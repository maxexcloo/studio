import path from "node:path";

import sharp from "sharp";

import type { QueueMedia } from "../../shared/queue.ts";
import { modelOf } from "../domain/queue.ts";
import type { OwnedJob } from "../domain/store.ts";
import { mediaUrls } from "../media-paths.js";
import { digest } from "../values.js";

/** Provider outputs use existing Studio media names and result-link shapes. */
export function providerMediaWriter(
  root: string,
  subfolderFor: (ownerId: string) => string,
  writeBytes: (file: string, bytes: Uint8Array, options: { mode: number }) => Promise<unknown>,
  withPngText: (buffer: Buffer, keyword: string, value: string) => Buffer | null,
) {
  return async (
    job: OwnedJob,
    index: number,
    bytes: Uint8Array,
    kind: "image" | "video",
    model: string,
    providerPrompt: string,
  ): Promise<QueueMedia> => {
    const subfolder = subfolderFor(job.ownerId);
    const directory = path.join(root, subfolder);
    const filename = `${digest(job.id)}-${index}.${kind === "video" ? "mp4" : "png"}`;
    const destination = path.join(directory, filename);
    let content = kind === "image" ? await sharp(bytes).png().toBuffer() : bytes;
    const dimensions = kind === "image" ? await sharp(content).metadata() : undefined;
    if (kind === "image") {
      const metadata = {
        prompt: String(job.input.prompt || "").trim(),
        providerPrompt,
        Model: model,
        provider: "cliproxyapi",
        profileId: modelOf(job.input),
        width: dimensions!.width,
        height: dimensions!.height,
      };
      const annotated = withPngText(Buffer.from(content), "civitai", JSON.stringify(metadata));
      if (!annotated) throw new Error("Could not retain the cloud image generation metadata.");
      content = annotated;
    }
    await writeBytes(destination, content, { mode: 0o600 });
    return {
      id: `${job.id}-${index}`,
      jobId: job.id,
      index,
      type: kind,
      status: "done",
      ...mediaUrls(filename, subfolder),
      filename,
      provider: "cliproxyapi",
      providerModel: model,
      ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    };
  };
}
