import {
  createRotaryKnob,
  type RotaryKnobHandle,
  type RotaryKnobOptions,
} from "./RotaryKnob.js";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return target.isContentEditable;
}

const HARMONICS = 128;
const MASTER_PREVIEW_HZ = 220;
const MASTER_PREVIEW_PERIODS = 2;
const MAX_VIBRATO_SEMITONES = 24;
const VIBRATO_DEPTH_CENTS_LIMIT = 100;
const ENVELOPE_HOLD = 0.35;
const MIN_CUTOFF_HZ = 80;
const MAX_CUTOFF_HZ = 20000;
const MIN_FILTER_Q = 0.5;
const MAX_FILTER_Q = 4;

type Osc1Waveform = "pulse" | "saw";
type Osc2Waveform = "triangle" | "sine";
type VibratoWaveform = "triangle" | "square";

interface SynthParams {
  osc1Waveform: Osc1Waveform;
  osc2Waveform: Osc2Waveform;
  oscMix: number;
  pulseWidth: number;
  osc2Pitch: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterInitial: number;
  filterFinal: number;
  filterSpeed: number;
  filterResonance: number;
  vibratoRate: number;
  vibratoDelay: number;
  vibratoRamp: number;
  vibratoAmount: number;
  vibratoWaveform: VibratoWaveform;
}

interface EffectsParams {
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  reverbDecay: number;
  reverbMix: number;
  pitchSpeed: number;
  pitchAmount: number;
  masterVolume: number;
}

interface KeyLayout {
  semitone: number;
  label: string;
  keyCode?: string;
  white: boolean;
  whiteIndex?: number;
  tier: "main" | "upper";
}

interface ActiveVoice {
  osc1Osc: OscillatorNode;
  osc2Osc: OscillatorNode;
  osc1Gain: GainNode;
  osc2Gain: GainNode;
  mixGain: GainNode;
  filter1: BiquadFilterNode;
  filter2: BiquadFilterNode;
  vibratoOsc: OscillatorNode;
  vibratoGain: GainNode;
  envelope: GainNode;
  baseFrequency: number;
  startTime: number;
}

interface PlotPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const DEFAULT_PARAMS: SynthParams = {
  osc1Waveform: "pulse",
  osc2Waveform: "triangle",
  oscMix: 0,
  pulseWidth: 1,
  osc2Pitch: 0.5,
  attack: 0.01,
  decay: 0.12,
  sustain: 0.55,
  release: 0.2,
  filterInitial: 1,
  filterFinal: 1,
  filterSpeed: 0,
  filterResonance: (0.7 - MIN_FILTER_Q) / (MAX_FILTER_Q - MIN_FILTER_Q),
  vibratoRate: 5,
  vibratoDelay: 0.3,
  vibratoRamp: 0,
  vibratoAmount: vibratoCentsToKnob(20),
  vibratoWaveform: "triangle",
};

const MASTER_GAIN = 0.22;

const DEFAULT_EFFECTS: EffectsParams = {
  delayTime: 0.35,
  delayFeedback: 0.35,
  delayMix: 0,
  reverbDecay: 0.15,
  reverbMix: 0.3,
  pitchSpeed: 0.12,
  pitchAmount: 0.5,
  masterVolume: MASTER_GAIN,
};

const MIN_REVERB_SECONDS = 0;
const MAX_REVERB_SECONDS = 10;
const MAX_DELAY_SECONDS = 1;
const OSC2_PITCH_NEGATIVE_SECTION = 1 / 5;
const OSC2_PITCH_CENTS_SECTION = 3 / 5;
const OSC2_PITCH_POSITIVE_SECTION = 1 / 5;
const OSC2_PITCH_CENTS_LIMIT = 100;
const OSC2_PITCH_SEMITONE_EXTENT = 12;
const FILTER_SWEEP_MIN_SECONDS = 0;
const FILTER_SWEEP_MAX_SECONDS = 1;

type SectionColor =
  | "oscillator"
  | "filter"
  | "envelope"
  | "vibrato"
  | "delay"
  | "reverb"
  | "master";

interface PanelTheme {
  accent: string;
  accentBright: string;
  accentMuted: string;
  accentFill: string;
  markerDark: string;
  markerDarker: string;
}

const SECTION_THEMES: Record<SectionColor, PanelTheme> = {
  oscillator: {
    accent: "#34d399",
    accentBright: "#6ee7b7",
    accentMuted: "rgba(52, 211, 153, 0.55)",
    accentFill: "rgba(52, 211, 153, 0.12)",
    markerDark: "#10b981",
    markerDarker: "#059669",
  },
  filter: {
    accent: "#fb923c",
    accentBright: "#fdba74",
    accentMuted: "rgba(251, 146, 60, 0.55)",
    accentFill: "rgba(251, 146, 60, 0.12)",
    markerDark: "#f97316",
    markerDarker: "#ea580c",
  },
  envelope: {
    accent: "#facc15",
    accentBright: "#fef08a",
    accentMuted: "rgba(250, 204, 21, 0.55)",
    accentFill: "rgba(250, 204, 21, 0.12)",
    markerDark: "#eab308",
    markerDarker: "#ca8a04",
  },
  vibrato: {
    accent: "#60a5fa",
    accentBright: "#93c5fd",
    accentMuted: "rgba(96, 165, 250, 0.55)",
    accentFill: "rgba(96, 165, 250, 0.12)",
    markerDark: "#3b82f6",
    markerDarker: "#2563eb",
  },
  delay: {
    accent: "#f472b6",
    accentBright: "#f9a8d4",
    accentMuted: "rgba(244, 114, 182, 0.55)",
    accentFill: "rgba(244, 114, 182, 0.12)",
    markerDark: "#ec4899",
    markerDarker: "#db2777",
  },
  reverb: {
    accent: "#a78bfa",
    accentBright: "#c4b5fd",
    accentMuted: "rgba(167, 139, 250, 0.55)",
    accentFill: "rgba(167, 139, 250, 0.12)",
    markerDark: "#8b5cf6",
    markerDarker: "#7c3aed",
  },
  master: {
    accent: "#94a3b8",
    accentBright: "#cbd5e1",
    accentMuted: "rgba(148, 163, 184, 0.55)",
    accentFill: "rgba(148, 163, 184, 0.12)",
    markerDark: "#64748b",
    markerDarker: "#475569",
  },
};

const OSC1_OPTIONS: { value: Osc1Waveform; label: string }[] = [
  { value: "pulse", label: "Pulse" },
  { value: "saw", label: "Saw" },
];

const OSC2_OPTIONS: { value: Osc2Waveform; label: string }[] = [
  { value: "triangle", label: "Triangle" },
  { value: "sine", label: "Sine" },
];

const VIBRATO_OPTIONS: { value: VibratoWaveform; label: string }[] = [
  { value: "triangle", label: "Triangle" },
  { value: "square", label: "Square" },
];

const MIN_OCTAVE = 0;
const MAX_OCTAVE = 7;
const DEFAULT_OCTAVE = 4;
const MIN_TRANSPOSE = -11;
const MAX_TRANSPOSE = 11;
const DEFAULT_TRANSPOSE = 0;
const MAIN_WHITE_COUNT = 7;
const EXT_WHITE_COUNT = 4;
const TOTAL_WHITE_COUNT = MAIN_WHITE_COUNT + EXT_WHITE_COUNT;

const KEY_LAYOUT: KeyLayout[] = [
  { semitone: 0, label: "C", keyCode: "KeyA", white: true, whiteIndex: 0, tier: "main" },
  { semitone: 1, label: "C#", keyCode: "KeyW", white: false, tier: "main" },
  { semitone: 2, label: "D", keyCode: "KeyS", white: true, whiteIndex: 1, tier: "main" },
  { semitone: 3, label: "D#", keyCode: "KeyE", white: false, tier: "main" },
  { semitone: 4, label: "E", keyCode: "KeyD", white: true, whiteIndex: 2, tier: "main" },
  { semitone: 5, label: "F", keyCode: "KeyF", white: true, whiteIndex: 3, tier: "main" },
  { semitone: 6, label: "F#", keyCode: "KeyT", white: false, tier: "main" },
  { semitone: 7, label: "G", keyCode: "KeyG", white: true, whiteIndex: 4, tier: "main" },
  { semitone: 8, label: "G#", keyCode: "KeyY", white: false, tier: "main" },
  { semitone: 9, label: "A", keyCode: "KeyH", white: true, whiteIndex: 5, tier: "main" },
  { semitone: 10, label: "A#", keyCode: "KeyU", white: false, tier: "main" },
  { semitone: 11, label: "B", keyCode: "KeyJ", white: true, whiteIndex: 6, tier: "main" },
  { semitone: 12, label: "C", keyCode: "KeyK", white: true, whiteIndex: 7, tier: "upper" },
  { semitone: 13, label: "C#", keyCode: "KeyO", white: false, tier: "upper" },
  { semitone: 14, label: "D", keyCode: "KeyL", white: true, whiteIndex: 8, tier: "upper" },
  { semitone: 15, label: "D#", keyCode: "KeyP", white: false, tier: "upper" },
  { semitone: 16, label: "E", keyCode: "Semicolon", white: true, whiteIndex: 9, tier: "upper" },
  { semitone: 17, label: "F", keyCode: "Quote", white: true, whiteIndex: 10, tier: "upper" },
];

/** Firefox Quick Find: `/` searches text, `'` searches links. */
const BROWSER_FIND_KEY_CODES = new Set(["Quote"]);

const KEY_PRESSED_CLASSES = [
  "!bg-teal-400",
  "!border-teal-500",
  "!text-slate-900",
] as const;

function keyCodeLabel(keyCode: string): string {
  if (keyCode === "Semicolon") {
    return ";";
  }
  if (keyCode === "Quote") {
    return "'";
  }
  return keyCode.startsWith("Key") ? keyCode.slice(3) : keyCode;
}

function midiNoteLabel(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pitch = note % 12;
  const octave = Math.floor(note / 12) - 1;
  return `${names[pitch]}${octave}`;
}

function baseMidiForOctave(octave: number): number {
  return 12 * (octave + 1);
}

function cutoffHz(value: number): number {
  return MIN_CUTOFF_HZ * (MAX_CUTOFF_HZ / MIN_CUTOFF_HZ) ** value;
}

function filterQ(value: number): number {
  return MIN_FILTER_Q + value * (MAX_FILTER_Q - MIN_FILTER_Q);
}

function delayTimeSeconds(value: number): number {
  const min = 0.05;
  const max = MAX_DELAY_SECONDS;
  return min * (max / min) ** value;
}

function formatDelayTime(value: number): string {
  return `${Math.round(delayTimeSeconds(value) * 1000)} ms`;
}

function reverbDurationSeconds(value: number): number {
  return MIN_REVERB_SECONDS + value * (MAX_REVERB_SECONDS - MIN_REVERB_SECONDS);
}

