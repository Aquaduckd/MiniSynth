import {
  formatVibratoDepth,
  snapVibratoDepthKnob,
  vibratoDepthCents,
} from "../../../audio/paramMath.js";
import {
  RANDOM_MODE_OPTIONS,
  SECTION_THEMES,
  VIBRATO_OPTIONS,
} from "../../../constants.js";
import {
  createRotaryKnob,
  type RotaryKnobHandle,
} from "../../../RotaryKnob.js";
import type {
  PitchModTab,
  RandomMode,
  VibratoWaveform,
} from "../../../types.js";
import {
  createKnobValueSpacer,
  createOptionButton,
  createParamKnob,
  type Panel,
  type PanelDrawContext,
  type PanelHost,
  setActivityDot,
  syncParamKnobs,
  updateOptionButtons,
  updateTabButtons,
} from "../../panelHost.js";
import { drawRandomPreview, drawVibratoPreview } from "./preview.js";
import {
  CANVAS_PREVIEW_CLASS,
  createTabButton,
  themeKnobOptions,
  VIBRATO_CONTROLS_MIN_WIDTH,
} from "../../primitives.js";

export class PitchModPanel implements Panel {
  private canvasEl: HTMLCanvasElement | null = null;
  private activeTabId: PitchModTab = "vibrato";
  private readonly tabButtons = new Map<PitchModTab, HTMLButtonElement>();
  private readonly tabDots = new Map<PitchModTab, HTMLElement>();
  private readonly tabPanels = new Map<PitchModTab, HTMLElement>();
  private readonly vibratoButtons = new Map<
    VibratoWaveform,
    HTMLButtonElement
  >();
  private readonly randomModeButtons = new Map<RandomMode, HTMLButtonElement>();
  private readonly knobs = new Map<string, RotaryKnobHandle>();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const section = document.createElement("section");
    section.className =
      "flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";
    section.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;

    const heading = document.createElement("div");
    heading.className =
      "flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2";

    const title = document.createElement("div");
    title.className =
      "text-xs font-medium uppercase tracking-wide text-slate-400";
    title.textContent = "Pitch Mod";

    const tabs = document.createElement("div");
    tabs.className = "flex items-center gap-1";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Pitch modulation");

    for (const tabId of ["vibrato", "random"] as PitchModTab[]) {
      const { button, dot } = createTabButton(
        tabId === "vibrato" ? "Vibrato" : "Random",
      );
      button.addEventListener(
        "click",
        () => {
          this.setActiveTab(tabId);
        },
        { signal: this.host.signal },
      );
      this.tabButtons.set(tabId, button);
      this.tabDots.set(tabId, dot);
      tabs.append(button);
    }

    heading.append(title, tabs);

    this.canvasEl = document.createElement("canvas");
    this.canvasEl.className = CANVAS_PREVIEW_CLASS;

    const body = document.createElement("div");
    body.className = "relative";

    const vibratoPanel = this.createVibratoTabPanel();
    const randomPanel = this.createRandomTabPanel();
    this.tabPanels.set("vibrato", vibratoPanel);
    this.tabPanels.set("random", randomPanel);
    body.append(vibratoPanel, randomPanel);

