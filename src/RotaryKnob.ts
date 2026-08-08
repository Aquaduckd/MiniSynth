export interface RotaryKnobOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  size?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  accent?: string;
  accentBright?: string;
  valueColor?: string;
}

export interface RotaryKnobHandle {
  element: HTMLElement;
  setValue: (value: number) => void;
  getValue: () => number;
  refreshDisplay: () => void;
}

const DEFAULT_KNOB_SIZE = 56;
const START_ANGLE = Math.PI * 0.75;
const SWEEP_ANGLE = Math.PI * 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapToStep(value: number, min: number, max: number, step: number): number {
  if (step <= 0) {
    return clamp(value, min, max);
  }

  const steps = Math.round((value - min) / step);
  return clamp(min + steps * step, min, max);
}

function valueToAngle(value: number, min: number, max: number): number {
  const t = (value - min) / (max - min);
  return START_ANGLE + t * SWEEP_ANGLE;
}

function drawKnob(
  canvas: HTMLCanvasElement,
  value: number,
  min: number,
  max: number,
  active: boolean,
  size: number,
  accent: string,
  accentBright: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = size / 2;
  const cy = size / 2;
  const bodyRadius = size / 2 - size * 0.18;
  const arcRadius = size / 2 - size * 0.07;

  ctx.clearRect(0, 0, size, size);

  ctx.lineCap = "round";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#334155";
  ctx.beginPath();
  ctx.arc(cx, cy, arcRadius, START_ANGLE, START_ANGLE + SWEEP_ANGLE);
  ctx.stroke();

  const angle = valueToAngle(value, min, max);
  ctx.strokeStyle = active ? accentBright : accent;
  ctx.beginPath();
  ctx.arc(cx, cy, arcRadius, START_ANGLE, angle);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const tickInner = bodyRadius * 0.28;
  const tickOuter = bodyRadius - 2;
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(
    cx + Math.cos(angle) * tickInner,
    cy + Math.sin(angle) * tickInner,
  );
  ctx.lineTo(
    cx + Math.cos(angle) * tickOuter,
    cy + Math.sin(angle) * tickOuter,
  );
  ctx.stroke();
}

export function createRotaryKnob(options: RotaryKnobOptions): RotaryKnobHandle {
  const knobSize = options.size ?? DEFAULT_KNOB_SIZE;
  const accent = options.accent ?? "#2dd4bf";
  const accentBright = options.accentBright ?? "#5eead4";
  const valueColor = options.valueColor ?? accentBright;
  let value = snapToStep(options.value, options.min, options.max, options.step);
  let dragging = false;
  let dragStartY = 0;
  let dragStartValue = value;

  const root = document.createElement("div");
  root.className = "flex min-w-0 flex-col items-center gap-0.5";

  const valueEl = document.createElement("span");
  valueEl.className = "font-mono text-[9px] leading-none";
  valueEl.style.color = valueColor;
  valueEl.textContent = options.format(value);

  const dial = document.createElement("div");
  dial.className =
    "relative cursor-ns-resize touch-none select-none rounded-full";
  dial.title = `${options.label}: drag up/down to adjust`;

  const canvas = document.createElement("canvas");
  canvas.className = "block";
  canvas.style.width = `${knobSize}px`;
  canvas.style.height = `${knobSize}px`;
  dial.append(canvas);

  const label = document.createElement("span");
  label.className =
    "text-[9px] font-medium uppercase tracking-wide text-slate-500";
  label.textContent = options.label;

  root.append(valueEl, dial, label);

  const sensitivity = (options.max - options.min) / 160;

  function emit(next: number): void {
    value = snapToStep(next, options.min, options.max, options.step);
    valueEl.textContent = options.format(value);
    drawKnob(canvas, value, options.min, options.max, dragging, knobSize, accent, accentBright);
    options.onChange(value);
  }

  function redraw(): void {
    drawKnob(canvas, value, options.min, options.max, dragging, knobSize, accent, accentBright);
  }

  dial.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    dragStartY = event.clientY;
    dragStartValue = value;
    dial.setPointerCapture(event.pointerId);
    redraw();
  });

  dial.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }

    const delta = dragStartY - event.clientY;
    emit(dragStartValue + delta * sensitivity);
  });

  dial.addEventListener("pointerup", (event) => {
    if (!dragging) {
      return;
    }

    dragging = false;
    if (dial.hasPointerCapture(event.pointerId)) {
      dial.releasePointerCapture(event.pointerId);
    }
    redraw();
  });

  dial.addEventListener("pointercancel", () => {
    dragging = false;
    redraw();
  });

  dial.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const increment = event.shiftKey
        ? options.step
        : Math.max(options.step, (options.max - options.min) / 40);
      emit(value + direction * increment);
    },
    { passive: false },
  );

  redraw();

  function refreshDisplay(): void {
    valueEl.textContent = options.format(value);
    redraw();
  }

  return {
    element: root,
    setValue(next) {
      value = snapToStep(next, options.min, options.max, options.step);
      refreshDisplay();
    },
    getValue() {
      return value;
    },
    refreshDisplay,
  };
}
