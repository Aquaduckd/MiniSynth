import { detectChordName } from "../music/chords.js";
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
  TOTAL_WHITE_COUNT,
} from "../music/keyboard.js";
import { baseMidiForOctave, midiNoteLabel } from "../music/notes.js";
import {
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  saveUiSettings,
} from "../storage/settings.js";
import type { KeyLayout, PianoRollStyle } from "../types.js";

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

export interface PianoKeyboardHost {
  ensureAudioRunning(): Promise<void>;
  synthNoteOn(note: number): void;
  synthNoteOff(note: number): void;
  synthStopAll(): void;
  /** True when an external source (MIDI file) still holds the note. */
  isExternalHold(note: number): boolean;
  stopExternalPlayback(): void;
  onNotesChanged(): void;
}

export interface PianoKeyboardMountOptions {
  signal: AbortSignal;
  /** Left cell of the chord bar (MIDI transport). */
  leadingBar?: HTMLElement;
  /** Right cell of the chord bar (MIDI status). */
  trailingBar?: HTMLElement;
}

export class PianoKeyboard {
  private readonly pressedKeys = new Set<number>();
  /** Computer keyCode → MIDI note at press time (survives octave/transpose changes). */
  private readonly heldComputerKeys = new Map<string, number>();
  private keyButtons = new Map<number, HTMLButtonElement>();
  private enabled = false;
  private octave = DEFAULT_OCTAVE;
  private transposeSemitones = DEFAULT_TRANSPOSE;
  private pianoRollStyle: PianoRollStyle = DEFAULT_UI_SETTINGS.pianoRollStyle;
  private keyboardHeightPx = 96;
  private signal: AbortSignal | undefined;
  private keyboardRow: HTMLDivElement | null = null;
  private keyboardBoard: HTMLDivElement | null = null;
  private whiteRow: HTMLDivElement | null = null;
  private chordLabelEl: HTMLElement | null = null;
  private octaveLabel: HTMLSpanElement | null = null;
  private octaveDownButton: HTMLButtonElement | null = null;
  private octaveUpButton: HTMLButtonElement | null = null;
  private transposeLabel: HTMLSpanElement | null = null;
  private transposeDownButton: HTMLButtonElement | null = null;
  private transposeUpButton: HTMLButtonElement | null = null;

  constructor(private readonly host: PianoKeyboardHost) {}

  get transpose(): number {
    return this.transposeSemitones;
  }

  get style(): PianoRollStyle {
    return this.pianoRollStyle;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isPressed(note: number): boolean {
    return this.pressedKeys.has(note);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  restoreSettings(): void {
    const settings = loadUiSettings();
    this.pianoRollStyle = settings.pianoRollStyle;
  }

  setStyle(style: PianoRollStyle): void {
    if (style === this.pianoRollStyle) {
      return;
    }
    this.pianoRollStyle = style;
    saveUiSettings({ pianoRollStyle: style });
    this.renderKeys();
  }

  setHeight(px: number): void {
    this.keyboardHeightPx = px;
    this.applyKeyboardHeight();
  }

  mount(options: PianoKeyboardMountOptions): HTMLElement {
    this.signal = options.signal;

    const wrapper = document.createElement("div");
    wrapper.className = "flex shrink-0 flex-col justify-end px-3 pb-3 pt-2";

    const chordBar = document.createElement("div");
    chordBar.className =
      "mx-auto mb-1.5 grid h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/40 px-2";

    const leading = options.leadingBar ?? document.createElement("div");

    const chordCenter = document.createElement("div");
    chordCenter.className = "flex items-center justify-center px-2";
    chordCenter.setAttribute("aria-live", "polite");
    chordCenter.setAttribute("aria-label", "Current chord");

    this.chordLabelEl = document.createElement("span");
    this.chordLabelEl.className =
      "font-mono text-xs tabular-nums tracking-wide text-slate-500";
    this.chordLabelEl.textContent = "—";
    chordCenter.append(this.chordLabelEl);

    const trailing = document.createElement("div");
    trailing.className = "flex min-w-0 items-center justify-end";
    if (options.trailingBar) {
      trailing.append(options.trailingBar);
    }

    chordBar.append(leading, chordCenter, trailing);

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
      { signal: this.signal },
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
      { signal: this.signal },
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
        this.setTranspose(this.transposeSemitones - 1);
      },
      { signal: this.signal },
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
        this.setTranspose(this.transposeSemitones + 1);
      },
      { signal: this.signal },
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
    this.renderKeys();
    this.updatePitchControls();
    this.updateChordDisplay();
    return wrapper;
  }

