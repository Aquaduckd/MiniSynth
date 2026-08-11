import { SimpleSynth } from "./audio/SimpleSynth.js";
import {
  cloneEffects,
  cloneParams,
  DEFAULT_EFFECTS,
  DEFAULT_PARAMS,
} from "./constants.js";
import { MidiDeviceManager } from "./midi/MidiDeviceManager.js";
import { MidiFilePlayer } from "./midi/MidiFilePlayer.js";
import { BUILT_IN_PRESETS } from "./storage/presets.js";
import type { EffectsParams, SynthParams, SynthPreset } from "./types.js";
import { ConfigModal } from "./ui/ConfigModal.js";
import { ControlPanels } from "./ui/ControlPanels.js";
import type { PanelDrawContext } from "./ui/panelHost.js";
import { PianoKeyboard } from "./ui/PianoKeyboard.js";
import { PresetsModal } from "./ui/PresetsModal.js";

export class SynthApp {
  private root: HTMLDivElement | null = null;
  private controlsEl: HTMLDivElement | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private synth = new SimpleSynth();
  private params: SynthParams = cloneParams(DEFAULT_PARAMS);
  private effectsParams: EffectsParams = { ...DEFAULT_EFFECTS };
  private vizObserver: ResizeObserver | null = null;
  private livePreviewFrame: number | null = null;
  private readonly abort = new AbortController();
  private readonly panels = new ControlPanels({
    signal: this.abort.signal,
    getParams: () => this.params,
    setParams: (params) => {
      this.params = params;
    },
    getEffects: () => this.effectsParams,
    setEffects: (effects) => {
      this.effectsParams = effects;
    },
    applyParamsToSynth: (params) => {
      this.synth.setParams(params);
    },
    applyEffectsToSynth: (effects) => {
      this.synth.setEffectsParams(effects);
    },
    onVisualize: () => {
      this.updateVisualizations();
    },
  });
  private readonly presets = new PresetsModal(
    {
      getParams: () => this.params,
      getEffects: () => this.effectsParams,
      applySound: (preset) => {
        this.applySound(preset);
      },
    },
    this.abort.signal,
  );
  private readonly piano: PianoKeyboard = new PianoKeyboard({
    ensureAudioRunning: async () => {
      await this.synth.ensureRunning();
    },
    synthNoteOn: (note) => {
      this.synth.noteOn(note);
    },
    synthNoteOff: (note) => {
      this.synth.noteOff(note);
    },
    synthStopAll: () => {
      this.synth.stopAll();
    },
    isExternalHold: (note) => this.midiFilePlayer.isHolding(note),
    stopExternalPlayback: () => {
      this.midiFilePlayer.stop();
    },
    onNotesChanged: () => {
      this.updateVisualizations();
    },
  });
  private readonly midiDevices = new MidiDeviceManager({
    isAborted: () => this.abort.signal.aborted,
    isKeyboardEnabled: () => this.piano.isEnabled(),
    getTranspose: () => this.piano.transpose,
    noteOn: (note) => {
      void this.piano.press(note);
    },
    noteOff: (note) => {
      this.piano.release(note);
    },
  });
  private readonly config = new ConfigModal(
    {
      getPianoRollStyle: () => this.piano.style,
      setPianoRollStyle: (style) => {
        this.piano.setStyle(style);
      },
      createMidiConfigSection: (signal) =>
        this.midiDevices.createConfigSection(signal),
      refreshMidiPanel: () => {
        this.midiDevices.refreshPanel();
      },
      focusMidiEnableButton: () => {
        this.midiDevices.focusEnableButton();
      },
    },
    this.abort.signal,
  );
  private readonly midiFilePlayer: MidiFilePlayer = new MidiFilePlayer({
    getTranspose: () => this.piano.transpose,
    ensureAudioRunning: async () => {
      await this.synth.ensureRunning();
    },
    isAborted: () => this.abort.signal.aborted,
    noteOn: (note) => {
      this.piano.noteOnSync(note);
    },
    noteOff: (note) => {
      this.piano.release(note);
    },
    onTick: () => {
      this.updateVisualizations();
    },
  });

