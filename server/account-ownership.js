import crypto from "node:crypto";
import path from "node:path";

/** The authenticated server identity is the only source of a content owner ID. */
export function ownerIdForRequest(req) {
  return typeof req?.heissAccount?.userId === "string" ? req.heissAccount.userId : "";
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

export function accountOutputSubfolder(ownerId) {
  if (typeof ownerId !== "string" || !ownerId) return "";
  const stable = crypto.createHash("sha256").update(ownerId).digest("hex");
  return `heiss-ui/accounts/${stable}`;
}

export function outputSubfolderBelongsToRequest(subfolder, req) {
  const ownerId = ownerIdForRequest(req);
  if (!ownerId) return process.env.STUDIO_MULTI_USER !== "1";
  const prefix = `${accountOutputSubfolder(ownerId)}/`;
  return typeof subfolder === "string" && subfolder.startsWith(prefix);
}

export function outputFilenameBelongsToRequest(filename, subfolder, req) {
  if (typeof filename !== "string" || !filename || filename !== path.basename(filename) || /[\\/]/.test(filename)) return false;
  const ownerId = ownerIdForRequest(req);
  if (!ownerId) return process.env.STUDIO_MULTI_USER !== "1";
  const root = accountOutputSubfolder(ownerId);
  return subfolder === root || outputSubfolderBelongsToRequest(subfolder, req);
}
