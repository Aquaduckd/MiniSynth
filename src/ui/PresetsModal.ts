import { cloneEffects, cloneParams } from "../constants.js";
import {
  BUILT_IN_PRESETS,
  loadUserPresets,
  normalizeStoredPreset,
  saveUserPresets,
} from "../storage/presets.js";
import type { EffectsParams, SynthParams, SynthPreset } from "../types.js";

export interface PresetsModalHost {
  getParams(): SynthParams;
  getEffects(): EffectsParams;
  /** Apply sound state only (params/effects/synth/controls). Modal sets active id. */
  applySound(preset: SynthPreset): void;
}

export class PresetsModal {
  private userPresets: SynthPreset[] = loadUserPresets();
  private modal: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private nameInput: HTMLInputElement | null = null;
  private statusEl: HTMLElement | null = null;
  private activePresetId: string | null = "init";

  constructor(
    private readonly host: PresetsModalHost,
    private readonly signal: AbortSignal,
  ) {}

  open(): void {
    if (!this.modal) {
      this.modal = this.createModal();
      document.body.append(this.modal);
    }

    this.statusEl && (this.statusEl.textContent = "");
    this.refreshList();
    this.modal.classList.remove("hidden");
    this.modal.classList.add("flex");
    this.nameInput?.focus();
    this.nameInput?.select();
  }

  close(): void {
    if (!this.modal) {
      return;
    }

    this.modal.classList.add("hidden");
    this.modal.classList.remove("flex");
  }

  setActiveId(id: string | null): void {
    this.activePresetId = id;
    this.refreshList();
  }

  dispose(): void {
    this.modal?.remove();
    this.modal = null;
    this.listEl = null;
    this.nameInput = null;
    this.statusEl = null;
  }

  private createModal(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]";

