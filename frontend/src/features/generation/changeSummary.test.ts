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
  assert.equal(
    changeSummary(before, "Change her hair so it is straight, keeping the becak ride as it is"),
    "",
  );
  const long = "one two three four five six seven eight nine ten";
  assert.ok(changeSummary(long, `${long} with a much longer added phrase`, 20).endsWith("…"));
});
