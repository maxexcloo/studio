import type { GalleryItem, Preferences, ReferenceAsset } from './types';
import { defaultPrefs } from './constants';
import { fullGenerationText } from './format';
import { sharesWithoutSettings } from './shareSettings';

/**
 * Copies text. iOS Safari allows it only while the tap is still being
 * handled, so the clipboard is asked straight away, with nothing awaited
 * first; where there is no clipboard API (plain HTTP) a hidden text box is
 * selected and copied instead, also within the tap.
 */
export function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return Promise.resolve(copyWithSelection(text));
  try {
    return navigator.clipboard.writeText(text).then(() => true, () => copyWithSelection(text));
  } catch {
    return Promise.resolve(copyWithSelection(text));
  }
}

function copyWithSelection(text: string) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    // 16px, or iOS zooms the page to it; off screen but rendered, so it can be selected.
    textarea.style.cssText = "position:fixed;top:0;left:-9999px;font-size:16px;opacity:0";
    // Inside the open dialog, so its focus trap doesn't pull focus back before the copy.
    const host = document.activeElement?.closest('[role="dialog"]') || document.body;
    host.appendChild(textarea);
    const before = document.activeElement as HTMLElement | null;
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    before?.focus?.({ preventScroll: true });
    return copied;
  } catch {
    return false;
  }
}

export async function copyImage(item: GalleryItem) {
  if (!item.url) return copyText(fullGenerationText(item));
  if (item.type !== "image") return copyText(item.url);
  try {
    // Clipboards take PNG everywhere, and only PNG in some browsers, so a JPEG
    // or WebP is turned into one first. The promise keeps Safari's permission,
    // which only lasts while the click is still being handled. With "Share
    // without settings" a PNG is redrawn too, which leaves its prompt and
    // workflow behind, as a download would.
    const clean = sharesWithoutSettings(item);
    const png = fetch(item.url)
      .then((response) => {
        if (!response.ok) throw new Error("fetch failed");
        return response.blob();
      })
      .then((blob) => (blob.type === "image/png" && !clean ? blob : asPng(blob)));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return copyText(item.url);
  }
}

async function asPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("encode failed"))), "image/png"));
}

/**
 * How far the HEISS server's clock runs ahead of this browser's, in ms. Job
 * times are stamped by the server, which may be another machine, so timers
 * count against this instead of trusting the two clocks to agree.
 */
export let serverClockOffset = 0;

function noteServerClock(response: Response, sentAt: number) {
  const header = Date.parse(response.headers.get("date") || "");
  if (!Number.isFinite(header)) return;
  // The header has whole seconds; aim at the middle of the second and the round trip.
  const sample = header + 500 - (sentAt + Date.now()) / 2;
  // Under 1.5 s is rounding and latency, not a clock that is off.
  serverClockOffset = Math.abs(sample) < 1500 ? 0 : sample;
}

/** Fired when the server says this device has to sign in again (its session ended or was revoked). */
export const signedOutEvent = "studio:signed-out";

/**
 * Every request the studio makes to its own server goes through here. The
 * X-Studio header tells the server it came from the studio's page: other
 * websites cannot send it (server/request-guard.js), so they cannot make it
 * delete, install or change anything. A signed-out device hears about it here.
 */
type BootRequest = { at: number; response: Promise<Response> };

/**
 * An answer index.html asked for while the code downloaded: taken once, for a
 * plain GET within a few seconds of loading, and only when it succeeded (a
 * refusal or an error asks again, so sign-in and errors behave as usual).
 */
async function takeBoot(url: string, options: RequestInit) {
  const boot = (window as { __studioBoot?: Record<string, BootRequest> }).__studioBoot;
  const entry = boot?.[url];
  if (!entry || (options.method && options.method !== 'GET') || options.body || options.signal) return null;
  delete boot![url];
  if (Date.now() - entry.at > 10000) return null;
  const response = await entry.response.catch(() => null);
  return response?.ok ? response : null;
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const early = await takeBoot(url, options);
  if (early) return early;
  const headers = new Headers(options.headers);
  headers.set("X-Studio", "1");
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && (response.headers.get("X-Studio-Sign-In") || response.headers.get("X-HEISS-Sign-In"))) window.dispatchEvent(new Event(signedOutEvent));
  return response;
}

export async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const sentAt = Date.now();
  // The browser's own wording ("Failed to fetch", "Load failed") means nothing to people.
  const response = await apiFetch(url, options).catch((error) => {
    if (error?.name === "AbortError") throw error;
    throw new Error("Can’t reach Studio. Make sure it’s running, then try again.");
  });
  noteServerClock(response, sentAt);
  // A server started before an update answers new routes with the app page.
  if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
    throw new Error("Restart Studio to use this.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : response.statusText || "Request failed";
    throw new ApiError(message, response.status, typeof data?.reason === "string" ? data.reason : "");
  }
  return data as T;
}

