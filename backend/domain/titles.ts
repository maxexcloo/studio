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
 * `allowed` to use the prompt assistant, and never with cloud.
 */
export function createTitler(options: {
  writer: TitleWriter | null;
  idle(): boolean;
  allowed(ownerId: string): boolean;
  items(): Iterable<TitleItem>;
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
    enabled: () => Boolean(writer),
    unavailable: async () => "",
    wanted: (item) =>
      (item.type === "image" || item.type === "video") && !item.title && Boolean(item.prompt),
    async run(item, signal) {
      const reply = await writer!.title({ prompt: item.prompt!, signal });
      if (!signal.aborted) options.save(item, reply.title);
    },
  });
}
