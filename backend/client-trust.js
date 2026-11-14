
/**
 * Who is asking: this computer, or someone else. Every trust decision in the
 * server goes through clientOf(req).
 *
 * "This computer" means the request arrived over loopback and nothing sat in
 * between. A reverse proxy or tunnel on the same machine (Caddy, nginx,
 * `tailscale serve`, cloudflared, ngrok) also connects over loopback, but for
 * someone else, so any proxy header makes a request remote, whatever its
 * socket says. Single-user Studio answers only this computer; account mode
 * answers anyone with an account.
 */

/** Headers a proxy adds. Any one of them means the socket's address is not the client's. */
const proxyHeaders = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "via",
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
];

const loopback = new Set(["127.0.0.1", "::1"]);

/** "::ffff:192.168.1.4" and "192.168.1.4" are the same client. */
function plainAddress(value = "") {
  return String(value || "")
    .trim()
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "")
    .toLowerCase();
}

function isLoopbackAddress(value = "") {
  const address = plainAddress(value);
  return loopback.has(address) || /^127\.\d+\.\d+\.\d+$/.test(address);
}

function hasProxyHeaders(headers = {}) {
  return proxyHeaders.some((name) => headers[name] !== undefined && headers[name] !== "");
}

/** Whether a server on this host answers other devices, not only this computer. */
export function listensBeyondThisComputer(host = "") {
  return !["127.0.0.1", "localhost", "::1", ""].includes(host);
}

/**
 * The facts about one request, worked out once:
 *   address       who the server thinks the client is
 *   proxied       something between the client and this server added headers
 *   thisComputer  the browser runs on the machine Studio runs on
 */
export function classifyClient(req) {
  const headers = req?.headers || {};
  const address = plainAddress(req?.socket?.remoteAddress || "");
  const proxied = hasProxyHeaders(headers);
  const thisComputer = !proxied && isLoopbackAddress(address);
  return { address: proxied ? `proxied:${address}` : address, proxied, thisComputer };
}
