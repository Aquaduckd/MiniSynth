import type { PianoRollStyle } from "../types.js";

const MIDI_SETTINGS_KEY = "minisynth.midi.v1";
const UI_SETTINGS_KEY = "minisynth.ui.v1";

export interface MidiSettings {
  /** null = listen on every connected input */
  enabledInputIds: string[] | null;
}

export interface UiSettings {
  pianoRollStyle: PianoRollStyle;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  pianoRollStyle: "compact",
};

export function loadMidiSettings(): MidiSettings {
  try {
    const raw = localStorage.getItem(MIDI_SETTINGS_KEY);
    if (!raw) {
      return { enabledInputIds: null };
    }

    const parsed = JSON.parse(raw) as Partial<MidiSettings>;
    if (parsed.enabledInputIds === null) {
      return { enabledInputIds: null };
    }
    if (
      Array.isArray(parsed.enabledInputIds)
      && parsed.enabledInputIds.every((id) => typeof id === "string")
    ) {
      return { enabledInputIds: parsed.enabledInputIds };
    }
  } catch {
    // ignore corrupt storage
  }

  return { enabledInputIds: null };
}

export function saveMidiSettings(settings: MidiSettings): void {
  localStorage.setItem(MIDI_SETTINGS_KEY, JSON.stringify(settings));
}

export function loadUiSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_UI_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    if (parsed.pianoRollStyle === "compact" || parsed.pianoRollStyle === "full88") {
      return { pianoRollStyle: parsed.pianoRollStyle };
    }
  } catch {
    // ignore corrupt storage
  }
  return { ...DEFAULT_UI_SETTINGS };
}

export function saveUiSettings(settings: UiSettings): void {
  localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}