/** A failed API call that keeps the HTTP status and the server's reason code, so callers can explain it. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type ReferenceAssetPage = { items: ReferenceAsset[]; nextCursor?: string; hasMore?: boolean; locked?: boolean };

export function listReferenceAssets(source: "upload" | "generation" | "hidden", cursor = "", limit = 30, signal?: AbortSignal, query = "") {
  const search = new URLSearchParams({ source, limit: String(limit) });
  if (cursor) search.set("cursor", cursor);
  if (query.trim()) search.set("q", query.trim());
  return apiJson<ReferenceAssetPage>(`/api/reference-assets?${search}`, { signal });
}

export function uploadReferenceAsset(file: File, onProgress?: (progress: number) => void) {
  return new Promise<ReferenceAsset>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("image", file);
    request.open("POST", "/api/reference-assets/upload");
    request.setRequestHeader("X-Studio", "1");
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      const data = request.response || {};
      if (request.status >= 200 && request.status < 300 && data.asset) resolve(data.asset as ReferenceAsset);
      else reject(new Error(typeof data.error === "string" ? data.error : request.statusText || "Upload failed"));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed")));
    request.addEventListener("abort", () => reject(new Error("Upload canceled")));
    request.send(form);
  });
}

/** A gallery image as a reference, or with frame "last", a finished video's last frame. */
export async function referenceAssetFromGallery(galleryItemId: string, { frame }: { frame?: "last" } = {}) {
  const data = await apiJson<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(frame ? { galleryItemId, frame } : { galleryItemId })
  });
  return data.asset;
}

export function deleteReferenceAsset(assetId: string) {
  return apiJson<{ ok?: boolean }>(`/api/reference-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

const prefsKey = "studio-prefs";
const draftKey = "studio-draft";
const legacyPrefsKey = "j-ai-studio-prefs";
const legacyDraftKey = "j-ai-studio-draft";
let accountStorageScope = "";
export const accountStorageScopeChangeEvent = "studio:account-storage-scope-changed";

/** Keep browser-held studio content separate when people share a browser. */
export function setAccountStorageScope(accountId?: string) {
  const next = accountId ? `account:${accountId}` : "";
  if (next === accountStorageScope) return;
  accountStorageScope = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(accountStorageScopeChangeEvent));
}

export function scopedStorageKey(key: string) {
  return accountStorageScope ? `${key}:${accountStorageScope}` : key;
}

export function hasAccountStorageScope() {
  return Boolean(accountStorageScope);
}

export function savePrefs(value: Preferences) {
  localStorage.setItem(scopedStorageKey(prefsKey), JSON.stringify(value));
}

export function saveDraft(value: unknown) {
  localStorage.setItem(scopedStorageKey(draftKey), JSON.stringify(value));
}

function migratedGet(key: string, legacyKey: string) {
  try {
    const current = localStorage.getItem(scopedStorageKey(key));
    if (current != null) return current;
    if (accountStorageScope) return null;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy != null) {
      localStorage.setItem(key, legacy);
      return legacy;
    }
  } catch {
    // Ignore storage errors and fall through.
  }
  return null;
}

export function loadPrefs(): Preferences {
  try {
    const saved = migratedGet(prefsKey, legacyPrefsKey);
    if (!saved) return { ...defaultPrefs };
    const parsed = JSON.parse(saved);
    // Defaults fill missing preferences; an explicit count remains the user’s choice.
    parsed.countDefaultsVersion = 2;
    // Run grouping's first version kept its own settings; grouping is a view now.
    delete parsed.groupRuns;
    delete parsed.runGroupingMode;
    delete parsed.runCooldownMinutes;
    // Its trays and card decks went before release.
    delete parsed.runOpenStyle;
    // The phone has one layout now: the full studio on a phone went in batch 5.
    delete parsed.fullStudioOnPhone;
    if (parsed.runStackStyle === "deck") delete parsed.runStackStyle;
    // Carry an explicit Original choice from the earlier size control into the switch.
    if (parsed.autoResizeInputs === undefined && parsed.referenceMaxEdge === 0) parsed.autoResizeInputs = false;
    delete parsed.referenceMaxEdge;
    // Inpainting is the Studio's catalogue switch now; the per-browser switch that could hide it is gone.
    delete parsed.inpainting;
    return { ...defaultPrefs, ...parsed };
  } catch {
    return { ...defaultPrefs };
  }
}

export function loadDraft() {
  try {
    return JSON.parse(migratedGet(draftKey, legacyDraftKey) || "{}");
  } catch {
    return {};
  }
}
