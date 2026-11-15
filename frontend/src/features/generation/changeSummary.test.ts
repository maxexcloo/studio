import assert from "node:assert/strict";
import test from "node:test";

import { changeSummary } from "./changeSummary.ts";

test("a proposal's summary names the words it replaced, added and removed", () => {
  const before = "A becak ride at midday: a woman with straight hair, harsh light, phone photo";
  assert.equal(
    changeSummary(
      before,
      "A becak ride at golden hour: a woman with straight hair and a slight smile, harsh light",
    ),
    "midday → golden hour · + and a slight smile · − phone photo",
  );
  assert.equal(changeSummary(before, before), "");
  // An edit instruction shares too little with the prompt to compare.
  assert.equal(changeSummary(before, "Make her dress red, keep everything else"), "");
  assert.ok(changeSummary("a b c d e f", `a b c d e f ${"word ".repeat(40)}`, 30).endsWith("…"));
});
