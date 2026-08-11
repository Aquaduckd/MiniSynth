import {
  cloneEffects,
  cloneParams,
  DEFAULT_EFFECTS,
  DEFAULT_PARAMS,
  OSC_COUNT,
} from "../constants.js";
import type {
  EffectsParams,
  FmAlgorithmId,
  OscNumberTuple,
  OscWaveform,
  OscWaveformTuple,
  RandomMode,
  SynthParams,
  SynthPreset,
  VibratoWaveform,
} from "../types.js";
import { isFmAlgorithmId } from "../audio/fmAlgorithms.js";

const PRESET_STORAGE_KEY = "minisynth.presets.v1";

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

export const BUILT_IN_PRESETS: SynthPreset[] = [
  makeBuiltInPreset("init", "Default", {}),
];

export function loadUserPresets(): SynthPreset[] {
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

export function saveUserPresets(presets: SynthPreset[]): void {
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

export function normalizeStoredPreset(entry: unknown): SynthPreset | null {
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
    oscWaveforms: Array.from({ length: OSC_COUNT }, (_, index) =>
      isOscWaveform(waveforms[index])
        ? waveforms[index]
        : DEFAULT_PARAMS.oscWaveforms[index],
    ) as OscWaveformTuple,
    oscLevels: Array.from({ length: OSC_COUNT }, (_, index) =>
      normalizeNumber(levels[index], DEFAULT_PARAMS.oscLevels[index], 0, 1),
    ) as OscNumberTuple,
    oscPitches: Array.from({ length: OSC_COUNT }, (_, index) =>
      normalizeNumber(pitches[index], DEFAULT_PARAMS.oscPitches[index], 0, 1),
    ) as OscNumberTuple,
    oscPulseWidths: Array.from({ length: OSC_COUNT }, (_, index) =>
      normalizeNumber(widths[index], DEFAULT_PARAMS.oscPulseWidths[index], 0, 1),
    ) as OscNumberTuple,
    fmEnabled: Boolean(rawParams.fmEnabled),
    fmAlgorithm: (
      isFmAlgorithmId(rawParams.fmAlgorithm)
        ? rawParams.fmAlgorithm
        : DEFAULT_PARAMS.fmAlgorithm
    ) as FmAlgorithmId,
    fmFeedback: normalizeNumber(
      rawParams.fmFeedback,
      DEFAULT_PARAMS.fmFeedback,
      0,
      1,
    ),
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
