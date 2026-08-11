import { oscSample, pulseWidthLabel } from "../../../audio/paramMath.js";
import { OSC_WAVEFORM_OPTIONS } from "../../../constants.js";
import type {
  OscId,
  OscWaveform,
  PanelTheme,
  SynthParams,
} from "../../../types.js";
import { type PlotPadding, setupCanvas } from "../../../viz/canvas.js";

function oscWaveformLabel(waveform: OscWaveform): string {
  return (
    OSC_WAVEFORM_OPTIONS.find((option) => option.value === waveform)?.label
    ?? waveform
  );
}

export function drawOscillatorPreview(
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
  ctx.fillText("ABCD"[osc] ?? String(osc + 1), pad.left, 12);
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
