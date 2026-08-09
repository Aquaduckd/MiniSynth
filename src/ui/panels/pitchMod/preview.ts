import {
  formatVibratoDepth,
  vibratoDepthPreviewScale,
  vibratoRampEnvelope,
  vibratoWaveformValue,
} from "../../../audio/paramMath.js";
import {
  randomModSample,
  type NotePlayheadState,
} from "../../../audio/preview.js";
import type { PanelTheme, SynthParams } from "../../../types.js";
import {
  drawTimelinePlayhead,
  type PlotPadding,
  setupCanvas,
} from "../../../viz/canvas.js";

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
  const amplitude =
    vibratoDepthPreviewScale(params.vibratoAmount) * maxAmplitude;
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
  const amplitude =
    vibratoDepthPreviewScale(params.randomAmount) * maxAmplitude;
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