function sweepSeconds(speed: number): number {
  const t = Math.min(1, Math.max(0, speed));
  return (
    FILTER_SWEEP_MIN_SECONDS +
    t * (FILTER_SWEEP_MAX_SECONDS - FILTER_SWEEP_MIN_SECONDS)
  );
}

function pitchPeakHz(baseHz: number, pitchKnob: number): number {
  const cents = osc2PitchKnobToCents(pitchKnob);
  if (cents === 0) {
    return baseHz;
  }

  const peak = baseHz * 2 ** (cents / 1200);
  return Math.max(20, peak);
}

function osc2TunedFrequency(baseHz: number, pitchKnob: number): number {
  const cents = osc2PitchKnobToCents(pitchKnob);
  return baseHz * 2 ** (cents / 1200);
}

function osc2PitchNegativeEnd(): number {
  return OSC2_PITCH_NEGATIVE_SECTION;
}

function osc2PitchCentsEnd(): number {
  return OSC2_PITCH_NEGATIVE_SECTION + OSC2_PITCH_CENTS_SECTION;
}

function osc2PitchKnobToCents(knob: number): number {
  const t = snapOsc2PitchKnob(knob);
  const negativeEnd = osc2PitchNegativeEnd();
  const centsEnd = osc2PitchCentsEnd();

  if (t <= negativeEnd) {
    const progress = t / negativeEnd;
    const index = Math.round(progress * (OSC2_PITCH_SEMITONE_EXTENT - 1));
    return (index - OSC2_PITCH_SEMITONE_EXTENT) * 100;
  }

  if (t <= centsEnd) {
    const progress = (t - negativeEnd) / OSC2_PITCH_CENTS_SECTION;
    return Math.round(
      -OSC2_PITCH_CENTS_LIMIT + progress * (2 * OSC2_PITCH_CENTS_LIMIT),
    );
  }

  const progress = (t - centsEnd) / OSC2_PITCH_POSITIVE_SECTION;
  const index = Math.round(progress * (OSC2_PITCH_SEMITONE_EXTENT - 1));
  return (index + 1) * 100;
}

function snapOsc2PitchKnob(knob: number): number {
  const t = Math.min(1, Math.max(0, knob));
  const negativeEnd = osc2PitchNegativeEnd();
  const centsEnd = osc2PitchCentsEnd();

  if (t <= negativeEnd) {
    const progress = t / negativeEnd;
    const index = Math.min(
      OSC2_PITCH_SEMITONE_EXTENT - 1,
      Math.max(0, Math.round(progress * (OSC2_PITCH_SEMITONE_EXTENT - 1))),
    );
    return (index / (OSC2_PITCH_SEMITONE_EXTENT - 1)) * negativeEnd;
  }

  if (t <= centsEnd) {
    const progress = (t - negativeEnd) / OSC2_PITCH_CENTS_SECTION;
    const cents = Math.round(
      -OSC2_PITCH_CENTS_LIMIT + progress * (2 * OSC2_PITCH_CENTS_LIMIT),
    );
    return negativeEnd
      + ((cents + OSC2_PITCH_CENTS_LIMIT) / (2 * OSC2_PITCH_CENTS_LIMIT))
        * OSC2_PITCH_CENTS_SECTION;
  }

  const progress = (t - centsEnd) / OSC2_PITCH_POSITIVE_SECTION;
  const index = Math.min(
    OSC2_PITCH_SEMITONE_EXTENT - 1,
    Math.max(0, Math.round(progress * (OSC2_PITCH_SEMITONE_EXTENT - 1))),
  );
  return centsEnd
    + (index / (OSC2_PITCH_SEMITONE_EXTENT - 1)) * OSC2_PITCH_POSITIVE_SECTION;
}

function formatOsc2Pitch(knob: number): string {
  const cents = osc2PitchKnobToCents(knob);
  if (cents === 0) {
    return "0¢";
  }

  if (Math.abs(cents) < OSC2_PITCH_CENTS_LIMIT) {
    return cents > 0 ? `+${cents}¢` : `${cents}¢`;
  }

  const semitones = cents / 100;
  return semitones > 0 ? `+${semitones} st` : `${semitones} st`;
}

function vibratoDepthCents(knob: number): number {
  const snapped = snapVibratoDepthKnob(knob);
  if (snapped <= 0.5) {
    return Math.round((snapped / 0.5) * VIBRATO_DEPTH_CENTS_LIMIT);
  }

  const index = Math.round(
    ((snapped - 0.5) / 0.5) * (MAX_VIBRATO_SEMITONES - 1),
  );
  return (index + 1) * 100;
}

function vibratoCentsToKnob(cents: number): number {
  if (cents <= VIBRATO_DEPTH_CENTS_LIMIT) {
    return (cents / VIBRATO_DEPTH_CENTS_LIMIT) * 0.5;
  }

  const semitone = Math.min(
    MAX_VIBRATO_SEMITONES,
    Math.max(1, Math.round(cents / 100)),
  );
  const index = semitone - 1;
  return 0.5 + (index / (MAX_VIBRATO_SEMITONES - 1)) * 0.5;
}

function snapVibratoDepthKnob(knob: number): number {
  const t = Math.min(1, Math.max(0, knob));
  if (t <= 0.5) {
    const cents = Math.round((t / 0.5) * VIBRATO_DEPTH_CENTS_LIMIT);
    return (cents / VIBRATO_DEPTH_CENTS_LIMIT) * 0.5;
  }

  const progress = (t - 0.5) / 0.5;
  const index = Math.min(
    MAX_VIBRATO_SEMITONES - 1,
    Math.max(0, Math.round(progress * (MAX_VIBRATO_SEMITONES - 1))),
  );
  return 0.5 + (index / (MAX_VIBRATO_SEMITONES - 1)) * 0.5;
}

function formatVibratoDepth(knob: number): string {
  const cents = vibratoDepthCents(knob);
  if (cents < VIBRATO_DEPTH_CENTS_LIMIT) {
    return `${cents}¢`;
  }

  return `${cents / 100} st`;
}

function vibratoDepthPreviewScale(knob: number): number {
  return snapVibratoDepthKnob(knob);
}

function createReverbImpulse(
  context: AudioContext,
  duration: number,
  decay: number,
): AudioBuffer {
  const sampleRate = context.sampleRate;
  if (duration <= 0) {
    const impulse = context.createBuffer(2, 1, sampleRate);
    impulse.getChannelData(0)[0] = 1;
    impulse.getChannelData(1)[0] = 1;
    return impulse;
  }

  const length = Math.floor(sampleRate * duration);
  const impulse = context.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const channelData = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      channelData[index] =
        (Math.random() * 2 - 1) * (1 - index / length) ** decay;
    }
  }

  return impulse;
}

