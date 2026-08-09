import {
  cutoffHz,
  filterQ,
  formatHz,
  lowpassMagnitude24dB,
  sweepSeconds,
} from "../../../audio/paramMath.js";
import type { NotePlayheadState } from "../../../audio/preview.js";
import { MAX_CUTOFF_HZ } from "../../../constants.js";
import type { PanelTheme, SynthParams } from "../../../types.js";
import { type PlotPadding, setupCanvas } from "../../../viz/canvas.js";

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
  const cutoffLabel = playhead ? `${formatHz(activeCutoff)} · ` : "";
  ctx.fillText(
    `${cutoffLabel}${formatHz(initialHz)} → ${formatHz(finalHz)} · ${Math.round(sweepSeconds(params.filterSpeed) * 1000)} ms · Q ${q.toFixed(1)}`,
    width - pad.right,
    12,
  );
  ctx.textAlign = "start";
}
