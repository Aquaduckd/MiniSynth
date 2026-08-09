import { SECTION_THEMES } from "../../../constants.js";
import type { RotaryKnobHandle } from "../../../RotaryKnob.js";
import {
  createParamKnob,
  type Panel,
  type PanelDrawContext,
  type PanelHost,
  syncParamKnobs,
} from "../../panelHost.js";
import {
  CANVAS_PREVIEW_CLASS,
  createKnobRow,
  createSection,
} from "../../primitives.js";
import { drawEnvelopePreview } from "./preview.js";

export class EnvelopePanel implements Panel {
  private canvasEl: HTMLCanvasElement | null = null;
  private readonly knobs = new Map<string, RotaryKnobHandle>();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const section = createSection("Envelope");

    this.canvasEl = document.createElement("canvas");
    this.canvasEl.className = CANVAS_PREVIEW_CLASS;

    const controls = createKnobRow(4);
    controls.append(
      createParamKnob(
        this.host,
        this.knobs,
        "A",
        "attack",
        0,
        1,
        0.001,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "D",
        "decay",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "S",
        "sustain",
        0,
        1,
        0.01,
        (value) => value.toFixed(2),
        "envelope",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "R",
        "release",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
    );

    section.append(this.canvasEl, controls);
    return section;
  }

  syncFromState(): void {
    syncParamKnobs(this.host, this.knobs);
  }

  draw(ctx: PanelDrawContext): void {
    if (!this.canvasEl) {
      return;
    }
    drawEnvelopePreview(
      this.canvasEl,
      this.host.getParams(),
      SECTION_THEMES.envelope,
      ctx.playhead,
    );
  }

  dispose(): void {
    this.canvasEl = null;
    this.knobs.clear();
  }
}
