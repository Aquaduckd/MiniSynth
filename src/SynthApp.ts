import { SimpleSynth } from "./audio/SimpleSynth.js";
import {
  cloneEffects,
  cloneParams,
  DEFAULT_EFFECTS,
  DEFAULT_PARAMS,
} from "./constants.js";
import { MidiDeviceManager } from "./midi/MidiDeviceManager.js";
import { MidiFilePlayer } from "./midi/MidiFilePlayer.js";
import { PIANO_ROLL_STYLE_OPTIONS } from "./music/keyboard.js";
import { BUILT_IN_PRESETS } from "./storage/presets.js";
import type { EffectsParams, SynthParams, SynthPreset } from "./types.js";
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
  private pianoRollStyleSelect: HTMLSelectElement | null = null;
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
  private configModal: HTMLElement | null = null;
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
        this.openConfigModal();
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
    this.configModal?.remove();
    this.configModal = null;
    this.pianoRollStyleSelect = null;
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

  private openConfigModal(): void {
    if (!this.configModal) {
      this.configModal = this.createConfigModal();
      document.body.append(this.configModal);
    }

    this.midiDevices.refreshPanel();
    if (this.pianoRollStyleSelect) {
      this.pianoRollStyleSelect.value = this.piano.style;
    }
    this.configModal.classList.remove("hidden");
    this.configModal.classList.add("flex");
    this.midiDevices.focusEnableButton();
  }

  private closeConfigModal(): void {
    if (!this.configModal) {
      return;
    }

    this.configModal.classList.add("hidden");
    this.configModal.classList.remove("flex");
  }

  private createConfigModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]";

    const dialog = document.createElement("div");
    dialog.className =
      "flex max-h-[min(36rem,90vh)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Config");

    const header = document.createElement("div");
    header.className =
      "flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3";

    const title = document.createElement("h2");
    title.className = "text-sm font-medium text-slate-100";
    title.textContent = "Config";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    closeButton.textContent = "Close";
    closeButton.addEventListener(
      "click",
      () => {
        this.closeConfigModal();
      },
      { signal: this.abort.signal },
    );

    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3";

    const pianoSection = document.createElement("section");
    pianoSection.className = "space-y-3";

    const pianoTitle = document.createElement("h3");
    pianoTitle.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    pianoTitle.textContent = "Piano Roll";

    const pianoField = document.createElement("label");
    pianoField.className = "flex flex-col gap-1.5";

    const pianoFieldLabel = document.createElement("span");
    pianoFieldLabel.className = "text-[12px] text-slate-300";
    pianoFieldLabel.textContent = "Style";

    this.pianoRollStyleSelect = document.createElement("select");
    this.pianoRollStyleSelect.className =
      "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[12px] text-slate-100 outline-none hover:border-slate-500 focus:border-teal-600";
    for (const option of PIANO_ROLL_STYLE_OPTIONS) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      this.pianoRollStyleSelect.append(item);
    }
    this.pianoRollStyleSelect.value = this.piano.style;
    this.pianoRollStyleSelect.addEventListener(
      "change",
      () => {
        const value = this.pianoRollStyleSelect?.value;
        if (value === "compact" || value === "full88") {
          this.piano.setStyle(value);
        }
      },
      { signal: this.abort.signal },
    );

    const pianoHint = document.createElement("p");
    pianoHint.className = "text-[11px] leading-relaxed text-slate-500";
    pianoHint.textContent =
      "Compact is the computer-keyboard layout. Full 88-key shows A0–C8 for MIDI controllers and files.";

    pianoField.append(pianoFieldLabel, this.pianoRollStyleSelect);
    pianoSection.append(pianoTitle, pianoField, pianoHint);

    const midiSection = this.midiDevices.createConfigSection(
      this.abort.signal,
    );
    body.append(pianoSection, midiSection);
    dialog.append(header, body);
    overlay.append(dialog);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          this.closeConfigModal();
        }
      },
      { signal: this.abort.signal },
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!this.configModal || this.configModal.classList.contains("hidden")) {
          return;
        }
        event.preventDefault();
        this.closeConfigModal();
      },
      { signal: this.abort.signal },
    );

    return overlay;
  }
}
