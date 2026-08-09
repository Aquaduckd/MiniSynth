import { parseMidiFile, type MidiSong } from "../midiFile.js";

const MIDI_FILE_SKIP_SECONDS = 5;

const PLAY_BUTTON_CLASS =
  "shrink-0 rounded border border-emerald-700/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";
const STOP_BUTTON_CLASS =
  "shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";
const BAR_BUTTON_CLASS =
  "shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

function formatMidiClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export interface MidiFilePlayerHost {
  getTranspose(): number;
  ensureAudioRunning(): Promise<void>;
  isAborted(): boolean;
  /** Synchronous note on — file scheduler cannot await. */
  noteOn(note: number): void;
  noteOff(note: number): void;
  onTick(): void;
}

export class MidiFilePlayer {
  private song: MidiSong | null = null;
  private playing = false;
  private eventIndex = 0;
  private originMs = 0;
  private cursorSeconds = 0;
  private timer: number | null = null;
  private readonly holdCounts = new Map<number, number>();

  private statusEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private playStopButton: HTMLButtonElement | null = null;
  private backButton: HTMLButtonElement | null = null;
  private forwardButton: HTMLButtonElement | null = null;
  private fileInput: HTMLInputElement | null = null;

  constructor(private readonly host: MidiFilePlayerHost) {}

  isHolding(note: number): boolean {
    return this.holdCounts.has(note);
  }

  createControls(signal: AbortSignal): {
    transport: HTMLElement;
    status: HTMLElement;
  } {
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".mid,.midi,audio/midi,audio/x-midi";
    this.fileInput.className = "hidden";
    this.fileInput.addEventListener(
      "change",
      () => {
        const file = this.fileInput?.files?.[0];
        if (this.fileInput) {
          this.fileInput.value = "";
        }
        if (file) {
          void this.load(file);
        }
      },
      { signal },
    );

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = BAR_BUTTON_CLASS;
    loadButton.textContent = "Load";
    loadButton.title = "Load MIDI file";
    loadButton.addEventListener(
      "click",
      () => {
        this.fileInput?.click();
      },
      { signal },
    );

    this.backButton = document.createElement("button");
    this.backButton.type = "button";
    this.backButton.className = BAR_BUTTON_CLASS;
    this.backButton.textContent = "«";
    this.backButton.title = `Skip back ${MIDI_FILE_SKIP_SECONDS}s`;
    this.backButton.addEventListener(
      "click",
      () => {
        this.skip(-MIDI_FILE_SKIP_SECONDS);
      },
      { signal },
    );

    this.playStopButton = document.createElement("button");
    this.playStopButton.type = "button";
    this.playStopButton.className = PLAY_BUTTON_CLASS;
    this.playStopButton.textContent = "Play";
    this.playStopButton.title = "Play MIDI file";
    this.playStopButton.addEventListener(
      "click",
      () => {
        if (this.playing) {
          this.stop();
        } else {
          void this.play();
        }
      },
      { signal },
    );

    this.forwardButton = document.createElement("button");
    this.forwardButton.type = "button";
    this.forwardButton.className = BAR_BUTTON_CLASS;
    this.forwardButton.textContent = "»";
    this.forwardButton.title = `Skip forward ${MIDI_FILE_SKIP_SECONDS}s`;
    this.forwardButton.addEventListener(
      "click",
      () => {
        this.skip(MIDI_FILE_SKIP_SECONDS);
      },
      { signal },
    );

    this.timeEl = document.createElement("span");
    this.timeEl.className =
      "shrink-0 font-mono text-[10px] tabular-nums text-slate-400";
    this.timeEl.textContent = "0:00 / 0:00";
    this.timeEl.setAttribute("aria-label", "MIDI playback time");

    this.statusEl = document.createElement("span");
    this.statusEl.className =
      "min-w-0 truncate text-right font-mono text-[10px] text-slate-500";

    const transport = document.createElement("div");
    transport.className = "flex min-w-0 items-center gap-1.5";
    transport.append(
      loadButton,
      this.playStopButton,
      this.backButton,
      this.forwardButton,
      this.timeEl,
      this.fileInput,
    );

    this.refreshPanel();
    return { transport, status: this.statusEl };
  }

  stop(): void {
    const wasPlaying = this.playing;
    this.playing = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    this.clearHeldNotes();
    this.eventIndex = 0;
    this.cursorSeconds = 0;

    if (wasPlaying || this.song) {
      this.refreshPanel();
    }
  }

  dispose(): void {
    this.stop();
    this.statusEl = null;
    this.timeEl = null;
    this.playStopButton = null;
    this.backButton = null;
    this.forwardButton = null;
    this.fileInput = null;
  }

  private refreshPanel(): void {
    const hasSong = this.song !== null;
    if (this.playStopButton) {
      this.playStopButton.disabled = !hasSong;
      this.playStopButton.textContent = this.playing ? "Stop" : "Play";
      this.playStopButton.title = this.playing
        ? "Stop MIDI file"
        : "Play MIDI file";
      this.playStopButton.className = this.playing
        ? STOP_BUTTON_CLASS
        : PLAY_BUTTON_CLASS;
    }
    if (this.backButton) {
      this.backButton.disabled = !hasSong;
    }
    if (this.forwardButton) {
      this.forwardButton.disabled = !hasSong;
    }
    if (this.statusEl) {
      this.statusEl.textContent = this.song ? this.song.name : "No MIDI file";
    }
    this.refreshTime();
  }

