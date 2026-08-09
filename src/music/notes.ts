export const PITCH_CLASS_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export function midiNoteLabel(note: number): string {
  const pitch = ((note % 12) + 12) % 12;
  const octave = Math.floor(note / 12) - 1;
  return `${PITCH_CLASS_NAMES[pitch]}${octave}`;
}

export function pitchClassName(pitchClass: number): string {
  return PITCH_CLASS_NAMES[((pitchClass % 12) + 12) % 12];
}

export function baseMidiForOctave(octave: number): number {
  return 12 * (octave + 1);
}

export function noteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}
