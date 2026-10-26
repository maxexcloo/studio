import compression from "compression";
import staticGzip from "express-static-gzip";
import path from "node:path";
import { constants } from "node:zlib";
import { isInside } from "./paths.js";

const immutable = "public, max-age=31536000, immutable";
const revalidate = "no-cache";

const cacheControlFor = (dist, file) =>
  isInside(path.join(dist, "assets"), file) ? immutable : revalidate;

/** The built app from `dist`, precompressed copies first, then the page for every other path. */
export function serveApp(app, dist) {
  const root = path.resolve(dist);
  app.use(
    staticGzip(root, {
      enableBrotli: true,
      orderPreference: ["br", "gzip"],
      serveStatic: {
        cacheControl: false,
        setHeaders: (res, file) => res.setHeader("Cache-Control", cacheControlFor(root, file)),
      },
    }),
  );
  // A built file that is not there (a page from before an update asking for an
  // old hash) is missing, not the app page: HTML in place of a script fails obscurely.
  app.get("/assets/*splat", (_req, res) =>
    res.status(404).setHeader("Cache-Control", revalidate).end(),
  );
  app.get("*splat", (_req, res) =>
    res.sendFile(path.join(root, "index.html"), {
      cacheControl: false,
      dotfiles: "allow",
      headers: { "Cache-Control": revalidate },
    }),
  );
}

/**
 * Compresses `res.json` answers of at least `minBytes` for browsers that
 * accept it. `skip(req)` leaves a request alone (this computer's own browser).
 */
export function compressJson({ minBytes = 1024, skip = () => false } = {}) {
  return compression({
    brotli: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
    filter: (req, res) =>
      !skip(req) &&
      /^application\/json(?:;|$)/i.test(String(res.getHeader("Content-Type") || "")) &&
      compression.filter(req, res),
    threshold: minBytes,
  });
}
