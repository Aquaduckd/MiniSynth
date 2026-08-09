import { reverbDurationSeconds } from "../../../audio/paramMath.js";
import type { RotaryKnobHandle } from "../../../RotaryKnob.js";
import type { EffectsParams } from "../../../types.js";
import {
  createEffectKnob,
  type Panel,
  type PanelHost,
  syncEffectKnobs,
} from "../../panelHost.js";
import { createKnobRow, createSection } from "../../primitives.js";

export class ReverbPanel implements Panel {
  private readonly knobs = new Map<keyof EffectsParams, RotaryKnobHandle>();

  constructor(private readonly host: PanelHost) {}

  mount(): HTMLElement {
    const section = createSection("Reverb");

    const controls = createKnobRow(2);
    controls.append(
      createEffectKnob(
        this.host,
        this.knobs,
        "Decay",
        "reverbDecay",
        0,
        1,
        0.01,
        (value) => `${reverbDurationSeconds(value).toFixed(1)} s`,
        "reverb",
      ),
      createEffectKnob(
        this.host,
        this.knobs,
        "Mix",
        "reverbMix",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "reverb",
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
