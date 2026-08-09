import { formatDelayTime } from "../../../audio/paramMath.js";
import type { RotaryKnobHandle } from "../../../RotaryKnob.js";
import type { EffectsParams } from "../../../types.js";
import {
  createEffectKnob,
  type Panel,
  type PanelHost,
  syncEffectKnobs,
} from "../../panelHost.js";
import { createKnobRow, createSection } from "../../primitives.js";

export class DelayPanel implements Panel {
  private readonly knobs = new Map<keyof EffectsParams, RotaryKnobHandle>();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const section = createSection("Delay");

    const controls = createKnobRow(3);
    controls.append(
      createEffectKnob(
        this.host,
        this.knobs,
        "Time",
        "delayTime",
        0,
        1,
        0.01,
        formatDelayTime,
        "delay",
      ),
      createEffectKnob(
        this.host,
        this.knobs,
        "Fdbk",
        "delayFeedback",
        0,
        0.85,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "delay",
      ),
      createEffectKnob(
        this.host,
        this.knobs,
        "Mix",
        "delayMix",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "delay",
      ),
    );

    section.append(controls);
    return section;
  }

  syncFromState(): void {
    syncEffectKnobs(this.host, this.knobs);
  }

  dispose(): void {
    this.knobs.clear();
  }
}
