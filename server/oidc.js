import crypto from "node:crypto";

/**
 * OpenID Connect sign-in (Pocket ID) as a PKCE client. The provider proves who
 * someone is; Studio administrators decide what they may do. Nothing here
 * assigns roles or access profiles.
 */

const flowLifetimeMs = 10 * 60 * 1000;
const metadataLifetimeMs = 10 * 60 * 1000;
const maxPendingFlows = 500;
const algorithms = {
  RS256: { hash: "sha256" }, RS384: { hash: "sha384" }, RS512: { hash: "sha512" },
  PS256: { hash: "sha256", padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
  ES256: { hash: "sha256", ecdsa: true }, ES384: { hash: "sha384", ecdsa: true },
  EdDSA: { hash: null }
};

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");
const decodeJson = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const trimSlash = (value) => String(value || "").replace(/\/+$/, "");

export function oidcConfigFromEnv(env = process.env) {
  const issuer = trimSlash(env.STUDIO_OIDC_ISSUER);
  const clientId = String(env.STUDIO_OIDC_CLIENT_ID || "");
  const redirectUri = String(env.STUDIO_OIDC_REDIRECT_URI || "");
  if (!issuer || !clientId || !redirectUri) return null;
  for (const value of [issuer, redirectUri]) {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("STUDIO_OIDC_ISSUER and STUDIO_OIDC_REDIRECT_URI must use HTTPS.");
  }
  return {
    issuer,
    clientId,
    clientSecret: String(env.STUDIO_OIDC_CLIENT_SECRET || ""),
    redirectUri,
    label: String(env.STUDIO_OIDC_LABEL || "Pocket ID").slice(0, 40),
    scopes: "openid email profile"
  };
}

export function createOidcClient(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const flows = new Map();
  let metadata = null;
  let keys = null;

  async function getJson(url) {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`The sign-in provider answered HTTP ${response.status}.`);
    return response.json();
  }

  async function discover() {
    if (metadata && now() - metadata.at < metadataLifetimeMs) return metadata.value;
    const value = await getJson(`${config.issuer}/.well-known/openid-configuration`);
    if (trimSlash(value.issuer) !== config.issuer) throw new Error("The sign-in provider reported a different issuer.");
    for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
      if (!/^https?:\/\//.test(String(value[field] || ""))) throw new Error("The sign-in provider's configuration is incomplete.");
    }
    metadata = { at: now(), value };
    return value;
  }

  async function signingKey(kid, refresh = false) {
    if (!keys || refresh || now() - keys.at > metadataLifetimeMs) {
      const { jwks_uri: uri } = await discover();
      keys = { at: now(), value: (await getJson(uri)).keys || [] };
    }
    const jwk = keys.value.find((key) => !kid || key.kid === kid);
    if (jwk) return crypto.createPublicKey({ key: jwk, format: "jwk" });
    if (!refresh) return signingKey(kid, true);
    throw new Error("The sign-in provider's signing key was not found.");
  }

  function prune() {
    for (const [state, flow] of flows) if (now() - flow.createdAt > flowLifetimeMs) flows.delete(state);
    while (flows.size > maxPendingFlows) flows.delete(flows.keys().next().value);
  }

  /** The provider URL to send the browser to, and the state its callback must return. */
  async function start() {
    const provider = await discover();
    prune();
    const state = base64url(crypto.randomBytes(24));
    const nonce = base64url(crypto.randomBytes(24));
    const verifier = base64url(crypto.randomBytes(48));
    flows.set(state, { nonce, verifier, createdAt: now() });
    const url = new URL(provider.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes,
      state,
      nonce,
      code_challenge: base64url(crypto.createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256"
    }).toString();
    return { url: url.toString(), state };
  }

  async function verifyIdToken(token, nonce) {
    const [headerPart, payloadPart, signaturePart, extra] = String(token || "").split(".");
    if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) throw new Error("The sign-in provider returned an invalid identity token.");
    const header = decodeJson(headerPart);
    const algorithm = algorithms[header.alg];
    if (!algorithm) throw new Error("The sign-in provider used an unsupported signature.");
    const key = await signingKey(header.kid);
    const data = Buffer.from(`${headerPart}.${payloadPart}`);
    const signature = Buffer.from(signaturePart, "base64url");
    const options = algorithm.ecdsa ? { key, dsaEncoding: "ieee-p1363" } : algorithm.padding ? { key, padding: algorithm.padding, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST } : key;
    if (!crypto.verify(algorithm.hash, data, options, signature)) throw new Error("The identity token's signature is invalid.");
    const claims = decodeJson(payloadPart);
    const audiences = [].concat(claims.aud || []);
    const seconds = Math.floor(now() / 1000);
    if (trimSlash(claims.iss) !== config.issuer) throw new Error("The identity token came from another issuer.");
    if (!audiences.includes(config.clientId) || (audiences.length > 1 && claims.azp !== config.clientId)) throw new Error("The identity token was issued for another application.");
    if (!Number.isFinite(claims.exp) || claims.exp + 60 < seconds) throw new Error("The identity token has expired.");
    if (Number.isFinite(claims.nbf) && claims.nbf - 60 > seconds) throw new Error("The identity token is not valid yet.");
    if (claims.nonce !== nonce) throw new Error("The identity token does not match this sign-in.");
    if (typeof claims.sub !== "string" || !claims.sub) throw new Error("The identity token has no subject.");
    return claims;
  }

  /** Completes a callback: the verified identity, or an error. Each state works once. */
  async function finish({ code, state, expectedState }) {
    const flow = state && flows.get(state);
    flows.delete(state);
    if (!flow || !expectedState || state !== expectedState || now() - flow.createdAt > flowLifetimeMs) throw new Error("This sign-in expired or was started elsewhere. Try again.");
    if (!code) throw new Error("The sign-in provider did not return a code.");
    const provider = await discover();
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri, client_id: config.clientId, code_verifier: flow.verifier });
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (config.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`;
    const response = await fetchImpl(provider.token_endpoint, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("The sign-in provider refused the sign-in.");
    const claims = await verifyIdToken((await response.json()).id_token, flow.nonce);
    return {
      issuer: config.issuer,
      subject: claims.sub,
      email: typeof claims.email === "string" ? claims.email.trim() : "",
      emailVerified: claims.email_verified === true,
      name: String(claims.name || claims.preferred_username || "").trim().slice(0, 80)
    };
  }

  return { start, finish, label: config.label };
}
