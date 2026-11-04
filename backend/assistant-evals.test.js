import assert from "node:assert/strict";
import test from "node:test";
import {
  loadEvals,
  runEvals,
  scoreAnimate,
  scoreLoras,
  scoreNegative,
  scoreRewrite,
} from "./assistant-evals.js";

test("the eval set has 22 rewrite, 15 LoRA, 5 negative and 6 animate cases with unique ids", () => {
  const evals = loadEvals();
  assert.deepEqual(
    [
      evals.rewrite.cases.length,
      evals.loras.cases.length,
      evals.negative.cases.length,
      evals.animate.cases.length,
    ],
    [22, 15, 5, 6],
  );
  const ids = Object.values(evals).flatMap((set) => set.cases.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(evals.loras.catalogue.length >= 10, "a frozen catalogue snapshot");
});

test("every recorded reply passes the scorer when replayed through the engine", async () => {
  const { results, passed, total } = await runEvals();
  const failed = Object.values(results)
    .flat()
    .filter((item) => !item.ok)
    .map(
      (item) =>
        `${item.id}: ${item.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ""}`)
          .join("; ")}`,
    );
  assert.deepEqual(failed, []);
  assert.equal(passed, total);
});

test("the scorer catches dropped subjects and quotes, setting words, missing tone, length and preambles", () => {
  const item = {
    id: "x",
    prompt: 'a sign reading "Open Late" on a bar',
    preset: "portrait",
    expect: { keep: ["bar"] },
  };
  const failing = (output) =>
    scoreRewrite(item, output)
      .checks.filter((check) => !check.ok)
      .map((check) => check.name);
  assert.deepEqual(
    failing('Portrait of a man at a bar with a sign reading "Open Late", 35mm lens.'),
    [],
  );
  assert.deepEqual(
    failing('Portrait of a man at a pub with a sign reading "Open Late", 35mm lens.'),
    ['keeps "bar"'],
  );
  assert.deepEqual(
    failing('Portrait of a man at a bar with a sign reading "OPEN LATE", 35mm lens.'),
    ['quotes "Open Late" exactly'],
  );
  assert.deepEqual(
    failing('Portrait of a man at a bar, sign reading "Open Late", 16:9, 4K, turbo.'),
    ["no setting words"],
  );
  assert.deepEqual(failing('A painting of a bar with a sign reading "Open Late".'), [
    "portrait tone",
  ]);
  assert.deepEqual(
    failing('Here is a portrait of a man at a bar with a sign reading "Open Late".'),
    ["no preamble"],
  );
  assert.deepEqual(
    scoreRewrite({ id: "c", prompt: "a cat", preset: "concise" }, "cat ".repeat(50))
      .checks.filter((check) => !check.ok)
      .map((check) => check.name),
    ["at most 45 words"],
  );
  assert.equal(
    scoreRewrite({ id: "u", prompt: "a cat", preset: "enhance" }, "a cat").ok,
    false,
    "unchanged is not a rewrite",
  );
});

test("the LoRA and negative scorers check expected, forbidden, unused and subjects", () => {
  const item = { id: "l", expected: ["a"], forbidden: ["b"] };
  assert.equal(scoreLoras(item, [{ name: "a" }]).ok, true);
  assert.equal(scoreLoras(item, [{ name: "a" }, { name: "b" }]).ok, false);
  assert.equal(scoreLoras(item, []).ok, false);
  assert.equal(
    scoreLoras({ id: "n", expected: [], forbidden: [] }, [{ name: "c" }]).ok,
    false,
    "nothing expected means nothing suggested",
  );
  assert.equal(
    scoreNegative({ id: "u", expect: { unused: true } }, { negative: "blurry", unused: false }).ok,
    false,
  );
  assert.equal(
    scoreNegative(
      { id: "v", expect: { include: ["blurry"], avoid: ["dog"] } },
      { negative: "blurry, dog" },
    ).ok,
    false,
  );
});

test("the animate scorer catches labels on a wrapped profile, missing sections, filler, a replay and speech on a silent model", () => {
  const body =
    "The camera pushes in slowly as she lifts the cup, steam curling past her face with a soft hiss. ".repeat(
      5,
    );
  const failing = (expect, output) =>
    scoreAnimate({ id: "a", expect }, output)
      .checks.filter((check) => !check.ok)
      .map((check) => check.name);
  assert.deepEqual(failing({ sections: [] }, body), []);
  assert.deepEqual(failing({ sections: [] }, `overall_soundscape: ${body}`), ["no section labels"]);
  assert.deepEqual(failing({ sections: ["detailed_description", "overall_soundscape"] }, body), [
    "every section in order",
  ]);
  assert.deepEqual(failing({}, `${body} Smooth, cinematic.`), ["no filler"]);
  assert.deepEqual(failing({ avoid: ["lifts the cup"] }, body), ['moves on from "lifts the cup"']);
  assert.deepEqual(failing({ silent: true }, `${body} She says, "Morning."`), ["no dialogue"]);
});
