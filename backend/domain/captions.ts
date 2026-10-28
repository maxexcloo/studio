import { createHash } from "node:crypto";
import { createIdleWork, type IdleDocument, type IdleItem } from "./idle-work.ts";
import type { ModelImage } from "./model-content.ts";

/** What a finished gallery image shows, in the assistant model's words, so search can find it. */
export interface Caption {
  text: string;
  tags: string[];
  model: string;
  at: string;
  /** The caption rules it was written under; a pass redoes captions from older rules. */
  version: string;
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
export const captionCharacters = 600;
export const captionTags = 15;
// Gallery captions are for search: what is visible, in the words people search with.
export const captionInstructions = `You caption images in a private gallery so its search can find them. Describe only what is visible, as plain facts: the subjects and objects; for each person their apparent age range, body type, hair, skin tone and apparent ethnicity, clothing or outfit (and how nude, when they are), pose and expression; the setting and background; any action; the style and look (medium such as photo, painting, illustration or 3D render, lighting, main colours, mood, composition and framing); and any legible text, quoted exactly. This is an adult gallery: name nudity, sexual acts, fetish wear and body details plainly, in the everyday words people search with, never softened or left out. Tags are the specific, distinctive things someone would search this image for (the outfit, the act, the body type, the hair colour, the setting, the style), not generic words such as image, photo, person, indoor or colourful. No opinions or judgement, no guessed names or identities, no preamble. Reply with only this JSON: {"text": "the description, under ${captionCharacters} characters", "tags": ["8 to ${captionTags} short lowercase search tags"]}`;
// Changing the rules changes the version, so a Caption Gallery pass redoes older captions.
export const captionVersion = createHash("sha256")
  .update(captionInstructions)
  .digest("hex")
  .slice(0, 12);

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
