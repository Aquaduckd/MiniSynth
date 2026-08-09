import type {
  EffectsParams,
  OscNumberTuple,
  OscWaveform,
  OscWaveformTuple,
  PanelTheme,
  RandomMode,
  SectionColor,
  SynthParams,
  VibratoWaveform,
} from "./types.js";

export const HARMONICS = 128;
export const MASTER_PREVIEW_HZ = 220;
export const MASTER_PREVIEW_PERIODS = 2;
export const MAX_VIBRATO_SEMITONES = 24;
export const VIBRATO_DEPTH_CENTS_LIMIT = 100;
export const ENVELOPE_HOLD = 0.35;
export const MIN_CUTOFF_HZ = 80;
export const MAX_CUTOFF_HZ = 20000;
export const MIN_FILTER_Q = 0.5;
export const MAX_FILTER_Q = 4;

export const OSC_COUNT = 3;

export const MASTER_GAIN = 0.7;

export const MIN_REVERB_SECONDS = 0;
export const MAX_REVERB_SECONDS = 10;
export const MAX_DELAY_SECONDS = 1;
export const OSC2_PITCH_NEGATIVE_SECTION = 1 / 5;
export const OSC2_PITCH_CENTS_SECTION = 3 / 5;
export const OSC2_PITCH_POSITIVE_SECTION = 1 / 5;
export const OSC2_PITCH_CENTS_LIMIT = 100;
export const OSC2_PITCH_SEMITONE_EXTENT = 12;
export const FILTER_SWEEP_MIN_SECONDS = 0;
export const FILTER_SWEEP_MAX_SECONDS = 1;

export const MASTER_PREVIEW_SAMPLE_RATE = 48_000;
export const MASTER_PREVIEW_WARM_PERIODS = 1;

/** Inverse of paramMath's vibratoDepthCents; kept here so constants import nothing. */
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

export function cloneParams(params: SynthParams): SynthParams {
  return {
    ...params,
    oscWaveforms: [...params.oscWaveforms] as OscWaveformTuple,
    oscLevels: [...params.oscLevels] as OscNumberTuple,
    oscPitches: [...params.oscPitches] as OscNumberTuple,
    oscPulseWidths: [...params.oscPulseWidths] as OscNumberTuple,
  };
}

export const DEFAULT_PARAMS: SynthParams = {
  oscWaveforms: ["pulse", "triangle", "saw"],
  oscLevels: [1, 0, 0],
  oscPitches: [0.5, 0.5, 0.5],
  oscPulseWidths: [1, 1, 1],
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
  randomMode: "noise",
  randomRate: 4,
  randomAmount: vibratoCentsToKnob(0),
};

export function cloneEffects(effects: EffectsParams): EffectsParams {
  return { ...effects };
}

export const DEFAULT_EFFECTS: EffectsParams = {
  delayTime: 0.35,
  delayFeedback: 0.35,
  delayMix: 0,
  reverbDecay: 0.15,
  reverbMix: 0.3,
  pitchSpeed: 0.12,
  pitchAmount: 0.5,
  masterVolume: MASTER_GAIN,
};

export const SECTION_THEMES: Record<SectionColor, PanelTheme> = {
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

export const OSC_WAVEFORM_OPTIONS: { value: OscWaveform; label: string }[] = [
  { value: "pulse", label: "Pulse" },
  { value: "triangle", label: "Triangle" },
  { value: "saw", label: "Saw" },
  { value: "sine", label: "Sine" },
];

export const VIBRATO_OPTIONS: { value: VibratoWaveform; label: string }[] = [
  { value: "triangle", label: "Triangle" },
  { value: "square", label: "Square" },
];

export const RANDOM_MODE_OPTIONS: { value: RandomMode; label: string }[] = [
  { value: "noise", label: "Noise" },
  { value: "perlin", label: "Perlin" },
];
