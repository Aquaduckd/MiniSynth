import type { NotePlayheadState } from "../../../audio/preview.js";
import { ENVELOPE_HOLD } from "../../../constants.js";
import type { PanelTheme, SynthParams } from "../../../types.js";
import {
  drawTimelinePlayhead,
  type PlotPadding,
  setupCanvas,
} from "../../../viz/canvas.js";

export function drawEnvelopePreview(
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
    {
      label: "Sustain",
      center: (xAt(attack + decay) + xAt(attack + decay + ENVELOPE_HOLD)) / 2,
    },
    {
      label: "Release",
      center: (xAt(attack + decay + ENVELOPE_HOLD) + xAt(total)) / 2,
    },
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
