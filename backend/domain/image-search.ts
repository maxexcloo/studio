import type { DatabaseSync } from "node:sqlite";
import { createIdleWork, type IdleDocument, type IdleItem } from "./idle-work.ts";

/** The SigLIP 2 encoders (providers/siglip.ts). */
export interface ImageEncoder {
  /** Why the encoders can't run now, such as a model still downloading; "" when they can. */
  unavailable(): string;
  /** Whether the model is on disk, so a search never starts a download. */
  downloaded(): boolean;
  embedImage(bytes: Uint8Array): Promise<Float32Array>;
  embedText(text: string): Promise<Float32Array>;
}
/**
 * The least cosine similarity between a search and an image that counts as a match. SigLIP 2
 * scores a fitting description at about 0.10–0.15 and unrelated ones below 0.08.
 */
export const nearThreshold = 0.09;
const key = (item: IdleItem) => item.url || item.id || "";

/**
 * Image vectors in `studio_image_vectors` (float16, one row per gallery item) and in memory for
 * brute-force search, which is quick enough for tens of thousands of images. Rows from another
 * model `version` are dropped on load: they can't be compared with the current text encoder.
 */
export function createImageVectors(db: DatabaseSync, version: string) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS studio_image_vectors (key TEXT PRIMARY KEY, version TEXT NOT NULL, vector BLOB NOT NULL)",
  );
  db.prepare("DELETE FROM studio_image_vectors WHERE version != ?").run(version);
  const vectors = new Map<string, Float32Array>();
  for (const row of db.prepare("SELECT key, vector FROM studio_image_vectors").iterate()) {
    const bytes = row.vector as Uint8Array;
    vectors.set(row.key as string, Float32Array.from(new Float16Array(bytes.slice().buffer)));
  }
  const save = db.prepare(
    "INSERT INTO studio_image_vectors (key, version, vector) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET version = excluded.version, vector = excluded.vector",
  );
  return {
    get: (item: IdleItem) => vectors.get(key(item)),
    has: (item: IdleItem) => vectors.has(key(item)),
    get size() {
      return vectors.size;
    },
    set(item: IdleItem, vector: Float32Array) {
      save.run(key(item), version, new Uint8Array(new Float16Array(vector).buffer));
      vectors.set(key(item), vector);
    },
  };
}
type ImageVectors = ReturnType<typeof createImageVectors>;

/**
 * Image search: SigLIP 2 vectors of finished gallery images, made on the CPU while Studio is idle
 * (domain/idle-work.ts), as a trickle of new images or an administrator's Index Gallery pass, and
 * `near`, which matches a search against them. Images never leave Studio, so every owner's are read.
 */
export function createImageSearch(options: {
  /** The Settings › Models switch (STUDIO_IMAGE_SEARCH). */
  enabled(): boolean;
  encoder: ImageEncoder;
  vectors: ImageVectors;
  idle(): boolean;
  items(): Iterable<IdleItem>;
  visible(item: IdleItem): boolean;
  /** The image file's bytes. */
  image(item: IdleItem): Promise<Uint8Array>;
  load(): IdleDocument | null;
  persist(document: IdleDocument): void;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { encoder, vectors, log = console } = options;
  const work = createIdleWork<IdleItem>({
    ...options,
    name: "Image search",
    off: "Image Search is off in Settings › Models.",
    allowed: () => true,
    unavailable: async () => encoder.unavailable(),
    wanted: (item) => item.type === "image" && !vectors.has(item),
    async run(item) {
      // Once read, the vector is kept even if other work arrived meanwhile.
      vectors.set(item, await encoder.embedImage(await options.image(item)));
    },
  });
  const queries = new Map<string, Float32Array>();
  let failed = "";
  return {
    ...work,
    /**
     * A test for gallery items that look like `text`, or null when there is nothing to compare:
     * Image Search off, no image read yet or the model not downloaded.
     */
    async near(text: string) {
      const query = text.trim().toLowerCase();
      if (!query || !options.enabled() || !vectors.size || !encoder.downloaded()) return null;
      let target = queries.get(query);
      if (!target) {
        try {
          target = await encoder.embedText(query);
        } catch (error) {
          const reason = (error as Error).message;
          if (reason !== failed) log.info(`[Studio] Image search skip: ${reason}`);
          failed = reason;
          return null;
        }
        // Paging repeats a search, so the last few are kept.
        if (queries.size >= 50) queries.delete(queries.keys().next().value!);
        queries.set(query, target);
      }
      const wanted = target;
      return (item: IdleItem) => {
        const vector = vectors.get(item);
        if (!vector) return false;
        let similarity = 0;
        for (let index = 0; index < vector.length; index += 1)
          similarity += vector[index] * wanted[index];
        return similarity >= nearThreshold;
      };
    },
  };
}
