import { parseMidiNoteEvent } from "./noteEvent.js";
import { loadMidiSettings, saveMidiSettings } from "../storage/settings.js";

export interface MidiDeviceManagerHost {
  isAborted(): boolean;
  isKeyboardEnabled(): boolean;
  getTranspose(): number;
  noteOn(note: number): void;
  noteOff(note: number): void;
}

export class MidiDeviceManager {
  private access: MIDIAccess | null = null;
  private readonly boundInputs = new Set<MIDIInput>();
  private enabledInputIds: Set<string> | null = null;
  private permissionError: string | null = null;
  private activityTimer: number | null = null;

  private statusEl: HTMLElement | null = null;
  private deviceListEl: HTMLElement | null = null;
  private enableButton: HTMLButtonElement | null = null;
  private activityEl: HTMLElement | null = null;
  private sectionSignal: AbortSignal | null = null;

  constructor(private readonly host: MidiDeviceManagerHost) {}

  createConfigSection(signal: AbortSignal): HTMLElement {
    this.sectionSignal = signal;

    const section = document.createElement("section");
    section.className = "space-y-3";

    const heading = document.createElement("div");
    heading.className = "flex items-center justify-between gap-2";

    const title = document.createElement("h3");
    title.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    title.textContent = "MIDI";

    this.activityEl = document.createElement("span");
    this.activityEl.className =
      "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500";
    this.activityEl.textContent = "Idle";

    heading.append(title, this.activityEl);

    this.statusEl = document.createElement("p");
    this.statusEl.className = "text-[12px] leading-relaxed text-slate-400";

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap items-center gap-2";

    this.enableButton = document.createElement("button");
    this.enableButton.type = "button";
    this.enableButton.className =
      "rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50";
    this.enableButton.textContent = "Enable MIDI";
    this.enableButton.addEventListener(
      "click",
      () => {
        void this.requestAccess();
      },
      { signal },
    );

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className =
      "rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    refreshButton.textContent = "Refresh";
    refreshButton.addEventListener(
      "click",
      () => {
        this.syncInputs();
        this.refreshPanel();
      },
      { signal },
    );

    actions.append(this.enableButton, refreshButton);

    this.deviceListEl = document.createElement("div");
    this.deviceListEl.className = "space-y-2";

    const hint = document.createElement("p");
    hint.className = "text-[11px] leading-relaxed text-slate-500";
    hint.textContent =
      "Enable MIDI, then choose which keyboards to listen to. Browsers require permission the first time.";

    section.append(heading, this.statusEl, actions, this.deviceListEl, hint);
    this.refreshPanel();
    return section;
  }

  focusEnableButton(): void {
    this.enableButton?.focus();
  }

