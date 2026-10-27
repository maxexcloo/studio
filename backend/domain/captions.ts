import { createIdleWork, type IdleDocument, type IdleItem } from "./idle-work.ts";
import type { ModelImage } from "./model-content.ts";

/** What a finished gallery image shows, in the assistant model's words, so search can find it. */
export interface Caption {
  text: string;
  tags: string[];
  model: string;
  at: string;
  /** The caption format; a pass redoes captions from an older one. */
  version: number;
}
export interface CaptionItem extends IdleItem {
  caption?: Partial<Caption>;
}
/** The assistant gateway (assistant.js). */
export interface CaptionWriter {
  /** Whether the running text model reads images. */
  supportsVision(): Promise<boolean>;
  caption(request: {
    image: ModelImage;
    signal?: AbortSignal;
  }): Promise<{ text: string; tags: string[]; model: string }>;
}
export const captionVersion = 2;

/**
 * Captions finished gallery images while Studio is idle (domain/idle-work.ts): a trickle of new
 * images, or an administrator's Caption Gallery pass, which also redoes captions from an older
 * format. Only while the running text model reads images, and never with cloud.
 */
export function createCaptioner(options: {
  /** The Settings › Models switch (STUDIO_GALLERY_CAPTIONS). */
  enabled(): boolean;
  writer: CaptionWriter | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  items(): Iterable<CaptionItem>;
  visible(item: CaptionItem): boolean;
  /** A small (≤512 px) copy of the image, or null when there is none. */
  image(item: CaptionItem): Promise<ModelImage | null>;
  save(item: CaptionItem, caption: Caption): void;
  load(): IdleDocument | null;
  persist(document: IdleDocument): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer, now = Date.now } = options;
  return createIdleWork<CaptionItem>({
    ...options,
    name: "Gallery captions",
    off: "Gallery Captions is off in Settings › Models.",
    async unavailable() {
      if (!writer) return "No assistant model is configured.";
      if (!(await writer.supportsVision())) return "The running text model can't read images.";
      return "";
    },
    wanted: (item, all) =>
      item.type === "image" && (all ? item.caption?.version !== captionVersion : !item.caption),
    async run(item, signal) {
      const image = await options.image(item);
      if (signal.aborted) return;
      if (!image) throw new Error("no image to read");
      const reply = await writer!.caption({ image, signal });
      if (signal.aborted) return;
      options.save(item, {
        text: reply.text,
        tags: reply.tags,
        model: reply.model,
        at: new Date(now()).toISOString(),
        version: captionVersion,
      });
    },
  });
}
type Captioner = ReturnType<typeof createCaptioner>;

interface Request {
  body?: Record<string, unknown>;
}
interface Response {
  json(value: unknown): unknown;
}
type Handler = (req: Request, res: Response) => unknown;

/** Settings › Maintenance › Caption Gallery, for administrators. */
export function registerCaptionRoutes(
  app: {
    get(path: string, handler: Handler): unknown;
    post(path: string, handler: Handler): unknown;
  },
  {
    captioner,
    requireAdmin,
  }: { captioner: Captioner; requireAdmin(req: Request, res: Response): boolean },
) {
  app.get("/api/gallery/captions", async (req, res) => {
    if (requireAdmin(req, res)) res.json(await captioner.status());
  });
  app.post("/api/gallery/captions/start", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    captioner.startPass();
    res.json(await captioner.status());
  });
  app.post("/api/gallery/captions/stop", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    captioner.stopPass();
    res.json(await captioner.status());
  });
}
