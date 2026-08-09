import {
  createRotaryKnob,
  type RotaryKnobHandle,
  type RotaryKnobOptions,
} from "./RotaryKnob.js";
import { parseMidiFile, type MidiSong } from "./midiFile.js";

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

type OscWaveform = "pulse" | "saw" | "triangle" | "sine";
type OscId = 0 | 1 | 2;
type VibratoWaveform = "triangle" | "square";
type RandomMode = "noise" | "perlin";

const OSC_COUNT = 3;

type OscWaveformTuple = [OscWaveform, OscWaveform, OscWaveform];
type OscNumberTuple = [number, number, number];

interface SynthParams {
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

type PitchModTab = "vibrato" | "random";

interface PlotPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function cloneParams(params: SynthParams): SynthParams {
  return {
    ...params,
    oscWaveforms: [...params.oscWaveforms] as OscWaveformTuple,
    oscLevels: [...params.oscLevels] as OscNumberTuple,
    oscPitches: [...params.oscPitches] as OscNumberTuple,
    oscPulseWidths: [...params.oscPulseWidths] as OscNumberTuple,
  };
}

const DEFAULT_PARAMS: SynthParams = {
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

const MASTER_GAIN = 0.7;

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

interface SynthPreset {
  id: string;
  name: string;
  builtIn: boolean;
  params: SynthParams;
  effects: EffectsParams;
}

const PRESET_STORAGE_KEY = "minisynth.presets.v1";
const MIDI_SETTINGS_KEY = "minisynth.midi.v1";

interface MidiSettings {
  /** null = listen on every connected input */
  enabledInputIds: string[] | null;
}

function loadMidiSettings(): MidiSettings {
  try {
    const raw = localStorage.getItem(MIDI_SETTINGS_KEY);
    if (!raw) {
      return { enabledInputIds: null };
    }

    const parsed = JSON.parse(raw) as Partial<MidiSettings>;
    if (parsed.enabledInputIds === null) {
      return { enabledInputIds: null };
    }
    if (
      Array.isArray(parsed.enabledInputIds)
      && parsed.enabledInputIds.every((id) => typeof id === "string")
    ) {
      return { enabledInputIds: parsed.enabledInputIds };
    }
  } catch {
    // ignore corrupt storage
  }

  return { enabledInputIds: null };
}

function saveMidiSettings(settings: MidiSettings): void {
  localStorage.setItem(MIDI_SETTINGS_KEY, JSON.stringify(settings));
}

function cloneEffects(effects: EffectsParams): EffectsParams {
  return { ...effects };
}

function makeBuiltInPreset(
  id: string,
  name: string,
  params: Partial<SynthParams>,
  effects: Partial<EffectsParams> = {},
): SynthPreset {
  return {
    id,
    name,
    builtIn: true,
    params: cloneParams({ ...DEFAULT_PARAMS, ...params }),
    effects: cloneEffects({ ...DEFAULT_EFFECTS, ...effects }),
  };
}

const BUILT_IN_PRESETS: SynthPreset[] = [
  makeBuiltInPreset("init", "Default", {}),
];

function loadUserPresets(): SynthPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      const preset = normalizeStoredPreset(entry);
      return preset ? [preset] : [];
    });
  } catch {
    return [];
  }
}

function saveUserPresets(presets: SynthPreset[]): void {
  const payload = presets
    .filter((preset) => !preset.builtIn)
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      params: cloneParams(preset.params),
      effects: cloneEffects(preset.effects),
    }));
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(payload));
}

function isOscWaveform(value: unknown): value is OscWaveform {
  return (
    value === "pulse"
    || value === "saw"
    || value === "triangle"
    || value === "sine"
  );
}

function isVibratoWaveform(value: unknown): value is VibratoWaveform {
  return value === "triangle" || value === "square";
}

function isRandomMode(value: unknown): value is RandomMode {
  return value === "noise" || value === "perlin";
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeStoredPreset(entry: unknown): SynthPreset | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return null;
  }
  if (!record.params || typeof record.params !== "object") {
    return null;
  }
  if (!record.effects || typeof record.effects !== "object") {
    return null;
  }

  const rawParams = record.params as Record<string, unknown>;
  const rawEffects = record.effects as Record<string, unknown>;
  const waveforms = Array.isArray(rawParams.oscWaveforms)
    ? rawParams.oscWaveforms
    : DEFAULT_PARAMS.oscWaveforms;
  const levels = Array.isArray(rawParams.oscLevels)
    ? rawParams.oscLevels
    : DEFAULT_PARAMS.oscLevels;
  const pitches = Array.isArray(rawParams.oscPitches)
    ? rawParams.oscPitches
    : DEFAULT_PARAMS.oscPitches;
  const widths = Array.isArray(rawParams.oscPulseWidths)
    ? rawParams.oscPulseWidths
    : DEFAULT_PARAMS.oscPulseWidths;

  const params = cloneParams({
    ...DEFAULT_PARAMS,
    oscWaveforms: [0, 1, 2].map((index) =>
      isOscWaveform(waveforms[index])
        ? waveforms[index]
        : DEFAULT_PARAMS.oscWaveforms[index],
    ) as OscWaveformTuple,
    oscLevels: [0, 1, 2].map((index) =>
      normalizeNumber(levels[index], DEFAULT_PARAMS.oscLevels[index], 0, 1),
    ) as OscNumberTuple,
    oscPitches: [0, 1, 2].map((index) =>
      normalizeNumber(pitches[index], DEFAULT_PARAMS.oscPitches[index], 0, 1),
    ) as OscNumberTuple,
    oscPulseWidths: [0, 1, 2].map((index) =>
      normalizeNumber(widths[index], DEFAULT_PARAMS.oscPulseWidths[index], 0, 1),
    ) as OscNumberTuple,
    attack: normalizeNumber(rawParams.attack, DEFAULT_PARAMS.attack, 0, 2),
    decay: normalizeNumber(rawParams.decay, DEFAULT_PARAMS.decay, 0, 2),
    sustain: normalizeNumber(rawParams.sustain, DEFAULT_PARAMS.sustain, 0, 1),
    release: normalizeNumber(rawParams.release, DEFAULT_PARAMS.release, 0, 2),
    filterInitial: normalizeNumber(
      rawParams.filterInitial,
      DEFAULT_PARAMS.filterInitial,
      0,
      1,
    ),
    filterFinal: normalizeNumber(
      rawParams.filterFinal,
      DEFAULT_PARAMS.filterFinal,
      0,
      1,
    ),
    filterSpeed: normalizeNumber(
      rawParams.filterSpeed,
      DEFAULT_PARAMS.filterSpeed,
      0,
      1,
    ),
    filterResonance: normalizeNumber(
      rawParams.filterResonance,
      DEFAULT_PARAMS.filterResonance,
      0,
      1,
    ),
    vibratoRate: normalizeNumber(
      rawParams.vibratoRate,
      DEFAULT_PARAMS.vibratoRate,
      0.5,
      20,
    ),
    vibratoDelay: normalizeNumber(
      rawParams.vibratoDelay,
      DEFAULT_PARAMS.vibratoDelay,
      0,
      2,
    ),
    vibratoRamp: normalizeNumber(
      rawParams.vibratoRamp,
      DEFAULT_PARAMS.vibratoRamp,
      0,
      2,
    ),
    vibratoAmount: normalizeNumber(
      rawParams.vibratoAmount,
      DEFAULT_PARAMS.vibratoAmount,
      0,
      1,
    ),
    vibratoWaveform: isVibratoWaveform(rawParams.vibratoWaveform)
      ? rawParams.vibratoWaveform
      : DEFAULT_PARAMS.vibratoWaveform,
    randomMode: isRandomMode(rawParams.randomMode)
      ? rawParams.randomMode
      : DEFAULT_PARAMS.randomMode,
    randomRate: normalizeNumber(
      rawParams.randomRate,
      DEFAULT_PARAMS.randomRate,
      0.1,
      20,
    ),
    randomAmount: normalizeNumber(
      rawParams.randomAmount,
      DEFAULT_PARAMS.randomAmount,
      0,
      1,
    ),
  });

  const effects = cloneEffects({
    ...DEFAULT_EFFECTS,
    delayTime: normalizeNumber(
      rawEffects.delayTime,
      DEFAULT_EFFECTS.delayTime,
      0,
      1,
    ),
    delayFeedback: normalizeNumber(
      rawEffects.delayFeedback,
      DEFAULT_EFFECTS.delayFeedback,
      0,
      0.85,
    ),
    delayMix: normalizeNumber(
      rawEffects.delayMix,
      DEFAULT_EFFECTS.delayMix,
      0,
      1,
    ),
    reverbDecay: normalizeNumber(
      rawEffects.reverbDecay,
      DEFAULT_EFFECTS.reverbDecay,
      0,
      1,
    ),
    reverbMix: normalizeNumber(
      rawEffects.reverbMix,
      DEFAULT_EFFECTS.reverbMix,
      0,
      1,
    ),
    pitchSpeed: normalizeNumber(
      rawEffects.pitchSpeed,
      DEFAULT_EFFECTS.pitchSpeed,
      0,
      1,
    ),
    pitchAmount: normalizeNumber(
      rawEffects.pitchAmount,
      DEFAULT_EFFECTS.pitchAmount,
      0,
      1,
    ),
    masterVolume: normalizeNumber(
      rawEffects.masterVolume,
      DEFAULT_EFFECTS.masterVolume,
      0,
      1,
    ),
  });

  const id =
    typeof record.id === "string" && record.id.trim().length > 0
      ? record.id
      : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: record.name.trim().slice(0, 48),
    builtIn: false,
    params,
    effects,
  };
}

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

const OSC_WAVEFORM_OPTIONS: { value: OscWaveform; label: string }[] = [
  { value: "pulse", label: "Pulse" },
  { value: "triangle", label: "Triangle" },
  { value: "saw", label: "Saw" },
  { value: "sine", label: "Sine" },
];

const VIBRATO_OPTIONS: { value: VibratoWaveform; label: string }[] = [
  { value: "triangle", label: "Triangle" },
  { value: "square", label: "Square" },
];

const RANDOM_MODE_OPTIONS: { value: RandomMode; label: string }[] = [
  { value: "noise", label: "Noise" },
  { value: "perlin", label: "Perlin" },
];

const MIN_OCTAVE = 0;
const MAX_OCTAVE = 7;
const DEFAULT_OCTAVE = 4;
const MIN_TRANSPOSE = -11;
const MIDI_FILE_SKIP_SECONDS = 5;

function formatMidiClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
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

const PITCH_CLASS_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/**
 * Chord templates from richer/more specific shapes to simpler ones.
 * Incomplete voicings may only omit the fifth (see detectChordName).
 */
const CHORD_TEMPLATES: { intervals: number[]; suffix: string }[] = [
  // 6-note
  { intervals: [0, 2, 3, 5, 7, 10], suffix: "m11" },
  { intervals: [0, 2, 4, 5, 7, 10], suffix: "11" },
  { intervals: [0, 2, 4, 5, 7, 11], suffix: "maj11" },

  // 5-note
  { intervals: [0, 2, 4, 7, 9], suffix: "6/9" },
  { intervals: [0, 2, 3, 7, 9], suffix: "m6/9" },
  { intervals: [0, 2, 4, 7, 11], suffix: "maj9" },
  { intervals: [0, 2, 3, 7, 10], suffix: "m9" },
  { intervals: [0, 2, 4, 7, 10], suffix: "9" },
  { intervals: [0, 1, 4, 7, 10], suffix: "7♭9" },
  { intervals: [0, 3, 4, 7, 10], suffix: "7♯9" },
  { intervals: [0, 2, 4, 6, 10], suffix: "9♭5" },
  { intervals: [0, 2, 4, 8, 10], suffix: "9♯5" },
  { intervals: [0, 4, 6, 7, 10], suffix: "7♯11" },
  { intervals: [0, 4, 6, 7, 11], suffix: "maj7♯11" },
  { intervals: [0, 2, 5, 7, 10], suffix: "9sus4" },
  { intervals: [0, 1, 3, 7, 10], suffix: "m7♭9" },
  { intervals: [0, 2, 3, 7, 11], suffix: "m9(maj7)" },
  { intervals: [0, 1, 4, 7, 11], suffix: "maj7♭9" },
  { intervals: [0, 2, 4, 6, 11], suffix: "maj9♭5" },
  { intervals: [0, 2, 4, 8, 11], suffix: "maj9♯5" },
  { intervals: [0, 3, 5, 7, 10], suffix: "m7add11" },

  // 4-note sevenths / sixths / adds
  { intervals: [0, 4, 7, 11], suffix: "maj7" },
  { intervals: [0, 3, 7, 11], suffix: "m(maj7)" },
  { intervals: [0, 3, 7, 10], suffix: "m7" },
  { intervals: [0, 3, 6, 10], suffix: "m7♭5" },
  { intervals: [0, 3, 6, 9], suffix: "dim7" },
  { intervals: [0, 4, 6, 10], suffix: "7♭5" },
  { intervals: [0, 4, 8, 10], suffix: "7♯5" },
  { intervals: [0, 4, 8, 11], suffix: "maj7♯5" },
  { intervals: [0, 4, 6, 11], suffix: "maj7♭5" },
  { intervals: [0, 4, 7, 10], suffix: "7" },
  { intervals: [0, 5, 7, 10], suffix: "7sus4" },
  { intervals: [0, 2, 7, 10], suffix: "7sus2" },
  { intervals: [0, 5, 7, 11], suffix: "maj7sus4" },
  { intervals: [0, 4, 7, 9], suffix: "6" },
  { intervals: [0, 3, 7, 9], suffix: "m6" },
  { intervals: [0, 3, 7, 8], suffix: "m♭6" },
  { intervals: [0, 4, 7, 8], suffix: "♭6" },
  { intervals: [0, 2, 4, 7], suffix: "add9" },
  { intervals: [0, 2, 3, 7], suffix: "madd9" },
  { intervals: [0, 4, 5, 7], suffix: "add4" },
  { intervals: [0, 3, 5, 7], suffix: "madd4" },
  { intervals: [0, 2, 5, 7], suffix: "sus2sus4" },
  { intervals: [0, 4, 6, 9], suffix: "6♭5" },
  { intervals: [0, 5, 7, 9], suffix: "6sus4" },
  { intervals: [0, 2, 7, 9], suffix: "6sus2" },
  { intervals: [0, 2, 7, 11], suffix: "maj7sus2" },
  { intervals: [0, 3, 5, 10], suffix: "m7add4" },
  { intervals: [0, 4, 5, 10], suffix: "7add4" },
  { intervals: [0, 1, 4, 7], suffix: "add♭9" },
  { intervals: [0, 3, 4, 7], suffix: "add♯9" },
  // Root + fifth + major 7 (no third), e.g. C G B.
  { intervals: [0, 7, 11], suffix: "5maj7" },
  { intervals: [0, 7, 10], suffix: "57" },

  // 3-note triads / sus
  { intervals: [0, 4, 7], suffix: "" },
  { intervals: [0, 3, 7], suffix: "m" },
  { intervals: [0, 3, 6], suffix: "dim" },
  { intervals: [0, 4, 8], suffix: "aug" },
  // After major so C+E still prefers C over C♭5 (omitted ♭5).
  { intervals: [0, 4, 6], suffix: "♭5" },
  { intervals: [0, 3, 8], suffix: "m♯5" },
  { intervals: [0, 2, 7], suffix: "sus2" },
  { intervals: [0, 5, 7], suffix: "sus4" },

  // 2-note
  { intervals: [0, 7], suffix: "5" },
];

function midiNoteLabel(note: number): string {
  const pitch = ((note % 12) + 12) % 12;
  const octave = Math.floor(note / 12) - 1;
  return `${PITCH_CLASS_NAMES[pitch]}${octave}`;
}

function pitchClassName(pitchClass: number): string {
  return PITCH_CLASS_NAMES[((pitchClass % 12) + 12) % 12];
}

/** Fifth tone that may be omitted from an otherwise complete chord shape. */
function chordOmitableFifth(intervals: number[]): number | null {
  if (intervals.includes(7)) {
    return 7;
  }
  if (intervals.includes(6)) {
    return 6;
  }
  if (intervals.includes(8)) {
    return 8;
  }
  return null;
}

const BASIC_TRIAD_SUFFIXES = new Set(["", "m", "dim", "aug"]);

function detectChordName(notes: Iterable<number>): string {
  const midiNotes = [...new Set(notes)].sort((left, right) => left - right);
  if (midiNotes.length === 0) {
    return "";
  }

  if (midiNotes.length === 1) {
    return pitchClassName(midiNotes[0]);
  }

  const pitchClasses = [
    ...new Set(midiNotes.map((note) => ((note % 12) + 12) % 12)),
  ].sort((left, right) => left - right);

  if (pitchClasses.length === 1) {
    return pitchClassName(pitchClasses[0]);
  }

  const bassClass = ((midiNotes[0] % 12) + 12) % 12;
  let best: { root: number; suffix: string; score: number } | null = null;

  for (const root of pitchClasses) {
    const relative = new Set(
      pitchClasses.map((pitch) => (pitch - root + 12) % 12),
    );

    for (let index = 0; index < CHORD_TEMPLATES.length; index += 1) {
      const template = CHORD_TEMPLATES[index];
      const templateSet = new Set(template.intervals);

      // Every played tone must belong to the chord.
      let fits = true;
      for (const interval of relative) {
        if (!templateSet.has(interval)) {
          fits = false;
          break;
        }
      }
      if (!fits) {
        continue;
      }

      // Incomplete voicings may only drop the fifth (C+E → C), not the third
      // or seventh — otherwise C E F# spuriously matches F#m7♭5.
      // Also require a third so C+D does not become Csus2 (fifth omitted).
      const missingIntervals = template.intervals.filter(
        (interval) => !relative.has(interval),
      );
      if (missingIntervals.length > 0) {
        const omittable = chordOmitableFifth(template.intervals);
        const hasThird = relative.has(3) || relative.has(4);
        if (
          omittable === null
          || missingIntervals.length !== 1
          || missingIntervals[0] !== omittable
          || !hasThird
        ) {
          continue;
        }
      }

      const missing = missingIntervals.length;
      // Exact fits beat incomplete ones; basic triads beat exotic reinterpretations
      // of inversions (C F A → F, not C6sus4); bass root is only a tie-breaker.
      const score =
        -missing * 100_000
        + (BASIC_TRIAD_SUFFIXES.has(template.suffix) ? 5_000 : 0)
        + (root === bassClass ? 100 : 0)
        - index;
      if (!best || score > best.score) {
        best = { root, suffix: template.suffix, score };
      }
    }
  }

  if (!best) {
    return "Unknown";
  }

  return `${pitchClassName(best.root)}${best.suffix}`;
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
  const cents = oscPitchKnobToCents(pitchKnob);
  if (cents === 0) {
    return baseHz;
  }

  const peak = baseHz * 2 ** (cents / 1200);
  return Math.max(20, peak);
}

function oscTunedFrequency(baseHz: number, pitchKnob: number): number {
  const cents = oscPitchKnobToCents(pitchKnob);
  return baseHz * 2 ** (cents / 1200);
}

function oscPitchNegativeEnd(): number {
  return OSC2_PITCH_NEGATIVE_SECTION;
}

function oscPitchCentsEnd(): number {
  return OSC2_PITCH_NEGATIVE_SECTION + OSC2_PITCH_CENTS_SECTION;
}

