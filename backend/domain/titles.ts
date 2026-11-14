import { createIdleWork, type IdleItem } from "./idle-work.ts";

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
  items(): Iterable<TitleItem>;
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
      for (const other of options.items())
        if (other.title && other.prompt === item.prompt && other.ownerId === item.ownerId)
          return options.save(item, other.title);
      const reply = await writer!.title({ prompt: item.prompt!, signal });
      if (!signal.aborted) options.save(item, reply.title);
    },
  });
}
