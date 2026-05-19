import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from './gallery-store.js';

const startImageDir = path.join(dataDir, "start-images");
const memoryCache = new Map();

function extensionForMime(mime = "image/png") {
  if (/jpe?g/i.test(mime)) return "jpg";
  if (/webp/i.test(mime)) return "webp";
  return "png";
}

function parseDataUrl(dataUrl = "") {
  if (!String(dataUrl).includes(",")) throw new Error("Start image is not a data URL.");
  const [header, data] = String(dataUrl).split(",", 2);
  const mime = header.match(/data:(.*?);base64/i)?.[1] || "image/png";
  return { mime, buffer: Buffer.from(data, "base64") };
}

export function saveStartImage({ dataUrl = "", name = "" } = {}) {
  const { mime, buffer } = parseDataUrl(dataUrl);
  const id = crypto.randomUUID();
  const safeName = path.basename(String(name || `start-image.${extensionForMime(mime)}`)).replace(/[^\w.-]+/g, "-");
  const filename = `${id}-${safeName || `start-image.${extensionForMime(mime)}`}`;
  fs.mkdirSync(startImageDir, { recursive: true });
  const filePath = path.join(startImageDir, filename);
  fs.writeFileSync(filePath, buffer);
  const record = { id, name: safeName, mime, size: buffer.length, filePath };
  memoryCache.set(id, record);
  return { startImageId: id, name: safeName, mime, size: buffer.length };
}

export function resolveStartImage(id = "") {
  const key = String(id || "");
  if (!key) return null;
  const cached = memoryCache.get(key);
  if (cached && fs.existsSync(cached.filePath)) return cached;
  if (!fs.existsSync(startImageDir)) return null;
  const match = fs.readdirSync(startImageDir).find((file) => file.startsWith(`${key}-`));
  if (!match) return null;
  const filePath = path.join(startImageDir, match);
  const ext = path.extname(match).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  const record = { id: key, name: match.slice(key.length + 1), mime, size: fs.statSync(filePath).size, filePath };
  memoryCache.set(key, record);
  return record;
}

export function startImageDataUrl(id = "") {
  const record = resolveStartImage(id);
  if (!record) return "";
  const data = fs.readFileSync(record.filePath).toString("base64");
  return `data:${record.mime};base64,${data}`;
}
