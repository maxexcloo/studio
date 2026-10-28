// SPDX-License-Identifier: AGPL-3.0-only
// Replays the prompt assistant's eval cases (backend/fixtures/assistant-evals/) against the live
// LiteLLM gateway and scores the replies: `mise run eval:assistant`. On demand only, never in CI.
// It uses STUDIO_PROMPT_WRITER_URL, _KEY and _MODEL (and STUDIO_ASSISTANT_MODEL when set) from the
// environment. `--record` writes the live replies
// back as the recorded ones CI replays; review that diff before committing it.
import fs from "node:fs";
import path from "node:path";
import { evalsDir, loadEvals, runEvals } from "../assistant-evals.js";
import { assistantSettings } from "../assistant.js";

const record = process.argv.includes("--record");
let settings;
try {
  settings = assistantSettings(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
if (!settings) {
  console.error(
    "Set STUDIO_PROMPT_WRITER_URL, STUDIO_PROMPT_WRITER_KEY and STUDIO_PROMPT_WRITER_MODEL to replay the evals live.",
  );
  process.exit(2);
}

const evals = loadEvals();
const replies = { rewrite: new Map(), loras: new Map(), negative: new Map() };
console.log(
  `Replaying ${evals.rewrite.cases.length + evals.loras.cases.length + evals.negative.cases.length} cases on ${settings.model}…`,
);
const { results, passed, total } = await runEvals({
  evals,
  environment: process.env,
  fetchImpl: fetch,
  onReply: (kind, id, content) => replies[kind]?.set(id, content),
});

for (const [kind, items] of Object.entries(results)) {
  console.log(`\n${kind}`);
  for (const item of items) {
    const failed = item.checks.filter((check) => !check.ok);
    console.log(
      `  ${item.ok ? "pass" : "FAIL"}  ${item.id}${failed.length ? `: ${failed.map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ""}`).join("; ")}` : ""}`,
    );
  }
}
console.log(`\n${passed} of ${total} passed.`);

if (record) {
  for (const kind of Object.keys(replies)) {
    const file = path.join(evalsDir, `${kind}.json`);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const item of data.cases)
      if (replies[kind].has(item.id)) item.recorded = replies[kind].get(item.id);
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  console.log("Recorded the live replies. Review the fixture diff before committing it.");
}
process.exit(passed === total ? 0 : 1);
