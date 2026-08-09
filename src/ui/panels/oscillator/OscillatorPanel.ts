import {
  formatOscPitch,
  pulseWidthLabel,
  snapOscPitchKnob,
  sweepSeconds,
} from "../../../audio/paramMath.js";
import {
  OSC_COUNT,
  OSC_WAVEFORM_OPTIONS,
  SECTION_THEMES,
} from "../../../constants.js";
import {
  createRotaryKnob,
  type RotaryKnobHandle,
} from "../../../RotaryKnob.js";
import type { EffectsParams, OscId, OscWaveform } from "../../../types.js";
import {
  createEffectKnob,
  createKnobValueSpacer,
  createOptionButton,
  type Panel,
  type PanelDrawContext,
  type PanelHost,
  setActivityDot,
  syncEffectKnobs,
  syncParamKnobs,
  updateOptionButtons,
  updateTabButtons,
} from "../../panelHost.js";
import { drawOscillatorPreview } from "./preview.js";
import {
  CANVAS_PREVIEW_CLASS,
  createEffectFooter,
  createKnobRow,
  createLinkedPanel,
  createTabButton,
  OSC_MODULE_MIN_WIDTH,
  themeKnobOptions,
} from "../../primitives.js";

export class OscillatorPanel implements Panel {
  /** Waveform preview is static on param change; skip the live rAF loop. */
  readonly drawsLivePreview = false;

  private canvasEl: HTMLCanvasElement | null = null;
  private activeTabId: OscId = 0;
  private readonly tabButtons = new Map<OscId, HTMLButtonElement>();
  private readonly tabDots = new Map<OscId, HTMLElement>();
  private readonly tabPanels = new Map<OscId, HTMLElement>();
  private readonly waveformButtons: Array<Map<OscWaveform, HTMLButtonElement>> =
    [new Map(), new Map(), new Map()];
  private readonly widthKnobElements = new Map<OscId, HTMLElement>();
  private readonly paramKnobs = new Map<string, RotaryKnobHandle>();
  private readonly effectKnobs = new Map<
    keyof EffectsParams,
    RotaryKnobHandle
  >();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const panel = createLinkedPanel();

    this.canvasEl = document.createElement("canvas");
    this.canvasEl.className = CANVAS_PREVIEW_CLASS;

    const heading = document.createElement("div");
    heading.className =
      "flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2";

    const title = document.createElement("div");
    title.className =
      "text-xs font-medium uppercase tracking-wide text-slate-400";
    title.textContent = "Oscillator";

