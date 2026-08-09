import { pitchClassName } from "./notes.js";

/**
 * Chord templates from richer/more specific shapes to simpler ones.
 * Incomplete voicings may only omit the fifth (see detectChordName).
 */
export const CHORD_TEMPLATES: { intervals: number[]; suffix: string }[] = [
  // 6-note
  { intervals: [0, 2, 3, 5, 7, 10], suffix: "m11" },
  { intervals: [0, 2, 4, 5, 7, 10], suffix: "11" },
  { intervals: [0, 2, 4, 5, 7, 11], suffix: "maj11" },

  // 5-note
  { intervals: [0, 2, 4, 7, 9], suffix: "6/9" },
  { intervals: [0, 2, 3, 7, 9], suffix: "m6/9" },
  { intervals: [0, 2, 4, 7, 11], suffix: "maj9" },
  { intervals: [0, 2, 3, 7, 10], suffix: "m9" },
  { intervals: [0, 2, 4, 7, 10], suffix: "9" },
  { intervals: [0, 1, 4, 7, 10], suffix: "7♭9" },
  { intervals: [0, 3, 4, 7, 10], suffix: "7♯9" },
  { intervals: [0, 2, 4, 6, 10], suffix: "9♭5" },
  { intervals: [0, 2, 4, 8, 10], suffix: "9♯5" },
  { intervals: [0, 4, 6, 7, 10], suffix: "7♯11" },
  { intervals: [0, 4, 6, 7, 11], suffix: "maj7♯11" },
  { intervals: [0, 2, 5, 7, 10], suffix: "9sus4" },
  { intervals: [0, 1, 3, 7, 10], suffix: "m7♭9" },
  { intervals: [0, 2, 3, 7, 11], suffix: "m9(maj7)" },
  { intervals: [0, 1, 4, 7, 11], suffix: "maj7♭9" },
  { intervals: [0, 2, 4, 6, 11], suffix: "maj9♭5" },
  { intervals: [0, 2, 4, 8, 11], suffix: "maj9♯5" },
  { intervals: [0, 3, 5, 7, 10], suffix: "m7add11" },

  // 4-note sevenths / sixths / adds
  { intervals: [0, 4, 7, 11], suffix: "maj7" },
  { intervals: [0, 3, 7, 11], suffix: "m(maj7)" },
  { intervals: [0, 3, 7, 10], suffix: "m7" },
  { intervals: [0, 3, 6, 10], suffix: "m7♭5" },
  { intervals: [0, 3, 6, 9], suffix: "dim7" },
  { intervals: [0, 4, 6, 10], suffix: "7♭5" },
  { intervals: [0, 4, 8, 10], suffix: "7♯5" },
  { intervals: [0, 4, 8, 11], suffix: "maj7♯5" },
  { intervals: [0, 4, 6, 11], suffix: "maj7♭5" },
  { intervals: [0, 4, 7, 10], suffix: "7" },
  { intervals: [0, 5, 7, 10], suffix: "7sus4" },
  { intervals: [0, 2, 7, 10], suffix: "7sus2" },
  { intervals: [0, 5, 7, 11], suffix: "maj7sus4" },
  { intervals: [0, 4, 7, 9], suffix: "6" },
  { intervals: [0, 3, 7, 9], suffix: "m6" },
  { intervals: [0, 3, 7, 8], suffix: "m♭6" },
  { intervals: [0, 4, 7, 8], suffix: "♭6" },
  { intervals: [0, 2, 4, 7], suffix: "add9" },
  { intervals: [0, 2, 3, 7], suffix: "madd9" },
  { intervals: [0, 4, 5, 7], suffix: "add4" },
  { intervals: [0, 3, 5, 7], suffix: "madd4" },
  { intervals: [0, 2, 5, 7], suffix: "sus2sus4" },
  { intervals: [0, 4, 6, 9], suffix: "6♭5" },
  { intervals: [0, 5, 7, 9], suffix: "6sus4" },
  { intervals: [0, 2, 7, 9], suffix: "6sus2" },
  { intervals: [0, 2, 7, 11], suffix: "maj7sus2" },
  { intervals: [0, 3, 5, 10], suffix: "m7add4" },
  { intervals: [0, 4, 5, 10], suffix: "7add4" },
  { intervals: [0, 1, 4, 7], suffix: "add♭9" },
  { intervals: [0, 3, 4, 7], suffix: "add♯9" },
  // Root + fifth + major 7 (no third), e.g. C G B.
  { intervals: [0, 7, 11], suffix: "5maj7" },
  { intervals: [0, 7, 10], suffix: "57" },

  // 3-note triads / sus
  { intervals: [0, 4, 7], suffix: "" },
  { intervals: [0, 3, 7], suffix: "m" },
  { intervals: [0, 3, 6], suffix: "dim" },
  { intervals: [0, 4, 8], suffix: "aug" },
  // After major so C+E still prefers C over C♭5 (omitted ♭5).
  { intervals: [0, 4, 6], suffix: "♭5" },
  { intervals: [0, 3, 8], suffix: "m♯5" },
  { intervals: [0, 2, 7], suffix: "sus2" },
  { intervals: [0, 5, 7], suffix: "sus4" },

  // 2-note
  { intervals: [0, 7], suffix: "5" },
];

