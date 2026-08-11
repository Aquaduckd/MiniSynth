import {
  cloneParams,
  DEFAULT_EFFECTS,
  DEFAULT_PARAMS,
  ENVELOPE_HOLD,
  HARMONICS,
  MASTER_GAIN,
  MASTER_PREVIEW_HZ,
  MAX_DELAY_SECONDS,
  MIN_CUTOFF_HZ,
  OSC_COUNT,
} from "../constants.js";
import { noteToFrequency } from "../music/notes.js";
import type {
  ActiveVoice,
  EffectsParams,
  OscId,
  SynthParams,
} from "../types.js";
import {
  FM_MOD_DEPTH_RATIO,
  getFmAlgorithm,
} from "./fmAlgorithms.js";
import {
  clampRandomRate,
  createReverbImpulse,
  cutoffHz,
  delayTimeSeconds,
  filterQ,
  oscPitchKnobToCents,
  oscTunedFrequency,
  pitchPeakHz,
  pulseWidthToDuty,
  reverbDurationSeconds,
  sweepSeconds,
  vibratoDepthCents,
} from "./paramMath.js";
import {
  envelopeDiagramTime,
  envelopeLevelAtElapsed,
  previewFilterCutoffAtTime,
  type MasterPreviewVoice,
  type NotePlayheadState,
} from "./preview.js";

function readAudioParamValue(param: AudioParam, time: number): number {
  const reader = param as AudioParam & {
    getValueAtTime?: (value: number) => number;
  };
  if (typeof reader.getValueAtTime === "function") {
    return reader.getValueAtTime(time);
  }
  return param.value;
}

export class SimpleSynth {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayDry: GainNode | null = null;
  private delayWet: GainNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private reverbDry: GainNode | null = null;
  private reverbWet: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private effectsReady = false;
  private readonly voices = new Map<number, ActiveVoice>();
  private readonly heldNotes = new Set<number>();
  private readonly pendingStarts = new Set<number>();
  private readonly pulseReal = new Float32Array(HARMONICS);
  private readonly pulseImag = new Float32Array(HARMONICS);
  private readonly pulseWaves: Array<PeriodicWave | null> = Array.from(
    { length: OSC_COUNT },
    () => null,
  );
  private workletLoading: Promise<void> | null = null;
  private workletReady = false;
  private params: SynthParams = cloneParams(DEFAULT_PARAMS);
  private effectsParams: EffectsParams = { ...DEFAULT_EFFECTS };
  private previewChangeHandler: (() => void) | null = null;
  private lastPlayedNote: number | null = null;
  private lastPlayedNoteOnTime: number | null = null;
  private lastPlayedNoteRelease: {
    note: number;
    startTime: number;
    startLevel: number;
    diagramTime: number;
  } | null = null;

  setPreviewChangeHandler(handler: (() => void) | null): void {
    this.previewChangeHandler = handler;
  }

  private notifyPreviewChange(): void {
    this.previewChangeHandler?.();
  }

  private idlePreviewVoices(): MasterPreviewVoice[] {
    return [
      {
        baseFrequency: MASTER_PREVIEW_HZ,
        filterTimeOffset: sweepSeconds(this.params.filterSpeed),
      },
    ];
  }

  private hasConfiguredFilterSweep(): boolean {
    const initial = cutoffHz(this.params.filterInitial);
    const final = cutoffHz(this.params.filterFinal);
    if (Math.abs(initial - final) < 0.5) {
      return false;
    }

    return sweepSeconds(this.params.filterSpeed) > 0;
  }

