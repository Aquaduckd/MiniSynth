import {
  ENVELOPE_HOLD,
  MASTER_PREVIEW_HZ,
  MASTER_PREVIEW_PERIODS,
  MASTER_PREVIEW_SAMPLE_RATE,
  MASTER_PREVIEW_WARM_PERIODS,
  MIN_CUTOFF_HZ,
  OSC_COUNT,
} from "../constants.js";
import type { SynthParams } from "../types.js";
import {
  clampRandomRate,
  cutoffHz,
  filterQ,
  oscSample,
  oscTunedFrequency,
  sweepSeconds,
} from "./paramMath.js";

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

export interface BiquadCoeffs {
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

export class BiquadProcessor {
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

export function previewFilterCutoffAtTime(params: SynthParams, time: number): number {
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

export interface MasterPreviewVoice {
  baseFrequency: number;
  filterTimeOffset: number;
}

export interface NotePlayheadState {
  envelopeTime: number;
  envelopeLevel: number;
  filterCutoffHz: number;
  vibratoTime: number;
}

export function envelopeLevelAtElapsed(params: SynthParams, elapsed: number): number {
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

export function envelopeDiagramTime(params: SynthParams, elapsed: number): number {
  const { attack, decay } = params;
  const sustainEnd = attack + decay + ENVELOPE_HOLD;

  if (elapsed <= attack + decay) {
    return elapsed;
  }

  return Math.min(sustainEnd, attack + decay + (elapsed - attack - decay));
}

export function buildFilteredMasterWaveform(
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

function hashNoiseSample(index: number): number {
  let x = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * 2 - 1;
}

export function randomModSample(time: number, params: SynthParams): number {
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
