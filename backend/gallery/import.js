import { directRoute } from "../domain/direct-route.ts";
import { readMultipartUpload, saveUpload } from "../references.js";
import { localRefusal } from "../route-access.js";
import { promptTitle } from "./records.js";

const text = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\x00-\x08\x0b-\x1f\x7f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/**
 * What an imported picture records of where it was made: its prompt, model, creation time and
 * source link with title. Anything missing or unreadable is left out; a time must be a real past
 * time.
 */
export function importRecord(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const time = Date.parse(typeof record.createdAt === "string" ? record.createdAt : "");
  let url = "";
  try {
    const link = new URL(String(record.source?.url || ""));
    if (["http:", "https:"].includes(link.protocol)) url = link.href;
  } catch {}
  const title = text(record.source?.title, 160);
  return {
    prompt: text(record.prompt, 20000),
    model: text(record.model, 80),
    createdAt: Number.isFinite(time) && time <= Date.now() ? new Date(time).toISOString() : "",
    source: url ? { url, ...(title ? { title } : {}) } : undefined,
  };
}

/**
 * Saves a picture made elsewhere (another app's history) as `ownerId`'s upload with its record
 * (`importRecord`). An upload of the same bytes is kept as it is, so an import can run again.
 */
export async function importUpload(upload, record, ownerId = "") {
  const kept = importRecord(record);
  return saveUpload(
    { ...upload, ...kept, name: kept.prompt ? promptTitle(kept.prompt) : upload.name },
    ownerId,
  );
}

/**
 * POST /api/gallery/import: a form's `image` file and its `record` field (JSON, `importRecord`),
 * saved into the caller's own uploads. `uploaded(item)` hears of each new one, for image search.
 */
export function registerGalleryImportRoute(app, { uploaded = () => {} } = {}) {
  app.post("/api/gallery/import", async (req, res, next) => {
    try {
      const upload = await readMultipartUpload(req);
      req.body = { upload, record: JSON.parse(upload.fields.record || "{}") };
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next();
  });
  directRoute(app, "POST", "/api/gallery/import", async (account, { body }) => {
    const refused = account ? null : localRefusal(account);
    if (refused) return refused;
    try {
      const { item, added } = await importUpload(body.upload, body.record, account?.userId || "");
      if (added) uploaded(item);
      return { status: added ? 201 : 200, payload: { ok: true, id: item.id, added } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });
}
