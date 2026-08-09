import {
  cutoffHz,
  filterQ,
  formatHz,
  formatVibratoDepth,
  lowpassMagnitude24dB,
  oscSample,
  pulseWidthLabel,
  sweepSeconds,
  vibratoDepthPreviewScale,
  vibratoRampEnvelope,
  vibratoWaveformValue,
} from "../audio/paramMath.js";
import {
  buildFilteredMasterWaveform,
  randomModSample,
  type MasterPreviewVoice,
  type NotePlayheadState,
} from "../audio/preview.js";
import {
  ENVELOPE_HOLD,
  MAX_CUTOFF_HZ,
  OSC_WAVEFORM_OPTIONS,
} from "../constants.js";
import type {
  OscId,
  OscWaveform,
  PanelTheme,
  SynthParams,
} from "../types.js";

interface PlotPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
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

function oscWaveformLabel(waveform: OscWaveform): string {
  return (
    OSC_WAVEFORM_OPTIONS.find((option) => option.value === waveform)?.label
    ?? waveform
  );
}

export function setupCanvas(
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

export function drawAdsrEnvelope(
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

export function drawWaveformPreview(
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

export function drawMasterOutputPreview(
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

export function drawFilterPreview(
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

export function drawVibratoPreview(
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

export function drawRandomPreview(
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
