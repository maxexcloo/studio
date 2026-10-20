/** Byte ranges also work for decrypted/in-memory media (Safari seeks with them). */
export function sendMediaBuffer(req, res, buffer, mime = 'video/mp4') {
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  if (!range) { res.setHeader('Content-Length', buffer.length); res.send(buffer); return; }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : 0;
  let end = match?.[2] ? Number(match[2]) : buffer.length - 1;
  if (match && !match[1] && match[2]) { start = Math.max(0, buffer.length - Number(match[2])); end = buffer.length - 1; }
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= buffer.length) {
    res.setHeader('Content-Range', `bytes */${buffer.length}`); res.status(416).end(); return;
  }
  end = Math.min(end, buffer.length - 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
  res.setHeader('Content-Length', end - start + 1);
  res.send(buffer.subarray(start, end + 1));
}

/**
 * Studio media is stored under unique names and never rewritten
 * (media-store.js), so a browser keeps an original for good. Thumbnails,
 * posters and previews made from it are kept a week, then checked again by
 * ETag in the background, so a change to their size settings still arrives.
 */
export const immutableMediaCache = 'private, max-age=31536000, immutable';
export const derivedMediaCache = 'private, max-age=604800, stale-while-revalidate=2592000';