    section.append(heading, this.canvasEl, body);
    this.setActiveTab(this.activeTabId);
    this.updateVibratoWaveformButtons();
    this.updateRandomModeButtons();
    this.updateActivityDots();
    return section;
  }

  syncFromState(): void {
    syncParamKnobs(this.host, this.knobs);

    this.setActiveTab(this.activeTabId);
    this.updateVibratoWaveformButtons();
    this.updateRandomModeButtons();
    this.updateActivityDots();
  }

  draw(ctx: PanelDrawContext): void {
    if (!this.canvasEl) {
      return;
    }
    const params = this.host.getParams();
    if (this.activeTabId === "random") {
      drawRandomPreview(
        this.canvasEl,
        params,
        SECTION_THEMES.vibrato,
        ctx.playhead,
      );
      return;
    }
    drawVibratoPreview(
      this.canvasEl,
      params,
      SECTION_THEMES.vibrato,
      ctx.playhead,
    );
  }

  dispose(): void {
    this.canvasEl = null;
    this.tabButtons.clear();
    this.tabDots.clear();
    this.tabPanels.clear();
    this.vibratoButtons.clear();
    this.randomModeButtons.clear();
    this.knobs.clear();
  }

  private createVibratoTabPanel(): HTMLElement {
    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    controlsRow.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;
    controlsRow.setAttribute("role", "tabpanel");

    const knobValueSpacer = createKnobValueSpacer();

    const waveformGroup = document.createElement("div");
    waveformGroup.className = "flex shrink-0 flex-col items-center gap-0.5";

    const waveformButtons = document.createElement("div");
    waveformButtons.className = "flex flex-col gap-1";

    for (const option of VIBRATO_OPTIONS) {
      const button = createOptionButton(this.host, option.label, () => {
        this.setVibratoWaveform(option.value);
      });
      this.vibratoButtons.set(option.value, button);
      waveformButtons.append(button);
    }

    const waveformLabel = document.createElement("span");
    waveformLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    waveformLabel.textContent = "Wave";
    waveformGroup.append(knobValueSpacer, waveformButtons, waveformLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";

    knobsGroup.append(
      createParamKnob(
        this.host,
        this.knobs,
        "Rate",
        "vibratoRate",
        0.5,
        20,
        0.1,
        (value) => `${value.toFixed(1)} Hz`,
        "vibrato",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "Delay",
        "vibratoDelay",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "vibrato",
      ),
      createParamKnob(
        this.host,
        this.knobs,
        "Ramp",
        "vibratoRamp",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "vibrato",
      ),
      this.createDepthKnob("vibratoAmount"),
    );

    controlsRow.append(waveformGroup, knobsGroup);
    return controlsRow;
  }

  private createRandomTabPanel(): HTMLElement {
    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    controlsRow.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;
    controlsRow.setAttribute("role", "tabpanel");

    const knobValueSpacer = createKnobValueSpacer();

    const modeGroup = document.createElement("div");
    modeGroup.className = "flex shrink-0 flex-col items-center gap-0.5";

    const modeButtons = document.createElement("div");
    modeButtons.className = "flex flex-col gap-1";

    for (const option of RANDOM_MODE_OPTIONS) {
      const button = createOptionButton(this.host, option.label, () => {
        this.setRandomMode(option.value);
      });
      this.randomModeButtons.set(option.value, button);
      modeButtons.append(button);
    }

    const modeLabel = document.createElement("span");
    modeLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    modeLabel.textContent = "Mode";
    modeGroup.append(knobValueSpacer, modeButtons, modeLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";
    knobsGroup.append(
      createParamKnob(
        this.host,
        this.knobs,
        "Rate",
        "randomRate",
        0.1,
        20,
        0.1,
        (value) => `${value.toFixed(1)} Hz`,
        "vibrato",
      ),
      this.createDepthKnob("randomAmount"),
    );

    controlsRow.append(modeGroup, knobsGroup);
    return controlsRow;
  }

  private createDepthKnob(key: "vibratoAmount" | "randomAmount"): HTMLElement {
    const knob = createRotaryKnob({
      label: "Depth",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapVibratoDepthKnob(this.host.getParams()[key]),
      format: formatVibratoDepth,
      ...themeKnobOptions("vibrato"),
      onChange: (value) => {
        const snapped = snapVibratoDepthKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        const params = { ...this.host.getParams(), [key]: snapped };
        this.host.setParams(params);
        this.host.applyParamsToSynth(params);
        this.updateActivityDots();
        this.host.onVisualize();
      },
    });

    this.knobs.set(key, knob);
    return knob.element;
  }

  private setActiveTab(tab: PitchModTab): void {
    this.activeTabId = tab;

    updateTabButtons(this.tabButtons, tab, "vibrato");

    for (const [id, panel] of this.tabPanels) {
      panel.classList.toggle("hidden", id !== tab);
    }

    this.host.onVisualize();
  }

  private setVibratoWaveform(waveform: VibratoWaveform): void {
    const params = this.host.getParams();
    if (params.vibratoWaveform === waveform) {
      return;
    }

    params.vibratoWaveform = waveform;
    this.host.setParams(params);
    this.host.applyParamsToSynth(params);
    this.updateVibratoWaveformButtons();
    this.host.onVisualize();
  }

  private setRandomMode(mode: RandomMode): void {
    const params = this.host.getParams();
    if (params.randomMode === mode) {
      return;
    }

    params.randomMode = mode;
    this.host.setParams(params);
    this.host.applyParamsToSynth(params);
    this.updateRandomModeButtons();
    this.host.onVisualize();
  }

  private updateVibratoWaveformButtons(): void {
    updateOptionButtons(
      this.vibratoButtons,
      this.host.getParams().vibratoWaveform,
      "vibrato",
    );
  }

  private updateRandomModeButtons(): void {
    updateOptionButtons(
      this.randomModeButtons,
      this.host.getParams().randomMode,
      "vibrato",
    );
  }

  private updateActivityDots(): void {
    const params = this.host.getParams();

    for (const [tab, dot] of this.tabDots) {
      const depth =
        tab === "vibrato" ? params.vibratoAmount : params.randomAmount;
      setActivityDot(dot, vibratoDepthCents(depth) > 0);
    }
  }
}
