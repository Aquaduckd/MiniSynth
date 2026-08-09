import {
  FILTER_SWEEP_MAX_SECONDS,
  FILTER_SWEEP_MIN_SECONDS,
  MAX_CUTOFF_HZ,
  MAX_DELAY_SECONDS,
  MAX_FILTER_Q,
  MAX_REVERB_SECONDS,
  MAX_VIBRATO_SEMITONES,
  MIN_CUTOFF_HZ,
  MIN_FILTER_Q,
  MIN_REVERB_SECONDS,
  OSC2_PITCH_CENTS_LIMIT,
  OSC2_PITCH_CENTS_SECTION,
  OSC2_PITCH_NEGATIVE_SECTION,
  OSC2_PITCH_POSITIVE_SECTION,
  OSC2_PITCH_SEMITONE_EXTENT,
  VIBRATO_DEPTH_CENTS_LIMIT,
} from "../constants.js";
import type { OscWaveform, VibratoWaveform } from "../types.js";

export function cutoffHz(value: number): number {
  return MIN_CUTOFF_HZ * (MAX_CUTOFF_HZ / MIN_CUTOFF_HZ) ** value;
}

export function filterQ(value: number): number {
  return MIN_FILTER_Q + value * (MAX_FILTER_Q - MIN_FILTER_Q);
}

export function delayTimeSeconds(value: number): number {
  const min = 0.05;
  const max = MAX_DELAY_SECONDS;
  return min * (max / min) ** value;
}

export function formatDelayTime(value: number): string {
  return `${Math.round(delayTimeSeconds(value) * 1000)} ms`;
}

export function reverbDurationSeconds(value: number): number {
  return MIN_REVERB_SECONDS + value * (MAX_REVERB_SECONDS - MIN_REVERB_SECONDS);
}

export function sweepSeconds(speed: number): number {
  const t = Math.min(1, Math.max(0, speed));
  return (
    FILTER_SWEEP_MIN_SECONDS +
    t * (FILTER_SWEEP_MAX_SECONDS - FILTER_SWEEP_MIN_SECONDS)
  );
}

export function pitchPeakHz(baseHz: number, pitchKnob: number): number {
  const cents = oscPitchKnobToCents(pitchKnob);
  if (cents === 0) {
    return baseHz;
  }

  const peak = baseHz * 2 ** (cents / 1200);
  return Math.max(20, peak);
}

export function oscTunedFrequency(baseHz: number, pitchKnob: number): number {
  const cents = oscPitchKnobToCents(pitchKnob);
  return baseHz * 2 ** (cents / 1200);
}

function oscPitchNegativeEnd(): number {
  return OSC2_PITCH_NEGATIVE_SECTION;
}

function oscPitchCentsEnd(): number {
  return OSC2_PITCH_NEGATIVE_SECTION + OSC2_PITCH_CENTS_SECTION;
}

export function oscPitchKnobToCents(knob: number): number {
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

export function snapOscPitchKnob(knob: number): number {
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

export function formatOscPitch(knob: number): string {
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

export function vibratoDepthCents(knob: number): number {
  const snapped = snapVibratoDepthKnob(knob);
  if (snapped <= 0.5) {
    return Math.round((snapped / 0.5) * VIBRATO_DEPTH_CENTS_LIMIT);
  }

  const index = Math.round(
    ((snapped - 0.5) / 0.5) * (MAX_VIBRATO_SEMITONES - 1),
  );
  return (index + 1) * 100;
}

export function snapVibratoDepthKnob(knob: number): number {
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

export function formatVibratoDepth(knob: number): string {
  const cents = vibratoDepthCents(knob);
  if (cents < VIBRATO_DEPTH_CENTS_LIMIT) {
    return `${cents}¢`;
  }

  return `${cents / 100} st`;
}

export function vibratoDepthPreviewScale(knob: number): number {
  return snapVibratoDepthKnob(knob);
}

export function createReverbImpulse(
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

export function formatHz(hz: number): string {
  if (hz >= 1000) {
    return `${(hz / 1000).toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

export function formatCutoff(value: number): string {
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

export function lowpassMagnitude24dB(
  frequency: number,
  cutoff: number,
  q: number,
): number {
  const stage = lowpassMagnitude(frequency, cutoff, q);
  return stage * stage;
}

function pulseSample(phase: number, width: number): number {
  return phase < width ? 1 : -1;
}

export function pulseWidthToDuty(width: number): number {
  return Math.min(0.5, Math.max(0.001, width * 0.5));
}

export function pulseWidthLabel(width: number): string {
  return `${Math.round(width * 50)}%`;
}

export function oscSample(
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

export function vibratoRampEnvelope(
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

export function vibratoWaveformValue(
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

export function clampRandomRate(rate: number): number {
  return Math.min(20, Math.max(0.1, rate));
}