    const tabs = document.createElement("div");
    tabs.className = "flex items-center gap-1";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Oscillator");

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      const { button, dot } = createTabButton(`Osc ${osc + 1}`);
      button.dataset.oscTab = String(osc);
      button.addEventListener(
        "click",
        () => {
          this.setActiveTab(osc as OscId);
        },
        { signal: this.host.signal },
      );
      this.tabButtons.set(osc as OscId, button);
      this.tabDots.set(osc as OscId, dot);
      tabs.append(button);
    }

    heading.append(title, tabs);

    const body = document.createElement("div");
    body.className = "relative";

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      const tabPanel = this.createTabPanel(osc as OscId);
      this.tabPanels.set(osc as OscId, tabPanel);
      body.append(tabPanel);
    }

    const primary = document.createElement("div");
    primary.className = "flex min-w-0 flex-col";
    primary.append(heading, this.canvasEl, body);

    panel.append(
      primary,
      createEffectFooter("Pitch Envelope", this.createPitchControls()),
    );

    this.setActiveTab(this.activeTabId);
    this.updateActivityDots();
    return panel;
  }

  syncFromState(): void {
    syncParamKnobs(this.host, this.paramKnobs);
    syncEffectKnobs(this.host, this.effectKnobs);

    this.setActiveTab(0);
    this.updateWaveformButtons();
    this.updateActivityDots();
    this.updateWidthKnobVisibility();
  }

  draw(_ctx: PanelDrawContext): void {
    if (!this.canvasEl) {
      return;
    }
    drawOscillatorPreview(
      this.canvasEl,
      this.host.getParams(),
      SECTION_THEMES.oscillator,
      this.activeTabId,
    );
  }

  dispose(): void {
    this.canvasEl = null;
    this.tabButtons.clear();
    this.tabDots.clear();
    this.tabPanels.clear();
    for (const buttons of this.waveformButtons) {
      buttons.clear();
    }
    this.widthKnobElements.clear();
    this.paramKnobs.clear();
    this.effectKnobs.clear();
  }

  private createTabPanel(osc: OscId): HTMLElement {
    const panel = document.createElement("div");
    panel.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    panel.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;
    panel.setAttribute("role", "tabpanel");
    panel.dataset.oscPanel = String(osc);

    const knobValueSpacer = createKnobValueSpacer();

    const waveformColumn = document.createElement("div");
    waveformColumn.className = "flex shrink-0 flex-col items-center gap-0.5";

    const waveformGrid = document.createElement("div");
    waveformGrid.className = "grid grid-cols-2 gap-1";

    for (const option of OSC_WAVEFORM_OPTIONS) {
      const button = createOptionButton(this.host, option.label, () => {
        this.setWaveform(osc, option.value);
      });
      this.waveformButtons[osc].set(option.value, button);
      waveformGrid.append(button);
    }

    const waveLabel = document.createElement("span");
    waveLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    waveLabel.textContent = "Wave";
    waveformColumn.append(knobValueSpacer, waveformGrid, waveLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";

    const levelKnob = this.createLevelKnob(osc);
    levelKnob.classList.add("shrink-0");

    const widthKnob = this.createWidthKnob(osc);
    widthKnob.classList.add("shrink-0");
    this.widthKnobElements.set(osc, widthKnob);

    const pitchKnob = this.createPitchKnob(osc);
    pitchKnob.classList.add("shrink-0");

    knobsGroup.append(levelKnob, pitchKnob, widthKnob);
    panel.append(waveformColumn, knobsGroup);
    return panel;
  }

  private setActiveTab(osc: OscId): void {
    this.activeTabId = osc;

    updateTabButtons(this.tabButtons, osc, "oscillator");

    for (const [id, panel] of this.tabPanels) {
      panel.classList.toggle("hidden", id !== osc);
    }

    this.updateWaveformButtons();
    this.updateWidthKnobVisibility();
    this.host.onVisualize();
  }

  private setWaveform(osc: OscId, waveform: OscWaveform): void {
    const params = this.host.getParams();
    if (params.oscWaveforms[osc] === waveform) {
      return;
    }

    params.oscWaveforms[osc] = waveform;
    this.host.setParams(params);
    this.host.applyParamsToSynth(params);
    this.updateWaveformButtons();
    this.updateWidthKnobVisibility();
    this.host.onVisualize();
  }

  private updateWaveformButtons(): void {
    const params = this.host.getParams();
    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      updateOptionButtons(
        this.waveformButtons[osc],
        params.oscWaveforms[osc],
        "oscillator",
      );
    }
  }

  private updateWidthKnobVisibility(): void {
    const params = this.host.getParams();
    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      this.widthKnobElements.get(osc as OscId)?.classList.toggle(
        "hidden",
        params.oscWaveforms[osc] !== "pulse",
      );
    }
  }

  private updateActivityDots(): void {
    const params = this.host.getParams();

    for (const [osc, dot] of this.tabDots) {
      setActivityDot(dot, params.oscLevels[osc] > 0);
    }
  }

  private createLevelKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}Level`;
    const knob = createRotaryKnob({
      label: "Level",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.host.getParams().oscLevels[osc],
      format: (value) => `${Math.round(value * 100)}%`,
      ...themeKnobOptions("oscillator"),
      onChange: (value) => {
        const params = this.host.getParams();
        params.oscLevels[osc] = value;
        this.host.setParams(params);
        this.host.applyParamsToSynth(params);
        this.updateActivityDots();
        this.host.onVisualize();
      },
    });
    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createWidthKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}PulseWidth`;
    const knob = createRotaryKnob({
      label: "Width",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.host.getParams().oscPulseWidths[osc],
      format: pulseWidthLabel,
      ...themeKnobOptions("oscillator"),
      onChange: (value) => {
        const params = this.host.getParams();
        params.oscPulseWidths[osc] = value;
        this.host.setParams(params);
        this.host.applyParamsToSynth(params);
        this.host.onVisualize();
      },
    });
    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createPitchKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}Pitch`;
    const knob = createRotaryKnob({
      label: "Pitch",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapOscPitchKnob(this.host.getParams().oscPitches[osc]),
      format: formatOscPitch,
      ...themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOscPitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        const params = this.host.getParams();
        params.oscPitches[osc] = snapped;
        this.host.setParams(params);
        this.host.applyParamsToSynth(params);
        this.host.onVisualize();
      },
    });

    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createPitchControls(): HTMLElement {
    const controls = createKnobRow(2);
    controls.append(
      createEffectKnob(
        this.host,
        this.effectKnobs,
        "Speed",
        "pitchSpeed",
        0,
        1,
        0.01,
        (value) => `${Math.round(sweepSeconds(value) * 1000)} ms`,
        "oscillator",
      ),
      this.createPitchAmountKnob(),
    );
    return controls;
  }

  private createPitchAmountKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Amount",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapOscPitchKnob(this.host.getEffects().pitchAmount),
      format: formatOscPitch,
      ...themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOscPitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        const effects = { ...this.host.getEffects(), pitchAmount: snapped };
        this.host.setEffects(effects);
        this.host.applyEffectsToSynth(effects);
      },
    });

    this.effectKnobs.set("pitchAmount", knob);
    return knob.element;
  }
}