  setParams(params: SynthParams): void {
    const previous = this.params;
    const configChanged = Array.from({ length: OSC_COUNT }, (_, osc) => {
      return (
        params.oscWaveforms[osc] !== previous.oscWaveforms[osc]
        || params.oscPulseWidths[osc] !== previous.oscPulseWidths[osc]
      );
    });
    const pitchChangedFlags = Array.from({ length: OSC_COUNT }, (_, osc) => {
      return params.oscPitches[osc] !== previous.oscPitches[osc];
    });
    const mixChanged = params.oscLevels.some(
      (level, osc) => level !== previous.oscLevels[osc],
    );
    const fmChanged =
      params.fmEnabled !== previous.fmEnabled
      || params.fmAlgorithm !== previous.fmAlgorithm
      || params.fmFeedback !== previous.fmFeedback;
    const filterChanged =
      params.filterInitial !== previous.filterInitial
      || params.filterFinal !== previous.filterFinal
      || params.filterSpeed !== previous.filterSpeed
      || params.filterResonance !== previous.filterResonance;
    const vibratoChanged =
      params.vibratoRate !== previous.vibratoRate
      || params.vibratoDelay !== previous.vibratoDelay
      || params.vibratoRamp !== previous.vibratoRamp
      || params.vibratoAmount !== previous.vibratoAmount
      || params.vibratoWaveform !== previous.vibratoWaveform;
    const vibratoWaveformChanged =
      params.vibratoWaveform !== previous.vibratoWaveform;
    const randomChanged =
      params.randomMode !== previous.randomMode
      || params.randomRate !== previous.randomRate
      || params.randomAmount !== previous.randomAmount;

    this.params = cloneParams(params);

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      if (configChanged[osc] && this.params.oscWaveforms[osc] === "pulse") {
        this.updatePulseWave(osc as OscId);
      }
    }

    for (const voice of this.voices.values()) {
      if (mixChanged || fmChanged || pitchChangedFlags.some(Boolean)) {
        this.applyOscRouting(voice);
      }
      if (this.context) {
        const when = this.context.currentTime;
        for (let osc = 0; osc < OSC_COUNT; osc += 1) {
          if (pitchChangedFlags[osc]) {
            this.applyOscPitch(voice, osc as OscId, when);
          }
          if (configChanged[osc]) {
            this.configureOscillator(
              voice.oscillators[osc],
              osc as OscId,
              this.context,
            );
          }
        }
      }
      if (filterChanged) {
        this.applyFilter(voice);
      }
      if (vibratoChanged) {
        this.applyVibrato(voice);
      }
      if (vibratoWaveformChanged && this.context) {
        this.configureVibratoOsc(voice.vibratoOsc);
      }
      if (randomChanged) {
        this.applyRandomMod(voice);
      }
    }

