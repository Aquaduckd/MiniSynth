import {
  createRotaryKnob,
  type RotaryKnobHandle,
  type RotaryKnobOptions,
} from "./RotaryKnob.js";
import { parseMidiFile, type MidiSong } from "./midiFile.js";
import {
  filterQ,
  formatCutoff,
  formatDelayTime,
  formatOscPitch,
  formatVibratoDepth,
  pulseWidthLabel,
  reverbDurationSeconds,
  snapOscPitchKnob,
  snapVibratoDepthKnob,
  sweepSeconds,
  vibratoDepthCents,
} from "./audio/paramMath.js";
import type { NotePlayheadState } from "./audio/preview.js";
import { SimpleSynth } from "./audio/SimpleSynth.js";
import {
  cloneEffects,
  cloneParams,
  DEFAULT_EFFECTS,
  DEFAULT_PARAMS,
  OSC_COUNT,
  OSC_WAVEFORM_OPTIONS,
  RANDOM_MODE_OPTIONS,
  SECTION_THEMES,
  VIBRATO_OPTIONS,
} from "./constants.js";
import { parseMidiNoteEvent } from "./midi/noteEvent.js";
import { detectChordName } from "./music/chords.js";
import {
  BROWSER_FIND_KEY_CODES,
  DEFAULT_OCTAVE,
  DEFAULT_TRANSPOSE,
  FULL88_LAYOUT,
  FULL88_WHITE_COUNT,
  KEY_LAYOUT,
  KEY_PRESSED_CLASSES,
  keyCodeLabel,
  MAX_OCTAVE,
  MAX_TRANSPOSE,
  MIN_OCTAVE,
  MIN_TRANSPOSE,
  PIANO_ROLL_STYLE_OPTIONS,
  TOTAL_WHITE_COUNT,
} from "./music/keyboard.js";
import { baseMidiForOctave, midiNoteLabel } from "./music/notes.js";
import {
  BUILT_IN_PRESETS,
  loadUserPresets,
  normalizeStoredPreset,
  saveUserPresets,
} from "./storage/presets.js";
import {
  DEFAULT_UI_SETTINGS,
  loadMidiSettings,
  loadUiSettings,
  saveMidiSettings,
  saveUiSettings,
} from "./storage/settings.js";
import type {
  EffectsParams,
  KeyLayout,
  OscId,
  OscWaveform,
  PianoRollStyle,
  PitchModTab,
  RandomMode,
  SectionColor,
  SynthParams,
  SynthPreset,
  VibratoWaveform,
} from "./types.js";
import {
  drawAdsrEnvelope,
  drawFilterPreview,
  drawMasterOutputPreview,
  drawRandomPreview,
  drawVibratoPreview,
  drawWaveformPreview,
} from "./viz/draw.js";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return target.isContentEditable;
}

const MIDI_FILE_SKIP_SECONDS = 5;

function formatMidiClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

const CANVAS_PREVIEW_CLASS =
  "block aspect-[5/2] max-h-36 min-h-[4.5rem] w-full min-w-0";

const KNOB_SIZE_PX = 56;
const KNOB_GAP_PX = 8;
const KNOB_ROW_PADDING_PX = 24;
const OSC_WAVEFORM_BUTTON_WIDTH_PX = 64;

function knobRowMinWidth(knobCount: number): number {
  return (
    knobCount * KNOB_SIZE_PX +
    Math.max(0, knobCount - 1) * KNOB_GAP_PX +
    KNOB_ROW_PADDING_PX
  );
}

const MODULE_COLUMN_MIN_WIDTH = knobRowMinWidth(4);
const OSC_MODULE_MIN_WIDTH =
  2 * OSC_WAVEFORM_BUTTON_WIDTH_PX +
  3 * KNOB_SIZE_PX +
  5 * KNOB_GAP_PX +
  KNOB_ROW_PADDING_PX;
const VIBRATO_CONTROLS_MIN_WIDTH =
  OSC_WAVEFORM_BUTTON_WIDTH_PX +
  4 * KNOB_SIZE_PX +
  4 * KNOB_GAP_PX +
  KNOB_ROW_PADDING_PX;
const MASTER_CONTROLS_MIN_WIDTH =
  120 + KNOB_GAP_PX + KNOB_SIZE_PX + KNOB_ROW_PADDING_PX;

export class SynthApp {
  private root: HTMLDivElement | null = null;
  private controlsEl: HTMLDivElement | null = null;
  private keyboardWrapper: HTMLDivElement | null = null;
  private keyboardRow: HTMLDivElement | null = null;
  private chordLabelEl: HTMLElement | null = null;
  private whiteRow: HTMLDivElement | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private keyboardHeightPx = 96;
  private synth = new SimpleSynth();
  private params: SynthParams = cloneParams(DEFAULT_PARAMS);
  private effectsParams: EffectsParams = { ...DEFAULT_EFFECTS };
  private pressedKeys = new Set<number>();
  /** Computer keyCode → MIDI note at press time (survives octave/transpose changes). */
  private heldComputerKeys = new Map<string, number>();
  private keyButtons = new Map<number, HTMLButtonElement>();
  private keyboardEnabled = false;
  private pianoRollStyle: PianoRollStyle = DEFAULT_UI_SETTINGS.pianoRollStyle;
  private pianoRollStyleSelect: HTMLSelectElement | null = null;
  private octave = DEFAULT_OCTAVE;
  private transpose = DEFAULT_TRANSPOSE;
  private keyboardBoard: HTMLDivElement | null = null;
  private octaveLabel: HTMLSpanElement | null = null;
  private octaveDownButton: HTMLButtonElement | null = null;
  private octaveUpButton: HTMLButtonElement | null = null;
  private transposeLabel: HTMLSpanElement | null = null;
  private transposeDownButton: HTMLButtonElement | null = null;
  private transposeUpButton: HTMLButtonElement | null = null;
  private envelopeCanvas: HTMLCanvasElement | null = null;
  private waveformCanvas: HTMLCanvasElement | null = null;
  private filterCanvas: HTMLCanvasElement | null = null;
  private vibratoCanvas: HTMLCanvasElement | null = null;
  private masterCanvas: HTMLCanvasElement | null = null;
  private activeOscTab: OscId = 0;
  private oscTabButtons = new Map<OscId, HTMLButtonElement>();
  private oscTabDots = new Map<OscId, HTMLElement>();
  private oscTabPanels = new Map<OscId, HTMLElement>();
  private oscWaveformButtons: Array<Map<OscWaveform, HTMLButtonElement>> = [
    new Map(),
    new Map(),
    new Map(),
  ];
  private oscWidthKnobElements = new Map<OscId, HTMLElement>();
  private vibratoButtons = new Map<VibratoWaveform, HTMLButtonElement>();
  private randomModeButtons = new Map<RandomMode, HTMLButtonElement>();
  private activePitchModTab: PitchModTab = "vibrato";
  private pitchModTabButtons = new Map<PitchModTab, HTMLButtonElement>();
  private pitchModTabDots = new Map<PitchModTab, HTMLElement>();
  private pitchModTabPanels = new Map<PitchModTab, HTMLElement>();
  private paramKnobs = new Map<string, RotaryKnobHandle>();
  private effectKnobs = new Map<keyof EffectsParams, RotaryKnobHandle>();
  private vizObserver: ResizeObserver | null = null;
  private livePreviewFrame: number | null = null;
  private midiAccess: MIDIAccess | null = null;
  private readonly midiBoundInputs = new Set<MIDIInput>();
  /** null = all connected inputs are enabled */
  private midiEnabledInputIds: Set<string> | null = null;
  private midiPermissionError: string | null = null;
  private readonly abort = new AbortController();
  private userPresets: SynthPreset[] = loadUserPresets();
  private presetModal: HTMLElement | null = null;
  private presetListEl: HTMLElement | null = null;
  private presetNameInput: HTMLInputElement | null = null;
  private presetStatusEl: HTMLElement | null = null;
  private activePresetId: string | null = "init";
  private configModal: HTMLElement | null = null;
  private midiStatusEl: HTMLElement | null = null;
  private midiDeviceListEl: HTMLElement | null = null;
  private midiEnableButton: HTMLButtonElement | null = null;
  private midiActivityEl: HTMLElement | null = null;
  private midiActivityTimer: number | null = null;
  private midiSong: MidiSong | null = null;
  private midiFilePlaying = false;
  private midiFileEventIndex = 0;
  private midiFileOriginMs = 0;
  /** Playback cursor when stopped; ignored while playing (use wall-clock origin). */
  private midiFileCursorSeconds = 0;
  private midiFileTimer: number | null = null;
  private readonly midiFileHoldCounts = new Map<number, number>();
  private midiFileStatusEl: HTMLElement | null = null;
  private midiFileTimeEl: HTMLElement | null = null;
  private midiFilePlayStopButton: HTMLButtonElement | null = null;
  private midiFileBackButton: HTMLButtonElement | null = null;
  private midiFileForwardButton: HTMLButtonElement | null = null;
  private midiFileInput: HTMLInputElement | null = null;

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
        this.openPresetsModal();
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

    const moduleGrid = document.createElement("div");
    moduleGrid.className =
      "flex w-max max-w-full flex-wrap items-start justify-center gap-3";

    const filterDelayColumn = document.createElement("div");
    filterDelayColumn.className = "flex shrink-0 flex-col gap-3";
    filterDelayColumn.style.minWidth = `${MODULE_COLUMN_MIN_WIDTH}px`;

    const delayPedal = this.createDelayPedal();
    filterDelayColumn.append(this.createFilterPanel(), delayPedal);

    const envelopeReverbColumn = document.createElement("div");
    envelopeReverbColumn.className = "flex shrink-0 flex-col gap-3";
    envelopeReverbColumn.style.minWidth = `${MODULE_COLUMN_MIN_WIDTH}px`;

    const reverbPedal = this.createReverbPedal();
    envelopeReverbColumn.append(this.createEnvelopeSection(), reverbPedal);

    const vibratoColumn = document.createElement("div");
    vibratoColumn.className = "flex shrink-0 flex-col gap-3";
    vibratoColumn.style.minWidth = `${Math.max(
      MODULE_COLUMN_MIN_WIDTH,
      VIBRATO_CONTROLS_MIN_WIDTH,
      MASTER_CONTROLS_MIN_WIDTH,
    )}px`;

    const masterPedal = this.createMasterPedal();
    masterPedal.classList.add("shrink-0");
    vibratoColumn.append(this.createVibratoSection(), masterPedal);

    moduleGrid.append(
      this.createOscPitchPanel(),
      filterDelayColumn,
      envelopeReverbColumn,
      vibratoColumn,
    );

    this.controlsEl.append(moduleGrid);

    this.restoreUiSettings();
    this.keyboardWrapper = this.createKeyboard();

    this.root.append(header, this.controlsEl, this.keyboardWrapper);
    container.append(this.root);

