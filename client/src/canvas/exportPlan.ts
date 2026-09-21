import { create } from 'zustand';
import type Konva from 'konva';

/**
 * Exporting the plan as an image.
 *
 * The canvas has to be stripped for the picture — no grid, no conflict
 * highlights, no snap marker — and the obvious way to do that is to flip the
 * project's display settings. That would be a mistake: those settings live in
 * the project file, so "export a PNG" would dirty the document, fire an
 * autosave, and leave the user's grid switched off afterwards. This flag is a
 * view-only override that the canvas reads and nothing persists.
 */
interface ExportState {
  exporting: boolean;
  /** The rendered plan, held only while the print dialog is open. */
  printImage: string | null;
}

export const useExportMode = create<ExportState>(() => ({
  exporting: false,
  printImage: null,
}));

let stage: Konva.Stage | null = null;

/** The canvas hands its stage over on mount so exports can reach it. */
export function registerStage(next: Konva.Stage | null): void {
  stage = next;
}

/**
 * Wait for React to commit the export-mode render before grabbing pixels.
 *
 * A bare `requestAnimationFrame` looks right and hangs: a backgrounded tab
 * never paints, so the callback never runs, the export never resolves, and the
 * button it came from stays disabled for the life of the page. The timer is the
 * floor — whichever fires first wins.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

/**
 * Render the current view to a PNG data URL, or null if the canvas isn't up.
 * `pixelRatio` of 2 gives a usable image on a normal screen without producing
 * a 20MB file.
 */
export async function exportPlanPng(pixelRatio = 2): Promise<string | null> {
  if (!stage) return null;

  useExportMode.setState({ exporting: true });
  try {
    // Two frames: one for React to render the stripped-down layers, one for
    // Konva to have drawn them.
    await nextFrame();
    await nextFrame();
    return stage.toDataURL({ pixelRatio, mimeType: 'image/png' });
  } finally {
    useExportMode.setState({ exporting: false });
  }
}

/**
 * Print the plan by printing a picture of it.
 *
 * Printing the live canvas doesn't work: the page is a three-column app, and
 * the canvas has no background of its own, so walls drawn in near-white come
 * out invisible on white paper. Rendering the same stripped export used for
 * PNG and printing that image sidesteps all of it, and what's on the page is
 * then exactly what the PNG would have been.
 */
export async function printPlan(): Promise<void> {
  const url = await exportPlanPng(2);
  if (!url) return;

  useExportMode.setState({ printImage: url });
  await nextFrame();
  await nextFrame();
  try {
    window.print();
  } finally {
    useExportMode.setState({ printImage: null });
  }
}

/** Save bytes to the user's disk under a given name. */
export function download(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadText(text: string, filename: string, mime = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  download(url, filename);
  // Revoking immediately can beat the download on some browsers; a tick is
  // enough and the object is small.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filename that won't need quoting and says which room it came from. */
export function safeFilename(name: string, extension: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'room'}.${extension}`;
}