  private refreshTime(): void {
    if (!this.timeEl) {
      return;
    }
    if (!this.song) {
      this.timeEl.textContent = "0:00 / 0:00";
      return;
    }
    const current = Math.min(this.song.duration, this.playbackTime());
    this.timeEl.textContent = `${formatMidiClock(current)} / ${formatMidiClock(this.song.duration)}`;
  }

  private async load(file: File): Promise<void> {
    this.stop();
    try {
      const buffer = await file.arrayBuffer();
      this.song = parseMidiFile(buffer, file.name);
      if (this.song.events.length === 0) {
        this.song = null;
        this.refreshPanel();
        if (this.statusEl) {
          this.statusEl.textContent = "No playable notes";
        }
        return;
      }
    } catch (error) {
      this.song = null;
      this.refreshPanel();
      if (this.statusEl) {
        this.statusEl.textContent =
          error instanceof Error ? error.message : "Could not read MIDI file";
      }
      return;
    }

    this.cursorSeconds = 0;
    this.refreshPanel();
  }

  private playbackTime(): number {
    if (!this.song) {
      return 0;
    }
    if (this.playing) {
      return Math.max(0, (performance.now() - this.originMs) / 1000);
    }
    return this.cursorSeconds;
  }

  private findEventIndex(timeSeconds: number): number {
    if (!this.song) {
      return 0;
    }
    const events = this.song.events;
    let index = 0;
    while (index < events.length && events[index].time < timeSeconds) {
      index += 1;
    }
    return index;
  }

  private activeNotesAt(timeSeconds: number): Map<number, number> {
    const active = new Map<number, number>();
    if (!this.song) {
      return active;
    }

    for (const event of this.song.events) {
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

  private clearHeldNotes(): void {
    for (const note of [...this.holdCounts.keys()]) {
      this.releaseNote(note, true);
    }
    this.holdCounts.clear();
  }

  private applyPosition(timeSeconds: number, resumeHolds: boolean): void {
    if (!this.song) {
      return;
    }

    const duration = this.song.duration;
    const target = Math.min(duration, Math.max(0, timeSeconds));
    this.clearHeldNotes();
    this.eventIndex = this.findEventIndex(target);
    this.cursorSeconds = target;
    this.originMs = performance.now() - target * 1000;

    if (!resumeHolds) {
      return;
    }

    const transpose = this.host.getTranspose();
    for (const [rawNote, count] of this.activeNotesAt(target)) {
      const note = Math.min(127, Math.max(0, rawNote + transpose));
      this.holdCounts.set(note, count);
      this.host.noteOn(note);
    }
  }

  private skip(deltaSeconds: number): void {
    if (!this.song) {
      return;
    }

    const target = this.playbackTime() + deltaSeconds;
    if (this.playing) {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }

      if (target >= this.song.duration) {
        this.playing = false;
        this.clearHeldNotes();
        this.eventIndex = this.song.events.length;
        this.cursorSeconds = 0;
        this.refreshPanel();
        return;
      }

      this.applyPosition(target, true);
      this.refreshPanel();
      this.pumpScheduler();
      return;
    }

    this.applyPosition(target, false);
    this.refreshPanel();
  }

  private async play(): Promise<void> {
    if (!this.song || this.playing) {
      return;
    }

    await this.host.ensureAudioRunning();
    if (!this.song || this.host.isAborted()) {
      return;
    }

    if (this.cursorSeconds >= this.song.duration) {
      this.cursorSeconds = 0;
    }

    this.playing = true;
    this.applyPosition(this.cursorSeconds, true);
    this.refreshPanel();
    this.pumpScheduler();
  }

  private pumpScheduler(): void {
    if (!this.playing || !this.song) {
      return;
    }

    const elapsed = (performance.now() - this.originMs) / 1000;
    const horizon = elapsed + 0.08;
    const events = this.song.events;
    const transpose = this.host.getTranspose();

    while (
      this.eventIndex < events.length
      && events[this.eventIndex].time <= horizon
    ) {
      const event = events[this.eventIndex];
      this.eventIndex += 1;
      const note = Math.min(127, Math.max(0, event.note + transpose));
      if (event.type === "noteOn") {
        this.acquireNote(note);
      } else {
        this.releaseNote(note);
      }
    }

    if (this.eventIndex >= events.length) {
      this.playing = false;
      this.timer = null;
      this.clearHeldNotes();
      this.cursorSeconds = 0;
      this.refreshPanel();
      return;
    }

    this.refreshTime();
    this.host.onTick();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.pumpScheduler();
    }, 20);
  }

  private acquireNote(note: number): void {
    const count = (this.holdCounts.get(note) ?? 0) + 1;
    this.holdCounts.set(note, count);
    if (count !== 1) {
      return;
    }
    this.host.noteOn(note);
  }

  private releaseNote(note: number, force = false): void {
    if (force) {
      this.holdCounts.delete(note);
      this.host.noteOff(note);
      return;
    }

    const count = (this.holdCounts.get(note) ?? 0) - 1;
    if (count <= 0) {
      this.holdCounts.delete(note);
      this.host.noteOff(note);
      return;
    }

    this.holdCounts.set(note, count);
  }
}
