import { createHash } from "node:crypto";

import { promptInstruction, promptInstructionStore } from "../prompt-instructions.js";
import { type IdleDocument, type IdleItem, createIdleWork, pictured } from "./idle-work.ts";
import type { ModelImage } from "./model-content.ts";
import type { PromptWriter } from "./taste.ts";
import { plainWords } from "./writing-standard.ts";

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
  prompt?: string;
}
/** The assistant gateway (assistant.js). */
export interface CaptionWriter {
  /** Whether the text model the side asks for reads images. */
  supportsVision(writer?: PromptWriter): Promise<boolean>;
  caption(request: {
    image: ModelImage;
    instructions: string;
    prompt?: string;
    signal?: AbortSignal;
    writer?: PromptWriter;
  }): Promise<{ text: string; tags: string[]; model: string }>;
}
export const captionCharacters = 600;
export const captionTags = 15;
let cachedPrompt: { hash: string; instructions: string; version: string } | undefined;
function captionPrompt() {
  const { hash } = promptInstructionStore().get("caption-gallery");
  if (cachedPrompt && cachedPrompt.hash === hash) return cachedPrompt;
  const instructions = promptInstruction("caption-gallery", {
    captionCharacters,
    captionTags,
    plainWords,
  });
  const version = createHash("sha256").update(instructions).digest("hex").slice(0, 12);
  cachedPrompt = { hash, instructions, version };
  return cachedPrompt;
}

export const captionInstructions = () => captionPrompt().instructions;
// The Out of Date pass retakes captions written with different instructions.
export const captionVersion = () => captionPrompt().version;
/** A caption as the result saves it, under the current rules. */
export const captionRecord = (
  reply: { text: string; tags: string[]; model: string },
  at: number,
): Caption => ({
  text: reply.text,
  tags: reply.tags,
  model: reply.model,
  at: new Date(at).toISOString(),
  version: captionVersion(),
});

/**
 * Captions finished gallery images, Dream's pool included, while Studio is idle
 * (domain/idle-work.ts): a trickle of new images, or an administrator's Gallery Captions catch-up, which
 * also redoes captions from an older format, on the text model where the owner runs text (`text`)
 * while it reads images.
 */
export function createCaptioner(options: {
  /** The Settings › Studio switch (STUDIO_GALLERY_CAPTIONS). */
  enabled(): boolean;
  writer: CaptionWriter | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  /** The owner's text writer (account-policy.js `promptWriter`). */
  text(ownerId: string): PromptWriter;
  items(since?: number): Iterable<CaptionItem>;
  changes?(): number;
  visible(item: CaptionItem): boolean;
  /** A small (≤512 px) copy of the image, or null when there is none. */
  image(item: CaptionItem): Promise<ModelImage | null>;
  save(item: CaptionItem, caption: Caption): void;
  /** Captions the item in one read with whatever else it needs (domain/enrich.ts), saving each. */
  enrich?(item: CaptionItem, signal: AbortSignal): Promise<void>;
  load(): IdleDocument | null;
  persist(document: IdleDocument): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer, now = Date.now } = options;
  // Checked before each pick, so an owner's images wait while their text model can't read them.
  const vision = { cloud: true, local: false };
  return createIdleWork<CaptionItem>({
    ...options,
    name: "Gallery captions",
    dailyCap: false,
    revision: captionVersion,
    off: "Gallery Captions is off in Settings › Studio.",
    async unavailable() {
      if (!writer) return "No assistant model is configured.";
      vision.local = await writer.supportsVision({ side: "local", uncensored: false });
      return "";
    },
    // The trickle and a Missing pass caption new images; Out of Date also redoes captions from older
    // rules, and All redoes every caption written before the pass began.
    wanted: (item, all, target) =>
      pictured(item) &&
      vision[options.text(item.ownerId || "").side] &&
      (!all || target?.scope === "missing"
        ? !item.caption
        : target?.scope === "all"
          ? !(item.caption?.at && item.caption.at >= target.startedAt)
          : item.caption?.version !== captionVersion()),
    async run(item, signal) {
      if (options.enrich) return options.enrich(item, signal);
      const image = await options.image(item);
      if (signal.aborted) return;
      if (!image) throw new Error("no image to read");
      const reply = await writer!.caption({
        image,
        instructions: captionInstructions(),
        prompt: item.prompt,
        signal,
        writer: options.text(item.ownerId || ""),
      });
      if (signal.aborted) return;
      options.save(item, captionRecord(reply, now()));
    },
  });
}
