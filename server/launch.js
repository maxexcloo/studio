/**
 * Finding a port: when the one asked for is taken by another program, Studio
 * UI takes the next free one (8788, 8789, …) instead of stopping with a note
 * to edit .env. When it is taken by Studio itself, that copy is already
 * running: say where instead of starting a second one.
 */
import http from "node:http";

/**
 * Where to ask whether Studio holds a port: the address it listens on when
 * that is one address (HOST=192.168.1.20), this computer when it listens on
 * all of them.
 */
export function probeHost(host = "") {
  const text = String(host || "")
    .trim()
    .replace(/^\[|\]$/g, "");
  return !text || text === "0.0.0.0" || text === "::" || text === "localhost" ? "127.0.0.1" : text;
}

/** Whether a Studio server (or an older HEISS UI one) answers on this port of this computer (at `host`, when it listens on one address). */
export function studioAnswersAt(port, { timeoutMs = 1500, host = "" } = {}) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: probeHost(host), port, path: "/api/ping", timeout: timeoutMs },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        response.on("end", () => {
          // Older versions have no /api/ping, but their unknown-route answer names Studio.
          try {
            const data = JSON.parse(body);
            resolve(
              data?.app === "studio" ||
                data?.app === "heiss-ui" ||
                /Studio/.test(String(data?.error || "")),
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function listenOnce(handler, port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/**
 * Listens on `port`, or on the next free one when another program has it.
 * Resolves `{ server, port, moved }`. Rejects with the listen error; when
 * Studio itself holds a port on the way, the error has `studioRunning`, that
 * `port` and the `host` it answered at. `tries` ports are tried in all; `fallback: false` tries one;
 * `skip` names ports the fallback passes over.
 */
export async function listenWithFallback(
  handler,
  { port, host, tries = 10, fallback = true, skip = [], isStudio = studioAnswersAt } = {},
) {
  const first = Number(port);
  for (let offset = 0; ; offset += 1) {
    const candidate = first + offset;
    // A port kept for something else of ours (HTTPS for other devices) is passed over.
    if (offset > 0 && skip.includes(candidate)) continue;
    try {
      const server = await listenOnce(handler, candidate, host);
      // Port 0 asks the system for any free port; report the one it gave.
      return { server, port: server.address()?.port || candidate, moved: offset > 0 };
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      if (await isStudio(candidate, { host })) {
        error.studioRunning = true;
        error.port = candidate;
        error.host = probeHost(host);
        throw error;
      }
      if (!fallback || offset + 1 >= tries || candidate >= 65535) {
        error.port = first;
        throw error;
      }
    }
  }
}
