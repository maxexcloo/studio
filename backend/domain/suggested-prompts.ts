import { createIdleWork, type IdleItem } from "./idle-work.ts";
import type { ModelImage } from "./model-content.ts";

export interface SuggestedPromptItem extends IdleItem {
  prompt?: string;
  caption?: { text?: string };
  /** Where an imported upload came from (gallery/reddit.js); its title is a hint. */
  source?: { title?: string };
  /** A prompt that would recreate an item Studio has no prompt for (an upload); Recreate uses it. */
  suggestedPrompt?: string;
}
/** The assistant gateway (assistant.js). */
export interface PromptDescriber {
  supportsVision(): Promise<boolean>;
  describe(request: {
    images: ModelImage[];
    hint: string;
    title?: string;
    signal?: AbortSignal;
  }): Promise<{ available: boolean; reason?: string; prompt?: string }>;
}

/**
 * Suggests prompts for finished items without one, such as uploads, as continuous idle work
 * (domain/idle-work.ts), newest first. A text model that reads images describes the picture (a
 * video's first frame); otherwise the item's caption is written up as a prompt, and an item
 * without one waits. Kept apart from the item's own prompt. Only for owners `allowed` to use the
 * prompt assistant.
 */
export function createPromptSuggester(options: {
  writer: PromptDescriber | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  items(): Iterable<SuggestedPromptItem>;
  visible(item: SuggestedPromptItem): boolean;
  /** A small (≤512 px) copy of the picture, or null when there is none. */
  image(item: SuggestedPromptItem): Promise<ModelImage | null>;
  save(item: SuggestedPromptItem, prompt: string): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer } = options;
  // Checked before each pick, so items wait for a caption only while no model reads images.
  let vision = false;
  return createIdleWork<SuggestedPromptItem>({
    ...options,
    name: "Suggested prompts",
    continuous: true,
    enabled: () => Boolean(writer),
    async unavailable() {
      vision = await writer!.supportsVision();
      return "";
    },
    wanted: (item) =>
      (item.type === "image" || item.type === "video") &&
      !item.prompt &&
      !item.suggestedPrompt &&
      (vision || Boolean(item.caption?.text)),
    async run(item, signal) {
      const image = vision ? await options.image(item) : null;
      if (signal.aborted) return;
      const reply = await writer!.describe({
        images: image ? [image] : [],
        hint: item.caption?.text || "",
        title: item.source?.title || "",
        signal,
      });
      if (signal.aborted) return;
      if (!reply.available || !reply.prompt) throw new Error(reply.reason || "no prompt written");
      options.save(item, reply.prompt);
    },
  });
}
