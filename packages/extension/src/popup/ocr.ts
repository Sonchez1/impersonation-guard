/** Local screenshot reading with tesseract.js. Every asset (worker, core wasm, English
 *  language data) ships inside the extension, so no image or text leaves the computer. */

import { createWorker, type Worker } from "tesseract.js";

export type OcrProgress = (status: string, progress: number) => void;

let worker: Promise<Worker> | null = null;

function assetUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
  return `/packages/extension/dist/${path}`;
}

async function getWorker(onProgress?: OcrProgress): Promise<Worker> {
  if (!worker) {
    worker = createWorker("eng", 1, {
      workerPath: assetUrl("tesseract/worker.min.js"),
      // A file path (not a directory) makes the worker load exactly this core: the SIMD
      // LSTM build, which every Chrome this extension supports can run.
      corePath: assetUrl("tesseract/tesseract-core-simd-lstm.wasm.js"),
      langPath: assetUrl("tesseract/"),
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (m: { status?: string; progress?: number }) => onProgress?.(m.status ?? "", m.progress ?? 0),
    }).catch((e) => { worker = null; throw e; });
  }
  return worker;
}

/** Recognize the text in an image. Throws if OCR cannot be set up in this build. */
export async function recognize(blob: Blob, onProgress?: OcrProgress): Promise<string> {
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(blob);
  return (data.text ?? "").replace(/[ \t]+\n/g, "\n").trim();
}

export async function disposeOcr(): Promise<void> {
  if (!worker) return;
  const w = await worker.catch(() => null);
  worker = null;
  await w?.terminate();
}
