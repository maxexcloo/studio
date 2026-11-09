import fs from "node:fs";
import path from "node:path";
import { outputFilenameBelongsToRequest } from "../account-ownership.js";
import { accountAccessForId } from "../account-store.js";
import { withComfyBackend } from "../comfy/backends.js";
import { comfy, inDotFolder, localOutputFile } from "../comfy/comfy.js";
import { ownerMediaTypes } from "../comfy/media-routes.js";
import { queuePriority } from "../domain/store.ts";
import { galleryJobResponse } from "../gallery/routes.js";
import { gallery } from "../gallery/store.js";
import { mediaType, outputMediaPattern } from "../media-paths.js";
import { multiUserEnabled } from "../multi-user-auth.js";
import { defaultWorkerId } from "../workers.js";
import { mcpOutputPath } from "./media.js";

/** A signed MCP result link's file for its owner, as `{ content, mime }`, or null. */
export async function resolveSignedMcpResult(owner, jobId, index) {
  if (!accountAccessForId(owner)?.authenticated) return null;
  const item = gallery.find(
    (entry) =>
      entry.ownerId === owner &&
      entry.jobId === jobId &&
      entry.index === index &&
      entry.status === "done",
  );
  if (!item || !mcpOutputPath(item.url)) return null;
  const source = new URL(item.url, "http://localhost");
  const filename = source.searchParams.get("filename") || "";
  const subfolder = source.searchParams.get("subfolder") || "";
  const type = source.searchParams.get("type") || "output";
  const request = { studioAccount: { userId: owner } };
  if (
    !ownerMediaTypes.has(type) ||
    !outputMediaPattern.test(filename) ||
    inDotFolder(subfolder) ||
    !outputFilenameBelongsToRequest(filename, subfolder, request)
  )
    return null;
  try {
    const backend = item.settings?.comfyBackend || defaultWorkerId();
    // Studio media is read from its folder only, whichever worker made it.
    const file = localOutputFile(filename, subfolder, type);
    if (type === mediaType && !file) return null;
    const bytes = file
      ? await fs.promises.readFile(file)
      : await withComfyBackend(backend, () =>
          comfy(
            `/view?${new URLSearchParams({ filename, ...(subfolder ? { subfolder } : {}), type })}`,
            { timeout: 120000 },
          ),
        );
    const extension = path.extname(filename).toLowerCase();
    const mime = {
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".m4v": "video/mp4",
      ".mkv": "video/x-matroska",
      ".mov": "video/quicktime",
      ".mp4": "video/mp4",
      ".png": "image/png",
      ".webm": "video/webm",
      ".webp": "image/webp",
    }[extension];
    return mime ? { content: Buffer.from(bytes), mime } : null;
  } catch {
    return null;
  }
}

/**
 * MCP's direct domain calls: only generation and its owned results use them; other MCP tools
 * retain their transport. `admit` is domain/admission.ts's; `jobResponse` job-routes.js's.
 */
export function createMcpDomainRequest({ admit, jobResponse, store }) {
  return async (method, route, input, owner) => {
    const url = new URL(route, "http://localhost");
    const jobMatch = method === "GET" && url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    const galleryMatch = method === "GET" && url.pathname.match(/^\/api\/gallery\/jobs\/([^/]+)$/);
    if (!(method === "POST" && url.pathname === "/api/generate") && !jobMatch && !galleryMatch)
      return undefined;
    const account = multiUserEnabled ? accountAccessForId(owner) : undefined;
    if (multiUserEnabled && !account?.authenticated)
      return { status: 401, payload: { ok: false, error: "This account no longer has access." } };
    if (jobMatch)
      return {
        status: 200,
        payload: jobResponse(account, decodeURIComponent(jobMatch[1])),
      };
    if (galleryMatch)
      return galleryJobResponse(
        store,
        account,
        decodeURIComponent(galleryMatch[1]),
        url.searchParams.get("settings") === "1",
      );
    const { queueSet, studioSession, ...body } = input || {};
    // Studio Chat's agent queues into its chat as the person's own work, made from the result it reuses.
    if (studioSession) {
      const parent = studioSession.parent && store.job(owner, studioSession.parent);
      const parentJobId = parent?.sessionId === studioSession.id ? parent.id : undefined;
      return admit(
        body,
        account,
        {
          sessionId: studioSession.id,
          operation:
            body.kind === "video"
              ? "animate"
              : parentJobId && body.referenceAssets?.length
                ? "refine"
                : "image",
          parentJobId,
        },
        { priority: queuePriority.manual, queueSet },
      );
    }
    // External chat work queues after manual Studio requests; its set keeps it together once started.
    return admit(body, account, undefined, { priority: queuePriority.mcp, queueSet });
  };
}
