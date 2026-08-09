import type { Panel, PanelDrawContext, PanelHost } from "./panelHost.js";
import { DelayPanel } from "./panels/delay/DelayPanel.js";
import { EnvelopePanel } from "./panels/envelope/EnvelopePanel.js";
import { FilterPanel } from "./panels/filter/FilterPanel.js";
import { MasterPanel } from "./panels/master/MasterPanel.js";
import { OscillatorPanel } from "./panels/oscillator/OscillatorPanel.js";
import { PitchModPanel } from "./panels/pitchMod/PitchModPanel.js";
import { ReverbPanel } from "./panels/reverb/ReverbPanel.js";
import {
  MASTER_CONTROLS_MIN_WIDTH,
  MODULE_COLUMN_MIN_WIDTH,
  VIBRATO_CONTROLS_MIN_WIDTH,
} from "./primitives.js";

export type ControlPanelsHost = PanelHost;

export class ControlPanels {
  private readonly oscillator: OscillatorPanel;
  private readonly filter: FilterPanel;
  private readonly delay: DelayPanel;
  private readonly envelope: EnvelopePanel;
  private readonly reverb: ReverbPanel;
  private readonly pitchMod: PitchModPanel;
  private readonly master: MasterPanel;
  private readonly panels: Panel[];

  constructor(private readonly host: ControlPanelsHost) {
    this.oscillator = new OscillatorPanel(host);
    this.filter = new FilterPanel(host);
    this.delay = new DelayPanel(host);
    this.envelope = new EnvelopePanel(host);
    this.reverb = new ReverbPanel(host);
    this.pitchMod = new PitchModPanel(host);
    this.master = new MasterPanel(host);
    this.panels = [
      this.oscillator,
      this.filter,
      this.delay,
      this.envelope,
      this.reverb,
      this.pitchMod,
      this.master,
    ];
  }

  buildModuleGrid(): HTMLElement {
    const moduleGrid = document.createElement("div");
    moduleGrid.className =
      "flex w-max max-w-full flex-wrap items-start justify-center gap-3";

    const filterDelayColumn = document.createElement("div");
    filterDelayColumn.className = "flex shrink-0 flex-col gap-3";
    filterDelayColumn.style.minWidth = `${MODULE_COLUMN_MIN_WIDTH}px`;

    const delayPedal = this.delay.mount();
    filterDelayColumn.append(this.filter.mount(), delayPedal);

    const envelopeReverbColumn = document.createElement("div");
    envelopeReverbColumn.className = "flex shrink-0 flex-col gap-3";
    envelopeReverbColumn.style.minWidth = `${MODULE_COLUMN_MIN_WIDTH}px`;

    const reverbPedal = this.reverb.mount();
    envelopeReverbColumn.append(this.envelope.mount(), reverbPedal);

    const vibratoColumn = document.createElement("div");
    vibratoColumn.className = "flex shrink-0 flex-col gap-3";
    vibratoColumn.style.minWidth = `${Math.max(
      MODULE_COLUMN_MIN_WIDTH,
      VIBRATO_CONTROLS_MIN_WIDTH,
      MASTER_CONTROLS_MIN_WIDTH,
    )}px`;

    const masterPedal = this.master.mount();
    masterPedal.classList.add("shrink-0");
    vibratoColumn.append(this.pitchMod.mount(), masterPedal);

    moduleGrid.append(
      this.oscillator.mount(),
      filterDelayColumn,
      envelopeReverbColumn,
      vibratoColumn,
    );

    return moduleGrid;
  }

  syncControlsFromState(): void {
    for (const panel of this.panels) {
      panel.syncFromState();
    }

    this.host.onVisualize();
  }

  /** Full redraw (param changes, resize, note activity). */
  drawAll(ctx: PanelDrawContext): void {
    for (const panel of this.panels) {
      panel.draw?.(ctx);
    }
  }

  /** Live rAF redraw — skips panels that opt out (e.g. oscillator waveform). */
  drawLive(ctx: PanelDrawContext): void {
    for (const panel of this.panels) {
      if (!panel.draw) {
        continue;
      }
      if (panel.drawsLivePreview === false) {
        continue;
      }
      panel.draw(ctx);
    }
  }

  dispose(): void {
    for (const panel of this.panels) {
      panel.dispose();
    }
  }
}
