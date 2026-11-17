import { type IdleItem, createIdleWork } from "./idle-work.ts";
import type { ModelImage } from "./model-content.ts";
import type { TextSide } from "./taste.ts";

export interface SuggestedPromptItem extends IdleItem {
  prompt?: string;
  caption?: { text?: string };
  /** Where an imported upload came from (gallery/reddit.js); its title is a hint. */
  source?: { title?: string };
  /** A prompt that would recreate an item Studio has no prompt for (an upload); Recreate uses it. */
  suggestedPrompt?: string;
}
/** The assistant gateway (assistant.js). */
interface PromptDescriber {
  supportsVision(text?: TextSide): Promise<boolean>;
  describe(request: {
    images: ModelImage[];
    hint: string;
    title?: string;
    explicit?: boolean;
    signal?: AbortSignal;
    side?: TextSide;
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
  /** The Settings › Maintenance switch (STUDIO_SUGGESTED_PROMPTS). */
  enabled(): boolean;
  writer: PromptDescriber | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  /** Where the owner runs text (account-preferences.js `textSide`). */
  text(ownerId: string): TextSide;
  items(since?: number): Iterable<SuggestedPromptItem>;
  changes?(): number;
  visible(item: SuggestedPromptItem): boolean;
  /** A small (≤512 px) copy of the picture, or null when there is none. */
  image(item: SuggestedPromptItem): Promise<ModelImage | null>;
  save(item: SuggestedPromptItem, prompt: string): void;
  /** Whether the owner's prompts may be worded explicitly (Uncensored Models). */
  explicit?(ownerId: string): boolean;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer } = options;
  // Checked before each pick, so items wait for a caption only while their model can't read images.
  const vision = { cloud: true, local: false };
  return createIdleWork<SuggestedPromptItem>({
    ...options,
    name: "Suggested prompts",
    continuous: true,
    enabled: () => Boolean(writer) && options.enabled(),
    async unavailable() {
      vision.local = await writer!.supportsVision("local");
      return "";
    },
    wanted: (item) =>
      (item.type === "image" || item.type === "video") &&
      !item.prompt &&
      !item.suggestedPrompt &&
      (vision[options.text(item.ownerId || "")] || Boolean(item.caption?.text)),
    async run(item, signal) {
      const text = options.text(item.ownerId || "");
      const image = vision[text] ? await options.image(item) : null;
      if (signal.aborted) return;
      const reply = await writer!.describe({
        images: image ? [image] : [],
        hint: item.caption?.text || "",
        title: item.source?.title || "",
        explicit: options.explicit?.(item.ownerId || "") ?? false,
        signal,
        side: text,
      });
      if (signal.aborted) return;
      if (!reply.available || !reply.prompt) throw new Error(reply.reason || "no prompt written");
      options.save(item, reply.prompt);
    },
  });
}
