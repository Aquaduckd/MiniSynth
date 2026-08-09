import { SECTION_THEMES } from "../../../constants.js";
import { createRotaryKnob, type RotaryKnobHandle } from "../../../RotaryKnob.js";
import type { EffectsParams } from "../../../types.js";
import {
  type Panel,
  type PanelDrawContext,
  type PanelHost,
  syncEffectKnobs,
} from "../../panelHost.js";
import {
  createSection,
  MASTER_CONTROLS_MIN_WIDTH,
  themeKnobOptions,
} from "../../primitives.js";
import { drawMasterPreview } from "./preview.js";

export class MasterPanel implements Panel {
  private canvasEl: HTMLCanvasElement | null = null;
  private readonly knobs = new Map<keyof EffectsParams, RotaryKnobHandle>();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const section = createSection("Master");
    section.classList.add("shrink-0");

    const controls = document.createElement("div");
    controls.className =
      "grid w-full shrink-0 grid-cols-[minmax(120px,1fr)_auto] items-stretch gap-3 p-3";
    controls.style.minWidth = `${MASTER_CONTROLS_MIN_WIDTH}px`;

    const preview = document.createElement("div");
    preview.className = "relative h-full min-h-0 min-w-0";

    this.canvasEl = document.createElement("canvas");
    this.canvasEl.className =
      "absolute inset-0 block h-full w-full rounded border border-slate-800 bg-slate-950/80";
    preview.append(this.canvasEl);

    const volumeKnob = this.createVolumeKnob();
    volumeKnob.classList.add("shrink-0", "self-end");

    controls.append(preview, volumeKnob);

    section.append(controls);
    return section;
  }

  syncFromState(): void {
    syncEffectKnobs(this.host, this.knobs);
  }

  draw(ctx: PanelDrawContext): void {
    if (!this.canvasEl) {
      return;
    }
    drawMasterPreview(
      this.canvasEl,
      this.host.getParams(),
      ctx.previewVoices,
      SECTION_THEMES.master,
    );
  }

  dispose(): void {
    this.canvasEl = null;
    this.knobs.clear();
  }

  private createVolumeKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Volume",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.host.getEffects().masterVolume,
      format: (value) => `${Math.round(value * 100)}%`,
      ...themeKnobOptions("master"),
      onChange: (value) => {
        const effects = { ...this.host.getEffects(), masterVolume: value };
        this.host.setEffects(effects);
        this.host.applyEffectsToSynth(effects);
      },
    });

    this.knobs.set("masterVolume", knob);
    return knob.element;
  }
}