function formatHz(hz: number): string {
  if (hz >= 1000) {
    return `${(hz / 1000).toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

function formatCutoff(value: number): string {
  return formatHz(cutoffHz(value));
}

function lowpassMagnitude(frequency: number, cutoff: number, q: number): number {
  const ratio = frequency / cutoff;
  if (q <= 0) {
    return 1 / Math.sqrt(1 + ratio * ratio);
  }
  const real = 1 - ratio * ratio;
  const imag = ratio / q;
  return 1 / Math.sqrt(real * real + imag * imag);
}

function lowpassMagnitude24dB(
  frequency: number,
  cutoff: number,
  q: number,
): number {
  const stage = lowpassMagnitude(frequency, cutoff, q);
  return stage * stage;
}

const MASTER_PREVIEW_SAMPLE_RATE = 48_000;
const MASTER_PREVIEW_WARM_PERIODS = 1;

function mixedOscAtTime(
  time: number,
  params: SynthParams,
  baseFrequency: number,
): number {
  const osc1Phase = (time * baseFrequency) % 1;
  const osc2Frequency = osc2TunedFrequency(baseFrequency, params.osc2Pitch);
  const osc2Phase = (time * osc2Frequency) % 1;
  const osc1 = osc1Sample(osc1Phase, params.osc1Waveform, params.pulseWidth);
  const osc2 = osc2Sample(osc2Phase, params.osc2Waveform);
  return osc1 * (1 - params.oscMix) + osc2 * params.oscMix;
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function lowpassBiquadCoeffs(
  sampleRate: number,
  frequency: number,
  q: number,
): BiquadCoeffs {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const b0 = (1 - cos) / 2;
  const b1 = 1 - cos;
  const b2 = (1 - cos) / 2;
  const a0 = 1 + alpha;
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: -2 * cos / a0,
    a2: (1 - alpha) / a0,
  };
}

class BiquadProcessor {
  private z1 = 0;

  private z2 = 0;

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  process(input: number, coeffs: BiquadCoeffs): number {
    const output = coeffs.b0 * input + this.z1;
    this.z1 = coeffs.b1 * input - coeffs.a1 * output + this.z2;
    this.z2 = coeffs.b2 * input - coeffs.a2 * output;
    return output;
  }
}

function previewFilterCutoffAtTime(params: SynthParams, time: number): number {
  const initial = cutoffHz(params.filterInitial);
  const final = cutoffHz(params.filterFinal);
  const sweep = sweepSeconds(params.filterSpeed);
  const safeInitial = Math.max(initial, MIN_CUTOFF_HZ + 1);
  const safeFinal = Math.max(final, MIN_CUTOFF_HZ + 1);

  if (Math.abs(initial - final) < 0.5 || sweep <= 0) {
    return safeFinal;
  }

  if (time >= sweep) {
    return safeFinal;
  }

  return safeInitial * (safeFinal / safeInitial) ** (time / sweep);
}

function clampPreviewCutoff(cutoff: number, sampleRate: number): number {
  return Math.min(Math.max(MIN_CUTOFF_HZ, cutoff), sampleRate * 0.49);
}

function applyDualLowpassSweepInPlace(
  samples: Float32Array,
  sampleRate: number,
  params: SynthParams,
  filterTimeOffset: number,
): void {
  const resonance = filterQ(params.filterResonance);
  const stage1 = new BiquadProcessor();
  const stage2 = new BiquadProcessor();

  for (let index = 0; index < samples.length; index += 1) {
    const time = filterTimeOffset + index / sampleRate;
    const cutoff = clampPreviewCutoff(
      previewFilterCutoffAtTime(params, time),
      sampleRate,
    );
    const coeffs = lowpassBiquadCoeffs(sampleRate, cutoff, resonance);
    let sample = stage1.process(samples[index], coeffs);
    sample = stage2.process(sample, coeffs);
    samples[index] = sample;
  }
}

function normalizeWaveformPeak(samples: Float32Array): void {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }

  if (peak <= 0) {
    return;
  }

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] /= peak;
  }
}

interface MasterPreviewVoice {
  baseFrequency: number;
  filterTimeOffset: number;
}

interface NotePlayheadState {
  envelopeTime: number;
  envelopeLevel: number;
  filterCutoffHz: number;
  vibratoTime: number;
}

function envelopeLevelAtElapsed(params: SynthParams, elapsed: number): number {
  const { attack, decay, sustain } = params;
  if (elapsed <= 0) {
    return 0;
  }

  if (attack > 0 && elapsed < attack) {
    return elapsed / attack;
  }

  const decayStart = Math.max(attack, 0);
  if (decay > 0 && elapsed < decayStart + decay) {
    const progress = (elapsed - decayStart) / decay;
    return 1 + (sustain - 1) * progress;
  }

  return sustain;
}

function envelopeDiagramTime(params: SynthParams, elapsed: number): number {
  const { attack, decay } = params;
  const sustainEnd = attack + decay + ENVELOPE_HOLD;

  if (elapsed <= attack + decay) {
    return elapsed;
  }

  return Math.min(sustainEnd, attack + decay + (elapsed - attack - decay));
}

function drawTimelinePlayhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.restore();
}

function buildFilteredMasterWaveform(
  params: SynthParams,
  sampleCount: number,
  previewVoices: MasterPreviewVoice[],
): Float32Array {
  const voices =
    previewVoices.length > 0
      ? previewVoices
      : [
          {
            baseFrequency: MASTER_PREVIEW_HZ,
            filterTimeOffset: sweepSeconds(params.filterSpeed),
          },
        ];
  const lowestHz = Math.min(...voices.map((voice) => voice.baseFrequency));
  const samplesPerPeriod = Math.max(
    32,
    Math.round(MASTER_PREVIEW_SAMPLE_RATE / lowestHz),
  );
  const visiblePeriods = MASTER_PREVIEW_PERIODS;
  const internalLength =
    samplesPerPeriod * (MASTER_PREVIEW_WARM_PERIODS + visiblePeriods);
  const buffer = new Float32Array(internalLength);

  for (const voice of voices) {
    const voiceBuffer = new Float32Array(internalLength);
    for (let index = 0; index < internalLength; index += 1) {
      const time = index / MASTER_PREVIEW_SAMPLE_RATE;
      voiceBuffer[index] = mixedOscAtTime(time, params, voice.baseFrequency);
    }
    applyDualLowpassSweepInPlace(
      voiceBuffer,
      MASTER_PREVIEW_SAMPLE_RATE,
      params,
      voice.filterTimeOffset,
    );
    for (let index = 0; index < internalLength; index += 1) {
      buffer[index] += voiceBuffer[index];
    }
  }

  const sliceStart = samplesPerPeriod * MASTER_PREVIEW_WARM_PERIODS;
  const sliceLength = samplesPerPeriod * visiblePeriods;
  const output = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const sourceIndex = Math.min(
      sliceLength - 1,
      Math.floor((index / Math.max(1, sampleCount - 1)) * (sliceLength - 1)),
    );
    output[index] = buffer[sliceStart + sourceIndex];
  }

  normalizeWaveformPeak(output);
  return output;
}

function readAudioParamValue(param: AudioParam, time: number): number {
  const reader = param as AudioParam & {
    getValueAtTime?: (value: number) => number;
  };
  if (typeof reader.getValueAtTime === "function") {
    return reader.getValueAtTime(time);
  }
  return param.value;
}

function noteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function parseMidiNoteEvent(
  data: Uint8Array,
): { type: "noteOn" | "noteOff"; note: number } | null {
  const status = data[0] & 0xf0;
  const note = data[1];
  const velocity = data[2] ?? 0;

  if (note > 127) {
    return null;
  }

  if (status === 0x90) {
    if (velocity === 0) {
      return { type: "noteOff", note };
    }
    return { type: "noteOn", note };
  }

  if (status === 0x80) {
    return { type: "noteOff", note };
  }

  return null;
}

function pulseSample(phase: number, width: number): number {
  return phase < width ? 1 : -1;
}

function pulseWidthToDuty(width: number): number {
  return Math.min(0.5, Math.max(0.001, width * 0.5));
}

function pulseWidthLabel(width: number): string {
  return `${Math.round(width * 50)}%`;
}

function osc1Sample(
  phase: number,
  waveform: Osc1Waveform,
  pulseWidth: number,
): number {
  if (waveform === "pulse") {
    return pulseSample(phase, pulseWidthToDuty(pulseWidth));
  }
  return 2 * phase - 1;
}

function osc2Sample(phase: number, waveform: Osc2Waveform): number {
  if (waveform === "sine") {
    return Math.sin(phase * Math.PI * 2);
  }
  return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
}

function oscWaveformLabel(waveform: Osc1Waveform | Osc2Waveform): string {
  return (
    OSC1_OPTIONS.find((option) => option.value === waveform)?.label
    ?? OSC2_OPTIONS.find((option) => option.value === waveform)?.label
    ?? waveform
  );
}

function setupCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { ctx, width, height };
}

function drawAdsrEnvelope(
  canvas: HTMLCanvasElement,
  params: SynthParams,
  theme: PanelTheme,
  playhead: NotePlayheadState | null = null,
): void {
  const setup = setupCanvas(canvas);
  if (!setup) {
    return;
  }

  const { ctx, width, height } = setup;
  const pad: PlotPadding = { top: 18, right: 14, bottom: 30, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);

  const { attack, decay, sustain, release } = params;
  const total = attack + decay + ENVELOPE_HOLD + release;
  const xAt = (time: number) => pad.left + (time / total) * plotW;
  const yAt = (level: number) => pad.top + (1 - level) * plotH;

  const points = [
    { x: xAt(0), y: yAt(0) },
    { x: xAt(attack), y: yAt(1) },
    { x: xAt(attack + decay), y: yAt(sustain) },
    { x: xAt(attack + decay + ENVELOPE_HOLD), y: yAt(sustain) },
    { x: xAt(total), y: yAt(0) },
  ];

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  for (let level = 0; level <= 1; level += 0.5) {
    const y = yAt(level);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = theme.accentFill;
  ctx.beginPath();
  ctx.moveTo(points[0].x, yAt(0));
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.lineTo(points[4].x, yAt(0));
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.stroke();

  const markers = [
    { label: "A", point: points[1], color: theme.accentBright },
    { label: "D", point: points[2], color: theme.accent },
    { label: "S", point: points[3], color: theme.markerDark },
    { label: "R", point: points[4], color: theme.markerDarker },
  ];

  for (const marker of markers) {
    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.arc(marker.point.x, marker.point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const phases = [
    { label: "Attack", center: (xAt(0) + xAt(attack)) / 2 },
    { label: "Decay", center: (xAt(attack) + xAt(attack + decay)) / 2 },
    { label: "Sustain", center: (xAt(attack + decay) + xAt(attack + decay + ENVELOPE_HOLD)) / 2 },
    { label: "Release", center: (xAt(attack + decay + ENVELOPE_HOLD) + xAt(total)) / 2 },
  ];

  ctx.fillStyle = "#64748b";
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const phase of phases) {
    ctx.fillText(phase.label, phase.center, height - 10);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#475569";
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.fillText("1.0", pad.left - 6, yAt(1) + 3);
  ctx.fillText("0", pad.left - 6, yAt(0) + 3);
  ctx.textAlign = "start";

  if (playhead) {
    drawTimelinePlayhead(
      ctx,
      xAt(playhead.envelopeTime),
      pad.top,
      pad.top + plotH,
      "#64748b",
    );
  }
}

function drawWaveformPreview(
  canvas: HTMLCanvasElement,
  params: SynthParams,
  theme: PanelTheme,
): void {
  const setup = setupCanvas(canvas);
  if (!setup) {
    return;
  }

  const { ctx, width, height } = setup;
  const pad: PlotPadding = { top: 16, right: 12, bottom: 22, left: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const midY = pad.top + plotH / 2;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, midY);
  ctx.lineTo(width - pad.right, midY);
  ctx.stroke();

  const samples = Math.max(120, Math.floor(plotW));
  const osc1Points: { x: number; y: number }[] = [];
  const osc2Points: { x: number; y: number }[] = [];
  const mixPoints: { x: number; y: number }[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const phase = index / samples;
    const osc1 = osc1Sample(phase, params.osc1Waveform, params.pulseWidth);
    const osc2 = osc2Sample(phase, params.osc2Waveform);
    const mixed = osc1 * (1 - params.oscMix) + osc2 * params.oscMix;
    const x = pad.left + (index / samples) * plotW;

    osc1Points.push({
      x,
      y: midY - osc1 * (plotH / 2 - 4),
    });
    osc2Points.push({
      x,
      y: midY - osc2 * (plotH / 2 - 4),
    });
    mixPoints.push({
      x,
      y: midY - mixed * (plotH / 2 - 4),
    });
  }

  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1.5;
  for (const points of [osc1Points, osc2Points]) {
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let index = 0; index < mixPoints.length; index += 1) {
    const point = mixPoints[index];
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillText(
    `${oscWaveformLabel(params.osc1Waveform)} + ${oscWaveformLabel(params.osc2Waveform)}`,
    pad.left,
    12,
  );
  ctx.fillStyle = theme.accent;
  ctx.fillText("Mix", pad.left + 120, 12);
  ctx.fillStyle = "#475569";
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.textAlign = "right";
  if (params.osc1Waveform === "pulse") {
    ctx.fillText(`${pulseWidthLabel(params.pulseWidth)} width`, width - pad.right, 12);
  }
  ctx.textAlign = "start";
}

function drawMasterOutputPreview(
  canvas: HTMLCanvasElement,
  params: SynthParams,
  previewVoices: MasterPreviewVoice[],
  theme: PanelTheme,
): void {
  const setup = setupCanvas(canvas);
  if (!setup) {
    return;
  }

  const { ctx, width, height } = setup;
  const pad: PlotPadding = { top: 8, right: 8, bottom: 8, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const midY = pad.top + plotH / 2;
  const amplitude = plotH / 2 - 2;
  const sampleCount = Math.max(120, Math.floor(plotW));
  const waveform = buildFilteredMasterWaveform(
    params,
    sampleCount,
    previewVoices,
  );

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, midY);
  ctx.lineTo(width - pad.right, midY);
  ctx.stroke();

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.beginPath();

  for (let index = 0; index < waveform.length; index += 1) {
    const x = pad.left + (index / (waveform.length - 1)) * plotW;
    const y = midY - waveform[index] * amplitude;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function drawFilterPreview(
  canvas: HTMLCanvasElement,
  params: SynthParams,
  theme: PanelTheme,
  playhead: NotePlayheadState | null = null,
): void {
  const setup = setupCanvas(canvas);
  if (!setup) {
    return;
  }

  const { ctx, width, height } = setup;
  const pad: PlotPadding = { top: 16, right: 12, bottom: 26, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const initialHz = cutoffHz(params.filterInitial);
  const finalHz = cutoffHz(params.filterFinal);
  const q = filterQ(params.filterResonance);
  const minF = 40;
  const maxF = MAX_CUTOFF_HZ;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  for (let level = 0; level <= 1; level += 0.5) {
    const y = pad.top + (1 - level) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  const samples = Math.max(160, Math.floor(plotW));
  const buildResponsePoints = (cutoff: number) => {
    const points: { x: number; magnitude: number }[] = [];
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const frequency = minF * (maxF / minF) ** t;
      points.push({
        x: pad.left + t * plotW,
        magnitude: lowpassMagnitude24dB(frequency, cutoff, q),
      });
    }
    return points;
  };

  const activeCutoff = playhead?.filterCutoffHz ?? finalHz;
  const activePoints = buildResponsePoints(activeCutoff);
  const finalPoints = buildResponsePoints(finalHz);
  const initialPoints =
    Math.abs(initialHz - finalHz) > 0.5
      ? buildResponsePoints(initialHz)
      : null;

  let peak = 1;
  for (const point of activePoints) {
    peak = Math.max(peak, point.magnitude);
  }
  for (const point of finalPoints) {
    peak = Math.max(peak, point.magnitude);
  }
  if (initialPoints) {
    for (const point of initialPoints) {
      peak = Math.max(peak, point.magnitude);
    }
  }

  const scale = Math.max(1.2, peak);
  const yForMagnitude = (magnitude: number) =>
    pad.top + (1 - magnitude / scale) * plotH;

  const drawResponsePath = (
    points: { x: number; magnitude: number }[],
    strokeStyle: string,
    fillStyle: string | null,
    lineWidth: number,
  ) => {
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      ctx.moveTo(points[0].x, pad.top + plotH);
      for (const point of points) {
        ctx.lineTo(point.x, yForMagnitude(point.magnitude));
      }
      ctx.lineTo(points[points.length - 1].x, pad.top + plotH);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const y = yForMagnitude(point.magnitude);
      if (index === 0) {
        ctx.moveTo(point.x, y);
      } else {
        ctx.lineTo(point.x, y);
      }
    }
    ctx.stroke();
  };

  if (initialPoints) {
    drawResponsePath(
      initialPoints,
      "rgba(100, 116, 139, 0.35)",
      null,
      1,
    );
  }

  drawResponsePath(activePoints, theme.accent, theme.accentFill, 2);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillText("24 dB LP", pad.left, 12);
  ctx.fillStyle = "#475569";
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.textAlign = "right";
  const cutoffLabel = playhead
    ? `${formatHz(activeCutoff)} · `
    : "";
  ctx.fillText(
    `${cutoffLabel}${formatHz(initialHz)} → ${formatHz(finalHz)} · ${Math.round(sweepSeconds(params.filterSpeed) * 1000)} ms · Q ${q.toFixed(1)}`,
    width - pad.right,
    12,
  );
  ctx.textAlign = "start";
}

function drawVibratoPreview(
  canvas: HTMLCanvasElement,
  params: SynthParams,
  theme: PanelTheme,
  playhead: NotePlayheadState | null = null,
): void {
  const setup = setupCanvas(canvas);
  if (!setup) {
    return;
  }

  const { ctx, width, height } = setup;
  const pad: PlotPadding = { top: 16, right: 12, bottom: 22, left: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const midY = pad.top + plotH / 2;
  const maxAmplitude = plotH / 2 - 6;
  const amplitude = vibratoDepthPreviewScale(params.vibratoAmount) * maxAmplitude;
  const baseDuration = Math.max(
    1,
    params.vibratoDelay + params.vibratoRamp + 0.5,
  );
  const delayFraction = Math.min(1, params.vibratoDelay / baseDuration);
  const delayX = pad.left + delayFraction * plotW;
  const windowDuration = baseDuration;
  let windowStart = 0;

  if (playhead && playhead.vibratoTime >= params.vibratoDelay) {
    windowStart = playhead.vibratoTime - delayFraction * windowDuration;
  }

  ctx.clearRect(0, 0, width, height);

  const samples = Math.max(160, Math.floor(plotW));
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let index = 0; index <= samples; index += 1) {
    const x = pad.left + (index / samples) * plotW;
    const time = windowStart + (index / samples) * windowDuration;
    const envelope = vibratoRampEnvelope(
      time,
      params.vibratoDelay,
      params.vibratoRamp,
    );
    const phase =
      Math.max(0, time - params.vibratoDelay) * Math.PI * 2 * params.vibratoRate;
    const wobble =
      envelope
      * vibratoWaveformValue(phase, params.vibratoWaveform)
      * amplitude;
    const y = midY - wobble;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillText("Pitch mod", pad.left, 12);
  ctx.fillStyle = "#475569";
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillText(
    `${params.vibratoWaveform} · ${params.vibratoRate.toFixed(1)} Hz · ${Math.round(params.vibratoDelay * 1000)} ms · ${Math.round(params.vibratoRamp * 1000)} ms · ${formatVibratoDepth(params.vibratoAmount)}`,
    width - pad.right,
    12,
  );
  ctx.textAlign = "start";

  if (playhead) {
    const playheadX =
      params.vibratoDelay > 0 && playhead.vibratoTime < params.vibratoDelay
        ? pad.left + (playhead.vibratoTime / baseDuration) * plotW
        : delayX;
    drawTimelinePlayhead(
      ctx,
      playheadX,
      pad.top,
      pad.top + plotH,
      "#64748b",
    );
  }
}

function vibratoRampEnvelope(
  time: number,
  delay: number,
  ramp: number,
): number {
  if (time < delay) {
    return 0;
  }

  if (ramp <= 0) {
    return 1;
  }

  return Math.min(1, (time - delay) / ramp);
}

function vibratoWaveformValue(
  phase: number,
  waveform: VibratoWaveform,
): number {
  switch (waveform) {
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case "square":
      return Math.sin(phase) >= 0 ? 1 : -1;
  }
}

class SimpleSynth {
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
  private pulseWave: PeriodicWave | null = null;
  private params: SynthParams = { ...DEFAULT_PARAMS };
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
    const osc1ConfigChanged =
      params.osc1Waveform !== this.params.osc1Waveform
      || (params.osc1Waveform === "pulse"
        && params.pulseWidth !== this.params.pulseWidth);
    const osc2ConfigChanged =
      params.osc2Waveform !== this.params.osc2Waveform;
    const mixChanged = params.oscMix !== this.params.oscMix;
    const osc2PitchChanged = params.osc2Pitch !== this.params.osc2Pitch;
    const filterChanged =
      params.filterInitial !== this.params.filterInitial
      || params.filterFinal !== this.params.filterFinal
      || params.filterSpeed !== this.params.filterSpeed
      || params.filterResonance !== this.params.filterResonance;
    const vibratoChanged =
      params.vibratoRate !== this.params.vibratoRate
      || params.vibratoDelay !== this.params.vibratoDelay
      || params.vibratoRamp !== this.params.vibratoRamp
      || params.vibratoAmount !== this.params.vibratoAmount
      || params.vibratoWaveform !== this.params.vibratoWaveform;
    const vibratoWaveformChanged =
      params.vibratoWaveform !== this.params.vibratoWaveform;

    this.params = params;

    if (osc1ConfigChanged && this.params.osc1Waveform === "pulse") {
      this.updatePulseWave();
    }

    for (const voice of this.voices.values()) {
      if (mixChanged) {
        this.applyMixLevels(voice);
      }
      if (osc2PitchChanged && this.context) {
        this.applyOsc2Pitch(voice, this.context.currentTime);
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
      if (this.context) {
        if (osc1ConfigChanged) {
          this.configureOsc1(voice.osc1Osc, this.context);
        }
        if (osc2ConfigChanged) {
          this.configureOsc2(voice.osc2Osc);
        }
      }
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
      this.updatePulseWave();
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
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
    this.pulseWave = null;
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

      const now = context.currentTime;
      const baseFrequency = noteToFrequency(note);

      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, now);

      const osc2BaseFrequency = osc2TunedFrequency(
        baseFrequency,
        this.params.osc2Pitch,
      );

      const osc1Osc = context.createOscillator();
      this.configureOsc1(osc1Osc, context);
      osc1Osc.frequency.setValueAtTime(baseFrequency, now);

      const osc2Osc = context.createOscillator();
      this.configureOsc2(osc2Osc);
      osc2Osc.frequency.setValueAtTime(osc2BaseFrequency, now);
      this.schedulePitchContour(osc1Osc, baseFrequency, now);
      this.schedulePitchContour(osc2Osc, osc2BaseFrequency, now);

      const osc1Gain = context.createGain();
      const osc2Gain = context.createGain();
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

      osc1Osc.connect(osc1Gain);
      osc2Osc.connect(osc2Gain);
      osc1Gain.connect(mixGain);
      osc2Gain.connect(mixGain);
      mixGain.connect(filter1);
      filter1.connect(filter2);
      filter2.connect(envelope);
      envelope.connect(this.output);

      vibratoOsc.connect(vibratoGain);
      vibratoGain.connect(osc1Osc.frequency);
      vibratoGain.connect(osc2Osc.frequency);

      const voice: ActiveVoice = {
        osc1Osc,
        osc2Osc,
        osc1Gain,
        osc2Gain,
        mixGain,
        filter1,
        filter2,
        vibratoOsc,
        vibratoGain,
        envelope,
        baseFrequency,
        startTime: now,
      };

      if (!this.heldNotes.has(note)) {
        this.discardVoice(voice);
        return;
      }

      this.applyMixLevels(voice);
      this.scheduleAttack(envelope, now);
      this.applyVibrato(voice);

      osc1Osc.start(now);
      osc2Osc.start(now);
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
    voice.vibratoGain.disconnect();
    voice.vibratoOsc.disconnect();
    voice.osc1Osc.disconnect();
    voice.osc2Osc.disconnect();
    voice.osc1Gain.disconnect();
    voice.osc2Gain.disconnect();
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
    voice.osc1Osc.stop(stopAt);
    voice.osc2Osc.stop(stopAt);
    voice.vibratoOsc.stop(stopAt);
  }

  private scheduleAttack(envelope: GainNode, now: number): void {
    const { attack, decay, sustain } = this.params;
    const peakTime = now + attack;
    const decayTime = peakTime + decay;

    envelope.gain.linearRampToValueAtTime(1, peakTime);
    envelope.gain.linearRampToValueAtTime(sustain, decayTime);
  }

  private applyMixLevels(voice: ActiveVoice): void {
    voice.osc1Gain.gain.value = 1 - this.params.oscMix;
    voice.osc2Gain.gain.value = this.params.oscMix;
  }

  private applyOsc2Pitch(voice: ActiveVoice, when: number): void {
    const tuned = osc2TunedFrequency(voice.baseFrequency, this.params.osc2Pitch);
    voice.osc2Osc.frequency.cancelScheduledValues(when);
    voice.osc2Osc.frequency.setValueAtTime(Math.max(20, tuned), when);
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
    oscillator: OscillatorNode,
    baseFrequency: number,
    when: number,
  ): void {
    const pitchKnob = this.effectsParams.pitchAmount;

    if (osc2PitchKnobToCents(pitchKnob) === 0) {
      return;
    }

    const peak = pitchPeakHz(baseFrequency, pitchKnob);
    const decay = sweepSeconds(this.effectsParams.pitchSpeed);
    const safeBase = Math.max(baseFrequency, 20);
    const safePeak = Math.max(peak, 20);

    oscillator.frequency.cancelScheduledValues(when);
    oscillator.frequency.setValueAtTime(safePeak, when);
    if (decay <= 0) {
      oscillator.frequency.setValueAtTime(safeBase, when);
      return;
    }

    oscillator.frequency.exponentialRampToValueAtTime(safeBase, when + decay);
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

  private configureOsc1(
    oscillator: OscillatorNode,
    context: AudioContext,
  ): void {
    if (this.params.osc1Waveform === "pulse") {
      oscillator.setPeriodicWave(this.getPulseWave(context));
      return;
    }

    oscillator.type = "sawtooth";
  }

  private configureOsc2(oscillator: OscillatorNode): void {
    oscillator.type =
      this.params.osc2Waveform === "triangle" ? "triangle" : "sine";
  }

  private getPulseWave(context: AudioContext): PeriodicWave {
    if (!this.pulseWave) {
      this.updatePulseWave(context);
    }

    return this.pulseWave ?? context.createPeriodicWave(this.pulseReal, this.pulseImag);
  }

  private updatePulseWave(context?: AudioContext): void {
    const ctx = context ?? this.context;
    if (!ctx) {
      return;
    }

    const duty = pulseWidthToDuty(this.params.pulseWidth);
    this.pulseReal.fill(0);
    this.pulseImag.fill(0);

    for (let harmonic = 1; harmonic < HARMONICS; harmonic += 1) {
      this.pulseImag[harmonic] =
        (2 / (harmonic * Math.PI)) * Math.sin(harmonic * Math.PI * duty);
    }

    this.pulseWave = ctx.createPeriodicWave(this.pulseReal, this.pulseImag);
  }
}

const CANVAS_PREVIEW_CLASS =
  "block aspect-[5/2] max-h-36 min-h-[4.5rem] w-full min-w-0";

const KNOB_SIZE_PX = 56;
const KNOB_GAP_PX = 8;
const KNOB_ROW_PADDING_PX = 24;
const OSC_WAVEFORM_BUTTON_WIDTH_PX = 64;

function knobRowMinWidth(knobCount: number): number {
  return (
    knobCount * KNOB_SIZE_PX +
    Math.max(0, knobCount - 1) * KNOB_GAP_PX +
    KNOB_ROW_PADDING_PX
  );
}

const MODULE_COLUMN_MIN_WIDTH = knobRowMinWidth(4);
const OSC_MODULE_MIN_WIDTH =
  2 * OSC_WAVEFORM_BUTTON_WIDTH_PX +
  3 * KNOB_SIZE_PX +
  4 * KNOB_GAP_PX +
  KNOB_ROW_PADDING_PX;
const VIBRATO_CONTROLS_MIN_WIDTH =
  OSC_WAVEFORM_BUTTON_WIDTH_PX +
  4 * KNOB_SIZE_PX +
  4 * KNOB_GAP_PX +
  KNOB_ROW_PADDING_PX;
const MASTER_CONTROLS_MIN_WIDTH =
  120 + KNOB_GAP_PX + KNOB_SIZE_PX + KNOB_ROW_PADDING_PX;

export class SynthApp {
  private root: HTMLDivElement | null = null;
  private controlsEl: HTMLDivElement | null = null;
  private keyboardWrapper: HTMLDivElement | null = null;
  private keyboardRow: HTMLDivElement | null = null;
  private whiteRow: HTMLDivElement | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private keyboardHeightPx = 96;
  private synth = new SimpleSynth();
  private params: SynthParams = { ...DEFAULT_PARAMS };
  private effectsParams: EffectsParams = { ...DEFAULT_EFFECTS };
  private pressedKeys = new Set<number>();
  private keyButtons = new Map<number, HTMLButtonElement>();
  private keyboardEnabled = false;
  private octave = DEFAULT_OCTAVE;
  private transpose = DEFAULT_TRANSPOSE;
  private keyboardBoard: HTMLDivElement | null = null;
  private octaveLabel: HTMLSpanElement | null = null;
  private octaveDownButton: HTMLButtonElement | null = null;
  private octaveUpButton: HTMLButtonElement | null = null;
  private transposeLabel: HTMLSpanElement | null = null;
  private transposeDownButton: HTMLButtonElement | null = null;
  private transposeUpButton: HTMLButtonElement | null = null;
  private envelopeCanvas: HTMLCanvasElement | null = null;
  private waveformCanvas: HTMLCanvasElement | null = null;
  private filterCanvas: HTMLCanvasElement | null = null;
  private vibratoCanvas: HTMLCanvasElement | null = null;
  private masterCanvas: HTMLCanvasElement | null = null;
  private widthKnobElement: HTMLElement | null = null;
  private osc1Buttons = new Map<Osc1Waveform, HTMLButtonElement>();
  private osc2Buttons = new Map<Osc2Waveform, HTMLButtonElement>();
  private vibratoButtons = new Map<VibratoWaveform, HTMLButtonElement>();
  private paramKnobs = new Map<string, RotaryKnobHandle>();
  private effectKnobs = new Map<keyof EffectsParams, RotaryKnobHandle>();
  private vizObserver: ResizeObserver | null = null;
  private livePreviewFrame: number | null = null;
  private midiAccess: MIDIAccess | null = null;
  private readonly midiBoundInputs = new Set<MIDIInput>();
  private readonly abort = new AbortController();

  mount(container: HTMLElement): void {
    if (this.root) {
      return;
    }

    this.synth.setPreviewChangeHandler(() => {
      this.updateLivePreviews();
      this.syncLivePreviewLoop();
    });

    this.root = document.createElement("div");
    this.root.className =
      "flex h-full w-full min-h-0 flex-col overflow-hidden text-slate-100";

    const header = document.createElement("div");
    header.className =
      "flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 text-xs text-slate-400";

    const headerLabel = document.createElement("div");
    headerLabel.className = "min-w-0 truncate";
    headerLabel.textContent =
      "Synth · keyboard, MIDI, or click · Z/X octave · ./ transpose";

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className =
      "shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    resetButton.textContent = "Reset";
    resetButton.addEventListener(
      "click",
      () => {
        this.resetToDefaults();
      },
      { signal: this.abort.signal },
    );

    header.append(headerLabel, resetButton);

    this.controlsEl = document.createElement("div");
    this.controlsEl.className =
      "flex min-h-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto overscroll-contain border-b border-slate-800 p-3";

    const moduleGrid = document.createElement("div");
    moduleGrid.className =
      "flex w-max max-w-full flex-wrap items-start justify-center gap-3";

    const filterDelayColumn = document.createElement("div");
    filterDelayColumn.className = "flex shrink-0 flex-col gap-3";
    filterDelayColumn.style.minWidth = `${MODULE_COLUMN_MIN_WIDTH}px`;

    const delayPedal = this.createDelayPedal();
    filterDelayColumn.append(this.createFilterPanel(), delayPedal);

    const envelopeReverbColumn = document.createElement("div");
    envelopeReverbColumn.className = "flex shrink-0 flex-col gap-3";
    envelopeReverbColumn.style.minWidth = `${MODULE_COLUMN_MIN_WIDTH}px`;

    const reverbPedal = this.createReverbPedal();
    envelopeReverbColumn.append(this.createEnvelopeSection(), reverbPedal);

    const vibratoColumn = document.createElement("div");
    vibratoColumn.className = "flex shrink-0 flex-col gap-3";
    vibratoColumn.style.minWidth = `${Math.max(
      MODULE_COLUMN_MIN_WIDTH,
      VIBRATO_CONTROLS_MIN_WIDTH,
      MASTER_CONTROLS_MIN_WIDTH,
    )}px`;

    const masterPedal = this.createMasterPedal();
    masterPedal.classList.add("shrink-0");
    vibratoColumn.append(this.createVibratoSection(), masterPedal);

    moduleGrid.append(
      this.createOscPitchPanel(),
      filterDelayColumn,
      envelopeReverbColumn,
      vibratoColumn,
    );

    this.controlsEl.append(moduleGrid);

    this.keyboardWrapper = this.createKeyboard();

    this.root.append(header, this.controlsEl, this.keyboardWrapper);
    container.append(this.root);

    this.keyboardEnabled = true;
    this.observeVisualizations(this.controlsEl);
    this.bindLayoutObserver();
    this.syncPanelLayout(container.clientWidth, container.clientHeight);
    this.updateVisualizations();
    this.bindKeyboard();
    this.bindMidi();
    this.bindWindowFocus();
  }

  destroy(): void {
    this.keyboardEnabled = false;
    this.stopLivePreviewLoop();
    this.synth.setPreviewChangeHandler(null);
    this.releaseAllKeys();
    this.synth.dispose();
    this.vizObserver?.disconnect();
    this.vizObserver = null;
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.unbindMidi();
    this.abort.abort();
    this.root?.remove();
    this.root = null;
    this.controlsEl = null;
    this.keyboardWrapper = null;
    this.keyboardRow = null;
    this.whiteRow = null;
    this.envelopeCanvas = null;
    this.waveformCanvas = null;
    this.filterCanvas = null;
    this.vibratoCanvas = null;
    this.masterCanvas = null;
    this.widthKnobElement = null;
    this.osc1Buttons.clear();
    this.osc2Buttons.clear();
    this.vibratoButtons.clear();
    this.paramKnobs.clear();
    this.effectKnobs.clear();
    this.keyButtons.clear();
  }

  private bindWindowFocus(): void {
    window.addEventListener(
      "blur",
      () => {
        this.releaseAllKeys();
      },
      { signal: this.abort.signal },
    );
  }

  private observeVisualizations(container: HTMLElement): void {
    this.vizObserver = new ResizeObserver(() => {
      this.updateVisualizations();
    });
    this.vizObserver.observe(container);
  }

  private bindLayoutObserver(): void {
    if (!this.root) {
      return;
    }

    this.layoutObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.syncPanelLayout(width, height);
    });
    this.layoutObserver.observe(this.root);
  }

  private syncPanelLayout(_width: number, height: number): void {
    this.keyboardHeightPx = Math.max(
      72,
      Math.min(144, Math.round(height * 0.24)),
    );
    this.applyKeyboardHeight();
  }

  private applyKeyboardHeight(): void {
    if (this.whiteRow) {
      this.whiteRow.style.height = `${this.keyboardHeightPx}px`;
    }
  }

  private updateVisualizations(): void {
    const playhead = this.synth.getLastNotePlayhead();

    if (this.envelopeCanvas) {
      drawAdsrEnvelope(
        this.envelopeCanvas,
        this.params,
        SECTION_THEMES.envelope,
        playhead,
      );
    }
    if (this.waveformCanvas) {
      drawWaveformPreview(
        this.waveformCanvas,
        this.params,
        SECTION_THEMES.oscillator,
      );
    }
    if (this.filterCanvas) {
      drawFilterPreview(
        this.filterCanvas,
        this.params,
        SECTION_THEMES.filter,
        playhead,
      );
    }
    if (this.vibratoCanvas) {
      drawVibratoPreview(
        this.vibratoCanvas,
        this.params,
        SECTION_THEMES.vibrato,
        playhead,
      );
    }
    this.updateMasterPreview();
    this.syncLivePreviewLoop();
  }

  private updateLivePreviews(): void {
    const playhead = this.synth.getLastNotePlayhead();

    if (this.envelopeCanvas) {
      drawAdsrEnvelope(
        this.envelopeCanvas,
        this.params,
        SECTION_THEMES.envelope,
        playhead,
      );
    }
    if (this.filterCanvas) {
      drawFilterPreview(
        this.filterCanvas,
        this.params,
        SECTION_THEMES.filter,
        playhead,
      );
    }
    if (this.vibratoCanvas) {
      drawVibratoPreview(
        this.vibratoCanvas,
        this.params,
        SECTION_THEMES.vibrato,
        playhead,
      );
    }
    this.updateMasterPreview();
  }

  private updateMasterPreview(): void {
    if (!this.masterCanvas) {
      return;
    }

    drawMasterOutputPreview(
      this.masterCanvas,
      this.params,
      this.synth.getPreviewVoices(),
      SECTION_THEMES.master,
    );
  }

  private syncLivePreviewLoop(): void {
    if (
      !this.keyboardEnabled ||
      !this.synth.isLivePreviewActive()
    ) {
      this.stopLivePreviewLoop();
      return;
    }

    if (this.livePreviewFrame !== null) {
      return;
    }

    const tick = () => {
      if (!this.synth.isLivePreviewActive()) {
        this.livePreviewFrame = null;
        this.updateVisualizations();
        return;
      }

      this.updateLivePreviews();
      this.livePreviewFrame = requestAnimationFrame(tick);
    };

    this.livePreviewFrame = requestAnimationFrame(tick);
  }

  private stopLivePreviewLoop(): void {
    if (this.livePreviewFrame === null) {
      return;
    }

    cancelAnimationFrame(this.livePreviewFrame);
    this.livePreviewFrame = null;
  }

  private createKnobRow(knobCount: number): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className =
      "flex shrink-0 flex-nowrap items-start justify-around gap-2 p-3";
    controls.style.minWidth = `${knobRowMinWidth(knobCount)}px`;
    return controls;
  }

  private themeKnobOptions(theme: SectionColor): Pick<
    RotaryKnobOptions,
    "accent" | "accentBright" | "valueColor"
  > {
    const colors = SECTION_THEMES[theme];
    return {
      accent: colors.accent,
      accentBright: colors.accentBright,
      valueColor: colors.accentBright,
    };
  }

  private createSectionHeading(title: string): HTMLElement {
    const heading = document.createElement("div");
    heading.className =
      "border-b border-slate-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400";
    heading.textContent = title;
    return heading;
  }

  private createSection(title: string): HTMLElement {
    const section = document.createElement("section");
    section.className =
      "flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";

    section.append(this.createSectionHeading(title));

    return section;
  }

  private createEffectFooter(
    title: string,
    controls: HTMLElement,
  ): HTMLElement {
    const footer = document.createElement("div");
    footer.className = "shrink-0";

    footer.append(this.createSectionHeading(title), controls);

    return footer;
  }

  private createLinkedPanel(): HTMLElement {
    const panel = document.createElement("section");
    panel.className =
      "flex min-h-0 shrink-0 flex-col gap-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";
    panel.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;
    return panel;
  }

  private createEnvelopeSection(): HTMLElement {
    const section = this.createSection("Envelope");

    this.envelopeCanvas = document.createElement("canvas");
    this.envelopeCanvas.className = CANVAS_PREVIEW_CLASS;

    const controls = this.createKnobRow(4);
    controls.append(
      this.createParamKnob(
        "A",
        "attack",
        0,
        1,
        0.001,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
      this.createParamKnob(
        "D",
        "decay",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
      this.createParamKnob(
        "S",
        "sustain",
        0,
        1,
        0.01,
        (value) => value.toFixed(2),
        "envelope",
      ),
      this.createParamKnob(
        "R",
        "release",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
    );

    section.append(this.envelopeCanvas, controls);
    return section;
  }

  private createFilterPanel(): HTMLElement {
    const section = this.createSection("Filter");

    this.filterCanvas = document.createElement("canvas");
    this.filterCanvas.className = CANVAS_PREVIEW_CLASS;

    const filterControls = this.createKnobRow(4);
    filterControls.append(
      this.createParamKnob(
        "Initial",
        "filterInitial",
        0,
        1,
        0.01,
        formatCutoff,
        "filter",
      ),
      this.createParamKnob(
        "Final",
        "filterFinal",
        0,
        1,
        0.01,
        formatCutoff,
        "filter",
      ),
      this.createParamKnob(
        "Speed",
        "filterSpeed",
        0,
        1,
        0.01,
        (value) => `${Math.round(sweepSeconds(value) * 1000)} ms`,
        "filter",
      ),
      this.createParamKnob(
        "Res",
        "filterResonance",
        0,
        1,
        0.01,
        (value) => filterQ(value).toFixed(1),
        "filter",
      ),
    );

    section.append(this.filterCanvas, filterControls);

    return section;
  }

  private createOscPitchPanel(): HTMLElement {
    const panel = this.createLinkedPanel();

    this.waveformCanvas = document.createElement("canvas");
    this.waveformCanvas.className = CANVAS_PREVIEW_CLASS;

    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-between gap-2 p-3";
    controlsRow.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const waveformGroup = document.createElement("div");
    waveformGroup.className = "flex shrink-0 items-end gap-2";

    const osc1Column = document.createElement("div");
    osc1Column.className = "flex shrink-0 flex-col items-center gap-0.5";

    const osc1Buttons = document.createElement("div");
    osc1Buttons.className = "flex flex-col gap-1";

    for (const option of OSC1_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
        this.setOsc1Waveform(option.value);
      });
      this.osc1Buttons.set(option.value, button);
      osc1Buttons.append(button);
    }

    const osc1Label = document.createElement("span");
    osc1Label.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    osc1Label.textContent = "Osc 1";
    osc1Column.append(knobValueSpacer.cloneNode(true), osc1Buttons, osc1Label);

    const osc2Column = document.createElement("div");
    osc2Column.className = "flex shrink-0 flex-col items-center gap-0.5";

    const osc2Buttons = document.createElement("div");
    osc2Buttons.className = "flex flex-col gap-1";

    for (const option of OSC2_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
        this.setOsc2Waveform(option.value);
      });
      this.osc2Buttons.set(option.value, button);
      osc2Buttons.append(button);
    }

    const osc2Label = document.createElement("span");
    osc2Label.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    osc2Label.textContent = "Osc 2";
    osc2Column.append(knobValueSpacer.cloneNode(true), osc2Buttons, osc2Label);

    waveformGroup.append(osc1Column, osc2Column);

    const knobsGroup = document.createElement("div");
    knobsGroup.className =
      "flex shrink-0 flex-nowrap items-start gap-2";

    this.widthKnobElement = this.createParamKnob(
      "Width",
      "pulseWidth",
      0,
      1,
      0.01,
      pulseWidthLabel,
      "oscillator",
    );
    this.widthKnobElement.classList.add("shrink-0");

    const mixKnob = this.createParamKnob(
      "Mix",
      "oscMix",
      0,
      1,
      0.01,
      (value) => `${Math.round(value * 100)}%`,
      "oscillator",
    );
    mixKnob.classList.add("shrink-0");

    const pitchKnob = this.createOsc2PitchKnob();
    pitchKnob.classList.add("shrink-0");

    knobsGroup.append(mixKnob, this.widthKnobElement, pitchKnob);

    controlsRow.append(waveformGroup, knobsGroup);

    const primary = document.createElement("div");
    primary.className = "flex min-w-0 flex-col";
    primary.append(this.createSectionHeading("Oscillator"), this.waveformCanvas, controlsRow);

    panel.append(
      primary,
      this.createEffectFooter("Pitch Envelope", this.createPitchControls()),
    );

    this.updateOscWaveformButtons();
    this.updateWidthKnobVisibility();
    return panel;
  }

  private createOscWaveformButton(
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";
    button.addEventListener("click", onClick, { signal: this.abort.signal });
    return button;
  }

  private setOsc1Waveform(waveform: Osc1Waveform): void {
    if (this.params.osc1Waveform === waveform) {
      return;
    }

    this.params.osc1Waveform = waveform;
    this.synth.setParams(this.params);
    this.updateOscWaveformButtons();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
  }

  private setOsc2Waveform(waveform: Osc2Waveform): void {
    if (this.params.osc2Waveform === waveform) {
      return;
    }

    this.params.osc2Waveform = waveform;
    this.synth.setParams(this.params);
    this.updateOscWaveformButtons();
    this.updateVisualizations();
  }

  private updateOscWaveformButtons(): void {
    const theme = SECTION_THEMES.oscillator;
    const inactiveClass =
      "w-16 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
    const baseClass =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";

    const applyState = (
      button: HTMLButtonElement,
      active: boolean,
    ): void => {
      if (active) {
        button.className = baseClass;
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className = inactiveClass;
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    };

    for (const [waveform, button] of this.osc1Buttons) {
      applyState(button, this.params.osc1Waveform === waveform);
    }

    for (const [waveform, button] of this.osc2Buttons) {
      applyState(button, this.params.osc2Waveform === waveform);
    }
  }

  private updateWidthKnobVisibility(): void {
    this.widthKnobElement?.classList.toggle(
      "hidden",
      this.params.osc1Waveform !== "pulse",
    );
  }

  private createVibratoSection(): HTMLElement {
    const section = this.createSection("Vibrato");

    this.vibratoCanvas = document.createElement("canvas");
    this.vibratoCanvas.className = CANVAS_PREVIEW_CLASS;

    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-between gap-2 p-3";
    controlsRow.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const waveformGroup = document.createElement("div");
    waveformGroup.className = "flex shrink-0 flex-col items-center gap-0.5";

    const waveformButtons = document.createElement("div");
    waveformButtons.className = "flex flex-col gap-1";

    for (const option of VIBRATO_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
        this.setVibratoWaveform(option.value);
      });
      this.vibratoButtons.set(option.value, button);
      waveformButtons.append(button);
    }

    const waveformLabel = document.createElement("span");
    waveformLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    waveformLabel.textContent = "Wave";
    waveformGroup.append(knobValueSpacer, waveformButtons, waveformLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";

    knobsGroup.append(
      this.createParamKnob(
        "Rate",
        "vibratoRate",
        0.5,
        20,
        0.1,
        (value) => `${value.toFixed(1)} Hz`,
        "vibrato",
      ),
      this.createParamKnob(
        "Delay",
        "vibratoDelay",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "vibrato",
      ),
      this.createParamKnob(
        "Ramp",
        "vibratoRamp",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "vibrato",
      ),
      this.createVibratoDepthKnob(),
    );

    controlsRow.append(waveformGroup, knobsGroup);
    section.append(this.vibratoCanvas, controlsRow);

    this.updateVibratoWaveformButtons();
    return section;
  }

  private setVibratoWaveform(waveform: VibratoWaveform): void {
    if (this.params.vibratoWaveform === waveform) {
      return;
    }

    this.params.vibratoWaveform = waveform;
    this.synth.setParams(this.params);
    this.updateVibratoWaveformButtons();
    this.updateVisualizations();
  }

  private updateVibratoWaveformButtons(): void {
    const theme = SECTION_THEMES.vibrato;
    const inactiveClass =
      "w-16 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
    const baseClass =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";

    const applyState = (
      button: HTMLButtonElement,
      active: boolean,
    ): void => {
      if (active) {
        button.className = baseClass;
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className = inactiveClass;
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    };

    for (const [waveform, button] of this.vibratoButtons) {
      applyState(button, this.params.vibratoWaveform === waveform);
    }
  }

  private createDelayPedal(): HTMLElement {
    const section = this.createSection("Delay");

    const controls = this.createKnobRow(3);
    controls.append(
      this.createEffectKnob(
        "Time",
        "delayTime",
        0,
        1,
        0.01,
        formatDelayTime,
        "delay",
      ),
      this.createEffectKnob(
        "Fdbk",
        "delayFeedback",
        0,
        0.85,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "delay",
      ),
      this.createEffectKnob(
        "Mix",
        "delayMix",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "delay",
      ),
    );

    section.append(controls);
    return section;
  }

  private createReverbPedal(): HTMLElement {
    const section = this.createSection("Reverb");

    const controls = this.createKnobRow(2);
    controls.append(
      this.createEffectKnob(
        "Decay",
        "reverbDecay",
        0,
        1,
        0.01,
        (value) => `${reverbDurationSeconds(value).toFixed(1)} s`,
        "reverb",
      ),
      this.createEffectKnob(
        "Mix",
        "reverbMix",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "reverb",
      ),
    );

    section.append(controls);
    return section;
  }

  private createMasterPedal(): HTMLElement {
    const section = this.createSection("Master");
    section.classList.add("shrink-0");

    const controls = document.createElement("div");
    controls.className =
      "grid w-full shrink-0 grid-cols-[minmax(120px,1fr)_auto] items-stretch gap-3 p-3";
    controls.style.minWidth = `${MASTER_CONTROLS_MIN_WIDTH}px`;

    const preview = document.createElement("div");
    preview.className = "relative h-full min-h-0 min-w-0";

    this.masterCanvas = document.createElement("canvas");
    this.masterCanvas.className =
      "absolute inset-0 block h-full w-full rounded border border-slate-800 bg-slate-950/80";
    preview.append(this.masterCanvas);

    const volumeKnob = this.createMasterVolumeKnob();
    volumeKnob.classList.add("shrink-0", "self-end");

    controls.append(preview, volumeKnob);

    section.append(controls);
    return section;
  }

  private createPitchControls(): HTMLElement {
    const controls = this.createKnobRow(2);
    controls.append(
      this.createEffectKnob(
        "Speed",
        "pitchSpeed",
        0,
        1,
        0.01,
        (value) => `${Math.round(sweepSeconds(value) * 1000)} ms`,
        "oscillator",
      ),
      this.createPitchAmountKnob(),
    );
    return controls;
  }

  private createPitchAmountKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Amount",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapOsc2PitchKnob(this.effectsParams.pitchAmount),
      format: formatOsc2Pitch,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOsc2PitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.effectsParams = { ...this.effectsParams, pitchAmount: snapped };
        this.synth.setEffectsParams(this.effectsParams);
      },
    });

    this.effectKnobs.set("pitchAmount", knob);
    return knob.element;
  }

  private createEffectKnob(
    label: string,
    key: keyof EffectsParams,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    theme: SectionColor,
  ): HTMLElement {
    const knob = createRotaryKnob({
      label,
      min,
      max,
      step,
      value: this.effectsParams[key],
      format,
      ...this.themeKnobOptions(theme),
      onChange: (value) => {
        this.effectsParams = { ...this.effectsParams, [key]: value };
        this.synth.setEffectsParams(this.effectsParams);
      },
    });

    this.effectKnobs.set(key, knob);
    return knob.element;
  }

  private createMasterVolumeKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Volume",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.effectsParams.masterVolume,
      format: (value) => `${Math.round(value * 100)}%`,
      ...this.themeKnobOptions("master"),
      onChange: (value) => {
        this.effectsParams = { ...this.effectsParams, masterVolume: value };
        this.synth.setEffectsParams(this.effectsParams);
      },
    });

    this.effectKnobs.set("masterVolume", knob);
    return knob.element;
  }

  private createOsc2PitchKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Pitch",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapOsc2PitchKnob(this.params.osc2Pitch),
      format: formatOsc2Pitch,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOsc2PitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params = { ...this.params, osc2Pitch: snapped };
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set("osc2Pitch", knob);
    return knob.element;
  }

  private createVibratoDepthKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Depth",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapVibratoDepthKnob(this.params.vibratoAmount),
      format: formatVibratoDepth,
      ...this.themeKnobOptions("vibrato"),
      onChange: (value) => {
        const snapped = snapVibratoDepthKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params = { ...this.params, vibratoAmount: snapped };
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set("vibratoAmount", knob);
    return knob.element;
  }

  private createParamKnob(
    label: string,
    key: {
      [K in keyof SynthParams]: SynthParams[K] extends number ? K : never;
    }[keyof SynthParams],
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    theme: SectionColor,
  ): HTMLElement {
    const knob = createRotaryKnob({
      label,
      min,
      max,
      step,
      value: this.params[key] as number,
      format,
      ...this.themeKnobOptions(theme),
      onChange: (value) => {
        this.params = { ...this.params, [key]: value };
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private resetToDefaults(): void {
    this.params = { ...DEFAULT_PARAMS };
    this.effectsParams = { ...DEFAULT_EFFECTS };
    this.synth.setParams(this.params);
    this.synth.setEffectsParams(this.effectsParams);

    for (const [key, knob] of this.paramKnobs) {
      const value = this.params[key as keyof SynthParams];
      if (typeof value !== "number") {
        continue;
      }

      if (key === "osc2Pitch") {
        knob.setValue(snapOsc2PitchKnob(value));
        continue;
      }

      if (key === "vibratoAmount") {
        knob.setValue(snapVibratoDepthKnob(value));
        continue;
      }

      knob.setValue(value);
    }

    for (const [key, knob] of this.effectKnobs) {
      if (key === "pitchAmount") {
        knob.setValue(snapOsc2PitchKnob(this.effectsParams.pitchAmount));
        continue;
      }

      knob.setValue(this.effectsParams[key]);
    }

    this.updateOscWaveformButtons();
    this.updateVibratoWaveformButtons();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
  }

  private createKeyboard(): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className =
      "flex shrink-0 flex-col justify-end px-3 pb-3 pt-2";

    this.keyboardRow = document.createElement("div");
    this.keyboardRow.className =
      "mx-auto flex w-full min-w-0 flex-nowrap items-center gap-2";

    const pitchButtonClass =
      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-sm leading-none text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";
    const pitchLabelClass =
      "w-full py-1 text-center font-mono text-xs tabular-nums text-slate-400";
    const pitchColumnClass =
      "flex w-[4.75rem] shrink-0 flex-col items-center gap-1";

    const octaveColumn = document.createElement("div");
    octaveColumn.className = pitchColumnClass;

    this.octaveDownButton = document.createElement("button");
    this.octaveDownButton.type = "button";
    this.octaveDownButton.textContent = "-";
    this.octaveDownButton.title = "Octave down";
    this.octaveDownButton.className = pitchButtonClass;
    this.octaveDownButton.addEventListener(
      "click",
      () => {
        this.setOctave(this.octave - 1);
      },
      { signal: this.abort.signal },
    );

    this.octaveLabel = document.createElement("span");
    this.octaveLabel.className = pitchLabelClass;
    this.octaveLabel.textContent = this.formatOctaveLabel();

    this.octaveUpButton = document.createElement("button");
    this.octaveUpButton.type = "button";
    this.octaveUpButton.textContent = "+";
    this.octaveUpButton.title = "Octave up";
    this.octaveUpButton.className = pitchButtonClass;
    this.octaveUpButton.addEventListener(
      "click",
      () => {
        this.setOctave(this.octave + 1);
      },
      { signal: this.abort.signal },
    );

    octaveColumn.append(
      this.octaveUpButton,
      this.octaveLabel,
      this.octaveDownButton,
    );

    const transposeColumn = document.createElement("div");
    transposeColumn.className = pitchColumnClass;

    this.transposeDownButton = document.createElement("button");
    this.transposeDownButton.type = "button";
    this.transposeDownButton.textContent = "-";
    this.transposeDownButton.title = "Transpose down (semitone)";
    this.transposeDownButton.className = pitchButtonClass;
    this.transposeDownButton.addEventListener(
      "click",
      () => {
        this.setTranspose(this.transpose - 1);
      },
      { signal: this.abort.signal },
    );

    this.transposeLabel = document.createElement("span");
    this.transposeLabel.className = pitchLabelClass;
    this.transposeLabel.textContent = this.formatTransposeLabel();

    this.transposeUpButton = document.createElement("button");
    this.transposeUpButton.type = "button";
    this.transposeUpButton.textContent = "+";
    this.transposeUpButton.title = "Transpose up (semitone)";
    this.transposeUpButton.className = pitchButtonClass;
    this.transposeUpButton.addEventListener(
      "click",
      () => {
        this.setTranspose(this.transpose + 1);
      },
      { signal: this.abort.signal },
    );

    transposeColumn.append(
      this.transposeUpButton,
      this.transposeLabel,
      this.transposeDownButton,
    );

    this.keyboardBoard = document.createElement("div");
    this.keyboardBoard.className = "relative min-w-0 flex-1";

    this.keyboardRow.append(octaveColumn, this.keyboardBoard, transposeColumn);
    wrapper.append(this.keyboardRow);
    this.renderKeyboardKeys();
    this.updatePitchControls();
    return wrapper;
  }

  private renderKeyboardKeys(): void {
    if (!this.keyboardBoard) {
      return;
    }

    this.keyButtons.clear();
    this.keyboardBoard.replaceChildren();

    const whiteWidth = 100 / TOTAL_WHITE_COUNT;

    this.whiteRow = document.createElement("div");
    this.whiteRow.className = "relative flex min-h-[4.5rem] w-full gap-px";

    const whiteKeys = KEY_LAYOUT.filter((item) => item.white).sort(
      (left, right) => left.semitone - right.semitone,
    );

    for (const layout of whiteKeys) {
      const button = this.createKeyButton(layout);
      const extension = layout.tier === "upper";
      button.className += extension
        ? " min-w-0 flex-1 rounded-b-md border border-slate-600 bg-slate-300 text-slate-900 transition-colors hover:bg-slate-100 active:bg-teal-200"
        : " min-w-0 flex-1 rounded-b-md border border-slate-700 bg-slate-200 text-slate-900 transition-colors hover:bg-white active:bg-teal-200";
      this.whiteRow.append(button);
    }

    for (const layout of KEY_LAYOUT.filter((item) => !item.white)) {
      const prevWhite = KEY_LAYOUT.find(
        (item) => item.white && item.semitone === layout.semitone - 1,
      );
      if (prevWhite?.whiteIndex === undefined) {
        continue;
      }

      const button = this.createKeyButton(layout);
      const extension = layout.tier === "upper";
      button.className += extension
        ? " absolute top-0 z-10 h-[58%] rounded-b-md border border-slate-900 bg-slate-600 text-[10px] text-slate-100 transition-colors hover:bg-slate-500 active:bg-teal-700"
        : " absolute top-0 z-10 h-[58%] rounded-b-md border border-slate-900 bg-slate-700 text-[10px] text-slate-200 transition-colors hover:bg-slate-600 active:bg-teal-700";
      button.style.left = `${(prevWhite.whiteIndex + 0.68) * whiteWidth}%`;
      button.style.width = `${whiteWidth * 0.64}%`;
      this.whiteRow.append(button);
    }

    this.keyboardBoard.append(this.whiteRow);
    this.applyKeyboardHeight();
  }

  private formatOctaveLabel(): string {
    return `Oct ${this.octave}`;
  }

  private formatTransposeLabel(): string {
    const sign = this.transpose >= 0 ? "+" : "-";
    return `Tr ${sign}${Math.abs(this.transpose)}`;
  }

  private refreshKeyboardNoteLabels(): void {
    if (!this.keyboardBoard) {
      return;
    }

    const nextButtons = new Map<number, HTMLButtonElement>();

    for (const layout of KEY_LAYOUT) {
      const note = this.noteForLayout(layout);
      const button = this.keyboardBoard.querySelector<HTMLButtonElement>(
        `button[data-key-code="${layout.keyCode}"]`,
      );
      if (!button) {
        continue;
      }

      button.dataset.note = String(note);
      const noteLabel = button.querySelector("[data-note-label]");
      if (noteLabel) {
        noteLabel.textContent = midiNoteLabel(note);
      }
      nextButtons.set(note, button);
    }

    this.keyButtons = nextButtons;
  }

  private baseMidiNote(): number {
    return baseMidiForOctave(this.octave) + this.transpose;
  }

  private noteForLayout(layout: KeyLayout): number {
    return this.baseMidiNote() + layout.semitone;
  }

  private noteForKeyCode(keyCode: string): number | undefined {
    const layout = KEY_LAYOUT.find((item) => item.keyCode === keyCode);
    if (!layout) {
      return undefined;
    }

    return this.noteForLayout(layout);
  }

  private shouldHandleKeyboard(event: KeyboardEvent): boolean {
    if (!this.keyboardEnabled) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (isEditableTarget(event.target)) {
      return false;
    }

    return true;
  }

  private isCapturedKeyCode(keyCode: string): boolean {
    if (
      keyCode === "KeyZ" ||
      keyCode === "KeyX" ||
      keyCode === "Period" ||
      keyCode === "Slash"
    ) {
      return true;
    }
    if (BROWSER_FIND_KEY_CODES.has(keyCode)) {
      return true;
    }

    return this.noteForKeyCode(keyCode) !== undefined;
  }

  private suppressBrowserKey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private setOctave(octave: number): void {
    const clamped = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, octave));
    if (clamped === this.octave) {
      return;
    }

    this.releaseAllKeys();
    this.octave = clamped;
    if (this.octaveLabel) {
      this.octaveLabel.textContent = this.formatOctaveLabel();
    }
    this.updatePitchControls();
    this.refreshKeyboardNoteLabels();
  }

  private setTranspose(semitones: number): void {
    const clamped = Math.min(MAX_TRANSPOSE, Math.max(MIN_TRANSPOSE, semitones));
    if (clamped === this.transpose) {
      return;
    }

    this.releaseAllKeys();
    this.transpose = clamped;
    if (this.transposeLabel) {
      this.transposeLabel.textContent = this.formatTransposeLabel();
    }
    this.updatePitchControls();
    this.refreshKeyboardNoteLabels();
  }

  private updatePitchControls(): void {
    if (this.octaveDownButton) {
      this.octaveDownButton.disabled = this.octave <= MIN_OCTAVE;
    }
    if (this.octaveUpButton) {
      this.octaveUpButton.disabled = this.octave >= MAX_OCTAVE;
    }
    if (this.transposeDownButton) {
      this.transposeDownButton.disabled = this.transpose <= MIN_TRANSPOSE;
    }
    if (this.transposeUpButton) {
      this.transposeUpButton.disabled = this.transpose >= MAX_TRANSPOSE;
    }
  }

  private createKeyButton(layout: KeyLayout): HTMLButtonElement {
    const note = this.noteForLayout(layout);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.note = String(note);
    button.dataset.keyCode = layout.keyCode;
    button.className =
      "flex cursor-pointer select-none flex-col items-center justify-end gap-0.5 px-0.5 py-1 font-mono text-[10px]";

    if (layout.keyCode) {
      const computerKey = document.createElement("span");
      computerKey.className = "text-xs font-semibold uppercase";
      computerKey.textContent = keyCodeLabel(layout.keyCode);
      button.append(computerKey);
    }

    const noteName = document.createElement("span");
    noteName.dataset.noteLabel = "true";
    noteName.className =
      "min-w-[2.25rem] text-center text-[9px] tabular-nums opacity-50";
    noteName.textContent = midiNoteLabel(note);

    button.append(noteName);
    this.keyButtons.set(note, button);

    button.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        void this.pressKey(note);
      },
      { signal: this.abort.signal },
    );
    button.addEventListener(
      "pointerup",
      (event) => {
        if (button.hasPointerCapture(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        this.releaseKey(note);
      },
      { signal: this.abort.signal },
    );
    button.addEventListener(
      "pointercancel",
      () => {
        this.releaseKey(note);
      },
      { signal: this.abort.signal },
    );

    return button;
  }

  private bindKeyboard(): void {
    const keyboardOptions = { capture: true, signal: this.abort.signal };

    window.addEventListener(
      "keydown",
      (event) => {
        if (!this.shouldHandleKeyboard(event)) {
          return;
        }
        if (!this.isCapturedKeyCode(event.code)) {
          return;
        }

        this.suppressBrowserKey(event);

        if (event.repeat) {
          return;
        }

        if (event.code === "KeyZ") {
          this.setOctave(this.octave - 1);
          return;
        }
        if (event.code === "KeyX") {
          this.setOctave(this.octave + 1);
          return;
        }
        if (event.code === "Period") {
          this.setTranspose(this.transpose - 1);
          return;
        }
        if (event.code === "Slash") {
          this.setTranspose(this.transpose + 1);
          return;
        }

        const note = this.noteForKeyCode(event.code);
        if (note === undefined) {
          return;
        }

        void this.pressKey(note);
      },
      keyboardOptions,
    );

    window.addEventListener(
      "keyup",
      (event) => {
        if (!this.shouldHandleKeyboard(event)) {
          return;
        }
        if (!this.isCapturedKeyCode(event.code)) {
          return;
        }

        this.suppressBrowserKey(event);

        const note = this.noteForKeyCode(event.code);
        if (note === undefined) {
          return;
        }

        this.releaseKey(note);
      },
      keyboardOptions,
    );
  }

  private bindMidi(): void {
    if (!navigator.requestMIDIAccess) {
      return;
    }

    void navigator
      .requestMIDIAccess()
      .then((access) => {
        if (this.abort.signal.aborted) {
          return;
        }

        this.midiAccess = access;
        this.syncMidiInputs();
        access.onstatechange = () => {
          this.syncMidiInputs();
        };
      })
      .catch(() => {
        // Permission denied or MIDI unavailable.
      });
  }

  private unbindMidi(): void {
    for (const input of this.midiBoundInputs) {
      input.onmidimessage = null;
    }
    this.midiBoundInputs.clear();

    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
      this.midiAccess = null;
    }
  }

  private syncMidiInputs(): void {
    if (!this.midiAccess) {
      return;
    }

    const activeInputs = new Set(this.midiAccess.inputs.values());
    for (const input of this.midiBoundInputs) {
      if (!activeInputs.has(input)) {
        input.onmidimessage = null;
        this.midiBoundInputs.delete(input);
      }
    }

    for (const input of activeInputs) {
      if (this.midiBoundInputs.has(input)) {
        continue;
      }

      input.onmidimessage = (event) => {
        this.handleMidiMessage(event);
      };
      this.midiBoundInputs.add(input);
    }
  }

  private handleMidiMessage(event: MIDIMessageEvent): void {
    if (!this.keyboardEnabled) {
      return;
    }

    const data = event.data;
    if (!data || data.length < 2) {
      return;
    }

    const parsed = parseMidiNoteEvent(data);
    if (!parsed) {
      return;
    }

    if (parsed.type === "noteOn") {
      void this.pressKey(parsed.note);
      return;
    }

    this.releaseKey(parsed.note);
  }

  private async pressKey(note: number): Promise<void> {
    if (this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.add(note);
    this.setKeyPressed(this.keyButtons.get(note), true);
    await this.synth.ensureRunning();
    if (!this.pressedKeys.has(note)) {
      return;
    }
    this.synth.noteOn(note);
    this.updateVisualizations();
  }

  private releaseKey(note: number): void {
    if (!this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.delete(note);
    this.setKeyPressed(this.keyButtons.get(note), false);
    this.synth.noteOff(note);
    this.updateVisualizations();
  }

  private releaseAllKeys(): void {
    for (const note of this.pressedKeys) {
      this.setKeyPressed(this.keyButtons.get(note), false);
    }
    this.pressedKeys.clear();
    this.synth.stopAll();
    this.updateVisualizations();
  }

  private setKeyPressed(
    button: HTMLButtonElement | undefined,
    pressed: boolean,
  ): void {
    if (!button) {
      return;
    }

    for (const className of KEY_PRESSED_CLASSES) {
      button.classList.toggle(className, pressed);
    }
  }
}
