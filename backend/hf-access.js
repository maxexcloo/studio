import { envFileKeys } from "./env.js";

/**
 * How Studio reaches Hugging Face for model downloads, the way the Hugging Face
 * tools themselves do it:
 *   - a token (HF_TOKEN or HUGGING_FACE_HUB_TOKEN, from the environment or
 *     .env) opens gated repos. It goes to huggingface.co over HTTPS and
 *     nowhere else: not to a mirror, not to the CDN a download redirects to.
 *   - HF_ENDPOINT points downloads at a mirror (hf-mirror.com, a company
 *     proxy) instead of huggingface.co.
 */

const tokenKeys = ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"];

/** The token in use and where it came from ("file" when read from .env, "environment" when set outside). */
function hfToken(env = process.env) {
  for (const key of tokenKeys) {
    const value = String(env[key] || "").trim();
    if (value) return { token: value, source: envFileKeys.has(key) ? "file" : "environment", key };
  }
  return { token: "", source: "", key: "" };
}

/** What a refusal from a Hugging Face repository asks of the administrator. */
export function hfAccessNote(repo, env = process.env) {
  const page = `https://huggingface.co/${repo}`;
  return hfToken(env).token
    ? `Hugging Face needs access to this gated repository: accept its terms at ${page} with the account the deployment's token belongs to.`
    : `Hugging Face needs a token for this repository: add HF_TOKEN to the deployment and accept its terms at ${page}.`;
}

/** The credential for the worker's own Hugging Face download, or "". */
export function hfTokenValue(env = process.env) {
  return hfToken(env).token;
}

/** Whether downloads go to a mirror instead of huggingface.co. */
export function hfMirrored(env = process.env) {
  return Boolean(hfEndpoint(env));
}

/** Whether a token is set, where from and under which name, never the token itself. */
export function hfTokenStatus(env = process.env) {
  const { token, source, key } = hfToken(env);
  return { set: Boolean(token), source, ...(token ? { key, hint: `hf_…${token.slice(-4)}` } : {}) };
}

/** The mirror downloads go to instead of huggingface.co, or null. */
function hfEndpoint(env = process.env) {
  const raw = String(env.HF_ENDPOINT || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.hostname === "huggingface.co") return null;
    return url;
  } catch {
    return null;
  }
}

/** A catalogue URL, pointed at the mirror when one is set. Only huggingface.co addresses move. */
export function mirroredUrl(value, env = process.env) {
  const url = new URL(String(value));
  const mirror = hfEndpoint(env);
  if (!mirror || url.hostname !== "huggingface.co") return url;
  const base = mirror.pathname.replace(/\/+$/, "");
  return new URL(`${mirror.protocol}//${mirror.host}${base}${url.pathname}${url.search}`);
}

/* ------------------------------------------------------------ Fetch */

const redirects = new Set([301, 302, 303, 307, 308]);

/**
 * fetch for Hugging Face downloads: mirror and token applied, and
 * redirects followed by hand so the token never leaves huggingface.co.
 * `transport` replaces the network in tests.
 */
export async function hfFetch(input, init = {}, { env = process.env, transport = null } = {}) {
  let url = mirroredUrl(input, env);
  const { token } = hfToken(env);
  for (let hop = 0; hop <= 10; hop += 1) {
    const headers = new Headers(init.headers || {});
    headers.delete("authorization");
    if (token && url.protocol === "https:" && url.hostname === "huggingface.co")
      headers.set("authorization", `Bearer ${token}`);
    const options = { ...init, headers, redirect: "manual" };
    const response = await (transport || fetch)(url, options);
    const location = response.headers.get("location");
    if (!redirects.has(response.status) || !location) return response;
    await response.body?.cancel().catch(() => {});
    url = new URL(location, url);
  }
  throw new Error("Hugging Face kept redirecting the download.");
}
