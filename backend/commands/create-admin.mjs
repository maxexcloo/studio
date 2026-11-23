// Creates a multi-user Studio's recovery administrator through the running server's loopback
// bootstrap, for when no browser reaches Studio over loopback (a container without host
// networking): `docker exec -it studio node backend/commands/create-admin.mjs --email <address>`.
// The password is typed twice without echo, or read from stdin when that isn't a terminal.
import "../env.js";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";

import { port } from "../comfy/comfy.js";

const { values } = parseArgs({ options: { email: { type: "string" } } });
if (!values.email) throw new Error("Provide --email for the administrator.");

/** One line typed at the terminal without echo. */
function hidden(prompt) {
  process.stderr.write(prompt);
  process.stdin.setRawMode(true).setEncoding("utf8").resume();
  return new Promise((resolve, reject) => {
    let line = "";
    const done = (error) => {
      process.stdin.off("data", typed).setRawMode(false).pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(line);
    };
    const typed = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") return done();
        if (character === "\u0003") return done(new Error("Cancelled."));
        if (character === "\u007f" || character === "\b") line = line.slice(0, -1);
        else line += character;
      }
    };
    process.stdin.on("data", typed);
  });
}

let password;
if (process.stdin.isTTY) {
  password = await hidden("Password: ");
  if ((await hidden("Repeat password: ")) !== password) throw new Error("The passwords differ.");
} else password = (await text(process.stdin)).replace(/\r?\n$/, "");

const response = await fetch(`http://127.0.0.1:${port}/api/accounts/bootstrap`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: values.email, password }),
});
if (!response.ok) throw new Error((await response.json()).error);
console.log(`Created the administrator ${values.email}. Sign in with that email and password.`);