  mount(container: HTMLElement): void {
    if (this.root) {
      return;
    }

    this.synth.setPreviewChangeHandler(() => {
      this.updateLivePreviews();
      this.syncLivePreviewLoop();
    });

    this.root = document.createElement("div");
    this.root.className =
      "flex h-full w-full min-h-0 flex-col overflow-hidden text-slate-100";

    const header = document.createElement("div");
    header.className =
      "flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 text-xs text-slate-400";

    const headerLabel = document.createElement("div");
    headerLabel.className = "min-w-0 truncate";
    headerLabel.textContent =
      "Synth · keyboard, MIDI, or click · Z/X octave · ./ transpose";

    const headerActions = document.createElement("div");
    headerActions.className = "flex shrink-0 items-center gap-2";

    const configButton = document.createElement("button");
    configButton.type = "button";
    configButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    configButton.textContent = "Config";
    configButton.addEventListener(
      "click",
      () => {
        this.config.open();
      },
      { signal: this.abort.signal },
    );

    const presetsButton = document.createElement("button");
    presetsButton.type = "button";
    presetsButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    presetsButton.textContent = "Presets";
    presetsButton.addEventListener(
      "click",
      () => {
        this.presets.open();
      },
      { signal: this.abort.signal },
    );

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    resetButton.textContent = "Reset";
    resetButton.addEventListener(
      "click",
      () => {
        this.resetToDefaults();
      },
      { signal: this.abort.signal },
    );

    headerActions.append(configButton, presetsButton, resetButton);
    header.append(headerLabel, headerActions);

    this.controlsEl = document.createElement("div");
    this.controlsEl.className =
      "flex min-h-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto overscroll-contain border-b border-slate-800 p-3";

    this.controlsEl.append(this.panels.buildModuleGrid());

    this.piano.restoreSettings();
    const { transport: midiTransport, status: midiStatus } =
      this.midiFilePlayer.createControls(this.abort.signal);
    const keyboardWrapper = this.piano.mount({
      signal: this.abort.signal,
      leadingBar: midiTransport,
      trailingBar: midiStatus,
    });

    this.root.append(header, this.controlsEl, keyboardWrapper);
    container.append(this.root);

    this.piano.setEnabled(true);
    this.observeVisualizations(this.controlsEl);
    this.bindLayoutObserver();
    this.syncPanelLayout(container.clientWidth, container.clientHeight);
    this.updateVisualizations();
    this.piano.bindComputerKeys(this.abort.signal);
    this.midiDevices.restore();
    this.bindWindowFocus();
  }

  destroy(): void {
    this.piano.setEnabled(false);
    this.stopLivePreviewLoop();
    this.synth.setPreviewChangeHandler(null);
    this.piano.releaseAll();
    this.synth.dispose();
    this.vizObserver?.disconnect();
    this.vizObserver = null;
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.midiDevices.dispose();
    this.abort.abort();
    this.presets.dispose();
    this.config.dispose();
    this.midiFilePlayer.dispose();
    this.piano.dispose();
    this.root?.remove();
    this.root = null;
    this.controlsEl = null;
    this.panels.dispose();
  }

  private bindWindowFocus(): void {
    window.addEventListener(
      "blur",
      () => {
        // Drop stuck computer/pointer keys, but keep MIDI file playback going.
        this.piano.releaseManual();
      },
      { signal: this.abort.signal },
    );
  }

  private observeVisualizations(container: HTMLElement): void {
    this.vizObserver = new ResizeObserver(() => {
      this.updateVisualizations();
    });
    this.vizObserver.observe(container);
  }

  private bindLayoutObserver(): void {
    if (!this.root) {
      return;
    }

    this.layoutObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.syncPanelLayout(width, height);
    });
    this.layoutObserver.observe(this.root);
  }

  private syncPanelLayout(_width: number, height: number): void {
    this.piano.setHeight(Math.max(72, Math.min(144, Math.round(height * 0.24))));
  }

  private vizContext(): PanelDrawContext {
    return {
      playhead: this.synth.getLastNotePlayhead(),
      previewVoices: this.synth.getPreviewVoices(),
    };
  }

  private updateVisualizations(): void {
    this.panels.drawAll(this.vizContext());
    this.syncLivePreviewLoop();
  }

  private updateLivePreviews(): void {
    this.panels.drawLive(this.vizContext());
  }

  private syncLivePreviewLoop(): void {
    if (
      !this.piano.isEnabled() ||
      !this.synth.isLivePreviewActive()
    ) {
      this.stopLivePreviewLoop();
      return;
    }

    if (this.livePreviewFrame !== null) {
      return;
    }

    const tick = () => {
      if (!this.synth.isLivePreviewActive()) {
        this.livePreviewFrame = null;
        this.updateVisualizations();
        return;
      }

      this.updateLivePreviews();
      this.livePreviewFrame = requestAnimationFrame(tick);
    };

    this.livePreviewFrame = requestAnimationFrame(tick);
  }

  private stopLivePreviewLoop(): void {
    if (this.livePreviewFrame === null) {
      return;
    }

    cancelAnimationFrame(this.livePreviewFrame);
    this.livePreviewFrame = null;
  }

  private resetToDefaults(): void {
    this.applyPreset(BUILT_IN_PRESETS[0]);
  }

  private applyPreset(preset: SynthPreset): void {
    this.applySound(preset);
    this.presets.setActiveId(preset.id);
  }

  private applySound(preset: SynthPreset): void {
    this.params = cloneParams(preset.params);
    this.effectsParams = cloneEffects(preset.effects);
    this.synth.setParams(this.params);
        this.synth.setEffectsParams(this.effectsParams);
    this.panels.syncControlsFromState();
  }
}
