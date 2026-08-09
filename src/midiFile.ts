/** Minimal Standard MIDI File parser for note playback. */

export interface MidiSongEvent {
  time: number;
  type: "noteOn" | "noteOff";
  note: number;
}

export interface MidiSong {
  name: string;
  duration: number;
  events: MidiSongEvent[];
  tempoBpm: number;
}

class MidiReader {
  private offset = 0;

  constructor(private readonly view: DataView) {}

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  readBytes(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.view.byteLength) {
      throw new Error("Unexpected end of MIDI file");
    }
    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.offset,
      length,
    );
    this.offset += length;
    return bytes;
  }

  peekU8(): number {
    if (this.offset >= this.view.byteLength) {
      throw new Error("Unexpected end of MIDI file");
    }
    return this.view.getUint8(this.offset);
  }

  readU8(): number {
    const value = this.peekU8();
    this.offset += 1;
    return value;
  }

  readU16(): number {
    if (this.offset + 2 > this.view.byteLength) {
      throw new Error("Unexpected end of MIDI file");
    }
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  readU32(): number {
    if (this.offset + 4 > this.view.byteLength) {
      throw new Error("Unexpected end of MIDI file");
    }
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  readVarLen(): number {
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      const byte = this.readU8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        break;
      }
    }
    return value >>> 0;
  }

  expectChunk(type: string): number {
    const id = String.fromCharCode(...this.readBytes(4));
    if (id !== type) {
      throw new Error(`Expected ${type} chunk, found ${id}`);
    }
    return this.readU32();
  }
}

interface TempoEvent {
  tick: number;
  microsecondsPerBeat: number;
}

interface RawNoteEvent {
  tick: number;
  type: "noteOn" | "noteOff";
  note: number;
}

function ticksToSeconds(
  tick: number,
  ticksPerQuarter: number,
  tempoMap: TempoEvent[],
): number {
  let seconds = 0;
  let currentTick = 0;
  let tempo = 500_000;

  for (const event of tempoMap) {
    if (event.tick >= tick) {
      break;
    }
    const delta = event.tick - currentTick;
    seconds += (delta * tempo) / ticksPerQuarter / 1_000_000;
    currentTick = event.tick;
    tempo = event.microsecondsPerBeat;
  }

  seconds += ((tick - currentTick) * tempo) / ticksPerQuarter / 1_000_000;
  return seconds;
}

function parseTrack(
  data: Uint8Array,
  tempoMap: TempoEvent[],
  noteEvents: RawNoteEvent[],
): void {
  const reader = new MidiReader(
    new DataView(data.buffer, data.byteOffset, data.byteLength),
  );
  let tick = 0;
  let runningStatus = 0;

  while (reader.remaining > 0) {
    tick += reader.readVarLen();

    let status: number;
    const next = reader.peekU8();
    if (next < 0x80) {
      if (runningStatus < 0x80) {
        throw new Error("Invalid running status in MIDI track");
      }
      status = runningStatus;
    } else {
      status = reader.readU8();
      // Only channel messages (8x-Ex) update running status. Meta/SysEx clear it.
      if (status >= 0x80 && status <= 0xef) {
        runningStatus = status;
      } else {
        runningStatus = 0;
      }
    }

    if (status === 0xff) {
      const metaType = reader.readU8();
      const length = reader.readVarLen();
      const metaData = reader.readBytes(length);
      if (metaType === 0x51 && metaData.length >= 3) {
        const microsecondsPerBeat =
          (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
        tempoMap.push({ tick, microsecondsPerBeat });
      }
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const length = reader.readVarLen();
      reader.readBytes(length);
      continue;
    }

    // Real-time single-byte messages (should be rare in files).
    if (status >= 0xf8) {
      continue;
    }

    // Other system common messages with fixed sizes.
    if (status === 0xf1 || status === 0xf3) {
      reader.readU8();
      continue;
    }
    if (status === 0xf2) {
      reader.readU8();
      reader.readU8();
      continue;
    }
    if (status >= 0xf4 && status <= 0xf7) {
      continue;
    }

    const type = status & 0xf0;

    if (type === 0x80 || type === 0x90) {
      const note = reader.readU8() & 0x7f;
      const velocity = reader.readU8() & 0x7f;
      if (type === 0x80 || velocity === 0) {
        noteEvents.push({ tick, type: "noteOff", note });
      } else {
        noteEvents.push({ tick, type: "noteOn", note });
      }
      continue;
    }

    if (type === 0xc0 || type === 0xd0) {
      reader.readU8();
      continue;
    }

    if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
      reader.readU8();
      reader.readU8();
      continue;
    }

    throw new Error(`Unsupported MIDI status byte 0x${status.toString(16)}`);
  }
}

export function parseMidiFile(buffer: ArrayBuffer, name: string): MidiSong {
  const reader = new MidiReader(new DataView(buffer));
  const headerLength = reader.expectChunk("MThd");
  if (headerLength < 6) {
    throw new Error("Invalid MIDI header");
  }

  reader.readU16(); // format
  const trackCount = reader.readU16();
  const division = reader.readU16();
  if ((division & 0x8000) !== 0) {
    throw new Error("SMPTE MIDI timing is not supported");
  }
  const ticksPerQuarter = division || 96;

  if (headerLength > 6) {
    reader.readBytes(headerLength - 6);
  }

  const tempoMap: TempoEvent[] = [{ tick: 0, microsecondsPerBeat: 500_000 }];
  const noteEvents: RawNoteEvent[] = [];

  for (let track = 0; track < trackCount; track += 1) {
    if (reader.remaining < 8) {
      break;
    }
    const trackLength = reader.expectChunk("MTrk");
    const trackData = reader.readBytes(trackLength);
    parseTrack(trackData, tempoMap, noteEvents);
  }

  tempoMap.sort((left, right) => left.tick - right.tick);
  // Collapse duplicate tempos at the same tick; keep the last.
  const compactTempo: TempoEvent[] = [];
  for (const event of tempoMap) {
    const last = compactTempo[compactTempo.length - 1];
    if (last && last.tick === event.tick) {
      last.microsecondsPerBeat = event.microsecondsPerBeat;
    } else {
      compactTempo.push({ ...event });
    }
  }

  const events: MidiSongEvent[] = noteEvents
    .map((event) => ({
      time: ticksToSeconds(event.tick, ticksPerQuarter, compactTempo),
      type: event.type,
      note: event.note,
    }))
    .sort((left, right) => {
      if (left.time !== right.time) {
        return left.time - right.time;
      }
      if (left.type !== right.type) {
        return left.type === "noteOff" ? -1 : 1;
      }
      return left.note - right.note;
    });

  const duration = events.length > 0 ? events[events.length - 1].time : 0;
  const tempoBpm = Math.round(
    60_000_000 / compactTempo[0].microsecondsPerBeat,
  );

  return {
    name,
    duration,
    events,
    tempoBpm,
  };
}
