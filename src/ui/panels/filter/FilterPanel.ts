import { filterQ, formatCutoff, sweepSeconds } from "../../../audio/paramMath.js";
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
import { drawFilterPreview } from "./preview.js";

export class FilterPanel implements Panel {
  private canvasEl: HTMLCanvasElement | null = null;
  private readonly knobs = new Map<string, RotaryKnobHandle>();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const section = createSection("Filter");

    this.canvasEl = document.createElement("canvas");
    this.canvasEl.className = CANVAS_PREVIEW_CLASS;

    const filterControls = createKnobRow(4);
    filterControls.append(
      createParamKnob(
        this.host,
        this.knobs,
        "Initial",
        "filterInitial",
        0,
        1,
        0.01,
        formatCutoff,
        "filter",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "Final",
        "filterFinal",
        0,
        1,
        0.01,
        formatCutoff,
        "filter",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "Speed",
        "filterSpeed",
        0,
        1,
        0.01,
        (value) => `${Math.round(sweepSeconds(value) * 1000)} ms`,
        "filter",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "Res",
        "filterResonance",
        0,
        1,
        0.01,
        (value) => filterQ(value).toFixed(1),
        "filter",
      ),
    );

    section.append(this.canvasEl, filterControls);

    return section;
  }

  syncFromState(): void {
    syncParamKnobs(this.host, this.knobs);
  }

  draw(ctx: PanelDrawContext): void {
    if (!this.canvasEl) {
      return;
    }
    drawFilterPreview(
      this.canvasEl,
      this.host.getParams(),
      SECTION_THEMES.filter,
      ctx.playhead,
    );
  }

  dispose(): void {
    this.canvasEl = null;
    this.knobs.clear();
  }
}