    const dialog = document.createElement("div");
    dialog.className =
      "flex max-h-[min(36rem,90vh)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Presets");

    const header = document.createElement("div");
    header.className =
      "flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3";

    const title = document.createElement("h2");
    title.className = "text-sm font-medium text-slate-100";
    title.textContent = "Presets";

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

    this.listEl = document.createElement("div");
    this.listEl.className = "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3";

    const saveSection = document.createElement("div");
    saveSection.className =
      "shrink-0 space-y-2 border-t border-slate-800 px-4 py-3";

    const saveLabel = document.createElement("div");
    saveLabel.className = "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    saveLabel.textContent = "Save current";

    const saveRow = document.createElement("div");
    saveRow.className = "flex gap-2";

    this.nameInput = document.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.maxLength = 48;
    this.nameInput.placeholder = "Preset name";
    this.nameInput.className =
      "min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-500";
    this.nameInput.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.saveCurrentPreset();
        }
      },
      { signal: this.signal },
    );

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className =
      "shrink-0 rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 hover:text-emerald-200";
    saveButton.textContent = "Save";
    saveButton.addEventListener(
      "click",
      () => {
        this.saveCurrentPreset();
      },
      { signal: this.signal },
    );

    const exportCurrentButton = document.createElement("button");
    exportCurrentButton.type = "button";
    exportCurrentButton.className =
      "shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    exportCurrentButton.textContent = "Export";
    exportCurrentButton.title = "Export the current patch as a file";
    exportCurrentButton.addEventListener(
      "click",
      () => {
        this.exportCurrentPreset();
      },
      { signal: this.signal },
    );

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className =
      "shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100";
    importButton.textContent = "Import";
    importButton.title = "Import a preset file";

    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.className = "hidden";
    importInput.addEventListener(
      "change",
      () => {
        const file = importInput.files?.[0];
        importInput.value = "";
        if (file) {
          void this.importPresetFile(file);
        }
      },
      { signal: this.signal },
    );

    importButton.addEventListener(
      "click",
      () => {
        importInput.click();
      },
      { signal: this.signal },
    );

    saveRow.append(
      this.nameInput,
      saveButton,
      exportCurrentButton,
      importButton,
      importInput,
    );

    this.statusEl = document.createElement("div");
    this.statusEl.className = "min-h-[1rem] text-[11px] text-slate-500";

    saveSection.append(saveLabel, saveRow, this.statusEl);
    dialog.append(header, this.listEl, saveSection);
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

  private refreshList(): void {
    if (!this.listEl) {
      return;
    }

    this.listEl.replaceChildren();

    const factorySection = this.createSection("Factory", BUILT_IN_PRESETS, false);
    const userSection = this.createSection("Saved", this.userPresets, true);
    this.listEl.append(factorySection, userSection);
  }

  private createSection(
    title: string,
    presets: SynthPreset[],
    allowDelete: boolean,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "space-y-2";

    const heading = document.createElement("div");
    heading.className =
      "text-[11px] font-medium uppercase tracking-wide text-slate-500";
    heading.textContent = title;
    section.append(heading);

    if (presets.length === 0) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-md border border-dashed border-slate-800 px-3 py-4 text-center text-[12px] text-slate-500";
      empty.textContent = "No saved presets yet";
      section.append(empty);
      return section;
    }

    const list = document.createElement("div");
    list.className = "space-y-1";

    for (const preset of presets) {
      const row = document.createElement("div");
      row.className =
        "flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5";

      if (preset.id === this.activePresetId) {
        row.classList.add("border-emerald-700/60", "bg-emerald-950/20");
      }

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className =
        "min-w-0 flex-1 truncate text-left text-sm text-slate-200 hover:text-white";
      loadButton.textContent = preset.name;
      loadButton.title = `Load “${preset.name}”`;
      loadButton.addEventListener(
        "click",
        () => {
          this.setActiveId(preset.id);
          this.host.applySound(preset);
          if (this.statusEl) {
            this.statusEl.textContent = `Loaded “${preset.name}”`;
          }
        },
        { signal: this.signal },
      );

      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className =
        "shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-slate-500 hover:text-slate-200";
      exportButton.textContent = "Export";
      exportButton.title = `Export “${preset.name}”`;
      exportButton.addEventListener(
        "click",
        () => {
          this.exportPreset(preset);
        },
        { signal: this.signal },
      );

      row.append(loadButton, exportButton);

      if (allowDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className =
          "shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-rose-700 hover:text-rose-300";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener(
          "click",
          () => {
            this.deleteUserPreset(preset.id);
          },
          { signal: this.signal },
        );
        row.append(deleteButton);
      }

      list.append(row);
    }

    section.append(list);
    return section;
  }

  private saveCurrentPreset(): void {
    const name = this.nameInput?.value.trim() ?? "";
    if (!name) {
      if (this.statusEl) {
        this.statusEl.textContent = "Enter a name to save";
      }
      this.nameInput?.focus();
      return;
    }

    const existingIndex = this.userPresets.findIndex(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );

    const preset: SynthPreset = {
      id:
        existingIndex >= 0
          ? this.userPresets[existingIndex].id
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.slice(0, 48),
      builtIn: false,
      params: cloneParams(this.host.getParams()),
      effects: cloneEffects(this.host.getEffects()),
    };

    if (existingIndex >= 0) {
      this.userPresets[existingIndex] = preset;
    } else {
      this.userPresets.push(preset);
    }

    this.userPresets.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    saveUserPresets(this.userPresets);
    this.setActiveId(preset.id);

    if (this.statusEl) {
      this.statusEl.textContent =
        existingIndex >= 0 ? `Updated “${preset.name}”` : `Saved “${preset.name}”`;
    }
    if (this.nameInput) {
      this.nameInput.value = preset.name;
    }
  }

  private deleteUserPreset(id: string): void {
    const preset = this.userPresets.find((entry) => entry.id === id);
    if (!preset) {
      return;
    }

    this.userPresets = this.userPresets.filter((entry) => entry.id !== id);
    saveUserPresets(this.userPresets);
    if (this.activePresetId === id) {
      this.activePresetId = null;
    }
    this.refreshList();
    if (this.statusEl) {
      this.statusEl.textContent = `Deleted “${preset.name}”`;
    }
  }

  private exportCurrentPreset(): void {
    const name = this.nameInput?.value.trim() || "MiniSynth Preset";
    this.exportPreset({
      id: this.activePresetId ?? `export-${Date.now()}`,
      name,
      builtIn: false,
      params: cloneParams(this.host.getParams()),
      effects: cloneEffects(this.host.getEffects()),
    });
  }

  private exportPreset(preset: SynthPreset): void {
    const payload = {
      format: "minisynth-preset",
      version: 1,
      name: preset.name,
      params: cloneParams(preset.params),
      effects: cloneEffects(preset.effects),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.presetFilename(preset.name)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    if (this.statusEl) {
      this.statusEl.textContent = `Exported “${preset.name}”`;
    }
  }

  private presetFilename(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug.length > 0 ? slug : "minisynth-preset";
  }

  private async importPresetFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const record =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;

      if (
        record
        && record.format !== undefined
        && record.format !== "minisynth-preset"
      ) {
        if (this.statusEl) {
          this.statusEl.textContent = "Unrecognized preset file";
        }
        return;
      }

      const preset = normalizeStoredPreset({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name:
          typeof record?.name === "string" && record.name.trim().length > 0
            ? record.name
            : file.name.replace(/\.json$/i, ""),
        params: record?.params,
        effects: record?.effects,
      });

      if (!preset) {
        if (this.statusEl) {
          this.statusEl.textContent = "Could not read that preset file";
        }
        return;
      }

      const existingIndex = this.userPresets.findIndex(
        (entry) => entry.name.toLowerCase() === preset.name.toLowerCase(),
      );
      if (existingIndex >= 0) {
        preset.id = this.userPresets[existingIndex].id;
        this.userPresets[existingIndex] = preset;
      } else {
        this.userPresets.push(preset);
      }

      this.userPresets.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
      saveUserPresets(this.userPresets);
      this.setActiveId(preset.id);
      this.host.applySound(preset);
      if (this.nameInput) {
        this.nameInput.value = preset.name;
      }
      if (this.statusEl) {
        this.statusEl.textContent =
          existingIndex >= 0
            ? `Imported and updated “${preset.name}”`
            : `Imported “${preset.name}”`;
      }
    } catch {
      if (this.statusEl) {
        this.statusEl.textContent = "Could not read that preset file";
      }
    }
  }
}
