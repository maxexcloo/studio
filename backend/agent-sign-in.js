import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { accountCookieName } from "./access.js";
import { createEmailSession } from "./account-store.js";
import { logEvent } from "./crash-log.js";
import { currentDataDir } from "./data-dir.js";
import { agentSignInSocketName } from "./data-names.js";

/**
 * Signs an agent's browser in as an account, for whoever can already run commands in Studio's
 * container (backend/commands/agent-session.mjs): the socket is reachable only through the data
 * folder, never over the network. The server owns the session store, so sessions are made here.
 */
export function listenForAgentSignIn(
  socketPath = path.join(currentDataDir(), agentSignInSocketName),
) {
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let email = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (email += chunk));
    socket.on("end", () => {
      let reply;
      try {
        const { accountId, token, maxAge } = createEmailSession(email.trim());
        logEvent("Signed an agent's browser in", { accountId });
        reply = { name: accountCookieName, value: token, maxAge };
      } catch (error) {
        reply = { error: error.message };
      }
      socket.end(JSON.stringify(reply));
    });
  });
  server.listen(socketPath);
  server.unref();
  return server;
}
