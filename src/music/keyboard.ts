import type { KeyLayout, PianoRollStyle } from "../types.js";
import { midiNoteLabel } from "./notes.js";

export const MIN_OCTAVE = 0;
export const MAX_OCTAVE = 7;
export const DEFAULT_OCTAVE = 4;
export const MIN_TRANSPOSE = -11;
export const MAX_TRANSPOSE = 11;
export const DEFAULT_TRANSPOSE = 0;
const MAIN_WHITE_COUNT = 7;
const EXT_WHITE_COUNT = 4;
export const TOTAL_WHITE_COUNT = MAIN_WHITE_COUNT + EXT_WHITE_COUNT;

export const KEY_LAYOUT: KeyLayout[] = [
  { semitone: 0, label: "C", keyCode: "KeyA", white: true, whiteIndex: 0, tier: "main" },
  { semitone: 1, label: "C#", keyCode: "KeyW", white: false, tier: "main" },
  { semitone: 2, label: "D", keyCode: "KeyS", white: true, whiteIndex: 1, tier: "main" },
  { semitone: 3, label: "D#", keyCode: "KeyE", white: false, tier: "main" },
  { semitone: 4, label: "E", keyCode: "KeyD", white: true, whiteIndex: 2, tier: "main" },
  { semitone: 5, label: "F", keyCode: "KeyF", white: true, whiteIndex: 3, tier: "main" },
  { semitone: 6, label: "F#", keyCode: "KeyT", white: false, tier: "main" },
  { semitone: 7, label: "G", keyCode: "KeyG", white: true, whiteIndex: 4, tier: "main" },
  { semitone: 8, label: "G#", keyCode: "KeyY", white: false, tier: "main" },
  { semitone: 9, label: "A", keyCode: "KeyH", white: true, whiteIndex: 5, tier: "main" },
  { semitone: 10, label: "A#", keyCode: "KeyU", white: false, tier: "main" },
  { semitone: 11, label: "B", keyCode: "KeyJ", white: true, whiteIndex: 6, tier: "main" },
  { semitone: 12, label: "C", keyCode: "KeyK", white: true, whiteIndex: 7, tier: "upper" },
  { semitone: 13, label: "C#", keyCode: "KeyO", white: false, tier: "upper" },
  { semitone: 14, label: "D", keyCode: "KeyL", white: true, whiteIndex: 8, tier: "upper" },
  { semitone: 15, label: "D#", keyCode: "KeyP", white: false, tier: "upper" },
  { semitone: 16, label: "E", keyCode: "Semicolon", white: true, whiteIndex: 9, tier: "upper" },
  { semitone: 17, label: "F", keyCode: "Quote", white: true, whiteIndex: 10, tier: "upper" },
];

const FULL88_MIDI_MIN = 21;
const FULL88_MIDI_MAX = 108;

export const PIANO_ROLL_STYLE_OPTIONS: { value: PianoRollStyle; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "full88", label: "Full 88-key" },
];

export function isPianoWhiteNote(note: number): boolean {
  const pitch = ((note % 12) + 12) % 12;
  return pitch !== 1 && pitch !== 3 && pitch !== 6 && pitch !== 8 && pitch !== 10;
}

/** Firefox Quick Find: `/` searches text, `'` searches links. */
export const BROWSER_FIND_KEY_CODES = new Set(["Quote"]);

export const KEY_PRESSED_CLASSES = [
  "!bg-teal-400",
  "!border-teal-500",
  "!text-slate-900",
] as const;

export function keyCodeLabel(keyCode: string): string {
  if (keyCode === "Semicolon") {
    return ";";
  }
  if (keyCode === "Quote") {
    return "'";
  }
  return keyCode.startsWith("Key") ? keyCode.slice(3) : keyCode;
}

function buildFull88Layout(): KeyLayout[] {
  const layouts: KeyLayout[] = [];
  let whiteIndex = 0;
  for (let midiNote = FULL88_MIDI_MIN; midiNote <= FULL88_MIDI_MAX; midiNote += 1) {
    const white = isPianoWhiteNote(midiNote);
    layouts.push({
      semitone: midiNote - FULL88_MIDI_MIN,
      midiNote,
      label: midiNoteLabel(midiNote),
      white,
      whiteIndex: white ? whiteIndex : undefined,
      tier: "main",
    });
    if (white) {
      whiteIndex += 1;
    }
  }
  return layouts;
}

export const FULL88_LAYOUT: KeyLayout[] = buildFull88Layout();
export const FULL88_WHITE_COUNT = FULL88_LAYOUT.filter((item) => item.white).length;