/** Fifth tone that may be omitted from an otherwise complete chord shape. */
function chordOmitableFifth(intervals: number[]): number | null {
  if (intervals.includes(7)) {
    return 7;
  }
  if (intervals.includes(6)) {
    return 6;
  }
  if (intervals.includes(8)) {
    return 8;
  }
  return null;
}

const BASIC_TRIAD_SUFFIXES = new Set(["", "m", "dim", "aug"]);

export function detectChordName(notes: Iterable<number>): string {
  const midiNotes = [...new Set(notes)].sort((left, right) => left - right);
  if (midiNotes.length === 0) {
    return "";
  }

  if (midiNotes.length === 1) {
    return pitchClassName(midiNotes[0]);
  }

  const pitchClasses = [
    ...new Set(midiNotes.map((note) => ((note % 12) + 12) % 12)),
  ].sort((left, right) => left - right);

  if (pitchClasses.length === 1) {
    return pitchClassName(pitchClasses[0]);
  }

  const bassClass = ((midiNotes[0] % 12) + 12) % 12;
  let best: { root: number; suffix: string; score: number } | null = null;

  for (const root of pitchClasses) {
    const relative = new Set(
      pitchClasses.map((pitch) => (pitch - root + 12) % 12),
    );

    for (let index = 0; index < CHORD_TEMPLATES.length; index += 1) {
      const template = CHORD_TEMPLATES[index];
      const templateSet = new Set(template.intervals);

      // Every played tone must belong to the chord.
      let fits = true;
      for (const interval of relative) {
        if (!templateSet.has(interval)) {
          fits = false;
          break;
        }
      }
      if (!fits) {
        continue;
      }

      // Incomplete voicings may only drop the fifth (C+E → C), not the third
      // or seventh — otherwise C E F# spuriously matches F#m7♭5.
      // Also require a third so C+D does not become Csus2 (fifth omitted).
      const missingIntervals = template.intervals.filter(
        (interval) => !relative.has(interval),
      );
      if (missingIntervals.length > 0) {
        const omittable = chordOmitableFifth(template.intervals);
        const hasThird = relative.has(3) || relative.has(4);
        if (
          omittable === null
          || missingIntervals.length !== 1
          || missingIntervals[0] !== omittable
          || !hasThird
        ) {
          continue;
        }
      }

      const missing = missingIntervals.length;
      // Exact fits beat incomplete ones; basic triads beat exotic reinterpretations
      // of inversions (C F A → F, not C6sus4); bass root is only a tie-breaker.
      const score =
        -missing * 100_000
        + (BASIC_TRIAD_SUFFIXES.has(template.suffix) ? 5_000 : 0)
        + (root === bassClass ? 100 : 0)
        - index;
      if (!best || score > best.score) {
        best = { root, suffix: template.suffix, score };
      }
    }
  }

  if (!best) {
    return "Unknown";
  }

  return `${pitchClassName(best.root)}${best.suffix}`;
}