    this.keyboardEnabled = true;
    this.observeVisualizations(this.controlsEl);
    this.bindLayoutObserver();
    this.syncPanelLayout(container.clientWidth, container.clientHeight);
    this.updateVisualizations();
    this.bindKeyboard();
    this.restoreMidiSettings();
    this.bindWindowFocus();
  }

  destroy(): void {
    this.keyboardEnabled = false;
    this.stopLivePreviewLoop();
    this.synth.setPreviewChangeHandler(null);
    this.releaseAllKeys();
    this.synth.dispose();
    this.vizObserver?.disconnect();
    this.vizObserver = null;
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.unbindMidi();
    if (this.midiActivityTimer !== null) {
      window.clearTimeout(this.midiActivityTimer);
      this.midiActivityTimer = null;
    }
    this.abort.abort();
    this.presetModal?.remove();
    this.presetModal = null;
    this.presetListEl = null;
    this.presetNameInput = null;
    this.presetStatusEl = null;
    this.configModal?.remove();
    this.configModal = null;
    this.pianoRollStyleSelect = null;
    this.midiStatusEl = null;
    this.midiDeviceListEl = null;
    this.midiEnableButton = null;
    this.midiActivityEl = null;
    this.midiFileStatusEl = null;
    this.midiFileTimeEl = null;
    this.midiFilePlayStopButton = null;
    this.midiFileBackButton = null;
    this.midiFileForwardButton = null;
    this.midiFileInput = null;
    this.root?.remove();
    this.root = null;
    this.controlsEl = null;
    this.keyboardWrapper = null;
    this.keyboardRow = null;
    this.chordLabelEl = null;
    this.whiteRow = null;
    this.envelopeCanvas = null;
    this.waveformCanvas = null;
    this.filterCanvas = null;
    this.vibratoCanvas = null;
    this.masterCanvas = null;
    this.oscTabButtons.clear();
    this.oscTabDots.clear();
    this.oscTabPanels.clear();
    for (const buttons of this.oscWaveformButtons) {
      buttons.clear();
    }
    this.oscWidthKnobElements.clear();
    this.vibratoButtons.clear();
    this.randomModeButtons.clear();
    this.pitchModTabButtons.clear();
    this.pitchModTabDots.clear();
    this.pitchModTabPanels.clear();
    this.paramKnobs.clear();
    this.effectKnobs.clear();
    this.keyButtons.clear();
  }

  private bindWindowFocus(): void {
    window.addEventListener(
      "blur",
      () => {
        // Drop stuck computer/pointer keys, but keep MIDI file playback going.
        this.releaseManualKeys();
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
    this.keyboardHeightPx = Math.max(
      72,
      Math.min(144, Math.round(height * 0.24)),
    );
    this.applyKeyboardHeight();
  }

  private applyKeyboardHeight(): void {
    if (this.whiteRow) {
      this.whiteRow.style.height = `${this.keyboardHeightPx}px`;
    }
  }

  private updateVisualizations(): void {
    const playhead = this.synth.getLastNotePlayhead();

    if (this.envelopeCanvas) {
      drawAdsrEnvelope(
        this.envelopeCanvas,
        this.params,
        SECTION_THEMES.envelope,
        playhead,
      );
    }
    if (this.waveformCanvas) {
      drawWaveformPreview(
        this.waveformCanvas,
        this.params,
        SECTION_THEMES.oscillator,
        this.activeOscTab,
      );
    }
    if (this.filterCanvas) {
      drawFilterPreview(
        this.filterCanvas,
        this.params,
        SECTION_THEMES.filter,
        playhead,
      );
    }
    this.updatePitchModPreview(playhead);
    this.updateMasterPreview();
    this.syncLivePreviewLoop();
  }

  private updateLivePreviews(): void {
    const playhead = this.synth.getLastNotePlayhead();

    if (this.envelopeCanvas) {
      drawAdsrEnvelope(
        this.envelopeCanvas,
        this.params,
        SECTION_THEMES.envelope,
        playhead,
      );
    }
    if (this.filterCanvas) {
      drawFilterPreview(
        this.filterCanvas,
        this.params,
        SECTION_THEMES.filter,
        playhead,
      );
    }
    this.updatePitchModPreview(playhead);
    this.updateMasterPreview();
  }

  private updatePitchModPreview(playhead: NotePlayheadState | null): void {
    if (!this.vibratoCanvas) {
      return;
    }

    if (this.activePitchModTab === "random") {
      drawRandomPreview(
        this.vibratoCanvas,
        this.params,
        SECTION_THEMES.vibrato,
        playhead,
      );
      return;
    }

    drawVibratoPreview(
      this.vibratoCanvas,
      this.params,
      SECTION_THEMES.vibrato,
      playhead,
    );
  }

  private updateMasterPreview(): void {
    if (!this.masterCanvas) {
      return;
    }

    drawMasterOutputPreview(
      this.masterCanvas,
      this.params,
      this.synth.getPreviewVoices(),
      SECTION_THEMES.master,
    );
  }

  private syncLivePreviewLoop(): void {
    if (
      !this.keyboardEnabled ||
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

  private createKnobRow(knobCount: number): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className =
      "flex shrink-0 flex-nowrap items-start justify-around gap-2 p-3";
    controls.style.minWidth = `${knobRowMinWidth(knobCount)}px`;
    return controls;
  }

  private themeKnobOptions(theme: SectionColor): Pick<
    RotaryKnobOptions,
    "accent" | "accentBright" | "valueColor"
  > {
    const colors = SECTION_THEMES[theme];
    return {
      accent: colors.accent,
      accentBright: colors.accentBright,
      valueColor: colors.accentBright,
    };
  }

  private createSectionHeading(title: string): HTMLElement {
    const heading = document.createElement("div");
    heading.className =
      "border-b border-slate-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400";
    heading.textContent = title;
    return heading;
  }

  private createSection(title: string): HTMLElement {
    const section = document.createElement("section");
    section.className =
      "flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";

    section.append(this.createSectionHeading(title));

    return section;
  }

  private createEffectFooter(
    title: string,
    controls: HTMLElement,
  ): HTMLElement {
    const footer = document.createElement("div");
    footer.className = "shrink-0";

    footer.append(this.createSectionHeading(title), controls);

    return footer;
  }

  private createLinkedPanel(): HTMLElement {
    const panel = document.createElement("section");
    panel.className =
      "flex min-h-0 shrink-0 flex-col gap-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40";
    panel.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;
    return panel;
  }

  private createEnvelopeSection(): HTMLElement {
    const section = this.createSection("Envelope");

    this.envelopeCanvas = document.createElement("canvas");
    this.envelopeCanvas.className = CANVAS_PREVIEW_CLASS;

    const controls = this.createKnobRow(4);
    controls.append(
      this.createParamKnob(
        "A",
        "attack",
        0,
        1,
        0.001,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
      this.createParamKnob(
        "D",
        "decay",
        0,
        1,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
      this.createParamKnob(
        "S",
        "sustain",
        0,
        1,
        0.01,
        (value) => value.toFixed(2),
        "envelope",
      ),
      this.createParamKnob(
        "R",
        "release",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "envelope",
      ),
    );

    section.append(this.envelopeCanvas, controls);
    return section;
  }

  private createFilterPanel(): HTMLElement {
    const section = this.createSection("Filter");

    this.filterCanvas = document.createElement("canvas");
    this.filterCanvas.className = CANVAS_PREVIEW_CLASS;

    const filterControls = this.createKnobRow(4);
    filterControls.append(
      this.createParamKnob(
        "Initial",
        "filterInitial",
        0,
        1,
        0.01,
        formatCutoff,
        "filter",
      ),
      this.createParamKnob(
        "Final",
        "filterFinal",
        0,
        1,
        0.01,
        formatCutoff,
        "filter",
      ),
      this.createParamKnob(
        "Speed",
        "filterSpeed",
        0,
        1,
        0.01,
        (value) => `${Math.round(sweepSeconds(value) * 1000)} ms`,
        "filter",
      ),
      this.createParamKnob(
        "Res",
        "filterResonance",
        0,
        1,
        0.01,
        (value) => filterQ(value).toFixed(1),
        "filter",
      ),
    );

    section.append(this.filterCanvas, filterControls);

    return section;
  }

  private createOscPitchPanel(): HTMLElement {
    const panel = this.createLinkedPanel();

    this.waveformCanvas = document.createElement("canvas");
    this.waveformCanvas.className = CANVAS_PREVIEW_CLASS;

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
      const { button, dot } = this.createTabButton(`Osc ${osc + 1}`);
      button.dataset.oscTab = String(osc);
      button.addEventListener(
        "click",
        () => {
          this.setActiveOscTab(osc as OscId);
        },
        { signal: this.abort.signal },
      );
      this.oscTabButtons.set(osc as OscId, button);
      this.oscTabDots.set(osc as OscId, dot);
      tabs.append(button);
    }

    heading.append(title, tabs);

    const body = document.createElement("div");
    body.className = "relative";

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      const tabPanel = this.createOscTabPanel(osc as OscId);
      this.oscTabPanels.set(osc as OscId, tabPanel);
      body.append(tabPanel);
    }

    const primary = document.createElement("div");
    primary.className = "flex min-w-0 flex-col";
    primary.append(heading, this.waveformCanvas, body);

    panel.append(
      primary,
      this.createEffectFooter("Pitch Envelope", this.createPitchControls()),
    );

    this.setActiveOscTab(this.activeOscTab);
    this.updateTabActivityIndicators();
    return panel;
  }

  private createOscTabPanel(osc: OscId): HTMLElement {
    const panel = document.createElement("div");
    panel.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    panel.style.minWidth = `${OSC_MODULE_MIN_WIDTH}px`;
    panel.setAttribute("role", "tabpanel");
    panel.dataset.oscPanel = String(osc);

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const waveformColumn = document.createElement("div");
    waveformColumn.className = "flex shrink-0 flex-col items-center gap-0.5";

    const waveformGrid = document.createElement("div");
    waveformGrid.className = "grid grid-cols-2 gap-1";

    for (const option of OSC_WAVEFORM_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
        this.setOscWaveform(osc, option.value);
      });
      this.oscWaveformButtons[osc].set(option.value, button);
      waveformGrid.append(button);
    }

    const waveLabel = document.createElement("span");
    waveLabel.className =
      "text-[9px] font-medium uppercase tracking-wide text-slate-500";
    waveLabel.textContent = "Wave";
    waveformColumn.append(knobValueSpacer, waveformGrid, waveLabel);

    const knobsGroup = document.createElement("div");
    knobsGroup.className = "flex shrink-0 flex-nowrap items-start gap-2";

    const levelKnob = this.createOscLevelKnob(osc);
    levelKnob.classList.add("shrink-0");

    const widthKnob = this.createOscWidthKnob(osc);
    widthKnob.classList.add("shrink-0");
    this.oscWidthKnobElements.set(osc, widthKnob);

    const pitchKnob = this.createOscPitchKnob(osc);
    pitchKnob.classList.add("shrink-0");

    knobsGroup.append(levelKnob, pitchKnob, widthKnob);
    panel.append(waveformColumn, knobsGroup);
    return panel;
  }

  private setActiveOscTab(osc: OscId): void {
    this.activeOscTab = osc;
    const theme = SECTION_THEMES.oscillator;

    for (const [id, button] of this.oscTabButtons) {
      const selected = id === osc;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors";
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    }

    for (const [id, panel] of this.oscTabPanels) {
      panel.classList.toggle("hidden", id !== osc);
    }

    this.updateOscWaveformButtons();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
  }

  private createOscWaveformButton(
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";
    button.addEventListener("click", onClick, { signal: this.abort.signal });
    return button;
  }

  private setOscWaveform(osc: OscId, waveform: OscWaveform): void {
    if (this.params.oscWaveforms[osc] === waveform) {
      return;
    }

    this.params.oscWaveforms[osc] = waveform;
    this.synth.setParams(this.params);
    this.updateOscWaveformButtons();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
  }

  private updateOscWaveformButtons(): void {
    const theme = SECTION_THEMES.oscillator;
    const inactiveClass =
      "w-16 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
    const baseClass =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";

    const applyState = (
      button: HTMLButtonElement,
      active: boolean,
    ): void => {
      if (active) {
        button.className = baseClass;
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className = inactiveClass;
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    };

    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      for (const [waveform, button] of this.oscWaveformButtons[osc]) {
        applyState(button, this.params.oscWaveforms[osc] === waveform);
      }
    }
  }

  private updateWidthKnobVisibility(): void {
    for (let osc = 0; osc < OSC_COUNT; osc += 1) {
      this.oscWidthKnobElements.get(osc as OscId)?.classList.toggle(
        "hidden",
        this.params.oscWaveforms[osc] !== "pulse",
      );
    }
  }

  private createVibratoSection(): HTMLElement {
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
      const { button, dot } = this.createTabButton(
        tabId === "vibrato" ? "Vibrato" : "Random",
      );
      button.addEventListener(
        "click",
        () => {
          this.setActivePitchModTab(tabId);
        },
        { signal: this.abort.signal },
      );
      this.pitchModTabButtons.set(tabId, button);
      this.pitchModTabDots.set(tabId, dot);
      tabs.append(button);
    }

    heading.append(title, tabs);

    this.vibratoCanvas = document.createElement("canvas");
    this.vibratoCanvas.className = CANVAS_PREVIEW_CLASS;

    const body = document.createElement("div");
    body.className = "relative";

    const vibratoPanel = this.createVibratoTabPanel();
    const randomPanel = this.createRandomTabPanel();
    this.pitchModTabPanels.set("vibrato", vibratoPanel);
    this.pitchModTabPanels.set("random", randomPanel);
    body.append(vibratoPanel, randomPanel);

    section.append(heading, this.vibratoCanvas, body);
    this.setActivePitchModTab(this.activePitchModTab);
    this.updateVibratoWaveformButtons();
    this.updateRandomModeButtons();
    this.updateTabActivityIndicators();
    return section;
  }

  private createVibratoTabPanel(): HTMLElement {
    const controlsRow = document.createElement("div");
    controlsRow.className =
      "flex shrink-0 flex-nowrap items-end justify-center gap-2 p-3";
    controlsRow.style.minWidth = `${VIBRATO_CONTROLS_MIN_WIDTH}px`;
    controlsRow.setAttribute("role", "tabpanel");

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const waveformGroup = document.createElement("div");
    waveformGroup.className = "flex shrink-0 flex-col items-center gap-0.5";

    const waveformButtons = document.createElement("div");
    waveformButtons.className = "flex flex-col gap-1";

    for (const option of VIBRATO_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
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
      this.createParamKnob(
        "Rate",
        "vibratoRate",
        0.5,
        20,
        0.1,
        (value) => `${value.toFixed(1)} Hz`,
        "vibrato",
      ),
      this.createParamKnob(
        "Delay",
        "vibratoDelay",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "vibrato",
      ),
      this.createParamKnob(
        "Ramp",
        "vibratoRamp",
        0,
        2,
        0.01,
        (value) => `${Math.round(value * 1000)} ms`,
        "vibrato",
      ),
      this.createVibratoDepthKnob(),
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

    const knobValueSpacer = document.createElement("span");
    knobValueSpacer.className =
      "pointer-events-none font-mono text-[9px] leading-none invisible select-none";
    knobValueSpacer.textContent = "100%";
    knobValueSpacer.setAttribute("aria-hidden", "true");

    const modeGroup = document.createElement("div");
    modeGroup.className = "flex shrink-0 flex-col items-center gap-0.5";

    const modeButtons = document.createElement("div");
    modeButtons.className = "flex flex-col gap-1";

    for (const option of RANDOM_MODE_OPTIONS) {
      const button = this.createOscWaveformButton(option.label, () => {
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
      this.createParamKnob(
        "Rate",
        "randomRate",
        0.1,
        20,
        0.1,
        (value) => `${value.toFixed(1)} Hz`,
        "vibrato",
      ),
      this.createRandomDepthKnob(),
    );

    controlsRow.append(modeGroup, knobsGroup);
    return controlsRow;
  }

  private setActivePitchModTab(tab: PitchModTab): void {
    this.activePitchModTab = tab;
    const theme = SECTION_THEMES.vibrato;

    for (const [id, button] of this.pitchModTabButtons) {
      const selected = id === tab;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors";
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className =
          "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    }

    for (const [id, panel] of this.pitchModTabPanels) {
      panel.classList.toggle("hidden", id !== tab);
    }

    this.updateVisualizations();
  }

  private setVibratoWaveform(waveform: VibratoWaveform): void {
    if (this.params.vibratoWaveform === waveform) {
      return;
    }

    this.params.vibratoWaveform = waveform;
    this.synth.setParams(this.params);
    this.updateVibratoWaveformButtons();
    this.updateVisualizations();
  }

  private setRandomMode(mode: RandomMode): void {
    if (this.params.randomMode === mode) {
      return;
    }

    this.params.randomMode = mode;
    this.synth.setParams(this.params);
    this.updateRandomModeButtons();
    this.updateVisualizations();
  }

  private updatePitchModOptionButtons(
    buttons: Map<string, HTMLButtonElement>,
    activeValue: string,
  ): void {
    const theme = SECTION_THEMES.vibrato;
    const inactiveClass =
      "w-16 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";
    const baseClass =
      "w-16 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors";

    for (const [value, button] of buttons) {
      const active = value === activeValue;
      if (active) {
        button.className = baseClass;
        button.style.borderColor = `${theme.accent}99`;
        button.style.backgroundColor = theme.accentFill;
        button.style.color = theme.accentBright;
      } else {
        button.className = inactiveClass;
        button.style.borderColor = "";
        button.style.backgroundColor = "";
        button.style.color = "";
      }
    }
  }

  private updateVibratoWaveformButtons(): void {
    this.updatePitchModOptionButtons(
      this.vibratoButtons,
      this.params.vibratoWaveform,
    );
  }

  private updateRandomModeButtons(): void {
    this.updatePitchModOptionButtons(
      this.randomModeButtons,
      this.params.randomMode,
    );
  }

  private createDelayPedal(): HTMLElement {
    const section = this.createSection("Delay");

    const controls = this.createKnobRow(3);
    controls.append(
      this.createEffectKnob(
        "Time",
        "delayTime",
        0,
        1,
        0.01,
        formatDelayTime,
        "delay",
      ),
      this.createEffectKnob(
        "Fdbk",
        "delayFeedback",
        0,
        0.85,
        0.01,
        (value) => `${Math.round(value * 100)}%`,
        "delay",
      ),
      this.createEffectKnob(
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

  private createReverbPedal(): HTMLElement {
    const section = this.createSection("Reverb");

    const controls = this.createKnobRow(2);
    controls.append(
      this.createEffectKnob(
        "Decay",
        "reverbDecay",
        0,
        1,
        0.01,
        (value) => `${reverbDurationSeconds(value).toFixed(1)} s`,
        "reverb",
      ),
      this.createEffectKnob(
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

  private createMasterPedal(): HTMLElement {
    const section = this.createSection("Master");
    section.classList.add("shrink-0");

    const controls = document.createElement("div");
    controls.className =
      "grid w-full shrink-0 grid-cols-[minmax(120px,1fr)_auto] items-stretch gap-3 p-3";
    controls.style.minWidth = `${MASTER_CONTROLS_MIN_WIDTH}px`;

    const preview = document.createElement("div");
    preview.className = "relative h-full min-h-0 min-w-0";

    this.masterCanvas = document.createElement("canvas");
    this.masterCanvas.className =
      "absolute inset-0 block h-full w-full rounded border border-slate-800 bg-slate-950/80";
    preview.append(this.masterCanvas);

    const volumeKnob = this.createMasterVolumeKnob();
    volumeKnob.classList.add("shrink-0", "self-end");

    controls.append(preview, volumeKnob);

    section.append(controls);
    return section;
  }

  private createPitchControls(): HTMLElement {
    const controls = this.createKnobRow(2);
    controls.append(
      this.createEffectKnob(
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
      value: snapOscPitchKnob(this.effectsParams.pitchAmount),
      format: formatOscPitch,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOscPitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.effectsParams = { ...this.effectsParams, pitchAmount: snapped };
        this.synth.setEffectsParams(this.effectsParams);
      },
    });

    this.effectKnobs.set("pitchAmount", knob);
    return knob.element;
  }

  private createEffectKnob(
    label: string,
    key: keyof EffectsParams,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    theme: SectionColor,
  ): HTMLElement {
    const knob = createRotaryKnob({
      label,
      min,
      max,
      step,
      value: this.effectsParams[key],
      format,
      ...this.themeKnobOptions(theme),
      onChange: (value) => {
        this.effectsParams = { ...this.effectsParams, [key]: value };
        this.synth.setEffectsParams(this.effectsParams);
      },
    });

    this.effectKnobs.set(key, knob);
    return knob.element;
  }

  private createMasterVolumeKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Volume",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.effectsParams.masterVolume,
      format: (value) => `${Math.round(value * 100)}%`,
      ...this.themeKnobOptions("master"),
      onChange: (value) => {
        this.effectsParams = { ...this.effectsParams, masterVolume: value };
        this.synth.setEffectsParams(this.effectsParams);
      },
    });

    this.effectKnobs.set("masterVolume", knob);
    return knob.element;
  }

  private createOscLevelKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}Level`;
    const knob = createRotaryKnob({
      label: "Level",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.params.oscLevels[osc],
      format: (value) => `${Math.round(value * 100)}%`,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        this.params.oscLevels[osc] = value;
        this.synth.setParams(this.params);
        this.updateTabActivityIndicators();
        this.updateVisualizations();
      },
    });
    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createOscWidthKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}PulseWidth`;
    const knob = createRotaryKnob({
      label: "Width",
      min: 0,
      max: 1,
      step: 0.01,
      value: this.params.oscPulseWidths[osc],
      format: pulseWidthLabel,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        this.params.oscPulseWidths[osc] = value;
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });
    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createOscPitchKnob(osc: OscId): HTMLElement {
    const key = `osc${osc}Pitch`;
    const knob = createRotaryKnob({
      label: "Pitch",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapOscPitchKnob(this.params.oscPitches[osc]),
      format: formatOscPitch,
      ...this.themeKnobOptions("oscillator"),
      onChange: (value) => {
        const snapped = snapOscPitchKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params.oscPitches[osc] = snapped;
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private createVibratoDepthKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Depth",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapVibratoDepthKnob(this.params.vibratoAmount),
      format: formatVibratoDepth,
      ...this.themeKnobOptions("vibrato"),
      onChange: (value) => {
        const snapped = snapVibratoDepthKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params = { ...this.params, vibratoAmount: snapped };
        this.synth.setParams(this.params);
        this.updateTabActivityIndicators();
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set("vibratoAmount", knob);
    return knob.element;
  }

  private createRandomDepthKnob(): HTMLElement {
    const knob = createRotaryKnob({
      label: "Depth",
      min: 0,
      max: 1,
      step: 0.01,
      value: snapVibratoDepthKnob(this.params.randomAmount),
      format: formatVibratoDepth,
      ...this.themeKnobOptions("vibrato"),
      onChange: (value) => {
        const snapped = snapVibratoDepthKnob(value);
        if (snapped !== value) {
          knob.setValue(snapped);
        }
        this.params = { ...this.params, randomAmount: snapped };
        this.synth.setParams(this.params);
        this.updateTabActivityIndicators();
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set("randomAmount", knob);
    return knob.element;
  }

  private createTabButton(label: string): {
    button: HTMLButtonElement;
    dot: HTMLElement;
  } {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.className =
      "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200";

    const dot = document.createElement("span");
    dot.className = "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = label;

    button.append(dot, text);
    return { button, dot };
  }

  private updateTabActivityIndicators(): void {
    for (const [osc, dot] of this.oscTabDots) {
      const active = this.params.oscLevels[osc] > 0;
      dot.className = active
        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
        : "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
    }

    for (const [tab, dot] of this.pitchModTabDots) {
      const depth =
        tab === "vibrato"
          ? this.params.vibratoAmount
          : this.params.randomAmount;
      const active = vibratoDepthCents(depth) > 0;
      dot.className = active
        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
        : "h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600";
    }
  }

  private createParamKnob(
    label: string,
    key: {
      [K in keyof SynthParams]: SynthParams[K] extends number ? K : never;
    }[keyof SynthParams],
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    theme: SectionColor,
  ): HTMLElement {
    const knob = createRotaryKnob({
      label,
      min,
      max,
      step,
      value: this.params[key] as number,
      format,
      ...this.themeKnobOptions(theme),
      onChange: (value) => {
        this.params = { ...this.params, [key]: value };
        this.synth.setParams(this.params);
        this.updateVisualizations();
      },
    });

    this.paramKnobs.set(key, knob);
    return knob.element;
  }

  private resetToDefaults(): void {
    this.applyPreset(BUILT_IN_PRESETS[0]);
  }

  private applyPreset(preset: SynthPreset): void {
    this.params = cloneParams(preset.params);
    this.effectsParams = cloneEffects(preset.effects);
    this.activePresetId = preset.id;
    this.synth.setParams(this.params);
    this.synth.setEffectsParams(this.effectsParams);
    this.syncControlsFromState();
    this.refreshPresetList();
  }

  private syncControlsFromState(): void {
    for (const [key, knob] of this.paramKnobs) {
      const oscLevelMatch = /^osc(\d+)Level$/.exec(key);
      if (oscLevelMatch) {
        knob.setValue(this.params.oscLevels[Number(oscLevelMatch[1])] ?? 0);
        continue;
      }

      const oscPitchMatch = /^osc(\d+)Pitch$/.exec(key);
      if (oscPitchMatch) {
        knob.setValue(
          snapOscPitchKnob(this.params.oscPitches[Number(oscPitchMatch[1])] ?? 0.5),
        );
        continue;
      }

      const oscWidthMatch = /^osc(\d+)PulseWidth$/.exec(key);
      if (oscWidthMatch) {
        knob.setValue(this.params.oscPulseWidths[Number(oscWidthMatch[1])] ?? 1);
        continue;
      }

      const value = this.params[key as keyof SynthParams];
      if (typeof value !== "number") {
        continue;
      }

      if (key === "vibratoAmount" || key === "randomAmount") {
        knob.setValue(snapVibratoDepthKnob(value));
        continue;
      }

      knob.setValue(value);
    }

    for (const [key, knob] of this.effectKnobs) {
      if (key === "pitchAmount") {
        knob.setValue(snapOscPitchKnob(this.effectsParams.pitchAmount));
        continue;
      }

      knob.setValue(this.effectsParams[key]);
    }

    this.setActiveOscTab(0);
    this.setActivePitchModTab(this.activePitchModTab);
    this.updateOscWaveformButtons();
    this.updateVibratoWaveformButtons();
    this.updateRandomModeButtons();
    this.updateTabActivityIndicators();
    this.updateWidthKnobVisibility();
    this.updateVisualizations();
  }

  private openConfigModal(): void {
    if (!this.configModal) {
      this.configModal = this.createConfigModal();
      document.body.append(this.configModal);
    }

    this.refreshMidiPanel();
    if (this.pianoRollStyleSelect) {
      this.pianoRollStyleSelect.value = this.pianoRollStyle;
    }
    this.configModal.classList.remove("hidden");
    this.configModal.classList.add("flex");
    this.midiEnableButton?.focus();
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
    this.pianoRollStyleSelect.value = this.pianoRollStyle;
    this.pianoRollStyleSelect.addEventListener(
      "change",
      () => {
        const value = this.pianoRollStyleSelect?.value;
        if (value === "compact" || value === "full88") {
          this.setPianoRollStyle(value);
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

    const midiSection = document.createElement("section");
    midiSection.className = "space-y-3";

    const midiHeading = document.createElement("div");
    midiHeading.className = "flex items-center justify-between gap-2";

    const midiTitle = document.createElement("h3");
    midiTitle.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    midiTitle.textContent = "MIDI";

    this.midiActivityEl = document.createElement("span");
    this.midiActivityEl.className =
      "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500";
    this.midiActivityEl.textContent = "Idle";

    midiHeading.append(midiTitle, this.midiActivityEl);

    this.midiStatusEl = document.createElement("p");
    this.midiStatusEl.className = "text-[12px] leading-relaxed text-slate-400";

    const midiActions = document.createElement("div");
    midiActions.className = "flex flex-wrap items-center gap-2";

    this.midiEnableButton = document.createElement("button");
    this.midiEnableButton.type = "button";
    this.midiEnableButton.className =
      "rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50";
    this.midiEnableButton.textContent = "Enable MIDI";
    this.midiEnableButton.addEventListener(
      "click",
      () => {
        void this.requestMidiAccess();
      },
      { signal: this.abort.signal },
    );

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className =
      "rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    refreshButton.textContent = "Refresh";
    refreshButton.addEventListener(
      "click",
      () => {
        this.syncMidiInputs();
        this.refreshMidiPanel();
      },
      { signal: this.abort.signal },
    );

    midiActions.append(this.midiEnableButton, refreshButton);

    this.midiDeviceListEl = document.createElement("div");
    this.midiDeviceListEl.className = "space-y-2";

    const midiHint = document.createElement("p");
    midiHint.className = "text-[11px] leading-relaxed text-slate-500";
    midiHint.textContent =
      "Enable MIDI, then choose which keyboards to listen to. Browsers require permission the first time.";

    midiSection.append(
      midiHeading,
      this.midiStatusEl,
      midiActions,
      this.midiDeviceListEl,
      midiHint,
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

  private refreshMidiFilePanel(): void {
    const hasSong = this.midiSong !== null;
    if (this.midiFilePlayStopButton) {
      this.midiFilePlayStopButton.disabled = !hasSong;
      this.midiFilePlayStopButton.textContent = this.midiFilePlaying
        ? "Stop"
        : "Play";
      this.midiFilePlayStopButton.title = this.midiFilePlaying
        ? "Stop MIDI file"
        : "Play MIDI file";
      this.midiFilePlayStopButton.className = this.midiFilePlaying
        ? "shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        : "shrink-0 rounded border border-emerald-700/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";
    }
    if (this.midiFileBackButton) {
      this.midiFileBackButton.disabled = !hasSong;
    }
    if (this.midiFileForwardButton) {
      this.midiFileForwardButton.disabled = !hasSong;
    }

    if (this.midiFileStatusEl) {
      this.midiFileStatusEl.textContent = this.midiSong
        ? this.midiSong.name
        : "No MIDI file";
    }
    this.refreshMidiFileTime();
  }

  private refreshMidiFileTime(): void {
    if (!this.midiFileTimeEl) {
      return;
    }
    if (!this.midiSong) {
      this.midiFileTimeEl.textContent = "0:00 / 0:00";
      return;
    }
    const current = Math.min(
      this.midiSong.duration,
      this.midiFilePlaybackTime(),
    );
    this.midiFileTimeEl.textContent = `${formatMidiClock(current)} / ${formatMidiClock(this.midiSong.duration)}`;
  }

  private async loadMidiFile(file: File): Promise<void> {
    this.stopMidiFile();
    try {
      const buffer = await file.arrayBuffer();
      this.midiSong = parseMidiFile(buffer, file.name);
      if (this.midiSong.events.length === 0) {
        this.midiSong = null;
        this.refreshMidiFilePanel();
        if (this.midiFileStatusEl) {
          this.midiFileStatusEl.textContent = "No playable notes";
        }
        return;
      }
    } catch (error) {
      this.midiSong = null;
      this.refreshMidiFilePanel();
      if (this.midiFileStatusEl) {
        this.midiFileStatusEl.textContent =
          error instanceof Error ? error.message : "Could not read MIDI file";
      }
      return;
    }

    this.midiFileCursorSeconds = 0;
    this.refreshMidiFilePanel();
  }

  private midiFilePlaybackTime(): number {
    if (!this.midiSong) {
      return 0;
    }
    if (this.midiFilePlaying) {
      return Math.max(0, (performance.now() - this.midiFileOriginMs) / 1000);
    }
    return this.midiFileCursorSeconds;
  }

  private findMidiFileEventIndex(timeSeconds: number): number {
    if (!this.midiSong) {
      return 0;
    }
    const events = this.midiSong.events;
    let index = 0;
    while (index < events.length && events[index].time < timeSeconds) {
      index += 1;
    }
    return index;
  }

  private activeMidiNotesAt(timeSeconds: number): Map<number, number> {
    const active = new Map<number, number>();
    if (!this.midiSong) {
      return active;
    }

    for (const event of this.midiSong.events) {
      if (event.time >= timeSeconds) {
        break;
      }
      if (event.type === "noteOn") {
        active.set(event.note, (active.get(event.note) ?? 0) + 1);
      } else {
        const count = (active.get(event.note) ?? 0) - 1;
        if (count <= 0) {
          active.delete(event.note);
        } else {
          active.set(event.note, count);
        }
      }
    }
    return active;
  }

  private clearMidiFileHeldNotes(): void {
    for (const note of [...this.midiFileHoldCounts.keys()]) {
      this.releaseMidiFileNote(note, true);
    }
    this.midiFileHoldCounts.clear();
  }

  private applyMidiFilePosition(timeSeconds: number, resumeHolds: boolean): void {
    if (!this.midiSong) {
      return;
    }

    const duration = this.midiSong.duration;
    const target = Math.min(duration, Math.max(0, timeSeconds));
    this.clearMidiFileHeldNotes();
    this.midiFileEventIndex = this.findMidiFileEventIndex(target);
    this.midiFileCursorSeconds = target;
    this.midiFileOriginMs = performance.now() - target * 1000;

    if (!resumeHolds) {
      return;
    }

    for (const [rawNote, count] of this.activeMidiNotesAt(target)) {
      const note = Math.min(127, Math.max(0, rawNote + this.transpose));
      this.midiFileHoldCounts.set(note, count);
      if (!this.pressedKeys.has(note)) {
        this.pressedKeys.add(note);
        this.setKeyPressed(this.keyButtons.get(note), true);
        this.synth.noteOn(note);
      }
    }
    this.updateChordDisplay();
  }

  private skipMidiFile(deltaSeconds: number): void {
    if (!this.midiSong) {
      return;
    }

    const target = this.midiFilePlaybackTime() + deltaSeconds;
    if (this.midiFilePlaying) {
      if (this.midiFileTimer !== null) {
        window.clearTimeout(this.midiFileTimer);
        this.midiFileTimer = null;
      }

      if (target >= this.midiSong.duration) {
        this.midiFilePlaying = false;
        this.clearMidiFileHeldNotes();
        this.midiFileEventIndex = this.midiSong.events.length;
        this.midiFileCursorSeconds = 0;
        this.refreshMidiFilePanel();
        return;
      }

      this.applyMidiFilePosition(target, true);
      this.refreshMidiFilePanel();
      this.pumpMidiFileScheduler();
      return;
    }

    this.applyMidiFilePosition(target, false);
    this.refreshMidiFilePanel();
  }

  private async playMidiFile(): Promise<void> {
    if (!this.midiSong || this.midiFilePlaying) {
      return;
    }

    await this.synth.ensureRunning();
    if (!this.midiSong || this.abort.signal.aborted) {
      return;
    }

    if (this.midiFileCursorSeconds >= this.midiSong.duration) {
      this.midiFileCursorSeconds = 0;
    }

    this.midiFilePlaying = true;
    this.applyMidiFilePosition(this.midiFileCursorSeconds, true);
    this.refreshMidiFilePanel();
    this.pumpMidiFileScheduler();
  }

  private stopMidiFile(): void {
    const wasPlaying = this.midiFilePlaying;
    this.midiFilePlaying = false;
    if (this.midiFileTimer !== null) {
      window.clearTimeout(this.midiFileTimer);
      this.midiFileTimer = null;
    }

    this.clearMidiFileHeldNotes();
    this.midiFileEventIndex = 0;
    this.midiFileCursorSeconds = 0;

    if (wasPlaying || this.midiSong) {
      this.refreshMidiFilePanel();
    }
  }

  private pumpMidiFileScheduler(): void {
    if (!this.midiFilePlaying || !this.midiSong) {
      return;
    }

    const elapsed = (performance.now() - this.midiFileOriginMs) / 1000;
    const horizon = elapsed + 0.08;
    const events = this.midiSong.events;

    while (
      this.midiFileEventIndex < events.length
      && events[this.midiFileEventIndex].time <= horizon
    ) {
      const event = events[this.midiFileEventIndex];
      this.midiFileEventIndex += 1;
      const note = Math.min(127, Math.max(0, event.note + this.transpose));
      if (event.type === "noteOn") {
        this.acquireMidiFileNote(note);
      } else {
        this.releaseMidiFileNote(note);
      }
    }

    if (this.midiFileEventIndex >= events.length) {
      // Let ringing notes finish via their note-offs already processed; stop cleanly.
      this.midiFilePlaying = false;
      this.midiFileTimer = null;
      this.clearMidiFileHeldNotes();
      this.midiFileCursorSeconds = 0;
      this.refreshMidiFilePanel();
      return;
    }

    this.refreshMidiFileTime();
    this.updateVisualizations();
    this.midiFileTimer = window.setTimeout(() => {
      this.midiFileTimer = null;
      this.pumpMidiFileScheduler();
    }, 20);
  }

  private acquireMidiFileNote(note: number): void {
    const count = (this.midiFileHoldCounts.get(note) ?? 0) + 1;
    this.midiFileHoldCounts.set(note, count);
    if (count !== 1) {
      return;
    }

    // Drive the synth synchronously — async pressKey can lose notes when many
    // file events land in the same scheduler slice (noteOff before await).
    if (!this.pressedKeys.has(note)) {
      this.pressedKeys.add(note);
      this.setKeyPressed(this.keyButtons.get(note), true);
      this.synth.noteOn(note);
    }
    this.updateChordDisplay();
  }

  private releaseMidiFileNote(note: number, force = false): void {
    if (force) {
      this.midiFileHoldCounts.delete(note);
      this.releaseKey(note);
      return;
    }

    const count = (this.midiFileHoldCounts.get(note) ?? 0) - 1;
    if (count <= 0) {
      this.midiFileHoldCounts.delete(note);
      this.releaseKey(note);
      return;
    }

    this.midiFileHoldCounts.set(note, count);
  }

  private refreshMidiPanel(): void {
    if (!this.midiStatusEl || !this.midiDeviceListEl || !this.midiEnableButton) {
      return;
    }

    const supported = Boolean(navigator.requestMIDIAccess);
    this.midiEnableButton.disabled = !supported || this.midiAccess !== null;
    this.midiEnableButton.textContent = this.midiAccess
      ? "MIDI Enabled"
      : "Enable MIDI";

    if (!supported) {
      this.midiStatusEl.textContent =
        "Web MIDI is not supported in this browser. Try Chrome or Edge, or enable MIDI in Firefox.";
      this.midiDeviceListEl.replaceChildren();
      return;
    }

    if (this.midiPermissionError) {
      this.midiStatusEl.textContent = this.midiPermissionError;
    } else if (!this.midiAccess) {
      this.midiStatusEl.textContent =
        "MIDI is off. Click Enable MIDI to connect a keyboard.";
    } else {
      const count = this.midiAccess.inputs.size;
      this.midiStatusEl.textContent =
        count === 0
          ? "MIDI access granted. No input devices found — plug in a keyboard and hit Refresh."
          : `MIDI access granted. ${count} input${count === 1 ? "" : "s"} available.`;
    }

    this.midiDeviceListEl.replaceChildren();

    if (!this.midiAccess) {
      return;
    }

    const inputs = [...this.midiAccess.inputs.values()].sort((left, right) =>
      (left.name ?? left.id).localeCompare(right.name ?? right.id),
    );

    if (inputs.length === 0) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-md border border-dashed border-slate-700 px-3 py-4 text-center text-[12px] text-slate-500";
      empty.textContent = "No MIDI inputs connected";
      this.midiDeviceListEl.append(empty);
      return;
    }

    for (const input of inputs) {
      this.midiDeviceListEl.append(this.createMidiDeviceRow(input));
    }
  }

  private createMidiDeviceRow(input: MIDIInput): HTMLElement {
    const row = document.createElement("label");
    row.className =
      "flex cursor-pointer items-start gap-3 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2.5 hover:border-slate-700";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "mt-0.5 accent-emerald-400";
    checkbox.checked = this.isMidiInputEnabled(input.id);
    checkbox.addEventListener(
      "change",
      () => {
        this.setMidiInputEnabled(input.id, checkbox.checked);
      },
      { signal: this.abort.signal },
    );

    const text = document.createElement("div");
    text.className = "min-w-0 flex-1";

    const name = document.createElement("div");
    name.className = "truncate text-[13px] text-slate-200";
    name.textContent = input.name?.trim() || "MIDI keyboard";

    const meta = document.createElement("div");
    meta.className = "truncate text-[11px] text-slate-500";
    const manufacturer = input.manufacturer?.trim();
    meta.textContent = [
      manufacturer || null,
      input.state,
      input.connection,
    ]
      .filter(Boolean)
      .join(" · ");

    text.append(name, meta);
    row.append(checkbox, text);
    return row;
  }

  private openPresetsModal(): void {
    if (!this.presetModal) {
      this.presetModal = this.createPresetsModal();
      document.body.append(this.presetModal);
    }

    this.presetStatusEl && (this.presetStatusEl.textContent = "");
    this.refreshPresetList();
    this.presetModal.classList.remove("hidden");
    this.presetModal.classList.add("flex");
    this.presetNameInput?.focus();
    this.presetNameInput?.select();
  }

  private closePresetsModal(): void {
    if (!this.presetModal) {
      return;
    }

    this.presetModal.classList.add("hidden");
    this.presetModal.classList.remove("flex");
  }

  private createPresetsModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]";

    const dialog = document.createElement("div");
    dialog.className =
      "flex max-h-[min(36rem,90vh)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Presets");

    const header = document.createElement("div");
    header.className =
      "flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3";

    const title = document.createElement("h2");
    title.className = "text-sm font-medium text-slate-100";
    title.textContent = "Presets";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    closeButton.textContent = "Close";
    closeButton.addEventListener(
      "click",
      () => {
        this.closePresetsModal();
      },
      { signal: this.abort.signal },
    );

    header.append(title, closeButton);

    this.presetListEl = document.createElement("div");
    this.presetListEl.className =
      "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3";

    const saveSection = document.createElement("div");
    saveSection.className =
      "shrink-0 space-y-2 border-t border-slate-800 px-4 py-3";

    const saveLabel = document.createElement("div");
    saveLabel.className = "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    saveLabel.textContent = "Save current";

    const saveRow = document.createElement("div");
    saveRow.className = "flex gap-2";

    this.presetNameInput = document.createElement("input");
    this.presetNameInput.type = "text";
    this.presetNameInput.maxLength = 48;
    this.presetNameInput.placeholder = "Preset name";
    this.presetNameInput.className =
      "min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-500";
    this.presetNameInput.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.saveCurrentPreset();
        }
      },
      { signal: this.abort.signal },
    );

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className =
      "shrink-0 rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200";
    saveButton.textContent = "Save";
    saveButton.addEventListener(
      "click",
      () => {
        this.saveCurrentPreset();
      },
      { signal: this.abort.signal },
    );

    const exportCurrentButton = document.createElement("button");
    exportCurrentButton.type = "button";
    exportCurrentButton.className =
      "shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    exportCurrentButton.textContent = "Export";
    exportCurrentButton.title = "Export the current patch as a file";
    exportCurrentButton.addEventListener(
      "click",
      () => {
        this.exportCurrentPreset();
      },
      { signal: this.abort.signal },
    );

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className =
      "shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    importButton.textContent = "Import";
    importButton.title = "Import a preset file";

    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.className = "hidden";
    importInput.addEventListener(
      "change",
      () => {
        const file = importInput.files?.[0];
        importInput.value = "";
        if (file) {
          void this.importPresetFile(file);
        }
      },
      { signal: this.abort.signal },
    );

    importButton.addEventListener(
      "click",
      () => {
        importInput.click();
      },
      { signal: this.abort.signal },
    );

    saveRow.append(
      this.presetNameInput,
      saveButton,
      exportCurrentButton,
      importButton,
      importInput,
    );

    this.presetStatusEl = document.createElement("div");
    this.presetStatusEl.className = "min-h-[1rem] text-[11px] text-slate-500";

    saveSection.append(saveLabel, saveRow, this.presetStatusEl);
    dialog.append(header, this.presetListEl, saveSection);
    overlay.append(dialog);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          this.closePresetsModal();
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
        if (!this.presetModal || this.presetModal.classList.contains("hidden")) {
          return;
        }
        event.preventDefault();
        this.closePresetsModal();
      },
      { signal: this.abort.signal },
    );

    return overlay;
  }

  private refreshPresetList(): void {
    if (!this.presetListEl) {
      return;
    }

    this.presetListEl.replaceChildren();

    const factorySection = this.createPresetSection(
      "Factory",
      BUILT_IN_PRESETS,
      false,
    );
    const userSection = this.createPresetSection(
      "Saved",
      this.userPresets,
      true,
    );
    this.presetListEl.append(factorySection, userSection);
  }

  private createPresetSection(
    title: string,
    presets: SynthPreset[],
    allowDelete: boolean,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "space-y-2";

    const heading = document.createElement("div");
    heading.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    heading.textContent = title;
    section.append(heading);

    if (presets.length === 0) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-md border border-dashed border-slate-800 px-3 py-4 text-center text-[12px] text-slate-500";
      empty.textContent = "No saved presets yet";
      section.append(empty);
      return section;
    }

    const list = document.createElement("div");
    list.className = "space-y-1";

    for (const preset of presets) {
      const row = document.createElement("div");
      row.className =
        "flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5";

      if (preset.id === this.activePresetId) {
        row.classList.add("border-emerald-700/60", "bg-emerald-950/20");
      }

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className =
        "min-w-0 flex-1 truncate text-left text-sm text-slate-200 hover:text-white";
      loadButton.textContent = preset.name;
      loadButton.title = `Load “${preset.name}”`;
      loadButton.addEventListener(
        "click",
        () => {
          this.applyPreset(preset);
          if (this.presetStatusEl) {
            this.presetStatusEl.textContent = `Loaded “${preset.name}”`;
          }
        },
        { signal: this.abort.signal },
      );

      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className =
        "shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-slate-500 hover:text-slate-200";
      exportButton.textContent = "Export";
      exportButton.title = `Export “${preset.name}”`;
      exportButton.addEventListener(
        "click",
        () => {
          this.exportPreset(preset);
        },
        { signal: this.abort.signal },
      );

      row.append(loadButton, exportButton);

      if (allowDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className =
          "shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-rose-700 hover:text-rose-300";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener(
          "click",
          () => {
            this.deleteUserPreset(preset.id);
          },
          { signal: this.abort.signal },
        );
        row.append(deleteButton);
      }

      list.append(row);
    }

    section.append(list);
    return section;
  }

  private saveCurrentPreset(): void {
    const name = this.presetNameInput?.value.trim() ?? "";
    if (!name) {
      if (this.presetStatusEl) {
        this.presetStatusEl.textContent = "Enter a name to save";
      }
      this.presetNameInput?.focus();
      return;
    }

    const existingIndex = this.userPresets.findIndex(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );

    const preset: SynthPreset = {
      id:
        existingIndex >= 0
          ? this.userPresets[existingIndex].id
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.slice(0, 48),
      builtIn: false,
      params: cloneParams(this.params),
      effects: cloneEffects(this.effectsParams),
    };

    if (existingIndex >= 0) {
      this.userPresets[existingIndex] = preset;
    } else {
      this.userPresets.push(preset);
    }

    this.userPresets.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    saveUserPresets(this.userPresets);
    this.activePresetId = preset.id;
    this.refreshPresetList();

    if (this.presetStatusEl) {
      this.presetStatusEl.textContent =
        existingIndex >= 0 ? `Updated “${preset.name}”` : `Saved “${preset.name}”`;
    }
    if (this.presetNameInput) {
      this.presetNameInput.value = preset.name;
    }
  }

  private deleteUserPreset(id: string): void {
    const preset = this.userPresets.find((entry) => entry.id === id);
    if (!preset) {
      return;
    }

    this.userPresets = this.userPresets.filter((entry) => entry.id !== id);
    saveUserPresets(this.userPresets);
    if (this.activePresetId === id) {
      this.activePresetId = null;
    }
    this.refreshPresetList();
    if (this.presetStatusEl) {
      this.presetStatusEl.textContent = `Deleted “${preset.name}”`;
    }
  }

  private exportCurrentPreset(): void {
    const name = this.presetNameInput?.value.trim() || "MiniSynth Preset";
    this.exportPreset({
      id: this.activePresetId ?? `export-${Date.now()}`,
      name,
      builtIn: false,
      params: cloneParams(this.params),
      effects: cloneEffects(this.effectsParams),
    });
  }

  private exportPreset(preset: SynthPreset): void {
    const payload = {
      format: "minisynth-preset",
      version: 1,
      name: preset.name,
      params: cloneParams(preset.params),
      effects: cloneEffects(preset.effects),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.presetFilename(preset.name)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    if (this.presetStatusEl) {
      this.presetStatusEl.textContent = `Exported “${preset.name}”`;
    }
  }

  private presetFilename(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug.length > 0 ? slug : "minisynth-preset";
  }

  private async importPresetFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const record =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;

      if (
        record
        && record.format !== undefined
        && record.format !== "minisynth-preset"
      ) {
        if (this.presetStatusEl) {
          this.presetStatusEl.textContent = "Unrecognized preset file";
        }
        return;
      }

      const preset = normalizeStoredPreset({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name:
          typeof record?.name === "string" && record.name.trim().length > 0
            ? record.name
            : file.name.replace(/\.json$/i, ""),
        params: record?.params,
        effects: record?.effects,
      });

      if (!preset) {
        if (this.presetStatusEl) {
          this.presetStatusEl.textContent = "Could not read that preset file";
        }
        return;
      }

      const existingIndex = this.userPresets.findIndex(
        (entry) => entry.name.toLowerCase() === preset.name.toLowerCase(),
      );
      if (existingIndex >= 0) {
        preset.id = this.userPresets[existingIndex].id;
        this.userPresets[existingIndex] = preset;
      } else {
        this.userPresets.push(preset);
      }

      this.userPresets.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
      saveUserPresets(this.userPresets);
      this.applyPreset(preset);
      if (this.presetNameInput) {
        this.presetNameInput.value = preset.name;
      }
      if (this.presetStatusEl) {
        this.presetStatusEl.textContent =
          existingIndex >= 0
            ? `Imported and updated “${preset.name}”`
            : `Imported “${preset.name}”`;
      }
    } catch {
      if (this.presetStatusEl) {
        this.presetStatusEl.textContent = "Could not read that preset file";
      }
    }
  }

  private createKeyboard(): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className =
      "flex shrink-0 flex-col justify-end px-3 pb-3 pt-2";

    const chordBar = document.createElement("div");
    chordBar.className =
      "mx-auto mb-1.5 grid h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/40 px-2";

    const barButtonClass =
      "shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

    this.midiFileInput = document.createElement("input");
    this.midiFileInput.type = "file";
    this.midiFileInput.accept = ".mid,.midi,audio/midi,audio/x-midi";
    this.midiFileInput.className = "hidden";
    this.midiFileInput.addEventListener(
      "change",
      () => {
        const file = this.midiFileInput?.files?.[0];
        if (this.midiFileInput) {
          this.midiFileInput.value = "";
        }
        if (file) {
          void this.loadMidiFile(file);
        }
      },
      { signal: this.abort.signal },
    );

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = barButtonClass;
    loadButton.textContent = "Load";
    loadButton.title = "Load MIDI file";
    loadButton.addEventListener(
      "click",
      () => {
        this.midiFileInput?.click();
      },
      { signal: this.abort.signal },
    );

    this.midiFileBackButton = document.createElement("button");
    this.midiFileBackButton.type = "button";
    this.midiFileBackButton.className = barButtonClass;
    this.midiFileBackButton.textContent = "«";
    this.midiFileBackButton.title = `Skip back ${MIDI_FILE_SKIP_SECONDS}s`;
    this.midiFileBackButton.addEventListener(
      "click",
      () => {
        this.skipMidiFile(-MIDI_FILE_SKIP_SECONDS);
      },
      { signal: this.abort.signal },
    );

    this.midiFilePlayStopButton = document.createElement("button");
    this.midiFilePlayStopButton.type = "button";
    this.midiFilePlayStopButton.className =
      "shrink-0 rounded border border-emerald-700/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";
    this.midiFilePlayStopButton.textContent = "Play";
    this.midiFilePlayStopButton.title = "Play MIDI file";
    this.midiFilePlayStopButton.addEventListener(
      "click",
      () => {
        if (this.midiFilePlaying) {
          this.stopMidiFile();
        } else {
          void this.playMidiFile();
        }
      },
      { signal: this.abort.signal },
    );

    this.midiFileForwardButton = document.createElement("button");
    this.midiFileForwardButton.type = "button";
    this.midiFileForwardButton.className = barButtonClass;
    this.midiFileForwardButton.textContent = "»";
    this.midiFileForwardButton.title = `Skip forward ${MIDI_FILE_SKIP_SECONDS}s`;
    this.midiFileForwardButton.addEventListener(
      "click",
      () => {
        this.skipMidiFile(MIDI_FILE_SKIP_SECONDS);
      },
      { signal: this.abort.signal },
    );

    this.midiFileTimeEl = document.createElement("span");
    this.midiFileTimeEl.className =
      "shrink-0 font-mono text-[10px] tabular-nums text-slate-400";
    this.midiFileTimeEl.textContent = "0:00 / 0:00";
    this.midiFileTimeEl.setAttribute("aria-label", "MIDI playback time");

    this.midiFileStatusEl = document.createElement("span");
    this.midiFileStatusEl.className =
      "min-w-0 truncate text-right font-mono text-[10px] text-slate-500";

    const midiTransport = document.createElement("div");
    midiTransport.className = "flex min-w-0 items-center gap-1.5";
    midiTransport.append(
      loadButton,
      this.midiFilePlayStopButton,
      this.midiFileBackButton,
      this.midiFileForwardButton,
      this.midiFileTimeEl,
      this.midiFileInput,
    );

    const chordCenter = document.createElement("div");
    chordCenter.className = "flex items-center justify-center px-2";
    chordCenter.setAttribute("aria-live", "polite");
    chordCenter.setAttribute("aria-label", "Current chord");

    this.chordLabelEl = document.createElement("span");
    this.chordLabelEl.className =
      "font-mono text-xs tabular-nums tracking-wide text-slate-500";
    this.chordLabelEl.textContent = "—";
    chordCenter.append(this.chordLabelEl);

    const midiMeta = document.createElement("div");
    midiMeta.className = "flex min-w-0 items-center justify-end";
    midiMeta.append(this.midiFileStatusEl);

    chordBar.append(midiTransport, chordCenter, midiMeta);

    this.keyboardRow = document.createElement("div");
    this.keyboardRow.className =
      "mx-auto flex w-full min-w-0 flex-nowrap items-center gap-2";

    const pitchButtonClass =
      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-sm leading-none text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";
    const pitchLabelClass =
      "w-full py-1 text-center font-mono text-xs tabular-nums text-slate-400";
    const pitchColumnClass =
      "flex w-[4.75rem] shrink-0 flex-col items-center gap-1";

    const octaveColumn = document.createElement("div");
    octaveColumn.className = pitchColumnClass;

    this.octaveDownButton = document.createElement("button");
    this.octaveDownButton.type = "button";
    this.octaveDownButton.textContent = "-";
    this.octaveDownButton.title = "Octave down";
    this.octaveDownButton.className = pitchButtonClass;
    this.octaveDownButton.addEventListener(
      "click",
      () => {
        this.setOctave(this.octave - 1);
      },
      { signal: this.abort.signal },
    );

    this.octaveLabel = document.createElement("span");
    this.octaveLabel.className = pitchLabelClass;
    this.octaveLabel.textContent = this.formatOctaveLabel();

    this.octaveUpButton = document.createElement("button");
    this.octaveUpButton.type = "button";
    this.octaveUpButton.textContent = "+";
    this.octaveUpButton.title = "Octave up";
    this.octaveUpButton.className = pitchButtonClass;
    this.octaveUpButton.addEventListener(
      "click",
      () => {
        this.setOctave(this.octave + 1);
      },
      { signal: this.abort.signal },
    );

    octaveColumn.append(
      this.octaveUpButton,
      this.octaveLabel,
      this.octaveDownButton,
    );

    const transposeColumn = document.createElement("div");
    transposeColumn.className = pitchColumnClass;

    this.transposeDownButton = document.createElement("button");
    this.transposeDownButton.type = "button";
    this.transposeDownButton.textContent = "-";
    this.transposeDownButton.title = "Transpose down (semitone)";
    this.transposeDownButton.className = pitchButtonClass;
    this.transposeDownButton.addEventListener(
      "click",
      () => {
        this.setTranspose(this.transpose - 1);
      },
      { signal: this.abort.signal },
    );

    this.transposeLabel = document.createElement("span");
    this.transposeLabel.className = pitchLabelClass;
    this.transposeLabel.textContent = this.formatTransposeLabel();

    this.transposeUpButton = document.createElement("button");
    this.transposeUpButton.type = "button";
    this.transposeUpButton.textContent = "+";
    this.transposeUpButton.title = "Transpose up (semitone)";
    this.transposeUpButton.className = pitchButtonClass;
    this.transposeUpButton.addEventListener(
      "click",
      () => {
        this.setTranspose(this.transpose + 1);
      },
      { signal: this.abort.signal },
    );

    transposeColumn.append(
      this.transposeUpButton,
      this.transposeLabel,
      this.transposeDownButton,
    );

    this.keyboardBoard = document.createElement("div");
    this.keyboardBoard.className = "relative min-w-0 flex-1";

    this.keyboardRow.append(octaveColumn, this.keyboardBoard, transposeColumn);
    wrapper.append(chordBar, this.keyboardRow);
    this.renderKeyboardKeys();
    this.updatePitchControls();
    this.updateChordDisplay();
    this.refreshMidiFilePanel();
    return wrapper;
  }

  private updateChordDisplay(): void {
    if (!this.chordLabelEl) {
      return;
    }

    const name = detectChordName(this.pressedKeys);
    if (!name) {
      this.chordLabelEl.textContent = "—";
      this.chordLabelEl.className =
        "font-mono text-xs tabular-nums tracking-wide text-slate-500";
      return;
    }

    this.chordLabelEl.textContent = name;
    this.chordLabelEl.className =
      "font-mono text-xs tabular-nums tracking-wide text-teal-300";
  }

  private activeKeyLayout(): KeyLayout[] {
    return this.pianoRollStyle === "full88" ? FULL88_LAYOUT : KEY_LAYOUT;
  }

  private setPianoRollStyle(style: PianoRollStyle): void {
    if (style === this.pianoRollStyle) {
      return;
    }
    this.pianoRollStyle = style;
    saveUiSettings({ pianoRollStyle: style });
    if (this.pianoRollStyleSelect) {
      this.pianoRollStyleSelect.value = style;
    }
    this.renderKeyboardKeys();
  }

  private restoreUiSettings(): void {
    const settings = loadUiSettings();
    this.pianoRollStyle = settings.pianoRollStyle;
  }

  private renderKeyboardKeys(): void {
    if (!this.keyboardBoard) {
      return;
    }

    this.keyButtons.clear();
    this.keyboardBoard.replaceChildren();

    const layoutKeys = this.activeKeyLayout();
    const whiteCount =
      this.pianoRollStyle === "full88" ? FULL88_WHITE_COUNT : TOTAL_WHITE_COUNT;
    const whiteWidth = 100 / whiteCount;
    const full88 = this.pianoRollStyle === "full88";

    this.keyboardBoard.className = full88
      ? "relative min-w-0 flex-1 overflow-x-auto"
      : "relative min-w-0 flex-1";

    this.whiteRow = document.createElement("div");
    this.whiteRow.className = full88
      ? "relative flex min-h-[4.5rem] w-full min-w-[48rem] gap-px"
      : "relative flex min-h-[4.5rem] w-full gap-px";

    const whiteKeys = layoutKeys
      .filter((item) => item.white)
      .sort((left, right) => left.semitone - right.semitone);

    for (const layout of whiteKeys) {
      const button = this.createKeyButton(layout);
      const extension = layout.tier === "upper";
      button.className += extension
        ? " min-w-0 flex-1 rounded-b-md border border-slate-600 bg-slate-300 text-slate-900 transition-colors hover:bg-slate-100 active:bg-teal-200"
        : " min-w-0 flex-1 rounded-b-md border border-slate-700 bg-slate-200 text-slate-900 transition-colors hover:bg-white active:bg-teal-200";
      this.whiteRow.append(button);
    }

    for (const layout of layoutKeys.filter((item) => !item.white)) {
      const prevWhite = layoutKeys.find(
        (item) => item.white && item.semitone === layout.semitone - 1,
      );
      if (prevWhite?.whiteIndex === undefined) {
        continue;
      }

      const button = this.createKeyButton(layout);
      const extension = layout.tier === "upper";
      button.className += extension
        ? " absolute top-0 z-10 h-[58%] rounded-b-md border border-slate-900 bg-slate-600 text-[10px] text-slate-100 transition-colors hover:bg-slate-500 active:bg-teal-700"
        : " absolute top-0 z-10 h-[58%] rounded-b-md border border-slate-900 bg-slate-700 text-[10px] text-slate-200 transition-colors hover:bg-slate-600 active:bg-teal-700";
      button.style.left = `${(prevWhite.whiteIndex + 0.68) * whiteWidth}%`;
      button.style.width = `${whiteWidth * 0.64}%`;
      this.whiteRow.append(button);
    }

    this.keyboardBoard.append(this.whiteRow);
    this.applyKeyboardHeight();
    this.syncKeyboardPressedVisuals();
  }

  private formatOctaveLabel(): string {
    return `Oct ${this.octave}`;
  }

  private formatTransposeLabel(): string {
    const sign = this.transpose >= 0 ? "+" : "-";
    return `Tr ${sign}${Math.abs(this.transpose)}`;
  }

  private refreshKeyboardNoteLabels(): void {
    if (!this.keyboardBoard) {
      return;
    }

    const nextButtons = new Map<number, HTMLButtonElement>();

    for (const layout of this.activeKeyLayout()) {
      const note = this.noteForLayout(layout);
      const button = layout.keyCode
        ? this.keyboardBoard.querySelector<HTMLButtonElement>(
            `button[data-key-code="${layout.keyCode}"]`,
          )
        : this.keyboardBoard.querySelector<HTMLButtonElement>(
            `button[data-midi-base="${layout.midiNote}"]`,
          );
      if (!button) {
        continue;
      }

      button.dataset.note = String(note);
      const noteLabel = button.querySelector("[data-note-label]");
      if (noteLabel) {
        noteLabel.textContent = midiNoteLabel(note);
      }
      if (layout.midiNote !== undefined) {
        this.syncComputerKeyLabel(button, layout.midiNote, true);
      }
      nextButtons.set(note, button);
    }

    this.keyButtons = nextButtons;
    this.syncKeyboardPressedVisuals();
  }

  /** QWERTY mapping for the compact octave window, keyed by absolute MIDI note. */
  private computerKeyCodeForMidiBase(midiBase: number): string | undefined {
    const relative = midiBase - baseMidiForOctave(this.octave);
    return KEY_LAYOUT.find((item) => item.semitone === relative)?.keyCode;
  }

  private syncComputerKeyLabel(
    button: HTMLButtonElement,
    midiBase: number,
    full88: boolean,
  ): void {
    const keyCode = this.computerKeyCodeForMidiBase(midiBase);
    let computerKey = button.querySelector<HTMLElement>(
      "[data-computer-key-label]",
    );
    if (!keyCode) {
      computerKey?.remove();
      return;
    }

    if (!computerKey) {
      computerKey = document.createElement("span");
      computerKey.dataset.computerKeyLabel = "true";
      computerKey.className = full88
        ? "text-[8px] font-semibold uppercase leading-none"
        : "text-xs font-semibold uppercase";
      const noteLabel = button.querySelector("[data-note-label]");
      if (noteLabel) {
        button.insertBefore(computerKey, noteLabel);
      } else {
        button.append(computerKey);
      }
    }
    computerKey.textContent = keyCodeLabel(keyCode);
  }

  private syncKeyboardPressedVisuals(): void {
    for (const [note, button] of this.keyButtons) {
      this.setKeyPressed(button, this.pressedKeys.has(note));
    }
  }

  private baseMidiNote(): number {
    return baseMidiForOctave(this.octave) + this.transpose;
  }

  private noteForLayout(layout: KeyLayout): number {
    if (layout.midiNote !== undefined) {
      return Math.min(127, Math.max(0, layout.midiNote + this.transpose));
    }
    return this.baseMidiNote() + layout.semitone;
  }

  private noteForKeyCode(keyCode: string): number | undefined {
    // Computer keys always use the compact layout + octave window.
    const layout = KEY_LAYOUT.find((item) => item.keyCode === keyCode);
    if (!layout) {
      return undefined;
    }

    return this.baseMidiNote() + layout.semitone;
  }

  private shouldHandleKeyboard(event: KeyboardEvent): boolean {
    if (!this.keyboardEnabled) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (isEditableTarget(event.target)) {
      return false;
    }

    return true;
  }

  private isCapturedKeyCode(keyCode: string): boolean {
    if (
      keyCode === "KeyZ" ||
      keyCode === "KeyX" ||
      keyCode === "Period" ||
      keyCode === "Slash"
    ) {
      return true;
    }
    if (BROWSER_FIND_KEY_CODES.has(keyCode)) {
      return true;
    }

    return this.noteForKeyCode(keyCode) !== undefined;
  }

  private suppressBrowserKey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private setOctave(octave: number): void {
    const clamped = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, octave));
    if (clamped === this.octave) {
      return;
    }

    this.octave = clamped;
    if (this.octaveLabel) {
      this.octaveLabel.textContent = this.formatOctaveLabel();
    }
    this.updatePitchControls();
    this.refreshKeyboardNoteLabels();
  }

  private setTranspose(semitones: number): void {
    const clamped = Math.min(MAX_TRANSPOSE, Math.max(MIN_TRANSPOSE, semitones));
    if (clamped === this.transpose) {
      return;
    }

    this.transpose = clamped;
    if (this.transposeLabel) {
      this.transposeLabel.textContent = this.formatTransposeLabel();
    }
    this.updatePitchControls();
    this.refreshKeyboardNoteLabels();
  }

  private updatePitchControls(): void {
    if (this.octaveDownButton) {
      this.octaveDownButton.disabled = this.octave <= MIN_OCTAVE;
    }
    if (this.octaveUpButton) {
      this.octaveUpButton.disabled = this.octave >= MAX_OCTAVE;
    }
    if (this.transposeDownButton) {
      this.transposeDownButton.disabled = this.transpose <= MIN_TRANSPOSE;
    }
    if (this.transposeUpButton) {
      this.transposeUpButton.disabled = this.transpose >= MAX_TRANSPOSE;
    }
  }

  private createKeyButton(layout: KeyLayout): HTMLButtonElement {
    const note = this.noteForLayout(layout);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.note = String(note);
    if (layout.keyCode) {
      button.dataset.keyCode = layout.keyCode;
    }
    if (layout.midiNote !== undefined) {
      button.dataset.midiBase = String(layout.midiNote);
    }
    const full88 = layout.midiNote !== undefined;
    button.className = full88
      ? "flex cursor-pointer select-none flex-col items-center justify-end px-0 py-1 font-mono text-[9px]"
      : "flex cursor-pointer select-none flex-col items-center justify-end gap-0.5 px-0.5 py-1 font-mono text-[10px]";

    const noteName = document.createElement("span");
    noteName.dataset.noteLabel = "true";
    noteName.className = full88
      ? "max-w-full truncate px-px text-center text-[7px] leading-none tabular-nums opacity-60"
      : "min-w-[2.25rem] text-center text-[9px] tabular-nums opacity-50";
    noteName.textContent = midiNoteLabel(note);
    button.append(noteName);

    if (layout.keyCode) {
      const computerKey = document.createElement("span");
      computerKey.dataset.computerKeyLabel = "true";
      computerKey.className = "text-xs font-semibold uppercase";
      computerKey.textContent = keyCodeLabel(layout.keyCode);
      button.insertBefore(computerKey, noteName);
    } else if (layout.midiNote !== undefined) {
      this.syncComputerKeyLabel(button, layout.midiNote, true);
    }

    this.keyButtons.set(note, button);

    // Resolve note on each event so octave/transpose changes apply to clicks
    // (computer-keyboard handling already uses noteForLayout at press time).
    let activeNote: number | null = null;

    button.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        activeNote = this.noteForLayout(layout);
        void this.pressKey(activeNote);
      },
      { signal: this.abort.signal },
    );
    button.addEventListener(
      "pointerup",
      (event) => {
        if (button.hasPointerCapture(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        if (activeNote !== null) {
          this.releaseKey(activeNote);
          activeNote = null;
        }
      },
      { signal: this.abort.signal },
    );
    button.addEventListener(
      "pointercancel",
      () => {
        if (activeNote !== null) {
          this.releaseKey(activeNote);
          activeNote = null;
        }
      },
      { signal: this.abort.signal },
    );

    return button;
  }

  private bindKeyboard(): void {
    const keyboardOptions = { capture: true, signal: this.abort.signal };

    window.addEventListener(
      "keydown",
      (event) => {
        if (!this.shouldHandleKeyboard(event)) {
          return;
        }
        if (!this.isCapturedKeyCode(event.code)) {
          return;
        }

        this.suppressBrowserKey(event);

        if (event.repeat) {
          return;
        }

        if (event.code === "KeyZ") {
          this.setOctave(this.octave - 1);
          return;
        }
        if (event.code === "KeyX") {
          this.setOctave(this.octave + 1);
          return;
        }
        if (event.code === "Period") {
          this.setTranspose(this.transpose - 1);
          return;
        }
        if (event.code === "Slash") {
          this.setTranspose(this.transpose + 1);
          return;
        }

        if (this.heldComputerKeys.has(event.code)) {
          return;
        }

        const note = this.noteForKeyCode(event.code);
        if (note === undefined) {
          return;
        }

        this.heldComputerKeys.set(event.code, note);
        void this.pressKey(note);
      },
      keyboardOptions,
    );

    window.addEventListener(
      "keyup",
      (event) => {
        if (!this.isCapturedKeyCode(event.code)) {
          return;
        }

        const heldNote = this.heldComputerKeys.get(event.code);
        if (heldNote === undefined) {
          return;
        }

        this.suppressBrowserKey(event);
        this.heldComputerKeys.delete(event.code);
        this.releaseKey(heldNote);
      },
      keyboardOptions,
    );
  }

  private restoreMidiSettings(): void {
    const settings = loadMidiSettings();
    this.midiEnabledInputIds =
      settings.enabledInputIds === null
        ? null
        : new Set(settings.enabledInputIds);

    // Re-enable quietly if the browser still has permission from a prior visit.
    if (!navigator.requestMIDIAccess) {
      return;
    }

    void navigator
      .requestMIDIAccess()
      .then((access) => {
        if (this.abort.signal.aborted) {
          return;
        }
        this.attachMidiAccess(access);
        this.refreshMidiPanel();
      })
      .catch(() => {
        // Stay off until the user enables MIDI from Config.
      });
  }

  private async requestMidiAccess(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.midiPermissionError =
        "Web MIDI is not supported in this browser.";
      this.refreshMidiPanel();
      return;
    }

    if (this.midiEnableButton) {
      this.midiEnableButton.disabled = true;
      this.midiEnableButton.textContent = "Requesting…";
    }

    try {
      const access = await navigator.requestMIDIAccess();
      if (this.abort.signal.aborted) {
        return;
      }
      this.midiPermissionError = null;
      this.attachMidiAccess(access);
    } catch {
      this.midiPermissionError =
        "MIDI permission was denied. Allow MIDI access in the browser, then try again.";
    }

    this.refreshMidiPanel();
  }

  private attachMidiAccess(access: MIDIAccess): void {
    if (this.midiAccess && this.midiAccess !== access) {
      this.midiAccess.onstatechange = null;
    }

    this.midiAccess = access;
    this.syncMidiInputs();
    access.onstatechange = () => {
      this.syncMidiInputs();
      this.refreshMidiPanel();
    };
  }

  private unbindMidi(): void {
    for (const input of this.midiBoundInputs) {
      input.onmidimessage = null;
    }
    this.midiBoundInputs.clear();

    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
      this.midiAccess = null;
    }
  }

  private isMidiInputEnabled(inputId: string): boolean {
    return (
      this.midiEnabledInputIds === null
      || this.midiEnabledInputIds.has(inputId)
    );
  }

  private setMidiInputEnabled(inputId: string, enabled: boolean): void {
    if (!this.midiAccess) {
      return;
    }

    if (this.midiEnabledInputIds === null) {
      this.midiEnabledInputIds = new Set(
        [...this.midiAccess.inputs.keys()],
      );
    }

    if (enabled) {
      this.midiEnabledInputIds.add(inputId);
    } else {
      this.midiEnabledInputIds.delete(inputId);
    }

    saveMidiSettings({
      enabledInputIds: [...this.midiEnabledInputIds],
    });
    this.syncMidiInputs();
    this.refreshMidiPanel();
  }

  private syncMidiInputs(): void {
    if (!this.midiAccess) {
      return;
    }

    const activeInputs = new Set(this.midiAccess.inputs.values());
    for (const input of this.midiBoundInputs) {
      if (!activeInputs.has(input) || !this.isMidiInputEnabled(input.id)) {
        input.onmidimessage = null;
        this.midiBoundInputs.delete(input);
      }
    }

    for (const input of activeInputs) {
      if (!this.isMidiInputEnabled(input.id)) {
        continue;
      }
      if (this.midiBoundInputs.has(input)) {
        continue;
      }

      input.onmidimessage = (event) => {
        this.handleMidiMessage(event);
      };
      this.midiBoundInputs.add(input);
    }
  }

  private flashMidiActivity(): void {
    if (!this.midiActivityEl) {
      return;
    }

    this.midiActivityEl.textContent = "Note";
    this.midiActivityEl.className =
      "rounded-full border border-emerald-700/70 bg-emerald-950/50 px-2 py-0.5 text-[10px] text-emerald-300";

    if (this.midiActivityTimer !== null) {
      window.clearTimeout(this.midiActivityTimer);
    }
    this.midiActivityTimer = window.setTimeout(() => {
      this.midiActivityTimer = null;
      if (!this.midiActivityEl) {
        return;
      }
      this.midiActivityEl.textContent = "Idle";
      this.midiActivityEl.className =
        "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500";
    }, 180);
  }

  private handleMidiMessage(event: MIDIMessageEvent): void {
    if (!this.keyboardEnabled) {
      return;
    }

    const data = event.data;
    if (!data || data.length < 2) {
      return;
    }

    const parsed = parseMidiNoteEvent(data);
    if (!parsed) {
      return;
    }

    this.flashMidiActivity();

    const note = Math.min(127, Math.max(0, parsed.note + this.transpose));

    if (parsed.type === "noteOn") {
      void this.pressKey(note);
      return;
    }

    this.releaseKey(note);
  }

  private async pressKey(note: number): Promise<void> {
    if (this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.add(note);
    this.setKeyPressed(this.keyButtons.get(note), true);
    this.updateChordDisplay();
    await this.synth.ensureRunning();
    if (!this.pressedKeys.has(note)) {
      return;
    }
    this.synth.noteOn(note);
    this.updateVisualizations();
  }

  private releaseKey(note: number): void {
    if (!this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.delete(note);
    this.setKeyPressed(this.keyButtons.get(note), false);
    this.updateChordDisplay();
    this.synth.noteOff(note);
    this.updateVisualizations();
  }

  private releaseManualKeys(): void {
    this.heldComputerKeys.clear();
    for (const note of [...this.pressedKeys]) {
      if (this.midiFileHoldCounts.has(note)) {
        continue;
      }
      this.releaseKey(note);
    }
    this.updateChordDisplay();
    this.updateVisualizations();
  }

  private releaseAllKeys(): void {
    this.stopMidiFile();
    this.heldComputerKeys.clear();
    for (const note of this.pressedKeys) {
      this.setKeyPressed(this.keyButtons.get(note), false);
    }
    this.pressedKeys.clear();
    this.updateChordDisplay();
    this.synth.stopAll();
    this.updateVisualizations();
  }

  private setKeyPressed(
    button: HTMLButtonElement | undefined,
    pressed: boolean,
  ): void {
    if (!button) {
      return;
    }

    for (const className of KEY_PRESSED_CLASSES) {
      button.classList.toggle(className, pressed);
    }
  }
}
