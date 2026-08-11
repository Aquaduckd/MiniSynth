import { SECTION_THEMES } from "../constants.js";
import type { RotaryKnobOptions } from "../RotaryKnob.js";
import type { SectionColor } from "../types.js";

export const CANVAS_PREVIEW_CLASS =
  "block aspect-[5/2] max-h-36 min-h-[4.5rem] w-full min-w-0";

export const KNOB_SIZE_PX = 56;
export const KNOB_GAP_PX = 8;
export const KNOB_ROW_PADDING_PX = 24;
export const OSC_WAVEFORM_BUTTON_WIDTH_PX = 64;

export function knobRowMinWidth(knobCount: number): number {
  return (
    knobCount * KNOB_SIZE_PX +
    Math.max(0, knobCount - 1) * KNOB_GAP_PX +
    KNOB_ROW_PADDING_PX
  );
}

export const MODULE_COLUMN_MIN_WIDTH = knobRowMinWidth(4);
export const OSC_MODULE_MIN_WIDTH =
  2 * OSC_WAVEFORM_BUTTON_WIDTH_PX +
  3 * KNOB_SIZE_PX +
  5 * KNOB_GAP_PX +
  KNOB_ROW_PADDING_PX;
export const VIBRATO_CONTROLS_MIN_WIDTH =
  OSC_WAVEFORM_BUTTON_WIDTH_PX +
  4 * KNOB_SIZE_PX +
  4 * KNOB_GAP_PX +
  KNOB_ROW_PADDING_PX;
export const MASTER_CONTROLS_MIN_WIDTH =
  120 + KNOB_GAP_PX + KNOB_SIZE_PX + KNOB_ROW_PADDING_PX;

export function createKnobRow(knobCount: number): HTMLDivElement {
  const controls = document.createElement("div");
  controls.className =
    "flex shrink-0 flex-nowrap items-start justify-around gap-2 p-3";
  controls.style.minWidth = `${knobRowMinWidth(knobCount)}px`;
  return controls;
}

export function themeKnobOptions(theme: SectionColor): Pick<
  RotaryKnobOptions,
  "accent" | "accentBright" | "valueColor"
> {
  const colors = SECTION_THEMES[theme];
  return {
    accent: colors.accent,
    accentBright: colors.accentBright,
    valueColor: colors.accentBright,
  };
}

export function createSectionHeading(title: string): HTMLElement {
  const heading = document.createElement("div");
  heading.className =
    "border-b border-slate-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400";
  heading.textContent = title;
  return heading;
}

export function createSection(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className =
    "flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";

  section.append(createSectionHeading(title));

  return section;
}

export function createEffectFooter(
  title: string,
  controls: HTMLElement,
): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "shrink-0";

  footer.append(createSectionHeading(title), controls);

  return footer;
}

export function createLinkedPanel(): HTMLElement {
  const panel = document.createElement("section");
  panel.className =
    "flex min-h-0 shrink-0 flex-col gap-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";
  panel.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;
  return panel;
}

export function createTabButton(label: string): {
  button: HTMLButtonElement;
  dot: HTMLElement;
} {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "tab");
  button.className =
    "inline-flex h-7 box-border items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";

  const dot = document.createElement("span");
  dot.className = "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
  dot.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = label;

  button.append(dot, text);
  return { button, dot };
}