  bindComputerKeys(signal: AbortSignal): void {
    const keyboardOptions = { capture: true, signal };

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
          this.setTranspose(this.transposeSemitones - 1);
          return;
        }
        if (event.code === "Slash") {
          this.setTranspose(this.transposeSemitones + 1);
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
        void this.press(note);
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
        this.release(heldNote);
      },
      keyboardOptions,
    );
  }

  async press(note: number): Promise<void> {
    if (this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.add(note);
    this.setKeyPressed(this.keyButtons.get(note), true);
    this.updateChordDisplay();
    await this.host.ensureAudioRunning();
    if (!this.pressedKeys.has(note)) {
      return;
    }
    this.host.synthNoteOn(note);
    this.host.onNotesChanged();
  }

  /**
   * Sync note on for the MIDI file player — async press can drop notes when
   * many events land in one scheduler slice (noteOff before await).
   */
  noteOnSync(note: number): void {
    if (!this.pressedKeys.has(note)) {
      this.pressedKeys.add(note);
      this.setKeyPressed(this.keyButtons.get(note), true);
      this.host.synthNoteOn(note);
    }
    this.updateChordDisplay();
  }

  release(note: number): void {
    if (!this.pressedKeys.has(note)) {
      return;
    }

    this.pressedKeys.delete(note);
    this.setKeyPressed(this.keyButtons.get(note), false);
    this.updateChordDisplay();
    this.host.synthNoteOff(note);
    this.host.onNotesChanged();
  }

  /** Drop stuck computer/pointer keys, but keep external playback going. */
  releaseManual(): void {
    this.heldComputerKeys.clear();
    for (const note of [...this.pressedKeys]) {
      if (this.host.isExternalHold(note)) {
        continue;
      }
      this.release(note);
    }
    this.updateChordDisplay();
    this.host.onNotesChanged();
  }

  releaseAll(): void {
    this.host.stopExternalPlayback();
    this.heldComputerKeys.clear();
    for (const note of this.pressedKeys) {
      this.setKeyPressed(this.keyButtons.get(note), false);
    }
    this.pressedKeys.clear();
    this.updateChordDisplay();
    this.host.synthStopAll();
    this.host.onNotesChanged();
  }

  dispose(): void {
    this.keyButtons.clear();
    this.keyboardRow = null;
    this.keyboardBoard = null;
    this.whiteRow = null;
    this.chordLabelEl = null;
    this.octaveLabel = null;
    this.octaveDownButton = null;
    this.octaveUpButton = null;
    this.transposeLabel = null;
    this.transposeDownButton = null;
    this.transposeUpButton = null;
    this.signal = undefined;
  }

  private applyKeyboardHeight(): void {
    if (this.whiteRow) {
      this.whiteRow.style.height = `${this.keyboardHeightPx}px`;
    }
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

  private renderKeys(): void {
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
    this.syncPressedVisuals();
  }

  private formatOctaveLabel(): string {
    return `Oct ${this.octave}`;
  }

  private formatTransposeLabel(): string {
    const sign = this.transposeSemitones >= 0 ? "+" : "-";
    return `Tr ${sign}${Math.abs(this.transposeSemitones)}`;
  }

  private refreshNoteLabels(): void {
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
    this.syncPressedVisuals();
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

  private syncPressedVisuals(): void {
    for (const [note, button] of this.keyButtons) {
      this.setKeyPressed(button, this.pressedKeys.has(note));
    }
  }

  private baseMidiNote(): number {
    return baseMidiForOctave(this.octave) + this.transposeSemitones;
  }

  private noteForLayout(layout: KeyLayout): number {
    if (layout.midiNote !== undefined) {
      return Math.min(
        127,
        Math.max(0, layout.midiNote + this.transposeSemitones),
      );
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
    if (!this.enabled) {
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
    this.refreshNoteLabels();
  }

  private setTranspose(semitones: number): void {
    const clamped = Math.min(MAX_TRANSPOSE, Math.max(MIN_TRANSPOSE, semitones));
    if (clamped === this.transposeSemitones) {
      return;
    }

    this.transposeSemitones = clamped;
    if (this.transposeLabel) {
      this.transposeLabel.textContent = this.formatTransposeLabel();
    }
    this.updatePitchControls();
    this.refreshNoteLabels();
  }

  private updatePitchControls(): void {
    if (this.octaveDownButton) {
      this.octaveDownButton.disabled = this.octave <= MIN_OCTAVE;
    }
    if (this.octaveUpButton) {
      this.octaveUpButton.disabled = this.octave >= MAX_OCTAVE;
    }
    if (this.transposeDownButton) {
      this.transposeDownButton.disabled =
        this.transposeSemitones <= MIN_TRANSPOSE;
    }
    if (this.transposeUpButton) {
      this.transposeUpButton.disabled = this.transposeSemitones >= MAX_TRANSPOSE;
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
        void this.press(activeNote);
      },
      { signal: this.signal },
    );
    button.addEventListener(
      "pointerup",
      (event) => {
        if (button.hasPointerCapture(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        if (activeNote !== null) {
          this.release(activeNote);
          activeNote = null;
        }
      },
      { signal: this.signal },
    );
    button.addEventListener(
      "pointercancel",
      () => {
        if (activeNote !== null) {
          this.release(activeNote);
          activeNote = null;
        }
      },
      { signal: this.signal },
    );

    return button;
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
