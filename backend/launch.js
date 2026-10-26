/**
 * Taking the port. When Studio itself already holds it, that copy is running:
 * say where instead of starting a second one.
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

/** Whether a Studio server answers on this port of this computer (at `host`, when it listens on one address). */
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
          try {
            resolve(JSON.parse(body)?.app === "studio");
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

/**
 * Listens on `port` and resolves `{ server, port }` (port 0 reports the one the
 * system gave). Rejects with the listen error; when Studio itself holds the
 * port, the error has `studioRunning`, that `port` and the `host` it answered at.
 */
export async function listenOnPort(handler, { port, host, isStudio = studioAnswersAt } = {}) {
  try {
    const server = await new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.once("error", reject);
      server.listen(Number(port), host, () => {
        server.off("error", reject);
        resolve(server);
      });
    });
    return { server, port: server.address()?.port || Number(port) };
  } catch (error) {
    if (error.code === "EADDRINUSE" && (await isStudio(Number(port), { host }))) {
      error.studioRunning = true;
      error.port = Number(port);
      error.host = probeHost(host);
    }
    throw error;
  }
}
