import crypto from "node:crypto";
import path from "node:path";
import { accountFolders } from "./data-names.js";

/** The authenticated server identity is the only source of a content owner ID. */
export function ownerIdForRequest(req) {
  return typeof req?.studioAccount?.userId === "string" ? req.studioAccount.userId : "";
}

/** Legacy single-user records remain visible only in the single-user mode. */
export function recordBelongsToRequest(record, req) {
  const ownerId = ownerIdForRequest(req);
  if (!ownerId) return process.env.STUDIO_MULTI_USER !== "1";
  return record?.ownerId === ownerId;
}

export function recordsForRequest(records, req) {
  return records.filter((record) => recordBelongsToRequest(record, req));
}

const ownerHash = (ownerId) => crypto.createHash("sha256").update(ownerId).digest("hex");

/** The account's folder new outputs go to. */
export function accountOutputSubfolder(ownerId) {
  if (typeof ownerId !== "string" || !ownerId) return "";
  return accountFolders(ownerHash(ownerId))[0];
}

/** The account's folder under every name it may have (data-names.js): the written one, then the migration's. */
function accountOutputSubfolders(ownerId) {
  return typeof ownerId === "string" && ownerId ? accountFolders(ownerHash(ownerId)) : [];
}

export function outputSubfolderBelongsToRequest(subfolder, req) {
  const ownerId = ownerIdForRequest(req);
  if (!ownerId) return process.env.STUDIO_MULTI_USER !== "1";
  return typeof subfolder === "string" && accountOutputSubfolders(ownerId).some((folder) => subfolder.startsWith(`${folder}/`));
}

export function outputFilenameBelongsToRequest(filename, subfolder, req) {
  if (typeof filename !== "string" || !filename || filename !== path.basename(filename) || /[\\/]/.test(filename)) return false;
  const ownerId = ownerIdForRequest(req);
  if (!ownerId) return process.env.STUDIO_MULTI_USER !== "1";
  return accountOutputSubfolders(ownerId).includes(subfolder) || outputSubfolderBelongsToRequest(subfolder, req);
}