  restore(): void {
    const settings = loadMidiSettings();
    this.enabledInputIds =
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
        if (this.host.isAborted()) {
          return;
        }
        this.attachAccess(access);
        this.refreshPanel();
      })
      .catch(() => {
        // Stay off until the user enables MIDI from Config.
      });
  }

  refreshPanel(): void {
    if (!this.statusEl || !this.deviceListEl || !this.enableButton) {
      return;
    }

    const supported = Boolean(navigator.requestMIDIAccess);
    this.enableButton.disabled = !supported || this.access !== null;
    this.enableButton.textContent = this.access
      ? "MIDI Enabled"
      : "Enable MIDI";

    if (!supported) {
      this.statusEl.textContent =
        "Web MIDI is not supported in this browser. Try Chrome or Edge, or enable MIDI in Firefox.";
      this.deviceListEl.replaceChildren();
      return;
    }

    if (this.permissionError) {
      this.statusEl.textContent = this.permissionError;
    } else if (!this.access) {
      this.statusEl.textContent =
        "MIDI is off. Click Enable MIDI to connect a keyboard.";
    } else {
      const count = this.access.inputs.size;
      this.statusEl.textContent =
        count === 0
          ? "MIDI access granted. No input devices found — plug in a keyboard and hit Refresh."
          : `MIDI access granted. ${count} input${count === 1 ? "" : "s"} available.`;
    }

    this.deviceListEl.replaceChildren();

    if (!this.access) {
      return;
    }

    const inputs = [...this.access.inputs.values()].sort((left, right) =>
      (left.name ?? left.id).localeCompare(right.name ?? right.id),
    );

    if (inputs.length === 0) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-md border border-dashed border-slate-700 px-3 py-4 text-center text-[12px] text-slate-500";
      empty.textContent = "No MIDI inputs connected";
      this.deviceListEl.append(empty);
      return;
    }

    for (const input of inputs) {
      this.deviceListEl.append(this.createDeviceRow(input));
    }
  }

  dispose(): void {
    this.unbind();
    if (this.activityTimer !== null) {
      window.clearTimeout(this.activityTimer);
      this.activityTimer = null;
    }
    this.statusEl = null;
    this.deviceListEl = null;
    this.enableButton = null;
    this.activityEl = null;
    this.sectionSignal = null;
  }

  private async requestAccess(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.permissionError = "Web MIDI is not supported in this browser.";
      this.refreshPanel();
      return;
    }

    if (this.enableButton) {
      this.enableButton.disabled = true;
      this.enableButton.textContent = "Requesting…";
    }

    try {
      const access = await navigator.requestMIDIAccess();
      if (this.host.isAborted()) {
        return;
      }
      this.permissionError = null;
      this.attachAccess(access);
    } catch {
      this.permissionError =
        "MIDI permission was denied. Allow MIDI access in the browser, then try again.";
    }

    this.refreshPanel();
  }

  private attachAccess(access: MIDIAccess): void {
    if (this.access && this.access !== access) {
      this.access.onstatechange = null;
    }

    this.access = access;
    this.syncInputs();
    access.onstatechange = () => {
      this.syncInputs();
      this.refreshPanel();
    };
  }

  private unbind(): void {
    for (const input of this.boundInputs) {
      input.onmidimessage = null;
    }
    this.boundInputs.clear();

    if (this.access) {
      this.access.onstatechange = null;
      this.access = null;
    }
  }

  private isInputEnabled(inputId: string): boolean {
    return (
      this.enabledInputIds === null || this.enabledInputIds.has(inputId)
    );
  }

  private setInputEnabled(inputId: string, enabled: boolean): void {
    if (!this.access) {
      return;
    }

    if (this.enabledInputIds === null) {
      this.enabledInputIds = new Set([...this.access.inputs.keys()]);
    }

    if (enabled) {
      this.enabledInputIds.add(inputId);
    } else {
      this.enabledInputIds.delete(inputId);
    }

    saveMidiSettings({
      enabledInputIds: [...this.enabledInputIds],
    });
    this.syncInputs();
    this.refreshPanel();
  }

  private syncInputs(): void {
    if (!this.access) {
      return;
    }

    const activeInputs = new Set(this.access.inputs.values());
    for (const input of this.boundInputs) {
      if (!activeInputs.has(input) || !this.isInputEnabled(input.id)) {
        input.onmidimessage = null;
        this.boundInputs.delete(input);
      }
    }

    for (const input of activeInputs) {
      if (!this.isInputEnabled(input.id)) {
        continue;
      }
      if (this.boundInputs.has(input)) {
        continue;
      }

      input.onmidimessage = (event) => {
        this.handleMessage(event);
      };
      this.boundInputs.add(input);
    }
  }

  private createDeviceRow(input: MIDIInput): HTMLElement {
    const row = document.createElement("label");
    row.className =
      "flex cursor-pointer items-start gap-3 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2.5 hover:border-slate-700";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "mt-0.5 accent-emerald-400";
    checkbox.checked = this.isInputEnabled(input.id);
    checkbox.addEventListener(
      "change",
      () => {
        this.setInputEnabled(input.id, checkbox.checked);
      },
      this.sectionSignal ? { signal: this.sectionSignal } : undefined,
    );

    const text = document.createElement("div");
    text.className = "min-w-0 flex-1";

    const name = document.createElement("div");
    name.className = "truncate text-[13px] text-slate-200";
    name.textContent = input.name?.trim() || "MIDI keyboard";

    const meta = document.createElement("div");
    meta.className = "truncate text-[11px] text-slate-500";
    const manufacturer = input.manufacturer?.trim();
    meta.textContent = [manufacturer || null, input.state, input.connection]
      .filter(Boolean)
      .join(" · ");

    text.append(name, meta);
    row.append(checkbox, text);
    return row;
  }

  private flashActivity(): void {
    if (!this.activityEl) {
      return;
    }

    this.activityEl.textContent = "Note";
    this.activityEl.className =
      "rounded-full border border-emerald-700/70 bg-emerald-950/50 px-2 py-0.5 text-[10px] text-emerald-300";

    if (this.activityTimer !== null) {
      window.clearTimeout(this.activityTimer);
    }
    this.activityTimer = window.setTimeout(() => {
      this.activityTimer = null;
      if (!this.activityEl) {
        return;
      }
      this.activityEl.textContent = "Idle";
      this.activityEl.className =
        "rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500";
    }, 180);
  }

  private handleMessage(event: MIDIMessageEvent): void {
    if (!this.host.isKeyboardEnabled()) {
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

    this.flashActivity();

    const note = Math.min(
      127,
      Math.max(0, parsed.note + this.host.getTranspose()),
    );

    if (parsed.type === "noteOn") {
      this.host.noteOn(note);
      return;
    }

    this.host.noteOff(note);
  }
}