function oscPitchKnobToCents(knob: number): number {
  const t = snapOscPitchKnob(knob);
  const negativeEnd = oscPitchNegativeEnd();
  const centsEnd = oscPitchCentsEnd();

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

function snapOscPitchKnob(knob: number): number {
  const t = Math.min(1, Math.max(0, knob));
  const negativeEnd = oscPitchNegativeEnd();
  const centsEnd = oscPitchCentsEnd();

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

function formatOscPitch(knob: number): string {
  const cents = oscPitchKnobToCents(knob);
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
  let mix = 0;
  for (let osc = 0; osc < OSC_COUNT; osc += 1) {
    const frequency = oscTunedFrequency(baseFrequency, params.oscPitches[osc]);
    const phase = (time * frequency) % 1;
    mix +=
      oscSample(phase, params.oscWaveforms[osc], params.oscPulseWidths[osc])
      * params.oscLevels[osc];
  }
  return mix;
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

function oscSample(
  phase: number,
  waveform: OscWaveform,
  pulseWidth: number,
): number {
  switch (waveform) {
    case "pulse":
      return pulseSample(phase, pulseWidthToDuty(pulseWidth));
    case "saw":
      return 2 * phase - 1;
    case "sine":
      return Math.sin(phase * Math.PI * 2);
    case "triangle":
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
  }
}

function oscWaveformLabel(waveform: OscWaveform): string {
  return (
    OSC_WAVEFORM_OPTIONS.find((option) => option.value === waveform)?.label
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
  osc: OscId,
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

  const waveform = params.oscWaveforms[osc];
  const pulseWidth = params.oscPulseWidths[osc];
  const level = params.oscLevels[osc];
  const samples = Math.max(120, Math.floor(plotW));

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let index = 0; index <= samples; index += 1) {
    const phase = index / samples;
    const sample = oscSample(phase, waveform, pulseWidth);
    const x = pad.left + (index / samples) * plotW;
    const y = midY - sample * (plotH / 2 - 4);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillText(`Osc ${osc + 1}`, pad.left, 12);
  ctx.fillStyle = theme.accent;
  ctx.fillText(oscWaveformLabel(waveform), pad.left + 48, 12);
  ctx.fillStyle = "#475569";
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.textAlign = "right";
  const details =
    waveform === "pulse"
      ? `${pulseWidthLabel(pulseWidth)} · ${Math.round(level * 100)}%`
      : `${Math.round(level * 100)}%`;
  ctx.fillText(details, width - pad.right, 12);
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

function clampRandomRate(rate: number): number {
  return Math.min(20, Math.max(0.1, rate));
}

function hashNoiseSample(index: number): number {
  let x = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * 2 - 1;
}

function randomModSample(time: number, params: SynthParams): number {
  const rate = clampRandomRate(params.randomRate);
  if (params.randomMode === "perlin") {
    return (
      perlin1(time * rate * 0.85) * 0.7
      + perlin1(time * rate * 1.7 + 12.4) * 0.3
    );
  }

  // Rougher value noise whose feature rate tracks Rate (amplitude stays ~±1).
  const x = time * rate * 1.25;
  const i0 = Math.floor(x);
  const frac = perlinFade(x - i0);
  const smooth =
    hashNoiseSample(i0)
    + (hashNoiseSample(i0 + 1) - hashNoiseSample(i0)) * frac;
  const y = time * rate * 3.5;
  const j0 = Math.floor(y);
  const gritFrac = y - j0;
  const grit =
    hashNoiseSample(j0 + 97)
    + (hashNoiseSample(j0 + 98) - hashNoiseSample(j0 + 97)) * gritFrac;
  return Math.max(-1, Math.min(1, smooth * 0.72 + grit * 0.28));
}

function createPerlinPermutation(seed = 42): Uint8Array {
  const source = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) {
    source[index] = index;
  }

  let state = seed >>> 0;
  for (let index = 255; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const temp = source[index];
    source[index] = source[swap];
    source[swap] = temp;
  }

  const perm = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) {
    perm[index] = source[index & 255];
  }
  return perm;
}

const PERLIN_PERM = createPerlinPermutation();

function perlinFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function perlin1(x: number): number {
  const xi = Math.floor(x) & 255;
  const xf = x - Math.floor(x);
  const u = perlinFade(xf);
  const a = PERLIN_PERM[xi];
  const b = PERLIN_PERM[xi + 1];
  const gradA = (a & 1) === 0 ? xf : -xf;
  const gradB = (b & 1) === 0 ? xf - 1 : -(xf - 1);
  return gradA + u * (gradB - gradA);
}

function drawRandomPreview(
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
  const amplitude = vibratoDepthPreviewScale(params.randomAmount) * maxAmplitude;
  const windowDuration = 1.5;
  // Pin the caret at the left edge and scroll the modulation under it,
  // matching vibrato's post-delay playhead behavior.
  const windowStart = playhead ? playhead.vibratoTime : 0;
  const samples = Math.max(160, Math.floor(plotW));

  // Pure time-scaled modulation (Rate → temporal frequency only). Skip the
  // audio lowpass here so Rate can't masquerade as amplitude in the preview.
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, midY);
  ctx.lineTo(width - pad.right, midY);
  ctx.stroke();

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let index = 0; index <= samples; index += 1) {
    const time = windowStart + (index / samples) * windowDuration;
    const x = pad.left + (index / samples) * plotW;
    const y = midY - randomModSample(time, params) * amplitude;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillText(
    params.randomMode === "perlin" ? "Perlin" : "Noise",
    pad.left,
    12,
  );
  ctx.fillStyle = "#475569";
  ctx.font = "500 9px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillText(
    `${params.randomMode} · ${params.randomRate.toFixed(1)} Hz · ${formatVibratoDepth(params.randomAmount)}`,
    width - pad.right,
    12,
  );
  ctx.textAlign = "start";

  if (playhead) {
    drawTimelinePlayhead(
      ctx,
      pad.left,
      pad.top,
      pad.top + plotH,
      "#64748b",
    );
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
  private readonly pulseWaves: Array<PeriodicWave | null> = [null, null, null];
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
        || (params.oscWaveforms[osc] === "pulse"
          && params.oscPulseWidths[osc] !== previous.oscPulseWidths[osc])
      );
    });
    const pitchChangedFlags = Array.from({ length: OSC_COUNT }, (_, osc) => {
      return params.oscPitches[osc] !== previous.oscPitches[osc];
    });
    const mixChanged = params.oscLevels.some(
      (level, osc) => level !== previous.oscLevels[osc],
    );
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
      if (mixChanged) {
        this.applyMixLevels(voice);
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
        .addModule(new URL("./random-lfo-worklet.js", import.meta.url))
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

      for (let osc = 0; osc < OSC_COUNT; osc += 1) {
        const oscFrequency = oscTunedFrequency(
          baseFrequency,
          this.params.oscPitches[osc],
        );
        const oscillator = context.createOscillator();
        this.configureOscillator(oscillator, osc as OscId, context);
        oscillator.frequency.setValueAtTime(oscFrequency, now);
        this.schedulePitchContour(oscillator, oscFrequency, now);

        const oscGain = context.createGain();
        oscillator.connect(oscGain);
        oscGain.connect(mixGain);
        vibratoGain.connect(oscillator.frequency);
        randomGain.connect(oscillator.frequency);

        oscillators.push(oscillator);
        oscGains.push(oscGain);
      }

      mixGain.connect(filter1);
      filter1.connect(filter2);
      filter2.connect(envelope);
      envelope.connect(this.output);
      vibratoOsc.connect(vibratoGain);
      randomLfo.connect(randomGain);

      const voice: ActiveVoice = {
        oscillators,
        oscGains,
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

      this.applyMixLevels(voice);
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
    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      voice.oscillators[osc].disconnect();
      voice.oscGains[osc].disconnect();
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

  private applyMixLevels(voice: ActiveVoice): void {
    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      voice.oscGains[osc].gain.value = this.params.oscLevels[osc];
    }
  }

  private applyOscPitch(voice: ActiveVoice, osc: OscId, when: number): void {
    const tuned = oscTunedFrequency(
      voice.baseFrequency,
      this.params.oscPitches[osc],
    );
    voice.oscillators[osc].frequency.cancelScheduledValues(when);
    voice.oscillators[osc].frequency.setValueAtTime(Math.max(20, tuned), when);
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

    if (oscPitchKnobToCents(pitchKnob) === 0) {
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
  5 * KNOB_GAP_PX +
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
  private chordLabelEl: HTMLElement | null = null;
  private whiteRow: HTMLDivElement | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private keyboardHeightPx = 96;
  private synth = new SimpleSynth();
  private params: SynthParams = cloneParams(DEFAULT_PARAMS);
  private effectsParams: EffectsParams = { ...DEFAULT_EFFECTS };
  private pressedKeys = new Set<number>();
  /** Computer keyCode → MIDI note at press time (survives octave/transpose changes). */
  private heldComputerKeys = new Map<string, number>();
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
  private activeOscTab: OscId = 0;
  private oscTabButtons = new Map<OscId, HTMLButtonElement>();
  private oscTabDots = new Map<OscId, HTMLElement>();
  private oscTabPanels = new Map<OscId, HTMLElement>();
  private oscWaveformButtons: Array<Map<OscWaveform, HTMLButtonElement>> = [
    new Map(),
    new Map(),
    new Map(),
  ];
  private oscWidthKnobElements = new Map<OscId, HTMLElement>();
  private vibratoButtons = new Map<VibratoWaveform, HTMLButtonElement>();
  private randomModeButtons = new Map<RandomMode, HTMLButtonElement>();
  private activePitchModTab: PitchModTab = "vibrato";
  private pitchModTabButtons = new Map<PitchModTab, HTMLButtonElement>();
  private pitchModTabDots = new Map<PitchModTab, HTMLElement>();
  private pitchModTabPanels = new Map<PitchModTab, HTMLElement>();
  private paramKnobs = new Map<string, RotaryKnobHandle>();
  private effectKnobs = new Map<keyof EffectsParams, RotaryKnobHandle>();
  private vizObserver: ResizeObserver | null = null;
  private livePreviewFrame: number | null = null;
  private midiAccess: MIDIAccess | null = null;
  private readonly midiBoundInputs = new Set<MIDIInput>();
  /** null = all connected inputs are enabled */
  private midiEnabledInputIds: Set<string> | null = null;
  private midiPermissionError: string | null = null;
  private readonly abort = new AbortController();
  private userPresets: SynthPreset[] = loadUserPresets();
  private presetModal: HTMLElement | null = null;
  private presetListEl: HTMLElement | null = null;
  private presetNameInput: HTMLInputElement | null = null;
  private presetStatusEl: HTMLElement | null = null;
  private activePresetId: string | null = "init";
  private configModal: HTMLElement | null = null;
  private midiStatusEl: HTMLElement | null = null;
  private midiDeviceListEl: HTMLElement | null = null;
  private midiEnableButton: HTMLButtonElement | null = null;
  private midiActivityEl: HTMLElement | null = null;
  private midiActivityTimer: number | null = null;
  private midiSong: MidiSong | null = null;
  private midiFilePlaying = false;
  private midiFileEventIndex = 0;
  private midiFileOriginMs = 0;
  /** Playback cursor when stopped; ignored while playing (use wall-clock origin). */
  private midiFileCursorSeconds = 0;
  private midiFileTimer: number | null = null;
  private readonly midiFileHoldCounts = new Map<number, number>();
  private midiFileStatusEl: HTMLElement | null = null;
  private midiFileTimeEl: HTMLElement | null = null;
  private midiFilePlayStopButton: HTMLButtonElement | null = null;
  private midiFileBackButton: HTMLButtonElement | null = null;
  private midiFileForwardButton: HTMLButtonElement | null = null;
  private midiFileInput: HTMLInputElement | null = null;

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

    const headerActions = document.createElement("div");
    headerActions.className = "flex shrink-0 items-center gap-2";

    const configButton = document.createElement("button");
    configButton.type = "button";
    configButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    configButton.textContent = "Config";
    configButton.addEventListener(
      "click",
      () => {
        this.openConfigModal();
      },
      { signal: this.abort.signal },
    );

    const presetsButton = document.createElement("button");
    presetsButton.type = "button";
    presetsButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    presetsButton.textContent = "Presets";
    presetsButton.addEventListener(
      "click",
      () => {
        this.openPresetsModal();
      },
      { signal: this.abort.signal },
    );

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    resetButton.textContent = "Reset";
    resetButton.addEventListener(
      "click",
      () => {
        this.resetToDefaults();
      },
      { signal: this.abort.signal },
    );

    headerActions.append(configButton, presetsButton, resetButton);
    header.append(headerLabel, headerActions);

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
    this.restoreMidiSettings();
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
    if (this.midiActivityTimer !== null) {
      window.clearTimeout(this.midiActivityTimer);
      this.midiActivityTimer = null;
    }
    this.abort.abort();
    this.presetModal?.remove();
    this.presetModal = null;
    this.presetListEl = null;
    this.presetNameInput = null;
    this.presetStatusEl = null;
    this.configModal?.remove();
    this.configModal = null;
    this.midiStatusEl = null;
    this.midiDeviceListEl = null;
    this.midiEnableButton = null;
    this.midiActivityEl = null;
    this.midiFileStatusEl = null;
    this.midiFileTimeEl = null;
    this.midiFilePlayStopButton = null;
    this.midiFileBackButton = null;
    this.midiFileForwardButton = null;
    this.midiFileInput = null;
    this.root?.remove();
    this.root = null;
    this.controlsEl = null;
    this.keyboardWrapper = null;
    this.keyboardRow = null;
    this.chordLabelEl = null;
    this.whiteRow = null;
    this.envelopeCanvas = null;
    this.waveformCanvas = null;
    this.filterCanvas = null;
    this.vibratoCanvas = null;
    this.masterCanvas = null;
    this.oscTabButtons.clear();
    this.oscTabDots.clear();
    this.oscTabPanels.clear();
    for (const buttons of this.oscWaveformButtons) {
      buttons.clear();
    }
    this.oscWidthKnobElements.clear();
    this.vibratoButtons.clear();
    this.randomModeButtons.clear();
    this.pitchModTabButtons.clear();
    this.pitchModTabDots.clear();
    this.pitchModTabPanels.clear();
    this.paramKnobs.clear();
    this.effectKnobs.clear();
    this.keyButtons.clear();
  }

  private bindWindowFocus(): void {
    window.addEventListener(
      "blur",
      () => {
        // Drop stuck computer/pointer keys, but keep MIDI file playback going.
        this.releaseManualKeys();
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
        this.activeOscTab,
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
    this.updatePitchModPreview(playhead);
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
    this.updatePitchModPreview(playhead);
    this.updateMasterPreview();
  }

  private updatePitchModPreview(playhead: NotePlayheadState | null): void {
    if (!this.vibratoCanvas) {
      return;
    }

    if (this.activePitchModTab === "random") {
      drawRandomPreview(
        this.vibratoCanvas,
        this.params,
        SECTION_THEMES.vibrato,
        playhead,
      );
      return;
    }

    drawVibratoPreview(
      this.vibratoCanvas,
      this.params,
      SECTION_THEMES.vibrato,
      playhead,
    );
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

    const heading = document.createElement("div");
    heading.className =
      "flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2";

    const title = document.createElement("div");
    title.className =
      "text-xs font-medium uppercase tracking-wide text-slate-400";
    title.textContent = "Oscillator";

    const tabs = document.createElement("div");
    tabs.className = "flex items-center gap-1";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Oscillator");

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      const { button, dot } = this.createTabButton(`Osc ${osc + 1}`);
      button.dataset.oscTab = String(osc);
      button.addEventListener(
        "click",
        () => {
          this.setActiveOscTab(osc as OscId);
        },
        { signal: this.abort.signal },
      );
      this.oscTabButtons.set(osc as OscId, button);
      this.oscTabDots.set(osc as OscId, dot);
      tabs.append(button);
    }

    heading.append(title, tabs);

    const body = document.createElement("div");
    body.className = "relative";

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      const tabPanel = this.createOscTabPanel(osc as OscId);
      this.oscTabPanels.set(osc as OscId, tabPanel);
      body.append(tabPanel);
    }

    const primary = document.createElement("div");
    primary.className = "flex min-w-0 flex-col";
    primary.append(heading, this.waveformCanvas, body);

    panel.append(
      primary,
      this.createEffectFooter("Pitch Envelope", this.createPitchControls()),
    );

    this.setActiveOscTab(this.activeOscTab);
    this.updateTabActivityIndicators();
    return panel;
  }

  private createOscTabPanel(osc: OscId): HTMLElement {
    const panel = document.createElement("div");
    panel.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    panel.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;
    panel.setAttribute("role", "tabpanel");
    panel.dataset.oscPanel = String(osc);

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const waveformColumn = document.createElement("div");
    waveformColumn.className = "flex shrink-0 flex-col items-center gap-0.5";

    const waveformGrid = document.createElement("div");
    waveformGrid.className = "grid grid-cols-2 gap-1";

    for (const option of OSC_WAVEFORM_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
        this.setOscWaveform(osc, option.value);
      });
      this.oscWaveformButtons[osc].set(option.value, button);
      waveformGrid.append(button);
    }

    const waveLabel = document.createElement("span");
    waveLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    waveLabel.textContent = "Wave";
    waveformColumn.append(knobValueSpacer, waveformGrid, waveLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";

    const levelKnob = this.createOscLevelKnob(osc);
    levelKnob.classList.add("shrink-0");

    const widthKnob = this.createOscWidthKnob(osc);
    widthKnob.classList.add("shrink-0");
    this.oscWidthKnobElements.set(osc, widthKnob);

    const pitchKnob = this.createOscPitchKnob(osc);
    pitchKnob.classList.add("shrink-0");

    knobsGroup.append(levelKnob, pitchKnob, widthKnob);
    panel.append(waveformColumn, knobsGroup);
    return panel;
  }

  private setActiveOscTab(osc: OscId): void {
    this.activeOscTab = osc;
    const theme = SECTION_THEMES.oscillator;

    for (const [id, button] of this.oscTabButtons) {
      const selected = id === osc;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors";
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    }

    for (const [id, panel] of this.oscTabPanels) {
      panel.classList.toggle("hidden", id !== osc);
    }

    this.updateOscWaveformButtons();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
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

  private setOscWaveform(osc: OscId, waveform: OscWaveform): void {
    if (this.params.oscWaveforms[osc] === waveform) {
      return;
    }

    this.params.oscWaveforms[osc] = waveform;
    this.synth.setParams(this.params);
    this.updateOscWaveformButtons();
    this.updateWidthKnobVisibility();
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

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      for (const [waveform, button] of this.oscWaveformButtons[osc]) {
        applyState(button, this.params.oscWaveforms[osc] === waveform);
      }
    }
  }

  private updateWidthKnobVisibility(): void {
    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      this.oscWidthKnobElements.get(osc as OscId)?.classList.toggle(
        "hidden",
        this.params.oscWaveforms[osc] !== "pulse",
      );
    }
  }

  private createVibratoSection(): HTMLElement {
    const section = document.createElement("section");
    section.className =
      "flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";
    section.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;

    const heading = document.createElement("div");
    heading.className =
      "flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2";

    const title = document.createElement("div");
    title.className =
      "text-xs font-medium uppercase tracking-wide text-slate-400";
    title.textContent = "Pitch Mod";

    const tabs = document.createElement("div");
    tabs.className = "flex items-center gap-1";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Pitch modulation");

    for (const tabId of ["vibrato", "random"] as PitchModTab[]) {
      const { button, dot } = this.createTabButton(
        tabId === "vibrato" ? "Vibrato" : "Random",
      );
      button.addEventListener(
        "click",
        () => {
          this.setActivePitchModTab(tabId);
        },
        { signal: this.abort.signal },
      );
      this.pitchModTabButtons.set(tabId, button);
      this.pitchModTabDots.set(tabId, dot);
      tabs.append(button);
    }

    heading.append(title, tabs);

    this.vibratoCanvas = document.createElement("canvas");
    this.vibratoCanvas.className = CANVAS_PREVIEW_CLASS;

    const body = document.createElement("div");
    body.className = "relative";

    const vibratoPanel = this.createVibratoTabPanel();
    const randomPanel = this.createRandomTabPanel();
    this.pitchModTabPanels.set("vibrato", vibratoPanel);
    this.pitchModTabPanels.set("random", randomPanel);
    body.append(vibratoPanel, randomPanel);

    section.append(heading, this.vibratoCanvas, body);
    this.setActivePitchModTab(this.activePitchModTab);
    this.updateVibratoWaveformButtons();
    this.updateRandomModeButtons();
    this.updateTabActivityIndicators();
    return section;
  }

  private createVibratoTabPanel(): HTMLElement {
    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    controlsRow.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;
    controlsRow.setAttribute("role", "tabpanel");

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
    return controlsRow;
  }

  private createRandomTabPanel(): HTMLElement {
    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    controlsRow.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;
    controlsRow.setAttribute("role", "tabpanel");

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const modeGroup = document.createElement("div");
    modeGroup.className = "flex shrink-0 flex-col items-center gap-0.5";

    const modeButtons = document.createElement("div");
    modeButtons.className = "flex flex-col gap-1";

    for (const option of RANDOM_MODE_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
        this.setRandomMode(option.value);
      });
      this.randomModeButtons.set(option.value, button);
      modeButtons.append(button);
    }

    const modeLabel = document.createElement("span");
    modeLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    modeLabel.textContent = "Mode";
    modeGroup.append(knobValueSpacer, modeButtons, modeLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";
    knobsGroup.append(
      this.createParamKnob(
        "Rate",
        "randomRate",
        0.1,
        20,
        0.1,
        (value) => `${value.toFixed(1)} Hz`,
        "vibrato",
      ),
      this.createRandomDepthKnob(),
    );

    controlsRow.append(modeGroup, knobsGroup);
    return controlsRow;
  }

  private setActivePitchModTab(tab: PitchModTab): void {
    this.activePitchModTab = tab;
    const theme = SECTION_THEMES.vibrato;

    for (const [id, button] of this.pitchModTabButtons) {
      const selected = id === tab;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors";
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    }

    for (const [id, panel] of this.pitchModTabPanels) {
      panel.classList.toggle("hidden", id !== tab);
    }

    this.updateVisualizations();
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

  private setRandomMode(mode: RandomMode): void {
    if (this.params.randomMode === mode) {
      return;
    }

    this.params.randomMode = mode;
    this.synth.setParams(this.params);
    this.updateRandomModeButtons();
    this.updateVisualizations();
  }

  private updatePitchModOptionButtons(
    buttons: Map<string, HTMLButtonElement>,
    activeValue: string,
  ): void {
    const theme = SECTION_THEMES.vibrato;
    const inactiveClass =
      "w-16 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
    const baseClass =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";

    for (const [value, button] of buttons) {
      const active = value === activeValue;
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
    }
  }

  private updateVibratoWaveformButtons(): void {
    this.updatePitchModOptionButtons(
      this.vibratoButtons,
      this.params.vibratoWaveform,
    );
  }

  private updateRandomModeButtons(): void {
    this.updatePitchModOptionButtons(
      this.randomModeButtons,
      this.params.randomMode,
    );
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
      value: snapOscPitchKnob(this.effectsParams.pitchAmount),
      format: formatOscPitch,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOscPitchKnob(value);
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

  private createOscLevelKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}Level`;
    const knob = createRotaryKnob({
      label: "Level",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.params.oscLevels[osc],
      format: (value) => `${Math.round(value * 100)}%`,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        this.params.oscLevels[osc] = value;
        this.synth.setParams(this.params);
        this.updateTabActivityIndicators();
        this.updateVisualizations();
      },
    });
    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createOscWidthKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}PulseWidth`;
    const knob = createRotaryKnob({
      label: "Width",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.params.oscPulseWidths[osc],
      format: pulseWidthLabel,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        this.params.oscPulseWidths[osc] = value;
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });
    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createOscPitchKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}Pitch`;
    const knob = createRotaryKnob({
      label: "Pitch",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapOscPitchKnob(this.params.oscPitches[osc]),
      format: formatOscPitch,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOscPitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params.oscPitches[osc] = snapped;
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set(key, knob);
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
        this.updateTabActivityIndicators();
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set("vibratoAmount", knob);
    return knob.element;
  }

  private createRandomDepthKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Depth",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapVibratoDepthKnob(this.params.randomAmount),
      format: formatVibratoDepth,
      ...this.themeKnobOptions("vibrato"),
      onChange: (value) => {
        const snapped = snapVibratoDepthKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params = { ...this.params, randomAmount: snapped };
        this.synth.setParams(this.params);
        this.updateTabActivityIndicators();
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set("randomAmount", knob);
    return knob.element;
  }

  private createTabButton(label: string): {
    button: HTMLButtonElement;
    dot: HTMLElement;
  } {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.className =
      "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";

    const dot = document.createElement("span");
    dot.className = "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = label;

    button.append(dot, text);
    return { button, dot };
  }

  private updateTabActivityIndicators(): void {
    for (const [osc, dot] of this.oscTabDots) {
      const active = this.params.oscLevels[osc] > 0;
      dot.className = active
        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
        : "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
    }

    for (const [tab, dot] of this.pitchModTabDots) {
      const depth =
        tab === "vibrato"
          ? this.params.vibratoAmount
          : this.params.randomAmount;
      const active = vibratoDepthCents(depth) > 0;
      dot.className = active
        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
        : "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
    }
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
    this.applyPreset(BUILT_IN_PRESETS[0]);
  }

  private applyPreset(preset: SynthPreset): void {
    this.params = cloneParams(preset.params);
    this.effectsParams = cloneEffects(preset.effects);
    this.activePresetId = preset.id;
    this.synth.setParams(this.params);
    this.synth.setEffectsParams(this.effectsParams);
    this.syncControlsFromState();
    this.refreshPresetList();
  }

  private syncControlsFromState(): void {
    for (const [key, knob] of this.paramKnobs) {
      const oscLevelMatch = /^osc(\d+)Level$/.exec(key);
      if (oscLevelMatch) {
        knob.setValue(this.params.oscLevels[Number(oscLevelMatch[1])] ?? 0);
        continue;
      }

      const oscPitchMatch = /^osc(\d+)Pitch$/.exec(key);
      if (oscPitchMatch) {
        knob.setValue(
          snapOscPitchKnob(this.params.oscPitches[Number(oscPitchMatch[1])] ?? 0.5),
        );
        continue;
      }

      const oscWidthMatch = /^osc(\d+)PulseWidth$/.exec(key);
      if (oscWidthMatch) {
        knob.setValue(this.params.oscPulseWidths[Number(oscWidthMatch[1])] ?? 1);
        continue;
      }

      const value = this.params[key as keyof SynthParams];
      if (typeof value !== "number") {
        continue;
      }

      if (key === "vibratoAmount" || key === "randomAmount") {
        knob.setValue(snapVibratoDepthKnob(value));
        continue;
      }

      knob.setValue(value);
    }

    for (const [key, knob] of this.effectKnobs) {
      if (key === "pitchAmount") {
        knob.setValue(snapOscPitchKnob(this.effectsParams.pitchAmount));
        continue;
      }

      knob.setValue(this.effectsParams[key]);
    }

    this.setActiveOscTab(0);
    this.setActivePitchModTab(this.activePitchModTab);
    this.updateOscWaveformButtons();
    this.updateVibratoWaveformButtons();
    this.updateRandomModeButtons();
    this.updateTabActivityIndicators();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
  }

  private openConfigModal(): void {
    if (!this.configModal) {
      this.configModal = this.createConfigModal();
      document.body.append(this.configModal);
    }

    this.refreshMidiPanel();
    this.configModal.classList.remove("hidden");
    this.configModal.classList.add("flex");
    this.midiEnableButton?.focus();
  }

  private closeConfigModal(): void {
    if (!this.configModal) {
      return;
    }

    this.configModal.classList.add("hidden");
    this.configModal.classList.remove("flex");
  }

  private createConfigModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]";

    const dialog = document.createElement("div");
    dialog.className =
      "flex max-h-[min(36rem,90vh)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Config");

    const header = document.createElement("div");
    header.className =
      "flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3";

    const title = document.createElement("h2");
    title.className = "text-sm font-medium text-slate-100";
    title.textContent = "Config";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    closeButton.textContent = "Close";
    closeButton.addEventListener(
      "click",
      () => {
        this.closeConfigModal();
      },
      { signal: this.abort.signal },
    );

    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3";

    const midiSection = document.createElement("section");
    midiSection.className = "space-y-3";

    const midiHeading = document.createElement("div");
    midiHeading.className = "flex items-center justify-between gap-2";

    const midiTitle = document.createElement("h3");
    midiTitle.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    midiTitle.textContent = "MIDI";

    this.midiActivityEl = document.createElement("span");
    this.midiActivityEl.className =
      "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500";
    this.midiActivityEl.textContent = "Idle";

    midiHeading.append(midiTitle, this.midiActivityEl);

    this.midiStatusEl = document.createElement("p");
    this.midiStatusEl.className = "text-[12px] leading-relaxed text-slate-400";

    const midiActions = document.createElement("div");
    midiActions.className = "flex flex-wrap items-center gap-2";

    this.midiEnableButton = document.createElement("button");
    this.midiEnableButton.type = "button";
    this.midiEnableButton.className =
      "rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50";
    this.midiEnableButton.textContent = "Enable MIDI";
    this.midiEnableButton.addEventListener(
      "click",
      () => {
        void this.requestMidiAccess();
      },
      { signal: this.abort.signal },
    );

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className =
      "rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    refreshButton.textContent = "Refresh";
    refreshButton.addEventListener(
      "click",
      () => {
        this.syncMidiInputs();
        this.refreshMidiPanel();
      },
      { signal: this.abort.signal },
    );

    midiActions.append(this.midiEnableButton, refreshButton);

    this.midiDeviceListEl = document.createElement("div");
    this.midiDeviceListEl.className = "space-y-2";

    const midiHint = document.createElement("p");
    midiHint.className = "text-[11px] leading-relaxed text-slate-500";
    midiHint.textContent =
      "Enable MIDI, then choose which keyboards to listen to. Browsers require permission the first time.";

    midiSection.append(
      midiHeading,
      this.midiStatusEl,
      midiActions,
      this.midiDeviceListEl,
      midiHint,
    );
    body.append(midiSection);
    dialog.append(header, body);
    overlay.append(dialog);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          this.closeConfigModal();
        }
      },
      { signal: this.abort.signal },
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!this.configModal || this.configModal.classList.contains("hidden")) {
          return;
        }
        event.preventDefault();
        this.closeConfigModal();
      },
      { signal: this.abort.signal },
    );

    return overlay;
  }

  private refreshMidiFilePanel(): void {
    const hasSong = this.midiSong !== null;
    if (this.midiFilePlayStopButton) {
      this.midiFilePlayStopButton.disabled = !hasSong;
      this.midiFilePlayStopButton.textContent = this.midiFilePlaying
        ? "Stop"
        : "Play";
      this.midiFilePlayStopButton.title = this.midiFilePlaying
        ? "Stop MIDI file"
        : "Play MIDI file";
      this.midiFilePlayStopButton.className = this.midiFilePlaying
        ? "shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        : "shrink-0 rounded border border-emerald-700/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";
    }
    if (this.midiFileBackButton) {
      this.midiFileBackButton.disabled = !hasSong;
    }
    if (this.midiFileForwardButton) {
      this.midiFileForwardButton.disabled = !hasSong;
    }

    if (this.midiFileStatusEl) {
      this.midiFileStatusEl.textContent = this.midiSong
        ? this.midiSong.name
        : "No MIDI file";
    }
    this.refreshMidiFileTime();
  }

  private refreshMidiFileTime(): void {
    if (!this.midiFileTimeEl) {
      return;
    }
    if (!this.midiSong) {
      this.midiFileTimeEl.textContent = "0:00 / 0:00";
      return;
    }
    const current = Math.min(
      this.midiSong.duration,
      this.midiFilePlaybackTime(),
    );
    this.midiFileTimeEl.textContent = `${formatMidiClock(current)} / ${formatMidiClock(this.midiSong.duration)}`;
  }

  private async loadMidiFile(file: File): Promise<void> {
    this.stopMidiFile();
    try {
      const buffer = await file.arrayBuffer();
      this.midiSong = parseMidiFile(buffer, file.name);
      if (this.midiSong.events.length === 0) {
        this.midiSong = null;
        this.refreshMidiFilePanel();
        if (this.midiFileStatusEl) {
          this.midiFileStatusEl.textContent = "No playable notes";
        }
        return;
      }
    } catch (error) {
      this.midiSong = null;
      this.refreshMidiFilePanel();
      if (this.midiFileStatusEl) {
        this.midiFileStatusEl.textContent =
          error instanceof Error ? error.message : "Could not read MIDI file";
      }
      return;
    }

    this.midiFileCursorSeconds = 0;
    this.refreshMidiFilePanel();
  }

  private midiFilePlaybackTime(): number {
    if (!this.midiSong) {
      return 0;
    }
    if (this.midiFilePlaying) {
      return Math.max(0, (performance.now() - this.midiFileOriginMs) / 1000);
    }
    return this.midiFileCursorSeconds;
  }

  private findMidiFileEventIndex(timeSeconds: number): number {
    if (!this.midiSong) {
      return 0;
    }
    const events = this.midiSong.events;
    let index = 0;
    while (index < events.length && events[index].time < timeSeconds) {
      index += 1;
    }
    return index;
  }

  private activeMidiNotesAt(timeSeconds: number): Map<number, number> {
    const active = new Map<number, number>();
    if (!this.midiSong) {
      return active;
    }

    for (const event of this.midiSong.events) {
      if (event.time >= timeSeconds) {
        break;
      }
      if (event.type === "noteOn") {
        active.set(event.note, (active.get(event.note) ?? 0) + 1);
      } else {
        const count = (active.get(event.note) ?? 0) - 1;
        if (count <= 0) {
          active.delete(event.note);
        } else {
          active.set(event.note, count);
        }
      }
    }
    return active;
  }

  private clearMidiFileHeldNotes(): void {
    for (const note of [...this.midiFileHoldCounts.keys()]) {
      this.releaseMidiFileNote(note, true);
    }
    this.midiFileHoldCounts.clear();
  }

  private applyMidiFilePosition(timeSeconds: number, resumeHolds: boolean): void {
    if (!this.midiSong) {
      return;
    }

    const duration = this.midiSong.duration;
    const target = Math.min(duration, Math.max(0, timeSeconds));
    this.clearMidiFileHeldNotes();
    this.midiFileEventIndex = this.findMidiFileEventIndex(target);
    this.midiFileCursorSeconds = target;
    this.midiFileOriginMs = performance.now() - target * 1000;

    if (!resumeHolds) {
      return;
    }

    for (const [rawNote, count] of this.activeMidiNotesAt(target)) {
      const note = Math.min(127, Math.max(0, rawNote + this.transpose));
      this.midiFileHoldCounts.set(note, count);
      if (!this.pressedKeys.has(note)) {
        this.pressedKeys.add(note);
        this.setKeyPressed(this.keyButtons.get(note), true);
        this.synth.noteOn(note);
      }
    }
    this.updateChordDisplay();
  }

  private skipMidiFile(deltaSeconds: number): void {
    if (!this.midiSong) {
      return;
    }

    const target = this.midiFilePlaybackTime() + deltaSeconds;
    if (this.midiFilePlaying) {
      if (this.midiFileTimer !== null) {
        window.clearTimeout(this.midiFileTimer);
        this.midiFileTimer = null;
      }

      if (target >= this.midiSong.duration) {
        this.midiFilePlaying = false;
        this.clearMidiFileHeldNotes();
        this.midiFileEventIndex = this.midiSong.events.length;
        this.midiFileCursorSeconds = 0;
        this.refreshMidiFilePanel();
        return;
      }

      this.applyMidiFilePosition(target, true);
      this.refreshMidiFilePanel();
      this.pumpMidiFileScheduler();
      return;
    }

    this.applyMidiFilePosition(target, false);
    this.refreshMidiFilePanel();
  }

  private async playMidiFile(): Promise<void> {
    if (!this.midiSong || this.midiFilePlaying) {
      return;
    }

    await this.synth.ensureRunning();
    if (!this.midiSong || this.abort.signal.aborted) {
      return;
    }

    if (this.midiFileCursorSeconds >= this.midiSong.duration) {
      this.midiFileCursorSeconds = 0;
    }

    this.midiFilePlaying = true;
    this.applyMidiFilePosition(this.midiFileCursorSeconds, true);
    this.refreshMidiFilePanel();
    this.pumpMidiFileScheduler();
  }

  private stopMidiFile(): void {
    const wasPlaying = this.midiFilePlaying;
    this.midiFilePlaying = false;
    if (this.midiFileTimer !== null) {
      window.clearTimeout(this.midiFileTimer);
      this.midiFileTimer = null;
    }

    this.clearMidiFileHeldNotes();
    this.midiFileEventIndex = 0;
    this.midiFileCursorSeconds = 0;

    if (wasPlaying || this.midiSong) {
      this.refreshMidiFilePanel();
    }
  }

  private pumpMidiFileScheduler(): void {
    if (!this.midiFilePlaying || !this.midiSong) {
      return;
    }

    const elapsed = (performance.now() - this.midiFileOriginMs) / 1000;
    const horizon = elapsed + 0.08;
    const events = this.midiSong.events;

    while (
      this.midiFileEventIndex < events.length
      && events[this.midiFileEventIndex].time <= horizon
    ) {
      const event = events[this.midiFileEventIndex];
      this.midiFileEventIndex += 1;
      const note = Math.min(127, Math.max(0, event.note + this.transpose));
      if (event.type === "noteOn") {
        this.acquireMidiFileNote(note);
      } else {
        this.releaseMidiFileNote(note);
      }
    }

    if (this.midiFileEventIndex >= events.length) {
      // Let ringing notes finish via their note-offs already processed; stop cleanly.
      this.midiFilePlaying = false;
      this.midiFileTimer = null;
      this.clearMidiFileHeldNotes();
      this.midiFileCursorSeconds = 0;
      this.refreshMidiFilePanel();
      return;
    }

    this.refreshMidiFileTime();
    this.updateVisualizations();
    this.midiFileTimer = window.setTimeout(() => {
      this.midiFileTimer = null;
      this.pumpMidiFileScheduler();
    }, 20);
  }

  private acquireMidiFileNote(note: number): void {
    const count = (this.midiFileHoldCounts.get(note) ?? 0) + 1;
    this.midiFileHoldCounts.set(note, count);
    if (count !== 1) {
      return;
    }

    // Drive the synth synchronously — async pressKey can lose notes when many
    // file events land in the same scheduler slice (noteOff before await).
    if (!this.pressedKeys.has(note)) {
      this.pressedKeys.add(note);
      this.setKeyPressed(this.keyButtons.get(note), true);
      this.synth.noteOn(note);
    }
    this.updateChordDisplay();
  }

  private releaseMidiFileNote(note: number, force = false): void {
    if (force) {
      this.midiFileHoldCounts.delete(note);
      this.releaseKey(note);
      return;
    }

    const count = (this.midiFileHoldCounts.get(note) ?? 0) - 1;
    if (count <= 0) {
      this.midiFileHoldCounts.delete(note);
      this.releaseKey(note);
      return;
    }

    this.midiFileHoldCounts.set(note, count);
  }

  private refreshMidiPanel(): void {
    if (!this.midiStatusEl || !this.midiDeviceListEl || !this.midiEnableButton) {
      return;
    }

    const supported = Boolean(navigator.requestMIDIAccess);
    this.midiEnableButton.disabled = !supported || this.midiAccess !== null;
    this.midiEnableButton.textContent = this.midiAccess
      ? "MIDI Enabled"
      : "Enable MIDI";

    if (!supported) {
      this.midiStatusEl.textContent =
        "Web MIDI is not supported in this browser. Try Chrome or Edge, or enable MIDI in Firefox.";
      this.midiDeviceListEl.replaceChildren();
      return;
    }

    if (this.midiPermissionError) {
      this.midiStatusEl.textContent = this.midiPermissionError;
    } else if (!this.midiAccess) {
      this.midiStatusEl.textContent =
        "MIDI is off. Click Enable MIDI to connect a keyboard.";
    } else {
      const count = this.midiAccess.inputs.size;
      this.midiStatusEl.textContent =
        count === 0
          ? "MIDI access granted. No input devices found — plug in a keyboard and hit Refresh."
          : `MIDI access granted. ${count} input${count === 1 ? "" : "s"} available.`;
    }

    this.midiDeviceListEl.replaceChildren();

    if (!this.midiAccess) {
      return;
    }

    const inputs = [...this.midiAccess.inputs.values()].sort((left, right) =>
      (left.name ?? left.id).localeCompare(right.name ?? right.id),
    );

    if (inputs.length === 0) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-md border border-dashed border-slate-700 px-3 py-4 text-center text-[12px] text-slate-500";
      empty.textContent = "No MIDI inputs connected";
      this.midiDeviceListEl.append(empty);
      return;
    }

    for (const input of inputs) {
      this.midiDeviceListEl.append(this.createMidiDeviceRow(input));
    }
  }

  private createMidiDeviceRow(input: MIDIInput): HTMLElement {
    const row = document.createElement("label");
    row.className =
      "flex cursor-pointer items-start gap-3 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2.5 hover:border-slate-700";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "mt-0.5 accent-emerald-400";
    checkbox.checked = this.isMidiInputEnabled(input.id);
    checkbox.addEventListener(
      "change",
      () => {
        this.setMidiInputEnabled(input.id, checkbox.checked);
      },
      { signal: this.abort.signal },
    );

    const text = document.createElement("div");
    text.className = "min-w-0 flex-1";

    const name = document.createElement("div");
    name.className = "truncate text-[13px] text-slate-200";
    name.textContent = input.name?.trim() || "MIDI keyboard";

    const meta = document.createElement("div");
    meta.className = "truncate text-[11px] text-slate-500";
    const manufacturer = input.manufacturer?.trim();
    meta.textContent = [
      manufacturer || null,
      input.state,
      input.connection,
    ]
      .filter(Boolean)
      .join(" · ");

    text.append(name, meta);
    row.append(checkbox, text);
    return row;
  }

  private openPresetsModal(): void {
    if (!this.presetModal) {
      this.presetModal = this.createPresetsModal();
      document.body.append(this.presetModal);
    }

    this.presetStatusEl && (this.presetStatusEl.textContent = "");
    this.refreshPresetList();
    this.presetModal.classList.remove("hidden");
    this.presetModal.classList.add("flex");
    this.presetNameInput?.focus();
    this.presetNameInput?.select();
  }

  private closePresetsModal(): void {
    if (!this.presetModal) {
      return;
    }

    this.presetModal.classList.add("hidden");
    this.presetModal.classList.remove("flex");
  }

  private createPresetsModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]";

    const dialog = document.createElement("div");
    dialog.className =
      "flex max-h-[min(36rem,90vh)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Presets");

    const header = document.createElement("div");
    header.className =
      "flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3";

    const title = document.createElement("h2");
    title.className = "text-sm font-medium text-slate-100";
    title.textContent = "Presets";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    closeButton.textContent = "Close";
    closeButton.addEventListener(
      "click",
      () => {
        this.closePresetsModal();
      },
      { signal: this.abort.signal },
    );

    header.append(title, closeButton);

    this.presetListEl = document.createElement("div");
    this.presetListEl.className =
      "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3";

    const saveSection = document.createElement("div");
    saveSection.className =
      "shrink-0 space-y-2 border-t border-slate-800 px-4 py-3";

    const saveLabel = document.createElement("div");
    saveLabel.className = "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    saveLabel.textContent = "Save current";

    const saveRow = document.createElement("div");
    saveRow.className = "flex gap-2";

    this.presetNameInput = document.createElement("input");
    this.presetNameInput.type = "text";
    this.presetNameInput.maxLength = 48;
    this.presetNameInput.placeholder = "Preset name";
    this.presetNameInput.className =
      "min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-500";
    this.presetNameInput.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.saveCurrentPreset();
        }
      },
      { signal: this.abort.signal },
    );

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className =
      "shrink-0 rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200";
    saveButton.textContent = "Save";
    saveButton.addEventListener(
      "click",
      () => {
        this.saveCurrentPreset();
      },
      { signal: this.abort.signal },
    );

    const exportCurrentButton = document.createElement("button");
    exportCurrentButton.type = "button";
    exportCurrentButton.className =
      "shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    exportCurrentButton.textContent = "Export";
    exportCurrentButton.title = "Export the current patch as a file";
    exportCurrentButton.addEventListener(
      "click",
      () => {
        this.exportCurrentPreset();
      },
      { signal: this.abort.signal },
    );

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className =
      "shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    importButton.textContent = "Import";
    importButton.title = "Import a preset file";

    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.className = "hidden";
    importInput.addEventListener(
      "change",
      () => {
        const file = importInput.files?.[0];
        importInput.value = "";
        if (file) {
          void this.importPresetFile(file);
        }
      },
      { signal: this.abort.signal },
    );

    importButton.addEventListener(
      "click",
      () => {
        importInput.click();
      },
      { signal: this.abort.signal },
    );

    saveRow.append(
      this.presetNameInput,
      saveButton,
      exportCurrentButton,
      importButton,
      importInput,
    );

    this.presetStatusEl = document.createElement("div");
    this.presetStatusEl.className = "min-h-[1rem] text-[11px] text-slate-500";

    saveSection.append(saveLabel, saveRow, this.presetStatusEl);
    dialog.append(header, this.presetListEl, saveSection);
    overlay.append(dialog);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          this.closePresetsModal();
        }
      },
      { signal: this.abort.signal },
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!this.presetModal || this.presetModal.classList.contains("hidden")) {
          return;
        }
        event.preventDefault();
        this.closePresetsModal();
      },
      { signal: this.abort.signal },
    );

    return overlay;
  }

  private refreshPresetList(): void {
    if (!this.presetListEl) {
      return;
    }

    this.presetListEl.replaceChildren();

    const factorySection = this.createPresetSection(
      "Factory",
      BUILT_IN_PRESETS,
      false,
    );
    const userSection = this.createPresetSection(
      "Saved",
      this.userPresets,
      true,
    );
    this.presetListEl.append(factorySection, userSection);
  }

  private createPresetSection(
    title: string,
    presets: SynthPreset[],
    allowDelete: boolean,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "space-y-2";

    const heading = document.createElement("div");
    heading.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    heading.textContent = title;
    section.append(heading);

    if (presets.length === 0) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-md border border-dashed border-slate-800 px-3 py-4 text-center text-[12px] text-slate-500";
      empty.textContent = "No saved presets yet";
      section.append(empty);
      return section;
    }

    const list = document.createElement("div");
    list.className = "space-y-1";

    for (const preset of presets) {
      const row = document.createElement("div");
      row.className =
        "flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5";

      if (preset.id === this.activePresetId) {
        row.classList.add("border-emerald-700/60", "bg-emerald-950/20");
      }

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className =
        "min-w-0 flex-1 truncate text-left text-sm text-slate-200 hover:text-white";
      loadButton.textContent = preset.name;
      loadButton.title = `Load “${preset.name}”`;
      loadButton.addEventListener(
        "click",
        () => {
          this.applyPreset(preset);
          if (this.presetStatusEl) {
            this.presetStatusEl.textContent = `Loaded “${preset.name}”`;
          }
        },
        { signal: this.abort.signal },
      );

      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className =
        "shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-slate-500 hover:text-slate-200";
      exportButton.textContent = "Export";
      exportButton.title = `Export “${preset.name}”`;
      exportButton.addEventListener(
        "click",
        () => {
          this.exportPreset(preset);
        },
        { signal: this.abort.signal },
      );

      row.append(loadButton, exportButton);

      if (allowDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className =
          "shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-rose-700 hover:text-rose-300";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener(
          "click",
          () => {
            this.deleteUserPreset(preset.id);
          },
          { signal: this.abort.signal },
        );
        row.append(deleteButton);
      }

      list.append(row);
    }

    section.append(list);
    return section;
  }

  private saveCurrentPreset(): void {
    const name = this.presetNameInput?.value.trim() ?? "";
    if (!name) {
      if (this.presetStatusEl) {
        this.presetStatusEl.textContent = "Enter a name to save";
      }
      this.presetNameInput?.focus();
      return;
    }

    const existingIndex = this.userPresets.findIndex(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );

    const preset: SynthPreset = {
      id:
        existingIndex >= 0
          ? this.userPresets[existingIndex].id
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.slice(0, 48),
      builtIn: false,
      params: cloneParams(this.params),
      effects: cloneEffects(this.effectsParams),
    };

    if (existingIndex >= 0) {
      this.userPresets[existingIndex] = preset;
    } else {
      this.userPresets.push(preset);
    }

    this.userPresets.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    saveUserPresets(this.userPresets);
    this.activePresetId = preset.id;
    this.refreshPresetList();

    if (this.presetStatusEl) {
      this.presetStatusEl.textContent =
        existingIndex >= 0 ? `Updated “${preset.name}”` : `Saved “${preset.name}”`;
    }
    if (this.presetNameInput) {
      this.presetNameInput.value = preset.name;
    }
  }

  private deleteUserPreset(id: string): void {
    const preset = this.userPresets.find((entry) => entry.id === id);
    if (!preset) {
      return;
    }

    this.userPresets = this.userPresets.filter((entry) => entry.id !== id);
    saveUserPresets(this.userPresets);
    if (this.activePresetId === id) {
      this.activePresetId = null;
    }
    this.refreshPresetList();
    if (this.presetStatusEl) {
      this.presetStatusEl.textContent = `Deleted “${preset.name}”`;
    }
  }

  private exportCurrentPreset(): void {
    const name = this.presetNameInput?.value.trim() || "MiniSynth Preset";
    this.exportPreset({
      id: this.activePresetId ?? `export-${Date.now()}`,
      name,
      builtIn: false,
      params: cloneParams(this.params),
      effects: cloneEffects(this.effectsParams),
    });
  }

  private exportPreset(preset: SynthPreset): void {
    const payload = {
      format: "minisynth-preset",
      version: 1,
      name: preset.name,
      params: cloneParams(preset.params),
      effects: cloneEffects(preset.effects),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.presetFilename(preset.name)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    if (this.presetStatusEl) {
      this.presetStatusEl.textContent = `Exported “${preset.name}”`;
    }
  }

  private presetFilename(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug.length > 0 ? slug : "minisynth-preset";
  }

  private async importPresetFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const record =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;

      if (
        record
        && record.format !== undefined
        && record.format !== "minisynth-preset"
      ) {
        if (this.presetStatusEl) {
          this.presetStatusEl.textContent = "Unrecognized preset file";
        }
        return;
      }

      const preset = normalizeStoredPreset({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name:
          typeof record?.name === "string" && record.name.trim().length > 0
            ? record.name
            : file.name.replace(/\.json$/i, ""),
        params: record?.params,
        effects: record?.effects,
      });

      if (!preset) {
        if (this.presetStatusEl) {
          this.presetStatusEl.textContent = "Could not read that preset file";
        }
        return;
      }

      const existingIndex = this.userPresets.findIndex(
        (entry) => entry.name.toLowerCase() === preset.name.toLowerCase(),
      );
      if (existingIndex >= 0) {
        preset.id = this.userPresets[existingIndex].id;
        this.userPresets[existingIndex] = preset;
      } else {
        this.userPresets.push(preset);
      }

      this.userPresets.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
      saveUserPresets(this.userPresets);
      this.applyPreset(preset);
      if (this.presetNameInput) {
        this.presetNameInput.value = preset.name;
      }
      if (this.presetStatusEl) {
        this.presetStatusEl.textContent =
          existingIndex >= 0
            ? `Imported and updated “${preset.name}”`
            : `Imported “${preset.name}”`;
      }
    } catch {
      if (this.presetStatusEl) {
        this.presetStatusEl.textContent = "Could not read that preset file";
      }
    }
  }

  private createKeyboard(): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className =
      "flex shrink-0 flex-col justify-end px-3 pb-3 pt-2";

    const chordBar = document.createElement("div");
    chordBar.className =
      "mx-auto mb-1.5 grid h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/40 px-2";

    const barButtonClass =
      "shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

    this.midiFileInput = document.createElement("input");
    this.midiFileInput.type = "file";
    this.midiFileInput.accept = ".mid,.midi,audio/midi,audio/x-midi";
    this.midiFileInput.className = "hidden";
    this.midiFileInput.addEventListener(
      "change",
      () => {
        const file = this.midiFileInput?.files?.[0];
        if (this.midiFileInput) {
          this.midiFileInput.value = "";
        }
        if (file) {
          void this.loadMidiFile(file);
        }
      },
      { signal: this.abort.signal },
    );

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = barButtonClass;
    loadButton.textContent = "Load";
    loadButton.title = "Load MIDI file";
    loadButton.addEventListener(
      "click",
      () => {
        this.midiFileInput?.click();
      },
      { signal: this.abort.signal },
    );

    this.midiFileBackButton = document.createElement("button");
    this.midiFileBackButton.type = "button";
    this.midiFileBackButton.className = barButtonClass;
    this.midiFileBackButton.textContent = "«";
    this.midiFileBackButton.title = `Skip back ${MIDI_FILE_SKIP_SECONDS}s`;
    this.midiFileBackButton.addEventListener(
      "click",
      () => {
        this.skipMidiFile(-MIDI_FILE_SKIP_SECONDS);
      },
      { signal: this.abort.signal },
    );

    this.midiFilePlayStopButton = document.createElement("button");
    this.midiFilePlayStopButton.type = "button";
    this.midiFilePlayStopButton.className =
      "shrink-0 rounded border border-emerald-700/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";
    this.midiFilePlayStopButton.textContent = "Play";
    this.midiFilePlayStopButton.title = "Play MIDI file";
    this.midiFilePlayStopButton.addEventListener(
      "click",
      () => {
        if (this.midiFilePlaying) {
          this.stopMidiFile();
        } else {
          void this.playMidiFile();
        }
      },
      { signal: this.abort.signal },
    );

    this.midiFileForwardButton = document.createElement("button");
    this.midiFileForwardButton.type = "button";
    this.midiFileForwardButton.className = barButtonClass;
    this.midiFileForwardButton.textContent = "»";
    this.midiFileForwardButton.title = `Skip forward ${MIDI_FILE_SKIP_SECONDS}s`;
    this.midiFileForwardButton.addEventListener(
      "click",
      () => {
        this.skipMidiFile(MIDI_FILE_SKIP_SECONDS);
      },
      { signal: this.abort.signal },
    );

    this.midiFileTimeEl = document.createElement("span");
    this.midiFileTimeEl.className =
      "shrink-0 font-mono text-[10px] tabular-nums text-slate-400";
    this.midiFileTimeEl.textContent = "0:00 / 0:00";
    this.midiFileTimeEl.setAttribute("aria-label", "MIDI playback time");

    this.midiFileStatusEl = document.createElement("span");
    this.midiFileStatusEl.className =
      "min-w-0 truncate text-right font-mono text-[10px] text-slate-500";

    const midiTransport = document.createElement("div");
    midiTransport.className = "flex min-w-0 items-center gap-1.5";
    midiTransport.append(
      this.midiFilePlayStopButton,
      this.midiFileBackButton,
      this.midiFileForwardButton,
      this.midiFileTimeEl,
    );

    const chordCenter = document.createElement("div");
    chordCenter.className = "flex items-center justify-center px-2";
    chordCenter.setAttribute("aria-live", "polite");
    chordCenter.setAttribute("aria-label", "Current chord");

    this.chordLabelEl = document.createElement("span");
    this.chordLabelEl.className =
      "font-mono text-xs tabular-nums tracking-wide text-slate-500";
    this.chordLabelEl.textContent = "—";
    chordCenter.append(this.chordLabelEl);

    const midiMeta = document.createElement("div");
    midiMeta.className = "flex min-w-0 items-center justify-end gap-1.5";
    midiMeta.append(this.midiFileStatusEl, loadButton, this.midiFileInput);

    chordBar.append(midiTransport, chordCenter, midiMeta);

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
    wrapper.append(chordBar, this.keyboardRow);
    this.renderKeyboardKeys();
    this.updatePitchControls();
    this.updateChordDisplay();
    this.refreshMidiFilePanel();
    return wrapper;
  }

  private updateChordDisplay(): void {
    if (!this.chordLabelEl) {
      return;
    }

    const name = detectChordName(this.pressedKeys);
    if (!name) {
      this.chordLabelEl.textContent = "—";
      this.chordLabelEl.className =
        "font-mono text-xs tabular-nums tracking-wide text-slate-500";
      return;
    }

    this.chordLabelEl.textContent = name;
    this.chordLabelEl.className =
      "font-mono text-xs tabular-nums tracking-wide text-teal-300";
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
    this.syncKeyboardPressedVisuals();
  }

  private syncKeyboardPressedVisuals(): void {
    for (const [note, button] of this.keyButtons) {
      this.setKeyPressed(button, this.pressedKeys.has(note));
    }
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

    // Resolve note on each event so octave/transpose changes apply to clicks
    // (computer-keyboard handling already uses noteForLayout at press time).
    let activeNote: number | null = null;

    button.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        activeNote = this.noteForLayout(layout);
        void this.pressKey(activeNote);
      },
      { signal: this.abort.signal },
    );
    button.addEventListener(
      "pointerup",
      (event) => {
        if (button.hasPointerCapture(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        if (activeNote !== null) {
          this.releaseKey(activeNote);
          activeNote = null;
        }
      },
      { signal: this.abort.signal },
    );
    button.addEventListener(
      "pointercancel",
      () => {
        if (activeNote !== null) {
          this.releaseKey(activeNote);
          activeNote = null;
        }
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

        if (this.heldComputerKeys.has(event.code)) {
          return;
        }

        const note = this.noteForKeyCode(event.code);
        if (note === undefined) {
          return;
        }

        this.heldComputerKeys.set(event.code, note);
        void this.pressKey(note);
      },
      keyboardOptions,
    );

    window.addEventListener(
      "keyup",
      (event) => {
        if (!this.isCapturedKeyCode(event.code)) {
          return;
        }

        const heldNote = this.heldComputerKeys.get(event.code);
        if (heldNote === undefined) {
          return;
        }

        this.suppressBrowserKey(event);
        this.heldComputerKeys.delete(event.code);
        this.releaseKey(heldNote);
      },
      keyboardOptions,
    );
  }

  private restoreMidiSettings(): void {
    const settings = loadMidiSettings();
    this.midiEnabledInputIds =
      settings.enabledInputIds === null
        ? null
        : new Set(settings.enabledInputIds);

    // Re-enable quietly if the browser still has permission from a prior visit.
    if (!navigator.requestMIDIAccess) {
      return;
    }

    void navigator
      .requestMIDIAccess()
      .then((access) => {
        if (this.abort.signal.aborted) {
          return;
        }
        this.attachMidiAccess(access);
        this.refreshMidiPanel();
      })
      .catch(() => {
        // Stay off until the user enables MIDI from Config.
      });
  }

  private async requestMidiAccess(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.midiPermissionError =
        "Web MIDI is not supported in this browser.";
      this.refreshMidiPanel();
      return;
    }

    if (this.midiEnableButton) {
      this.midiEnableButton.disabled = true;
      this.midiEnableButton.textContent = "Requesting…";
    }

    try {
      const access = await navigator.requestMIDIAccess();
      if (this.abort.signal.aborted) {
        return;
      }
      this.midiPermissionError = null;
      this.attachMidiAccess(access);
    } catch {
      this.midiPermissionError =
        "MIDI permission was denied. Allow MIDI access in the browser, then try again.";
    }

    this.refreshMidiPanel();
  }

  private attachMidiAccess(access: MIDIAccess): void {
    if (this.midiAccess && this.midiAccess !== access) {
      this.midiAccess.onstatechange = null;
    }

    this.midiAccess = access;
    this.syncMidiInputs();
    access.onstatechange = () => {
      this.syncMidiInputs();
      this.refreshMidiPanel();
    };
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

  private isMidiInputEnabled(inputId: string): boolean {
    return (
      this.midiEnabledInputIds === null
      || this.midiEnabledInputIds.has(inputId)
    );
  }

  private setMidiInputEnabled(inputId: string, enabled: boolean): void {
    if (!this.midiAccess) {
      return;
    }

    if (this.midiEnabledInputIds === null) {
      this.midiEnabledInputIds = new Set(
        [...this.midiAccess.inputs.keys()],
      );
    }

    if (enabled) {
      this.midiEnabledInputIds.add(inputId);
    } else {
      this.midiEnabledInputIds.delete(inputId);
    }

    saveMidiSettings({
      enabledInputIds: [...this.midiEnabledInputIds],
    });
    this.syncMidiInputs();
    this.refreshMidiPanel();
  }

  private syncMidiInputs(): void {
    if (!this.midiAccess) {
      return;
    }

    const activeInputs = new Set(this.midiAccess.inputs.values());
    for (const input of this.midiBoundInputs) {
      if (!activeInputs.has(input) || !this.isMidiInputEnabled(input.id)) {
        input.onmidimessage = null;
        this.midiBoundInputs.delete(input);
      }
    }

    for (const input of activeInputs) {
      if (!this.isMidiInputEnabled(input.id)) {
        continue;
      }
      if (this.midiBoundInputs.has(input)) {
        continue;
      }

      input.onmidimessage = (event) => {
        this.handleMidiMessage(event);
      };
      this.midiBoundInputs.add(input);
    }
  }

  private flashMidiActivity(): void {
    if (!this.midiActivityEl) {
      return;
    }

    this.midiActivityEl.textContent = "Note";
    this.midiActivityEl.className =
      "rounded-full border border-emerald-700/70 bg-emerald-950/50 px-2 py-0.5 text-[10px] text-emerald-300";

    if (this.midiActivityTimer !== null) {
      window.clearTimeout(this.midiActivityTimer);
    }
    this.midiActivityTimer = window.setTimeout(() => {
      this.midiActivityTimer = null;
      if (!this.midiActivityEl) {
        return;
      }
      this.midiActivityEl.textContent = "Idle";
      this.midiActivityEl.className =
        "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500";
    }, 180);
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

    this.flashMidiActivity();

    const note = Math.min(127, Math.max(0, parsed.note + this.transpose));

    if (parsed.type === "noteOn") {
      void this.pressKey(note);
      return;
    }

    this.releaseKey(note);
  }

  private async pressKey(note: number): Promise<void> {
    if (this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.add(note);
    this.setKeyPressed(this.keyButtons.get(note), true);
    this.updateChordDisplay();
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
    this.updateChordDisplay();
    this.synth.noteOff(note);
    this.updateVisualizations();
  }

  private releaseManualKeys(): void {
    this.heldComputerKeys.clear();
    for (const note of [...this.pressedKeys]) {
      if (this.midiFileHoldCounts.has(note)) {
        continue;
      }
      this.releaseKey(note);
    }
    this.updateChordDisplay();
    this.updateVisualizations();
  }

  private releaseAllKeys(): void {
    this.stopMidiFile();
    this.heldComputerKeys.clear();
    for (const note of this.pressedKeys) {
      this.setKeyPressed(this.keyButtons.get(note), false);
    }
    this.pressedKeys.clear();
    this.updateChordDisplay();
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
