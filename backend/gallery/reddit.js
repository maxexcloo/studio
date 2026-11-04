import { ownerIdForRequest } from "../account-ownership.js";
import { imageMimes } from "../reference-names.js";
import { maxUploadBytes, saveUpload } from "../references.js";
import { requireLocal } from "../route-access.js";

/**
 * Import from Reddit: a post's images saved as the caller's uploads, each recording the post's link
 * and title (`source`). Every request goes to the owner's Redlib front end, which serves a post as
 * HTML and proxies its images under its own `/img/` and `/preview/` paths, so Studio never fetches
 * another host.
 */
export const redlib = "https://reddit.excloo.com";
// Links people paste: Reddit's own, its short links, and Redlib's.
const postHosts = new Set([
  "m.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "old.reddit.com",
  "redd.it",
  "reddit.com",
  "reddit.excloo.com",
  "www.reddit.com",
]);
const maxPageBytes = 5 * 1024 * 1024;
const redirects = 3;

/** The Redlib path for a pasted Reddit post or gallery link. */
export function redditPostPath(link) {
  let url;
  try {
    url = new URL(String(link || "").trim());
  } catch {
    throw new Error("Paste a link to a Reddit post.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !postHosts.has(url.hostname.toLowerCase()))
    throw new Error("Only Reddit post links can be imported.");
  const id =
    url.hostname.toLowerCase() === "redd.it"
      ? url.pathname.match(/^\/(\w+)\/?$/)?.[1]
      : url.pathname.match(/^(?:\/r\/\w+)?\/(?:gallery|comments)\/(\w+)/)?.[1];
  if (id) return `/comments/${id}`;
  // A share link keeps its path; Redlib resolves it to the post.
  const share = url.pathname.match(/^\/r\/\w+\/s\/\w+/)?.[0];
  if (!share) throw new Error("Paste a link to a Reddit post.");
  return share;
}

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (text) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name) =>
    name[0] === "#"
      ? String.fromCodePoint(Number(name[1] === "x" ? `0${name.slice(1)}` : name.slice(1)))
      : (entities[name.toLowerCase()] ?? whole),
  );

/** A Redlib post page's title and full-size image paths (one for an image post, each of a gallery's). */
export function redditPostImages(html) {
  const heading = html.match(/<h1 class="post_title">([\s\S]*?)<\/h1>/)?.[1] || "";
  // The flair is a link inside the heading.
  const title = decode(
    heading
      .replace(/<a\b[\s\S]*?<\/a>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const media = html.match(/<!-- POST MEDIA -->([\s\S]*?)<!-- POST BODY -->/)?.[1] || "";
  const paths = [...media.matchAll(/<a href="(\/(?:img|preview)\/[^"]+)"/g)].map((match) =>
    decode(match[1]),
  );
  return { title, paths: [...new Set(paths)] };
}

/** Reads a response's body, refusing one longer than `limit` bytes as it arrives. */
async function cappedBody(response, limit, tooLarge) {
  if (Number(response.headers.get("content-length") || 0) > limit) throw new Error(tooLarge);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error(tooLarge);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** GETs a Redlib path, following only redirects that stay on Redlib. */
async function fromRedlib(fetcher, route) {
  let url = new URL(route, redlib);
  for (let hop = 0; ; hop++) {
    if (url.origin !== redlib) throw new Error("Reddit sent the import somewhere else.");
    const response = await fetcher(url, {
      redirect: "manual",
      // Redlib shows a NSFW post only with this preference.
      headers: { Cookie: "show_nsfw=on" },
      signal: AbortSignal.timeout(30000),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location && hop < redirects) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "That Reddit post wasn’t found."
          : `Reddit returned ${response.status}.`,
      );
    return response;
  }
}

/**
 * Saves a Reddit post's images as `ownerId`'s uploads. Resolves to the post's title, the saved
 * items and each image that failed with its reason; a post without images is an error.
 */
export async function importRedditPost(link, ownerId = "", { fetch: fetcher = fetch } = {}) {
  const route = redditPostPath(link);
  const page = await fromRedlib(fetcher, route);
  const { title, paths } = redditPostImages(
    (await cappedBody(page, maxPageBytes, "That Reddit page is too large.")).toString(),
  );
  if (!paths.length) throw new Error("That Reddit post has no images.");
  const source = { url: new URL(route, "https://www.reddit.com").href, title };
  const items = [];
  const failed = [];
  for (const [index, imagePath] of paths.entries()) {
    try {
      const response = await fromRedlib(fetcher, imagePath);
      const mime = String(response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!imageMimes.includes(mime)) throw new Error("It isn’t a PNG, JPEG or WebP image.");
      const buffer = await cappedBody(
        response,
        maxUploadBytes,
        `Images can be up to ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`,
      );
      const name = `${title || "Reddit image"} ${index + 1}`.slice(0, 160);
      items.push((await saveUpload({ buffer, name, mime, source }, ownerId)).item);
    } catch (error) {
      failed.push({ image: index + 1, error: error.message });
    }
  }
  return { title, items, failed };
}

/** `uploaded(item)` hears of each saved image, for image search. */
export function registerRedditImportRoute(
  app,
  { uploaded = () => {}, fetch: fetcher = fetch } = {},
) {
  app.post("/api/gallery/import/reddit", async (req, res) => {
    if (!req.studioAccount && !requireLocal(req, res)) return;
    try {
      const result = await importRedditPost(req.body?.url, ownerIdForRequest(req), {
        fetch: fetcher,
      });
      for (const item of result.items) uploaded(item);
      res.status(result.items.length ? 201 : 422).json({
        ok: result.items.length > 0,
        title: result.title,
        imported: result.items.length,
        failed: result.failed,
        ...(result.items.length
          ? {}
          : { error: `None of that post’s images could be saved: ${result.failed[0].error}` }),
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
