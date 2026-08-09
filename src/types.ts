export type OscWaveform = "pulse" | "saw" | "triangle" | "sine";
export type OscId = 0 | 1 | 2;
export type VibratoWaveform = "triangle" | "square";
export type RandomMode = "noise" | "perlin";

export type OscWaveformTuple = [OscWaveform, OscWaveform, OscWaveform];
export type OscNumberTuple = [number, number, number];

export interface SynthParams {
  oscWaveforms: OscWaveformTuple;
  oscLevels: OscNumberTuple;
  oscPitches: OscNumberTuple;
  oscPulseWidths: OscNumberTuple;
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
  randomMode: RandomMode;
  randomRate: number;
  randomAmount: number;
}

export interface EffectsParams {
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  reverbDecay: number;
  reverbMix: number;
  pitchSpeed: number;
  pitchAmount: number;
  masterVolume: number;
}

export type PianoRollStyle = "compact" | "full88";

export interface KeyLayout {
  semitone: number;
  /** Absolute MIDI note for full 88-key layout; omit for octave-relative compact keys. */
  midiNote?: number;
  label: string;
  keyCode?: string;
  white: boolean;
  whiteIndex?: number;
  tier: "main" | "upper";
}

export interface ActiveVoice {
  oscillators: OscillatorNode[];
  oscGains: GainNode[];
  mixGain: GainNode;
  filter1: BiquadFilterNode;
  filter2: BiquadFilterNode;
  vibratoOsc: OscillatorNode;
  vibratoGain: GainNode;
  randomLfo: AudioWorkletNode;
  randomGain: GainNode;
  envelope: GainNode;
  baseFrequency: number;
  startTime: number;
  stopTimer: number | null;
}

export type PitchModTab = "vibrato" | "random";

export interface SynthPreset {
  id: string;
  name: string;
  builtIn: boolean;
  params: SynthParams;
  effects: EffectsParams;
}

export type SectionColor =
  | "oscillator"
  | "filter"
  | "envelope"
  | "vibrato"
  | "delay"
  | "reverb"
  | "master";

export interface PanelTheme {
  accent: string;
  accentBright: string;
  accentMuted: string;
  accentFill: string;
  markerDark: string;
  markerDarker: string;
}
