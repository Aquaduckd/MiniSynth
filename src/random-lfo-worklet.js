/// Continuous random / Perlin pitch-mod LFO.
/// Must stay in sync with randomModSample() in audio/preview.ts.

function createPerlinPermutation(seed = 42) {
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

function perlinFade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function perlin1(x) {
  const xi = Math.floor(x) & 255;
  const xf = x - Math.floor(x);
  const u = perlinFade(xf);
  const a = PERLIN_PERM[xi];
  const b = PERLIN_PERM[xi + 1];
  const gradA = (a & 1) === 0 ? xf : -xf;
  const gradB = (b & 1) === 0 ? xf - 1 : -(xf - 1);
  return gradA + u * (gradB - gradA);
}

function hashNoiseSample(index) {
  let x = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * 2 - 1;
}

function clampRate(rate) {
  return Math.min(20, Math.max(0.1, rate));
}

function sampleAt(time, rate, mode) {
  const r = clampRate(rate);
  if (mode === "perlin") {
    return (
      perlin1(time * r * 0.85) * 0.7
      + perlin1(time * r * 1.7 + 12.4) * 0.3
    );
  }

  const x = time * r * 1.25;
  const i0 = Math.floor(x);
  const frac = perlinFade(x - i0);
  const smooth =
    hashNoiseSample(i0)
    + (hashNoiseSample(i0 + 1) - hashNoiseSample(i0)) * frac;
  const y = time * r * 3.5;
  const j0 = Math.floor(y);
  const gritFrac = y - j0;
  const grit =
    hashNoiseSample(j0 + 97)
    + (hashNoiseSample(j0 + 98) - hashNoiseSample(j0 + 97)) * gritFrac;
  return Math.max(-1, Math.min(1, smooth * 0.72 + grit * 0.28));
}

class RandomLfoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.time = 0;
    this.mode = "noise";
    this.active = true;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }

      if (data.type === "stop") {
        this.active = false;
        return;
      }

      if (data.type === "params") {
        if (data.mode === "noise" || data.mode === "perlin") {
          this.mode = data.mode;
        }
      }
    };
  }

  static get parameterDescriptors() {
    return [
      {
        name: "rate",
        defaultValue: 4,
        minValue: 0.1,
        maxValue: 20,
        automationRate: "k-rate",
      },
    ];
  }

  process(_inputs, outputs, parameters) {
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }

    if (!this.active) {
      output.fill(0);
      return false;
    }

    const rateParam = parameters.rate;
    const rate =
      rateParam.length > 1 ? rateParam[0] : (rateParam[0] ?? 4);
    const dt = 1 / sampleRate;

    for (let index = 0; index < output.length; index += 1) {
      output[index] = sampleAt(this.time, rate, this.mode);
      this.time += dt;
    }

    return true;
  }
}

registerProcessor("random-lfo", RandomLfoProcessor);
