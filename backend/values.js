import crypto from "node:crypto";

/** Whether `value` is a plain record: an object that is not an array. */
export const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The SHA-256 of `bytes` (a string or Buffer), as hex. */
export const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
