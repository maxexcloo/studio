/** What a finished gallery image shows, in the assistant model's words, so search can find it. */
export interface Caption {
  text: string;
  model: string;
  at: string;
}
export interface CaptionItem {
  id?: string;
  url?: string;
  type?: string;
  status?: string;
  ownerId?: string;
  library?: unknown;
  caption?: Caption;
}
export interface CaptionImage {
  mime: string;
  data: string;
}
/** The assistant gateway (assistant.js). */
export interface CaptionWriter {
  settings(): { model: string };
  supportsVision(model: string): Promise<boolean>;
  caption(request: {
    image: CaptionImage;
    signal?: AbortSignal;
  }): Promise<{ text: string; model: string }>;
}
export type CaptionTick =
  | "off"
  | "busy"
  | "spaced"
  | "capped"
  | "text-only"
  | "none"
  | "captioned"
  | "yielded"
  | "failed";

const spacingMs = 10_000;
const watchMs = 1_000;
export const dailyCaptions = 500;

/**
 * Captions finished gallery images one at a time while Studio is idle (the same signal Dream uses:
 * no live job and no text work), newest first, at most one every 10 s and `dailyCaptions` a day
 * (the server's local day). It yields the moment work appears: the call is aborted and the image is
 * tried again later. Only with a vision assistant model, never with cloud, and only for owners
 * `allowed` to use the prompt assistant. An image that fails is skipped until the next start.
 */
export function createCaptioner(options: {
  /** The Settings › Models switch (STUDIO_GALLERY_CAPTIONS). */
  enabled(): boolean;
  writer: CaptionWriter | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  /** Every gallery record, newest first. */
  items(): Iterable<CaptionItem>;
  /** Whether the record shows in the gallery (not hidden, not in Dream's pool, its file present). */
  visible(item: CaptionItem): boolean;
  /** A small (≤512 px) copy of the image, or null when there is none. */
  image(item: CaptionItem): Promise<CaptionImage | null>;
  save(item: CaptionItem, caption: Caption): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer, now = Date.now, log = console } = options;
  const key = (item: CaptionItem) => item.url || item.id || "";
  const day = (time: number) => new Date(time).toDateString();
  const failed = new Set<string>();
  let current: AbortController | null = null;
  let last = -Infinity;
  let count = { day: "", captioned: 0 };
  let noted = "";
  const note = (reason: string) => {
    if (reason !== noted) log.info(`[Studio] Gallery captions skip: ${reason}`);
    noted = reason;
  };

  function next() {
    const allowed = new Map<string, boolean>();
    for (const item of options.items()) {
      if (item.type !== "image" || item.status !== "done" || item.caption || item.library) continue;
      if (failed.has(key(item))) continue;
      const owner = item.ownerId || "";
      if (!allowed.has(owner)) allowed.set(owner, options.allowed(owner));
      if (allowed.get(owner) && options.visible(item)) return item;
    }
    return null;
  }

  async function tick(): Promise<CaptionTick> {
    if (current) return "busy";
    if (!options.enabled() || !writer) return "off";
    if (!options.idle()) return "busy";
    const time = now();
    if (time - last < spacingMs) return "spaced";
    if (count.day !== day(time)) {
      // Counted from the records, so a restart keeps the day's count.
      let captioned = 0;
      for (const item of options.items())
        if (item.caption && day(Date.parse(item.caption.at)) === day(time)) captioned += 1;
      count = { day: day(time), captioned };
    }
    if (count.captioned >= dailyCaptions) return "capped";
    const controller = new AbortController();
    current = controller;
    let watch: ReturnType<typeof setInterval> | undefined;
    let item: CaptionItem | null = null;
    try {
      const { model } = writer.settings();
      if (!(await writer.supportsVision(model))) {
        note(`the assistant model ${model} can't read images.`);
        return "text-only";
      }
      item = next();
      if (!item) return "none";
      if (!options.idle()) return "busy";
      last = time;
      watch = setInterval(() => {
        if (!options.idle()) controller.abort();
      }, watchMs);
      watch.unref?.();
      const image = await options.image(item);
      if (controller.signal.aborted) return "yielded";
      if (!image) throw new Error("no image to read");
      const reply = await writer.caption({ image, signal: controller.signal });
      if (controller.signal.aborted) return "yielded";
      options.save(item, {
        text: reply.text,
        model: reply.model,
        at: new Date(now()).toISOString(),
      });
      count.captioned += 1;
      noted = "";
      return "captioned";
    } catch (error) {
      if (controller.signal.aborted) return "yielded";
      if (item) failed.add(key(item));
      note((error as Error).message);
      return "failed";
    } finally {
      clearInterval(watch);
      current = null;
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    tick,
    start() {
      timer ||= setInterval(() => void tick().catch(() => undefined), spacingMs / 2);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    /** Other work was admitted: a caption in progress steps aside at once. */
    interrupt() {
      current?.abort();
    },
  };
}
export type Captioner = ReturnType<typeof createCaptioner>;
