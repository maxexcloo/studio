// Asks the running server for a session for the account with the email on stdin,
// through its data folder socket (backend/agent-sign-in.js), and writes the
// server's JSON reply to stdout. Run inside Studio's container by
// `mise run browser-sign-in`, which keeps the reply out of sight.
import net from "node:net";
import path from "node:path";
import { text } from "node:stream/consumers";
import { currentDataDir } from "../data-dir.js";
import { agentSignInSocketName } from "../data-names.js";

const email = await text(process.stdin);
const socket = net.connect(path.join(currentDataDir(), agentSignInSocketName));
socket.end(email);
process.stdout.write(await text(socket));
