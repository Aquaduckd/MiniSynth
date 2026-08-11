import { snapOscPitchKnob, snapVibratoDepthKnob } from "../audio/paramMath.js";
import type {
  MasterPreviewVoice,
  NotePlayheadState,
} from "../audio/preview.js";
import { SECTION_THEMES } from "../constants.js";
import { createRotaryKnob, type RotaryKnobHandle } from "../RotaryKnob.js";
import type {
  EffectsParams,
  SectionColor,
  SynthParams,
} from "../types.js";
import { themeKnobOptions } from "./primitives.js";

export interface PanelHost {
  signal: AbortSignal;
  getParams(): SynthParams;
  setParams(params: SynthParams): void;
  getEffects(): EffectsParams;
  setEffects(effects: EffectsParams): void;
  /** Push params/effects into the audio engine */
  applyParamsToSynth(params: SynthParams): void;
  applyEffectsToSynth(effects: EffectsParams): void;
  onVisualize(): void;
}

export interface PanelDrawContext {
  playhead: NotePlayheadState | null;
  previewVoices: MasterPreviewVoice[];
}

export interface Panel {
  mount(): HTMLElement;
  syncFromState(): void;
  dispose(): void;
  /** Draw this panel's preview canvas, if any. */
  draw?(ctx: PanelDrawContext): void;
  /**
   * Whether `draw` participates in the live rAF preview loop.
   * Defaults to true when `draw` is implemented.
   */
  readonly drawsLivePreview?: boolean;
}

export type NumericParamKey = {
  [K in keyof SynthParams]: SynthParams[K] extends number ? K : never;
}[keyof SynthParams];

export type ParamKnobMap = Map<string, RotaryKnobHandle>;
export type EffectKnobMap = Map<keyof EffectsParams, RotaryKnobHandle>;

const OPTION_BUTTON_BASE_CLASS =
  "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";
const OPTION_BUTTON_INACTIVE_CLASS =
  "w-16 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
const TAB_BUTTON_BASE_CLASS =
  "inline-flex h-7 box-border items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors";
const TAB_BUTTON_INACTIVE_CLASS =
  "inline-flex h-7 box-border items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
const ACTIVE_DOT_CLASS = "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400";
const INACTIVE_DOT_CLASS = "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";

export function createParamKnob(
  host: PanelHost,
  knobs: ParamKnobMap,
  label: string,
  key: NumericParamKey,
  min: number,
  max: number,
  step: number,
  format: (value: number) => string,
  theme: SectionColor,
): HTMLElement {
  const knob = createRotaryKnob({
    label,
    min,
    max,
    step,
    value: host.getParams()[key] as number,
    format,
    ...themeKnobOptions(theme),
    onChange: (value) => {
      const params = { ...host.getParams(), [key]: value };
      host.setParams(params);
      host.applyParamsToSynth(params);
      host.onVisualize();
    },
  });

  knobs.set(key, knob);
  return knob.element;
}

export function createEffectKnob(
  host: PanelHost,
  knobs: EffectKnobMap,
  label: string,
  key: keyof EffectsParams,
  min: number,
  max: number,
  step: number,
  format: (value: number) => string,
  theme: SectionColor,
): HTMLElement {
  const knob = createRotaryKnob({
    label,
    min,
    max,
    step,
    value: host.getEffects()[key],
    format,
    ...themeKnobOptions(theme),
    onChange: (value) => {
      const effects = { ...host.getEffects(), [key]: value };
      host.setEffects(effects);
      host.applyEffectsToSynth(effects);
    },
  });

  knobs.set(key, knob);
  return knob.element;
}

/** Pushes current params back into every registered knob, honouring knob-space snapping. */
export function syncParamKnobs(host: PanelHost, knobs: ParamKnobMap): void {
  const params = host.getParams();

  for (const [key, knob] of knobs) {
    const oscLevelMatch = /^osc(\d+)Level$/.exec(key);
    if (oscLevelMatch) {
      knob.setValue(params.oscLevels[Number(oscLevelMatch[1])] ?? 0);
      continue;
    }

    const oscPitchMatch = /^osc(\d+)Pitch$/.exec(key);
    if (oscPitchMatch) {
      knob.setValue(
        snapOscPitchKnob(params.oscPitches[Number(oscPitchMatch[1])] ?? 0.5),
      );
      continue;
    }

    const oscWidthMatch = /^osc(\d+)PulseWidth$/.exec(key);
    if (oscWidthMatch) {
      knob.setValue(params.oscPulseWidths[Number(oscWidthMatch[1])] ?? 1);
      continue;
    }

    const value = params[key as keyof SynthParams];
    if (typeof value !== "number") {
      continue;
    }

    if (key === "vibratoAmount" || key === "randomAmount") {
      knob.setValue(snapVibratoDepthKnob(value));
      continue;
    }

    knob.setValue(value);
  }
}

export function syncEffectKnobs(host: PanelHost, knobs: EffectKnobMap): void {
  const effects = host.getEffects();

  for (const [key, knob] of knobs) {
    if (key === "pitchAmount") {
      knob.setValue(snapOscPitchKnob(effects.pitchAmount));
      continue;
    }

    knob.setValue(effects[key]);
  }
}

export function createOptionButton(
  host: PanelHost,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = OPTION_BUTTON_BASE_CLASS;
  button.addEventListener("click", onClick, { signal: host.signal });
  return button;
}

export function updateOptionButtons<K>(
  buttons: Map<K, HTMLButtonElement>,
  activeValue: K,
  theme: SectionColor,
): void {
  const colors = SECTION_THEMES[theme];

  for (const [value, button] of buttons) {
    if (value === activeValue) {
      button.className = OPTION_BUTTON_BASE_CLASS;
      button.style.borderColor = `${colors.accent}99`;
      button.style.backgroundColor = colors.accentFill;
      button.style.color = colors.accentBright;
    } else {
      button.className = OPTION_BUTTON_INACTIVE_CLASS;
      button.style.borderColor = "";
      button.style.backgroundColor = "";
      button.style.color = "";
    }
  }
}

export function updateTabButtons<K>(
  buttons: Map<K, HTMLButtonElement>,
  activeId: K,
  theme: SectionColor,
): void {
  const colors = SECTION_THEMES[theme];

  for (const [id, button] of buttons) {
    const selected = id === activeId;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) {
      button.className = TAB_BUTTON_BASE_CLASS;
      button.style.borderColor = `${colors.accent}99`;
      button.style.backgroundColor = colors.accentFill;
      button.style.color = colors.accentBright;
    } else {
      button.className = TAB_BUTTON_INACTIVE_CLASS;
      button.style.borderColor = "";
      button.style.backgroundColor = "";
      button.style.color = "";
    }
  }
}

export function setActivityDot(dot: HTMLElement, active: boolean): void {
  dot.className = active ? ACTIVE_DOT_CLASS : INACTIVE_DOT_CLASS;
}

export function createKnobValueSpacer(): HTMLElement {
  const spacer = document.createElement("span");
  spacer.className =
    "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
  spacer.textContent = "100%";
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}
