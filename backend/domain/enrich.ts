import type { Review } from "../../shared/projects.ts";
import { type Caption, captionRecord } from "./captions.ts";
import type { IdleItem } from "./idle-work.ts";
import type { ModelImage } from "./model-content.ts";
import { reviewRecord } from "./review.ts";
import type { PromptWriter } from "./taste.ts";

export interface EnrichItem extends IdleItem {
  prompt?: string;
  /** Where an imported upload came from (gallery/reddit.js); its title is a hint. */
  source?: { title?: string };
}
/** The idle work behind one task (domain/idle-work.ts take), which still does what enrich leaves. */
interface Task<Item> {
  take(items: Item[]): Promise<{ items: Item[]; release(): void }>;
}
/** The assistant gateway (assistant.js). */
interface EnrichWriter {
  enrich(request: {
    image: ModelImage;
    prompt?: string;
    caption: boolean;
    title: boolean;
    brief: string;
    describe: boolean;
    sourceTitle?: string;
    explicit: boolean;
    signal?: AbortSignal;
    writer?: PromptWriter;
  }): Promise<{
    model: string;
    caption?: { text: string; tags: string[] };
    title?: string;
    review?: { score: number; miss: string };
    prompt?: string;
  }>;
}
/** What one read saved on the item, as the gallery keeps it. */
export interface Enriched {
  caption?: Caption;
  title?: string;
  review?: Review;
  suggestedPrompt?: string;
}

/**
 * Reads a finished image once for every Background AI task it still needs: its caption, title,
 * self-review and, without a prompt of its own, a suggested prompt. Each task's own idle work
 * (captions, titles, review, suggested prompts) decides whether the item needs it, under that
 * task's switch, and does whatever this leaves undone. A read happens only for a caption or a
 * review, the tasks that need the image; a title or prompt alone stays with its own work.
 */
export function createEnricher<Item extends EnrichItem>(options: {
  writer: EnrichWriter | null;
  captions: Task<Item>;
  titles: Task<Item>;
  reviews: Task<Item> & { brief(item: Item): string };
  prompts: Task<Item>;
  /** The title the item's owner already has for the same prompt, if any (domain/titles.ts). */
  titled(item: Item): string | undefined;
  /** Whether the owner's results may be read and worded with the uncensored model. */
  explicit(ownerId: string): boolean;
  /** The owner's text writer (account-policy.js `promptWriter`). */
  text(ownerId: string): PromptWriter;
  /** A small (≤512 px) copy of the image, or null when there is none. */
  image(item: Item): Promise<ModelImage | null>;
  save(item: Item, enriched: Enriched): void;
  /** Why a new result's read failed; its tasks' own work still runs. */
  failed(reason: string): void;
  now?: () => number;
}) {
  const { writer, now = Date.now } = options;
  /** One item's read; `captioning` when the caption work already holds it. */
  async function read(item: Item, signal: AbortSignal, captioning: boolean) {
    const claims = await Promise.all([
      captioning ? null : options.captions.take([item]),
      options.titles.take([item]),
      options.reviews.take([item]),
      options.prompts.take([item]),
    ]);
    try {
      const [caption, title, review, describe] = claims.map(
        (claim) => !claim || claim.items.length > 0,
      );
      const done: Enriched = {};
      const known = title ? options.titled(item) : undefined;
      if (known) done.title = known;
      const brief = review ? options.reviews.brief(item) : "";
      if (writer && (caption || brief)) {
        const image = await options.image(item);
        if (signal.aborted) return done;
        if (!image) throw new Error("no image to read");
        const ownerId = item.ownerId || "";
        const reply = await writer.enrich({
          image,
          prompt: item.prompt,
          caption,
          title: title && !known,
          brief,
          describe,
          sourceTitle: item.source?.title,
          explicit: options.explicit(ownerId),
          signal,
          writer: options.text(ownerId),
        });
        if (signal.aborted) return done;
        const { model } = reply;
        if (reply.caption) done.caption = captionRecord({ ...reply.caption, model }, now());
        if (reply.title) done.title = reply.title;
        if (reply.review) done.review = reviewRecord({ ...reply.review, model }, brief, now());
        if (reply.prompt) done.suggestedPrompt = reply.prompt;
      }
      if (Object.keys(done).length) options.save(item, done);
      return done;
    } finally {
      for (const claim of claims) claim?.release();
    }
  }
  return {
    /**
     * Reads new results at once, without waiting for Studio to be idle; answers what each saved.
     * One at a time, so a run's later results take its first one's title. A failed read leaves its
     * tasks to their own work.
     */
    async completed(items: Item[]) {
      const signal = new AbortController().signal;
      const done = new Map<Item, Enriched>();
      for (const item of items)
        done.set(
          item,
          await read(item, signal, false).catch((error: Error): Enriched => {
            options.failed(error.message);
            return {};
          }),
        );
      return done;
    },
    /** The caption work's run (domain/captions.ts enrich): it throws when no caption came back. */
    async caption(item: Item, signal: AbortSignal) {
      const done = await read(item, signal, true);
      if (!signal.aborted && !done.caption) throw new Error("unusable reply");
    },
  };
}
