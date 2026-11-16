import dns from "node:dns";
import net from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { logWarning } from "../crash-log.js";
import { directRoute } from "../domain/direct-route.ts";
import { detectLink } from "../library/sources.js";
import { imageMimes } from "../reference-names.js";
import { readStreamUpload, saveUpload } from "../references.js";
import { localRefusal } from "../route-access.js";
import { importRedditPost, isRedditLink } from "./reddit.js";

/**
 * POST /api/gallery/import/link {url}: the gallery's Import › From URL. A Reddit post saves its
 * images as the caller's uploads (gallery/reddit.js); a Civitai or Hugging Face link starts a
 * Library import, for administrators (library/routes.js `importLink`); any other link must be an
 * image or video itself, saved as one upload. Direct links are fetched only from public addresses.
 */
const mediaMimes = [...imageMimes, "video/mp4", "video/webm"];
const redirects = 3;

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
])
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
])
  blocked.addSubnet(address, prefix, "ipv6");
const privateAddress = (address, family) =>
  blocked.check(address, family === 6 || family === "IPv6" ? "ipv6" : "ipv4");
const refusedAddress = () => new Error("That link points to a private address.");

/** Resolves a host as the connection does, refusing it when any address is private. */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (
      !addresses.length ||
      addresses.some(({ address, family }) => privateAddress(address, family))
    )
      return callback(refusedAddress());
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}
const publicOnly = new Agent({ connect: { lookup: publicLookup } });

/** GETs a public link, following up to three redirects that stay on public http(s) addresses. */
export async function fetchPublic(link) {
  let url = new URL(link);
  for (let hop = 0; ; hop++) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Paste an http or https link.");
    // A literal address never reaches the lookup.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && privateAddress(literal, net.isIP(literal))) throw refusedAddress();
    const response = await undiciFetch(url, {
      redirect: "manual",
      dispatcher: publicOnly,
      signal: AbortSignal.timeout(60000),
    }).catch((error) => {
      throw error.cause?.message === refusedAddress().message
        ? error.cause
        : new Error("That link couldn't be reached.");
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location && hop < redirects) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`That link answered ${response.status}.`);
    }
    return response;
  }
}

/** Saves the image or video a link points at as `ownerId`'s upload. */
export async function importMediaLink(link, ownerId = "", { fetch: fetcher = fetchPublic } = {}) {
  const response = await fetcher(link);
  const mime = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!mediaMimes.includes(mime)) {
    await response.body?.cancel();
    throw new Error("That link isn't a PNG, JPEG or WebP image or an MP4 or WebM video.");
  }
  const url = new URL(link);
  const name = decodeURIComponent(url.pathname.split("/").pop() || "") || url.hostname;
  const upload = await readStreamUpload(response.body, { name, mime });
  return (await saveUpload({ ...upload, source: { url: url.href } }, ownerId)).item;
}

/** A link a Library import resolves (Civitai or Hugging Face), rather than one to fetch. */
function libraryLink(link) {
  try {
    detectLink(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * `importLink(account, url)` starts a Library import; `uploaded(item)` hears of each saved upload,
 * for image search.
 */
export function registerLinkImportRoute(
  app,
  { importLink, uploaded = () => {}, fetchReddit = fetch, fetchMedia = fetchPublic } = {},
) {
  directRoute(app, "POST", "/api/gallery/import/link", async (account, { body }) => {
    const refused = account ? null : localRefusal(account);
    if (refused) return refused;
    const link = String(body?.url || "").trim();
    try {
      if (libraryLink(link)) {
        const admin = localRefusal(account);
        if (admin) return admin;
        return { status: 201, payload: { ok: true, import: await importLink(account, link) } };
      }
      if (isRedditLink(link)) {
        const result = await importRedditPost(link, account?.userId || "", { fetch: fetchReddit });
        for (const item of result.items) uploaded(item);
        if (result.failed.length)
          logWarning("Reddit import failed", {
            account: account?.userId,
            imported: result.items.length,
            failed: result.failed.length,
            reason: result.failed[0].error,
          });
        return {
          status: result.items.length ? 201 : 422,
          payload: {
            ok: result.items.length > 0,
            title: result.title,
            imported: result.items.length,
            failed: result.failed,
            ...(result.items.length
              ? {}
              : { error: `None of that post's images could be saved: ${result.failed[0].error}` }),
          },
        };
      }
      let url;
      try {
        url = new URL(link);
      } catch {
        throw new Error("Paste a link to an image, a video or a Reddit post.");
      }
      const item = await importMediaLink(url.href, account?.userId || "", { fetch: fetchMedia });
      uploaded(item);
      return { status: 201, payload: { ok: true, imported: 1, failed: [] } };
    } catch (error) {
      logWarning("Link import failed", { account: account?.userId, reason: error.message });
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });
}
