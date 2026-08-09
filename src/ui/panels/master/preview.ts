import {
  buildFilteredMasterWaveform,
  type MasterPreviewVoice,
} from "../../../audio/preview.js";
import type { PanelTheme, SynthParams } from "../../../types.js";
import { type PlotPadding, setupCanvas } from "../../../viz/canvas.js";

export function drawMasterPreview(
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
