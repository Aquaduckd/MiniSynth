import {
  FM_ALGORITHM_IDS,
  getFmAlgorithm,
  type FmAlgorithm,
} from "../../../audio/fmAlgorithms.js";
import type { FmAlgorithmId, SynthParams } from "../../../types.js";

export interface FmConfigModalHost {
  getParams(): SynthParams;
  setParams(params: SynthParams): void;
  applyParamsToSynth(params: SynthParams): void;
  onVisualize(): void;
}

export class FmConfigModal {
  private modal: HTMLElement | null = null;
  private enableInput: HTMLInputElement | null = null;
  private readonly algorithmButtons = new Map<
    FmAlgorithmId,
    HTMLButtonElement
  >();

  constructor(
    private readonly host: FmConfigModalHost,
    private readonly signal: AbortSignal,
  ) {}

  open(): void {
    if (!this.modal) {
      this.modal = this.createModal();
      document.body.append(this.modal);
    }

    this.syncFromState();
    this.modal.classList.remove("hidden");
    this.modal.classList.add("flex");
  }

  close(): void {
    if (!this.modal) {
      return;
    }

    this.modal.classList.add("hidden");
    this.modal.classList.remove("flex");
  }

  syncFromState(): void {
    const params = this.host.getParams();
    if (this.enableInput) {
      this.enableInput.checked = params.fmEnabled;
    }
    for (const [id, button] of this.algorithmButtons) {
      const selected = id === params.fmAlgorithm;
      button.classList.toggle("border-emerald-500", selected);
      button.classList.toggle("bg-emerald-500/10", selected);
      button.classList.toggle("border-slate-700", !selected);
      button.classList.toggle("bg-slate-950", !selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  dispose(): void {
    this.modal?.remove();
    this.modal = null;
    this.enableInput = null;
    this.algorithmButtons.clear();
  }

  private createModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]";

    const dialog = document.createElement("div");
    dialog.className =
      "flex max-h-[min(40rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "OSC Config");

    const header = document.createElement("div");
    header.className =
      "flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3";

    const title = document.createElement("h2");
    title.className = "text-sm font-medium text-slate-100";
    title.textContent = "OSC Config";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className =
      "rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100";
    closeButton.textContent = "Close";
    closeButton.addEventListener(
      "click",
      () => {
        this.close();
      },
      { signal: this.signal },
    );

    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3";

    const enableSection = document.createElement("section");
    enableSection.className = "space-y-2";

    const enableHeading = document.createElement("h3");
    enableHeading.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    enableHeading.textContent = "FM Synthesis";

    const enableRow = document.createElement("label");
    enableRow.className =
      "flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2.5";

    const enableText = document.createElement("div");
    enableText.className = "space-y-0.5";

    const enableLabel = document.createElement("div");
    enableLabel.className = "text-[12px] text-slate-200";
    enableLabel.textContent = "Enable FM";

    const enableHint = document.createElement("div");
    enableHint.className = "text-[11px] leading-relaxed text-slate-500";
    enableHint.textContent =
      "Routes the existing oscillators as DX9 operators.";

    enableText.append(enableLabel, enableHint);

    this.enableInput = document.createElement("input");
    this.enableInput.type = "checkbox";
    this.enableInput.className =
      "h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-600";
    this.enableInput.addEventListener(
      "change",
      () => {
        const params = this.host.getParams();
        params.fmEnabled = Boolean(this.enableInput?.checked);
        this.host.setParams(params);
        this.host.applyParamsToSynth(params);
        this.host.onVisualize();
        this.syncFromState();
      },
      { signal: this.signal },
    );

    enableRow.append(enableText, this.enableInput);
    enableSection.append(enableHeading, enableRow);

    const algorithmSection = document.createElement("section");
    algorithmSection.className = "space-y-2";

    const algorithmHeading = document.createElement("h3");
    algorithmHeading.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    algorithmHeading.textContent = "DX9 Algorithm";

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-4 gap-2";

    for (const id of FM_ALGORITHM_IDS) {
      const algorithm = getFmAlgorithm(id);
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "flex flex-col items-center gap-1.5 overflow-visible rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-slate-300 hover:border-slate-500 hover:text-slate-100";
      button.setAttribute("aria-label", `Algorithm ${id}`);
      button.append(createAlgorithmDiagram(algorithm), createAlgoLabel(id));
      button.addEventListener(
        "click",
        () => {
          const params = this.host.getParams();
          params.fmAlgorithm = id;
          this.host.setParams(params);
          this.host.applyParamsToSynth(params);
          this.host.onVisualize();
          this.syncFromState();
        },
        { signal: this.signal },
      );
      this.algorithmButtons.set(id, button);
      grid.append(button);
    }

    algorithmSection.append(algorithmHeading, grid);
    body.append(enableSection, algorithmSection);
    dialog.append(header, body);
    overlay.append(dialog);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          this.close();
        }
      },
      { signal: this.signal },
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!this.modal || this.modal.classList.contains("hidden")) {
          return;
        }
        event.preventDefault();
        this.close();
      },
      { signal: this.signal },
    );

    return overlay;
  }
}

function createAlgoLabel(id: FmAlgorithmId): HTMLElement {
  const label = document.createElement("span");
  label.className = "text-[10px] font-medium text-slate-400";
  label.textContent = String(id);
  return label;
}

