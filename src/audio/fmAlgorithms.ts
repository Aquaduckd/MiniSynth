import type { FmAlgorithmId } from "../types.js";

export interface FmEdge {
  src: number;
  dest: number;
}

/** Yamaha DX9 / 4-op algorithm topologies (0-indexed operators). */
export interface FmAlgorithm {
  id: FmAlgorithmId;
  carriers: number[];
  edges: FmEdge[];
  /** Self-feedback operator (op 4 / index 3 on these charts). */
  feedbackOp: number;
}

/** Hz deviation at full modulator level ≈ this × carrier base frequency. */
export const FM_MOD_DEPTH_RATIO = 2;

export const FM_ALGORITHMS: Record<FmAlgorithmId, FmAlgorithm> = {
  1: {
    id: 1,
    carriers: [0],
    edges: [
      { src: 3, dest: 2 },
      { src: 2, dest: 1 },
      { src: 1, dest: 0 },
    ],
    feedbackOp: 3,
  },
  2: {
    id: 2,
    carriers: [0],
    edges: [
      { src: 2, dest: 1 },
      { src: 3, dest: 1 },
      { src: 1, dest: 0 },
    ],
    feedbackOp: 3,
  },
  3: {
    id: 3,
    carriers: [0],
    edges: [
      { src: 2, dest: 1 },
      { src: 1, dest: 0 },
      { src: 3, dest: 0 },
    ],
    feedbackOp: 3,
  },
  4: {
    id: 4,
    carriers: [0],
    edges: [
      { src: 3, dest: 2 },
      { src: 2, dest: 0 },
      { src: 1, dest: 0 },
    ],
    feedbackOp: 3,
  },
  5: {
    id: 5,
    carriers: [0, 2],
    edges: [
      { src: 1, dest: 0 },
      { src: 3, dest: 2 },
    ],
    feedbackOp: 3,
  },
  6: {
    id: 6,
    carriers: [0, 1, 2],
    edges: [
      { src: 3, dest: 0 },
      { src: 3, dest: 1 },
      { src: 3, dest: 2 },
    ],
    feedbackOp: 3,
  },
  7: {
    id: 7,
    carriers: [0, 1, 2],
    edges: [{ src: 3, dest: 2 }],
    feedbackOp: 3,
  },
  8: {
    id: 8,
    carriers: [0, 1, 2, 3],
    edges: [],
    feedbackOp: 3,
  },
};

export const FM_ALGORITHM_IDS: FmAlgorithmId[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function getFmAlgorithm(id: FmAlgorithmId): FmAlgorithm {
  return FM_ALGORITHMS[id];
}

export function isFmAlgorithmId(value: unknown): value is FmAlgorithmId {
  return (
    value === 1
    || value === 2
    || value === 3
    || value === 4
    || value === 5
    || value === 6
    || value === 7
    || value === 8
  );
}
