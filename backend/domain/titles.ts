import { type IdleItem, createIdleWork } from "./idle-work.ts";

export interface TitleItem extends IdleItem {
  prompt?: string;
  /** A few words the text model summarised from the prompt (assistant.js title). */
  title?: string;
}
/** The assistant gateway (assistant.js). */
export interface TitleWriter {
  title(request: { prompt: string; signal?: AbortSignal }): Promise<{ title: string }>;
}

/**
 * Titles finished images and videos from their prompts: new results as they complete, and the
 * rest of the gallery as continuous idle work (domain/idle-work.ts), newest first. Only for owners
 * `allowed` to use the prompt assistant, and never with cloud. A result whose owner already has a
 * title for the same prompt (another result of its run, Run Again) takes that one without a call.
 */
export function createTitler(options: {
  /** The Settings › Generation switch (STUDIO_GALLERY_TITLES). */
  enabled(): boolean;
  writer: TitleWriter | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  items(since?: number): Iterable<TitleItem>;
  /** The title the item's owner already has for the same prompt, if any. */
  titled(item: TitleItem): string | undefined;
  changes?(): number;
  visible(item: TitleItem): boolean;
  save(item: TitleItem, title: string): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { writer } = options;
  return createIdleWork<TitleItem>({
    ...options,
    name: "Gallery titles",
    continuous: true,
    enabled: () => Boolean(writer) && options.enabled(),
    unavailable: async () => "",
    wanted: (item) =>
      (item.type === "image" || item.type === "video") && !item.title && Boolean(item.prompt),
    async run(item, signal) {
      const title = options.titled(item);
      if (title) return options.save(item, title);
      const reply = await writer!.title({ prompt: item.prompt!, signal });
      if (!signal.aborted) options.save(item, reply.title);
    },
  });
}
