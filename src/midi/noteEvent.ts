export function parseMidiNoteEvent(
  data: Uint8Array,
): { type: "noteOn" | "noteOff"; note: number } | null {
  const status = data[0] & 0xf0;
  const note = data[1];
  const velocity = data[2] ?? 0;

  if (note > 127) {
    return null;
  }

  if (status === 0x90) {
    if (velocity === 0) {
      return { type: "noteOff", note };
    }
    return { type: "noteOn", note };
  }

  if (status === 0x80) {
    return { type: "noteOff", note };
  }

  return null;
}