    if (
      mixChanged
      || fmChanged
      || filterChanged
      || pitchChangedFlags.some(Boolean)
      || configChanged.some(Boolean)
    ) {
      this.notifyPreviewChange();
    }
  }

  setEffectsParams(params: EffectsParams): void {
    const decayChanged =
      params.reverbDecay !== this.effectsParams.reverbDecay;
    this.effectsParams = { ...params };
    if (decayChanged) {
      this.updateReverbImpulse();
    }
    this.applyEffectsParams();
  }

  hasActiveVoices(): boolean {
    return this.voices.size > 0;
  }

  getPreviewVoices(): MasterPreviewVoice[] {
    if (!this.context) {
      return this.idlePreviewVoices();
    }

    const now = this.context.currentTime;
    const previewVoices: MasterPreviewVoice[] = [];

    for (const voice of this.voices.values()) {
      previewVoices.push({
        baseFrequency: voice.baseFrequency,
        filterTimeOffset: Math.max(0, now - voice.startTime),
      });
    }

    for (const note of this.heldNotes) {
      if (this.voices.has(note)) {
        continue;
      }

      previewVoices.push({
        baseFrequency: noteToFrequency(note),
        filterTimeOffset: 0,
      });
    }

    if (previewVoices.length === 0) {
      return this.idlePreviewVoices();
    }

    previewVoices.sort(
      (left, right) => left.baseFrequency - right.baseFrequency,
    );
    return previewVoices;
  }

  isFilterSweepActive(): boolean {
    if (!this.hasConfiguredFilterSweep() || !this.context) {
      return false;
    }

    if (this.heldNotes.size === 0) {
      return false;
    }

    const sweep = sweepSeconds(this.params.filterSpeed);
    const now = this.context.currentTime;

    for (const note of this.heldNotes) {
      if (!this.voices.has(note) || this.pendingStarts.has(note)) {
        return true;
      }
    }

    for (const voice of this.voices.values()) {
      if (now - voice.startTime < sweep) {
        return true;
      }
    }

    return false;
  }

  isLivePreviewActive(): boolean {
    if (!this.context) {
      return false;
    }

    if (this.heldNotes.size > 0) {
      return true;
    }

    if (this.lastPlayedNoteRelease !== null) {
      const elapsed =
        this.context.currentTime - this.lastPlayedNoteRelease.startTime;
      return elapsed < this.params.release;
    }

    return false;
  }

  getLastNotePlayhead(): NotePlayheadState | null {
    if (!this.context || this.lastPlayedNoteOnTime === null) {
      return null;
    }

    const now = this.context.currentTime;
    const params = this.params;
    const elapsed = now - this.lastPlayedNoteOnTime;
    const held =
      this.lastPlayedNote !== null && this.heldNotes.has(this.lastPlayedNote);

    let envelopeTime: number;
    let envelopeLevel: number;
    let filterElapsed: number;

    if (held) {
      envelopeLevel = envelopeLevelAtElapsed(params, elapsed);
      envelopeTime = envelopeDiagramTime(params, elapsed);
      filterElapsed = elapsed;
    } else if (
      this.lastPlayedNoteRelease !== null
      && this.lastPlayedNoteRelease.note === this.lastPlayedNote
    ) {
      const { startTime, startLevel, diagramTime } = this.lastPlayedNoteRelease;
      const releaseElapsed = now - startTime;
      if (releaseElapsed >= params.release) {
        return null;
      }

      envelopeLevel = startLevel * (1 - releaseElapsed / params.release);
      envelopeTime = Math.min(
        params.attack
          + params.decay
          + ENVELOPE_HOLD
          + params.release,
        diagramTime + releaseElapsed,
      );
      filterElapsed = Math.min(
        elapsed,
        sweepSeconds(params.filterSpeed),
      );
    } else {
      return null;
    }

    return {
      envelopeTime,
      envelopeLevel,
      filterCutoffHz: previewFilterCutoffAtTime(params, filterElapsed),
      vibratoTime: elapsed,
    };
  }

  private markLastPlayedNote(note: number): void {
    this.lastPlayedNote = note;
    this.lastPlayedNoteRelease = null;
    this.lastPlayedNoteOnTime = this.context?.currentTime ?? null;
    this.notifyPreviewChange();
  }

  private markLastPlayedNoteRelease(
    note: number,
    startTime: number,
    startLevel: number,
  ): void {
    if (this.lastPlayedNote !== note || this.lastPlayedNoteOnTime === null) {
      return;
    }

    const elapsed = startTime - this.lastPlayedNoteOnTime;
    this.lastPlayedNoteRelease = {
      note,
      startTime,
      startLevel,
      diagramTime: envelopeDiagramTime(this.params, elapsed),
    };
    this.notifyPreviewChange();
  }

  async ensureRunning(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.gain.value = 1;
      this.initEffectsChain(this.context);
      for (let osc = 0; osc < OSC_COUNT; osc += 1) {
        this.updatePulseWave(osc as OscId);
      }
      this.workletLoading = null;
      this.workletReady = false;
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
  }

  private async ensureRandomWorklet(context: AudioContext): Promise<void> {
    if (this.workletReady) {
      return;
    }

    if (!this.workletLoading) {
      this.workletLoading = context.audioWorklet
        .addModule(new URL("../random-lfo-worklet.js", import.meta.url))
        .then(() => {
          this.workletReady = true;
        });
    }

    await this.workletLoading;
  }

  private initEffectsChain(context: AudioContext): void {
    if (this.effectsReady || !this.output) {
      return;
    }

    this.delayNode = context.createDelay(MAX_DELAY_SECONDS);
    this.delayFeedback = context.createGain();
    this.delayDry = context.createGain();
    this.delayWet = context.createGain();

    this.reverbConvolver = context.createConvolver();
    this.reverbDry = context.createGain();
    this.reverbWet = context.createGain();
    this.masterGain = context.createGain();
    this.masterGain.gain.value = MASTER_GAIN;

    this.output.connect(this.delayDry);
    this.output.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);

    const delayBus = context.createGain();
    this.delayDry.connect(delayBus);
    this.delayWet.connect(delayBus);

    delayBus.connect(this.reverbDry);
    delayBus.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbWet);

    const reverbBus = context.createGain();
    this.reverbDry.connect(reverbBus);
    this.reverbWet.connect(reverbBus);

    reverbBus.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    this.updateReverbImpulse(context);
    this.applyEffectsParams();
    this.effectsReady = true;
  }

  private applyEffectsParams(): void {
    if (
      !this.delayNode ||
      !this.delayFeedback ||
      !this.delayDry ||
      !this.delayWet ||
      !this.reverbDry ||
      !this.reverbWet
    ) {
      return;
    }

    const { delayTime, delayFeedback, delayMix, reverbMix } =
      this.effectsParams;

    this.delayNode.delayTime.value = delayTimeSeconds(delayTime);
    this.delayFeedback.gain.value = delayFeedback;
    this.delayDry.gain.value = 1 - delayMix;
    this.delayWet.gain.value = delayMix;
    this.reverbDry.gain.value = 1 - reverbMix;
    this.reverbWet.gain.value = reverbMix;
    if (this.masterGain) {
      this.masterGain.gain.value = this.effectsParams.masterVolume;
    }
  }

  private updateReverbImpulse(context?: AudioContext): void {
    const ctx = context ?? this.context;
    if (!ctx || !this.reverbConvolver) {
      return;
    }

    const duration = reverbDurationSeconds(this.effectsParams.reverbDecay);
    const decay = 2 + this.effectsParams.reverbDecay * 5;
    this.reverbConvolver.buffer = createReverbImpulse(ctx, duration, decay);
  }

  noteOn(note: number): void {
    this.heldNotes.add(note);
    this.markLastPlayedNote(note);
    void this.startNote(note);
  }

  noteOff(note: number): void {
    this.heldNotes.delete(note);
    this.stopNote(note);
  }

  stopAll(): void {
    this.heldNotes.clear();
    for (const note of [...this.voices.keys()]) {
      this.stopNote(note);
    }
  }

  dispose(): void {
    this.heldNotes.clear();
    this.stopAll();
    void this.context?.close();
    this.context = null;
    this.output = null;
    this.delayNode = null;
    this.delayFeedback = null;
    this.delayDry = null;
    this.delayWet = null;
    this.reverbConvolver = null;
    this.reverbDry = null;
    this.reverbWet = null;
    this.masterGain = null;
    this.effectsReady = false;
    this.pulseWaves.fill(null);
    this.workletLoading = null;
    this.workletReady = false;
  }

  private async startNote(note: number): Promise<void> {
    if (this.voices.has(note) || this.pendingStarts.has(note)) {
      return;
    }

    this.pendingStarts.add(note);
    try {
      const context = await this.ensureRunning();
      if (
        !this.output ||
        this.voices.has(note) ||
        !this.heldNotes.has(note)
      ) {
        return;
      }

      await this.ensureRandomWorklet(context);
      if (
        !this.output ||
        this.voices.has(note) ||
        !this.heldNotes.has(note)
      ) {
        return;
      }

      const now = context.currentTime;
      const baseFrequency = noteToFrequency(note);

      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, now);

      const oscillators: OscillatorNode[] = [];
      const oscGains: GainNode[] = [];
      const mixGain = context.createGain();
      const filter1 = context.createBiquadFilter();
      const filter2 = context.createBiquadFilter();
      filter1.type = "lowpass";
      filter2.type = "lowpass";
      this.applyFilterSettings(filter1);
      this.applyFilterSettings(filter2);
      this.scheduleFilterSweep(filter1, now);
      this.scheduleFilterSweep(filter2, now);

      const vibratoOsc = context.createOscillator();
      this.configureVibratoOsc(vibratoOsc);
      vibratoOsc.frequency.setValueAtTime(this.params.vibratoRate, now);

      const vibratoGain = context.createGain();
      vibratoGain.gain.setValueAtTime(0, now);

      const randomLfo = new AudioWorkletNode(context, "random-lfo", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      const randomGain = context.createGain();
      randomGain.gain.value = 0;

      const pitchModScales: GainNode[] = [];

      for (let osc = 0; osc < OSC_COUNT; osc += 1) {
        const oscFrequency = oscTunedFrequency(
          baseFrequency,
          this.params.oscPitches[osc],
        );
        const oscillator = context.createOscillator();
        this.configureOscillator(oscillator, osc as OscId, context);
        oscillator.frequency.setValueAtTime(oscFrequency, now);
        this.schedulePitchContour(
          oscillator.frequency,
          oscFrequency,
          now,
        );

        const oscGain = context.createGain();
        oscillator.connect(oscGain);

        const pitchModScale = context.createGain();
        pitchModScale.gain.value = oscTunedFrequency(
          1,
          this.params.oscPitches[osc],
        );
        vibratoGain.connect(pitchModScale);
        randomGain.connect(pitchModScale);
        pitchModScale.connect(oscillator.frequency);

        oscillators.push(oscillator);
        oscGains.push(oscGain);
        pitchModScales.push(pitchModScale);
      }

      const fmModGains: GainNode[][] = Array.from({ length: OSC_COUNT }, () =>
        Array.from({ length: OSC_COUNT }, () => context.createGain()),
      );
      const fmFeedbackDelay = context.createDelay(0.05);
      fmFeedbackDelay.delayTime.value = 1 / context.sampleRate;
      const fmFeedbackGain = context.createGain();
      fmFeedbackGain.gain.value = 0;

      mixGain.connect(filter1);
      filter1.connect(filter2);
      filter2.connect(envelope);
      envelope.connect(this.output);
      vibratoOsc.connect(vibratoGain);
      randomLfo.connect(randomGain);

      const voice: ActiveVoice = {
        oscillators,
        oscGains,
        fmModGains,
        fmFeedbackDelay,
        fmFeedbackGain,
        pitchModScales,
        mixGain,
        filter1,
        filter2,
        vibratoOsc,
        vibratoGain,
        randomLfo,
        randomGain,
        envelope,
        baseFrequency,
        startTime: now,
        stopTimer: null,
      };

      if (!this.heldNotes.has(note)) {
        this.discardVoice(voice);
        return;
      }

      this.applyOscRouting(voice);
      this.scheduleAttack(envelope, now);
      this.applyVibrato(voice);
      this.applyRandomMod(voice);

      for (const oscillator of oscillators) {
        oscillator.start(now);
      }
      vibratoOsc.start(now);
      this.voices.set(note, voice);
      if (note === this.lastPlayedNote) {
        this.lastPlayedNoteOnTime = now;
      }
      this.notifyPreviewChange();
    } finally {
      this.pendingStarts.delete(note);
    }
  }

  private discardVoice(voice: ActiveVoice): void {
    if (voice.stopTimer !== null) {
      window.clearTimeout(voice.stopTimer);
      voice.stopTimer = null;
    }
    voice.vibratoGain.disconnect();
    voice.vibratoOsc.disconnect();
    voice.randomGain.disconnect();
    voice.randomLfo.port.postMessage({ type: "stop" });
    voice.randomLfo.disconnect();
    for (const scale of voice.pitchModScales) {
      scale.disconnect();
    }
    this.clearOscRouting(voice);
    for (let osc = 0; osc < voice.oscillators.length; osc += 1) {
      voice.oscillators[osc].disconnect();
      voice.oscGains[osc]?.disconnect();
    }
    voice.mixGain.disconnect();
    voice.filter1.disconnect();
    voice.filter2.disconnect();
    voice.envelope.disconnect();
  }

  private stopNote(note: number): void {
    const voice = this.voices.get(note);
    const context = this.context;
    if (!voice || !context) {
      return;
    }

    const now = context.currentTime;
    const releaseEnd = now + this.params.release;
    const currentGain = readAudioParamValue(voice.envelope.gain, now);

    this.voices.delete(note);
    this.markLastPlayedNoteRelease(note, now, currentGain);
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setValueAtTime(currentGain, now);
    voice.envelope.gain.linearRampToValueAtTime(0, releaseEnd);

    const stopAt = releaseEnd + 0.05;
    for (const oscillator of voice.oscillators) {
      oscillator.stop(stopAt);
    }
    voice.vibratoOsc.stop(stopAt);
    const delayMs = Math.max(0, (stopAt - now) * 1000);
    voice.stopTimer = window.setTimeout(() => {
      voice.stopTimer = null;
      voice.randomLfo.port.postMessage({ type: "stop" });
      voice.randomLfo.disconnect();
      voice.randomGain.disconnect();
    }, delayMs);
  }

  private scheduleAttack(envelope: GainNode, now: number): void {
    const { attack, decay, sustain } = this.params;
    const peakTime = now + attack;
    const decayTime = peakTime + decay;

    envelope.gain.linearRampToValueAtTime(1, peakTime);
    envelope.gain.linearRampToValueAtTime(sustain, decayTime);
  }

  /** Additive mix, or DX9-style FM using the same OscillatorNodes. */
  private applyOscRouting(voice: ActiveVoice): void {
    this.clearOscRouting(voice);

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      voice.oscGains[osc].gain.value = this.params.oscLevels[osc];
    }

    if (!this.params.fmEnabled) {
      for (let osc = 0; osc < OSC_COUNT; osc += 1) {
        voice.oscGains[osc].connect(voice.mixGain);
      }
      return;
    }

    const algorithm = getFmAlgorithm(this.params.fmAlgorithm);
    const carriers = new Set(algorithm.carriers);
    const depthHz = Math.max(20, voice.baseFrequency) * FM_MOD_DEPTH_RATIO;

    for (const osc of carriers) {
      voice.oscGains[osc].connect(voice.mixGain);
    }

    for (const { src, dest } of algorithm.edges) {
      const modGain = voice.fmModGains[dest][src];
      modGain.gain.value = depthHz;
      voice.oscGains[src].connect(modGain);
      modGain.connect(voice.oscillators[dest].frequency);
    }

    if (this.params.fmFeedback > 0) {
      const fb = algorithm.feedbackOp;
      voice.fmFeedbackGain.gain.value = depthHz * this.params.fmFeedback;
      voice.oscGains[fb].connect(voice.fmFeedbackDelay);
      voice.fmFeedbackDelay.connect(voice.fmFeedbackGain);
      voice.fmFeedbackGain.connect(voice.oscillators[fb].frequency);
    }
  }

  private clearOscRouting(voice: ActiveVoice): void {
    for (const gain of voice.oscGains) {
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    }
    for (const row of voice.fmModGains) {
      for (const gain of row) {
        try {
          gain.disconnect();
        } catch {
          // already disconnected
        }
      }
    }
    try {
      voice.fmFeedbackDelay.disconnect();
    } catch {
      // already disconnected
    }
    try {
      voice.fmFeedbackGain.disconnect();
    } catch {
      // already disconnected
    }
  }

  private applyOscPitch(voice: ActiveVoice, osc: OscId, when: number): void {
    const tuned = oscTunedFrequency(
      voice.baseFrequency,
      this.params.oscPitches[osc],
    );
    voice.oscillators[osc].frequency.cancelScheduledValues(when);
    voice.oscillators[osc].frequency.setValueAtTime(Math.max(20, tuned), when);
    voice.pitchModScales[osc].gain.setValueAtTime(
      oscTunedFrequency(1, this.params.oscPitches[osc]),
      when,
    );
  }

  private applyFilterSettings(filter: BiquadFilterNode): void {
    filter.frequency.value = cutoffHz(this.params.filterFinal);
    filter.Q.value = filterQ(this.params.filterResonance);
  }

  private applyFilter(voice: ActiveVoice): void {
    this.applyFilterSettings(voice.filter1);
    this.applyFilterSettings(voice.filter2);
  }

  private scheduleFilterSweep(filter: BiquadFilterNode, when: number): void {
    const initial = cutoffHz(this.params.filterInitial);
    const final = cutoffHz(this.params.filterFinal);
    const sweep = sweepSeconds(this.params.filterSpeed);
    const safeInitial = Math.max(initial, MIN_CUTOFF_HZ + 1);
    const safeFinal = Math.max(final, MIN_CUTOFF_HZ + 1);

    filter.frequency.cancelScheduledValues(when);
    filter.frequency.setValueAtTime(safeInitial, when);
    if (Math.abs(initial - final) < 0.5 || sweep <= 0) {
      filter.frequency.setValueAtTime(safeFinal, when);
      return;
    }

    filter.frequency.exponentialRampToValueAtTime(safeFinal, when + sweep);
  }

  private schedulePitchContour(
    frequency: AudioParam,
    baseFrequency: number,
    when: number,
  ): void {
    const pitchKnob = this.effectsParams.pitchAmount;

    if (oscPitchKnobToCents(pitchKnob) === 0) {
      return;
    }

    const peak = pitchPeakHz(baseFrequency, pitchKnob);
    const decay = sweepSeconds(this.effectsParams.pitchSpeed);
    const safeBase = Math.max(baseFrequency, 20);
    const safePeak = Math.max(peak, 20);

    frequency.cancelScheduledValues(when);
    frequency.setValueAtTime(safePeak, when);
    if (decay <= 0) {
      frequency.setValueAtTime(safeBase, when);
      return;
    }

    frequency.exponentialRampToValueAtTime(safeBase, when + decay);
  }

  private applyVibrato(voice: ActiveVoice): void {
    const context = this.context;
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const depth = this.vibratoDepthHz(voice.baseFrequency);
    const { vibratoDelay, vibratoRamp, vibratoRate } = this.params;
    const delayEnd = voice.startTime + vibratoDelay;
    const rampEnd = delayEnd + vibratoRamp;

    voice.vibratoOsc.frequency.setValueAtTime(vibratoRate, now);
    voice.vibratoGain.gain.cancelScheduledValues(now);

    if (now >= rampEnd) {
      voice.vibratoGain.gain.setValueAtTime(depth, now);
      return;
    }

    if (vibratoDelay <= 0 && vibratoRamp <= 0) {
      voice.vibratoGain.gain.setValueAtTime(depth, now);
      return;
    }

    const gainAtNow =
      now < delayEnd
        ? 0
        : vibratoRamp <= 0
          ? depth
          : depth * Math.min(1, (now - delayEnd) / vibratoRamp);

    voice.vibratoGain.gain.setValueAtTime(gainAtNow, now);

    if (now < delayEnd) {
      voice.vibratoGain.gain.setValueAtTime(0, delayEnd);
    }

    if (vibratoRamp > 0) {
      voice.vibratoGain.gain.linearRampToValueAtTime(depth, rampEnd);
    } else if (now < delayEnd) {
      voice.vibratoGain.gain.setValueAtTime(depth, delayEnd);
    }
  }

  private configureVibratoOsc(oscillator: OscillatorNode): void {
    oscillator.type = this.params.vibratoWaveform;
  }

  private vibratoDepthHz(baseFrequency: number): number {
    const cents = vibratoDepthCents(this.params.vibratoAmount);
    return baseFrequency * (2 ** (cents / 1200) - 1);
  }

  private randomDepthHz(baseFrequency: number): number {
    const cents = vibratoDepthCents(this.params.randomAmount);
    return baseFrequency * (2 ** (cents / 1200) - 1);
  }

  private applyRandomMod(voice: ActiveVoice): void {
    voice.randomLfo.port.postMessage({
      type: "params",
      mode: this.params.randomMode,
    });
    const rateParam = voice.randomLfo.parameters.get("rate");
    if (rateParam) {
      rateParam.value = clampRandomRate(this.params.randomRate);
    }
    // Worklet outputs ~±1; scale to depth in Hz.
    voice.randomGain.gain.value = this.randomDepthHz(voice.baseFrequency);
  }

  private configureOscillator(
    oscillator: OscillatorNode,
    osc: OscId,
    context: AudioContext,
  ): void {
    const waveform = this.params.oscWaveforms[osc];
    if (waveform === "pulse") {
      oscillator.setPeriodicWave(this.getPulseWave(osc, context));
      return;
    }
    if (waveform === "saw") {
      oscillator.type = "sawtooth";
      return;
    }
    if (waveform === "triangle") {
      oscillator.type = "triangle";
      return;
    }
    oscillator.type = "sine";
  }

  private getPulseWave(osc: OscId, context: AudioContext): PeriodicWave {
    if (!this.pulseWaves[osc]) {
      this.updatePulseWave(osc, context);
    }

    return (
      this.pulseWaves[osc]
      ?? context.createPeriodicWave(this.pulseReal, this.pulseImag)
    );
  }

  private updatePulseWave(osc: OscId, context?: AudioContext): void {
    const ctx = context ?? this.context;
    if (!ctx) {
      return;
    }

    const duty = pulseWidthToDuty(this.params.oscPulseWidths[osc]);
    this.pulseReal.fill(0);
    this.pulseImag.fill(0);

    for (let harmonic = 1; harmonic < HARMONICS; harmonic += 1) {
      this.pulseImag[harmonic] =
        (2 / (harmonic * Math.PI)) * Math.sin(harmonic * Math.PI * duty);
    }

    this.pulseWaves[osc] = ctx.createPeriodicWave(this.pulseReal, this.pulseImag);
  }
}
