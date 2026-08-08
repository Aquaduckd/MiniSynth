interface Navigator {
  requestMIDIAccess?(options?: MIDIOptions): Promise<MIDIAccess>;
}

interface MIDIOptions {
  sysex?: boolean;
  software?: boolean;
}

interface MIDIAccess extends EventTarget {
  readonly inputs: MIDIInputMap;
  readonly outputs: MIDIOutputMap;
  onstatechange: ((this: MIDIAccess, ev: MIDIConnectionEvent) => void) | null;
}

type MIDIInputMap = ReadonlyMap<string, MIDIInput>;
type MIDIOutputMap = ReadonlyMap<string, MIDIOutput>;

interface MIDIPort extends EventTarget {
  readonly id: string;
  readonly manufacturer: string | null;
  readonly name: string | null;
  readonly type: "input" | "output";
  readonly state: "connected" | "disconnected";
  readonly connection: "open" | "closed" | "pending";
}

interface MIDIInput extends MIDIPort {
  onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => void) | null;
}

interface MIDIOutput extends MIDIPort {
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array | null;
}

interface MIDIConnectionEvent extends Event {
  readonly port: MIDIPort | null;
}