function createAlgorithmDiagram(algorithm: FmAlgorithm): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // Extra room so edge operators, gaps, and feedback loops aren't clipped.
  svg.setAttribute("viewBox", "-8 0 80 72");
  svg.setAttribute("width", "80");
  svg.setAttribute("height", "72");
  svg.classList.add("block", "shrink-0", "overflow-visible");

  const positions = layoutPositions(algorithm.id);
  const carrierSet = new Set(algorithm.carriers);

  for (const { src, dest } of algorithm.edges) {
    const from = positions[src];
    const to = positions[dest];
    if (!from || !to) {
      continue;
    }
    appendLine(svg, from.x, from.y + 7, to.x, to.y - 7);
  }

  const fb = positions[algorithm.feedbackOp];
  if (fb) {
    appendFeedback(svg, fb.x, fb.y);
  }

  for (let op = 0; op < 4; op += 1) {
    const pos = positions[op];
    if (!pos) {
      continue;
    }
    appendOperator(svg, pos.x, pos.y, "ABCD"[op] ?? String(op + 1), carrierSet.has(op));
  }

  const bottoms = algorithm.carriers
    .map((op) => positions[op])
    .filter((pos): pos is { x: number; y: number } => Boolean(pos));
  if (bottoms.length > 0) {
    const minY = Math.max(...bottoms.map((pos) => pos.y));
    const row = bottoms.filter((pos) => pos.y === minY);
    const xs = row.map((pos) => pos.x).sort((a, b) => a - b);
    const outX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const opBottom = minY + 6;
    const busY = opBottom + 4;

    if (xs.length > 1) {
      for (const x of xs) {
        appendLine(svg, x, opBottom, x, busY);
      }
      appendLine(svg, xs[0], busY, xs[xs.length - 1], busY);
      appendOutputArrow(svg, outX, busY);
    } else {
      appendOutputArrow(svg, outX, opBottom);
    }
  }

  return svg;
}

function layoutPositions(
  id: FmAlgorithmId,
): Array<{ x: number; y: number } | null> {
  switch (id) {
    case 1:
      // Vertical stack — 16px centers leave a clear gap between 12px ops.
      return [
        { x: 32, y: 56 },
        { x: 32, y: 40 },
        { x: 32, y: 24 },
        { x: 32, y: 8 },
      ];
    case 2:
      return [
        { x: 32, y: 52 },
        { x: 32, y: 34 },
        { x: 18, y: 14 },
        { x: 46, y: 14 },
      ];
    case 3:
      return [
        { x: 32, y: 52 },
        { x: 18, y: 32 },
        { x: 18, y: 14 },
        { x: 46, y: 32 },
      ];
    case 4:
      return [
        { x: 32, y: 52 },
        { x: 18, y: 32 },
        { x: 46, y: 32 },
        { x: 46, y: 14 },
      ];
    case 5:
      return [
        { x: 20, y: 46 },
        { x: 20, y: 20 },
        { x: 44, y: 46 },
        { x: 44, y: 20 },
      ];
    case 6:
      return [
        { x: 16, y: 46 },
        { x: 32, y: 46 },
        { x: 48, y: 46 },
        { x: 32, y: 18 },
      ];
    case 7:
      return [
        { x: 16, y: 46 },
        { x: 32, y: 46 },
        { x: 48, y: 46 },
        { x: 48, y: 20 },
      ];
    case 8:
      // Horizontal row centered in viewBox (center x = 32).
      return [
        { x: 8, y: 36 },
        { x: 24, y: 36 },
        { x: 40, y: 36 },
        { x: 56, y: 36 },
      ];
  }
}

function appendOperator(
  svg: SVGSVGElement,
  x: number,
  y: number,
  label: string,
  carrier: boolean,
): void {
  const size = 12;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x - size / 2));
  rect.setAttribute("y", String(y - size / 2));
  rect.setAttribute("width", String(size));
  rect.setAttribute("height", String(size));
  rect.setAttribute("rx", "1.5");
  rect.setAttribute("fill", carrier ? "#64748b" : "#0f172a");
  rect.setAttribute("stroke", "#94a3b8");
  rect.setAttribute("stroke-width", "1");
  svg.append(rect);

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y + 3.2));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "8");
  text.setAttribute("font-family", "system-ui, sans-serif");
  text.setAttribute("font-weight", "600");
  text.setAttribute("fill", carrier ? "#0f172a" : "#e2e8f0");
  text.textContent = label;
  svg.append(text);
}

function appendLine(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", "#64748b");
  line.setAttribute("stroke-width", "1.25");
  svg.append(line);
}

function appendFeedback(svg: SVGSVGElement, x: number, y: number): void {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    `M ${x + 6} ${y - 2} C ${x + 14} ${y - 10}, ${x + 14} ${y + 10}, ${x + 6} ${y + 2}`,
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#64748b");
  path.setAttribute("stroke-width", "1.25");
  svg.append(path);
}

function appendOutputArrow(svg: SVGSVGElement, x: number, y: number): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x));
  line.setAttribute("y1", String(y));
  line.setAttribute("x2", String(x));
  line.setAttribute("y2", String(y + 8));
  line.setAttribute("stroke", "#64748b");
  line.setAttribute("stroke-width", "1.25");
  svg.append(line);

  const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
  head.setAttribute(
    "d",
    `M ${x - 3} ${y + 6} L ${x} ${y + 10} L ${x + 3} ${y + 6}`,
  );
  head.setAttribute("fill", "none");
  head.setAttribute("stroke", "#64748b");
  head.setAttribute("stroke-width", "1.25");
  svg.append(head);
}
