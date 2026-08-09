import { PIANO_ROLL_STYLE_OPTIONS } from "../music/keyboard.js";
import type { PianoRollStyle } from "../types.js";

export interface ConfigModalHost {
  getPianoRollStyle(): PianoRollStyle;
  setPianoRollStyle(style: PianoRollStyle): void;
  createMidiConfigSection(signal: AbortSignal): HTMLElement;
  refreshMidiPanel(): void;
  focusMidiEnableButton(): void;
}

export class ConfigModal {
  private modal: HTMLElement | null = null;
  private pianoRollStyleSelect: HTMLSelectElement | null = null;

  constructor(
    private readonly host: ConfigModalHost,
    private readonly signal: AbortSignal,
  ) {}

  open(): void {
    if (!this.modal) {
      this.modal = this.createModal();
      document.body.append(this.modal);
    }

    this.host.refreshMidiPanel();
    if (this.pianoRollStyleSelect) {
      this.pianoRollStyleSelect.value = this.host.getPianoRollStyle();
    }
    this.modal.classList.remove("hidden");
    this.modal.classList.add("flex");
    this.host.focusMidiEnableButton();
  }

  close(): void {
    if (!this.modal) {
      return;
    }

    this.modal.classList.add("hidden");
    this.modal.classList.remove("flex");
  }

  dispose(): void {
    this.modal?.remove();
    this.modal = null;
    this.pianoRollStyleSelect = null;
  }

  private createModal(): HTMLElement {
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
        this.close();
      },
      { signal: this.signal },
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
    this.pianoRollStyleSelect.value = this.host.getPianoRollStyle();
    this.pianoRollStyleSelect.addEventListener(
      "change",
      () => {
        const value = this.pianoRollStyleSelect?.value;
        if (value === "compact" || value === "full88") {
          this.host.setPianoRollStyle(value);
        }
      },
      { signal: this.signal },
    );

    const pianoHint = document.createElement("p");
    pianoHint.className = "text-[11px] leading-relaxed text-slate-500";
    pianoHint.textContent =
      "Compact is the computer-keyboard layout. Full 88-key shows A0–C8 for MIDI controllers and files.";

    pianoField.append(pianoFieldLabel, this.pianoRollStyleSelect);
    pianoSection.append(pianoTitle, pianoField, pianoHint);

    const midiSection = this.host.createMidiConfigSection(this.signal);
    body.append(pianoSection, midiSection);
    dialog.append(header, body);
    overlay.append(dialog);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          this.close();
        }
      },
      { signal: this.signal },
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!this.modal || this.modal.classList.contains("hidden")) {
          return;
        }
        event.preventDefault();
        this.close();
      },
      { signal: this.signal },
    );

    return overlay;
  }
}
