import fs from "node:fs";
import querystring from "node:querystring";
import { outputFilenameBelongsToRequest } from "../account-ownership.js";
import { accountAccessForId } from "../account-store.js";
import { withComfyBackend } from "../comfy/backends.js";
import { comfy, inDotFolder, localOutputFile } from "../comfy/comfy.js";
import { comfyView, outputMime, ownerMediaTypes } from "../comfy/media-routes.js";
import { findDirectRoute } from "../domain/direct-route.ts";
import { queuePriority } from "../domain/store.ts";
import { gallery } from "../gallery/store.js";
import { mediaType, outputMediaPattern } from "../media-paths.js";
import { mcpAccount, multiUserEnabled } from "../multi-user-auth.js";
import { multiUserRefusal, publicAccountPaths } from "../multi-user-gate.js";
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
    const mime = outputMime(filename);
    return mime === "application/octet-stream" ? null : { content: Buffer.from(bytes), mime };
  } catch {
    return null;
  }
}

/**
 * MCP's calls into Studio, in process: `(method, route, body, owner, credential, signal)` answers as the
 * route `app` registered with directRoute (domain/direct-route.ts) does, as `{ status, payload }` or
 * a file's `{ status, content, mime }`, after the gate a request with that credential meets
 * (multi-user-auth.js mcpAccount). Generation is admitted with MCP's own queue priority; `admit` is
 * domain/admission.ts's.
 */
export function createMcpDomainRequest({ app, admit, store }) {
  return async (method, route, input, owner, credential, signal) => {
    const url = new URL(route, "http://localhost");
    const routePath = url.pathname;
    let account;
    if (multiUserEnabled) {
      account = mcpAccount(owner, credential, method, routePath);
      const refusal =
        !publicAccountPaths.has(routePath) && multiUserRefusal(account, method, routePath);
      if (refusal) return refusal;
    }
    const query = querystring.parse(url.search.slice(1));
    // A route reads its body as JSON, as it arrived over HTTP; an upload carries its file's bytes.
    const body =
      input === undefined || routePath === "/api/reference-assets/upload"
        ? input
        : JSON.parse(JSON.stringify(input));
    try {
      if (method === "GET" && routePath === "/comfy/view") return await comfyView(account, query);
      if (method === "POST" && routePath === "/api/generate")
        return await generate(body, account, owner);
      const found = findDirectRoute(app, method, routePath);
      if (!found) throw new Error(`Studio has no route ${method} ${routePath}.`);
      return await found.run(account, { params: found.params, query, body, stop: signal });
    } catch (error) {
      // As Express answers a route that throws.
      console.error(`[mcp] ${method} ${routePath} failed:`, error);
      return { status: 500, payload: {} };
    }
  };

  function generate({ queueSet, studioSession, ...body }, account, owner) {
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
  }
}
