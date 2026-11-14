// Signs agent-browser in to live Studio and LibreChat as this checkout's Git user
// (`git config user.email`), with no passkey: each app makes the session inside
// its own pod through kubectl exec. The cookies go straight into a private state
// file and are never printed.
//
//   mise run browser-sign-in
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Runs kubectl with `input` on stdin and returns its last line of stdout as JSON. A failure
// reports only its status: stdout may hold a session.
function lastJson(args, input) {
  const run = spawnSync("kubectl", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (run.status !== 0)
    throw new Error(`kubectl ${args.slice(0, 4).join(" ")} failed (${run.status}).`);
  try {
    return JSON.parse(run.stdout.trim().split("\n").at(-1));
  } catch {
    throw new Error(`kubectl ${args.slice(0, 4).join(" ")} gave no reply.`);
  }
}

// LibreChat's own sign-in session (what setAuthTokens makes), from its data layer alone: loading the
// whole app beside the running server takes the pod past its memory limit. The app trades the refresh
// session for an access token on load.
const libreChatSession = (email) => `
const mongoose = require("mongoose");
const { createMethods, createModels } = require("@librechat/data-schemas");
createModels(mongoose);
const { createSession, findUser } = createMethods(mongoose);
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await findUser({ email: ${JSON.stringify(email)} }, "_id");
  if (!user) throw new Error("No LibreChat user has that email.");
  const { session, refreshToken } = await createSession(user._id.toString());
  const options = { expires: session.expiration, httpOnly: true };
  const cookies = [
    { name: "refreshToken", value: refreshToken, options },
    { name: "token_provider", value: "librechat", options },
  ];
  process.stdout.write("\\n" + JSON.stringify(cookies) + "\\n", () => process.exit(0));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
`;

const email = execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim();
const env = Object.fromEntries(
  JSON.parse(
    execFileSync("kubectl", ["get", "deploy", "-n", "studio", "studio", "-o", "json"], {
      encoding: "utf8",
    }),
  )
    .spec.template.spec.containers.find((container) => container.name === "studio")
    .env.filter((item) => "value" in item)
    .map((item) => [item.name, item.value]),
);
const studioHost = env.ROUTE_HOST;
const chatHost = new URL(env.STUDIO_CHAT_URL).hostname;

const studio = lastJson(
  [
    "exec",
    "-i",
    "-n",
    "studio",
    "deploy/studio",
    "-c",
    "studio",
    "--",
    "node",
    "backend/commands/agent-session.mjs",
  ],
  email,
);
if (studio.error) throw new Error(`Studio: ${studio.error}`);
const chat = lastJson(
  ["exec", "-i", "-n", "librechat", "deploy/librechat", "--", "sh", "-c", "cd /app/api && node -"],
  libreChatSession(email),
);

const cookies = [
  {
    name: studio.name,
    value: studio.value,
    domain: studioHost,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + studio.maxAge,
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  },
  ...chat.map(({ name, value, options }) => ({
    name,
    value,
    domain: chatHost,
    path: "/",
    expires: Math.floor(new Date(options.expires).getTime() / 1000),
    httpOnly: options.httpOnly,
    secure: true,
    sameSite: "Strict",
  })),
];
const directory = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"),
  "agent-browser",
);
const file = path.join(directory, "sign-in.json");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.writeFileSync(file, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
fs.chmodSync(file, 0o600);
const until = new Date(Math.min(...cookies.map((cookie) => cookie.expires)) * 1000);
console.log(`Signed in to ${studioHost} and ${chatHost} until ${until.toLocaleString("en-AU")}.`);
console.log(`agent-browser --session <name> state load ${file}`);
