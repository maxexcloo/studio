import assert from "node:assert/strict";
import test from "node:test";
import { loraPromptMetadata } from "./lora-catalogue.js";
import {
  loraPromptStyle,
  negativeUnused,
  recommendedNegative,
  relevantTags,
  withLoraTags,
  withLoraTriggers,
} from "./lora-prompts.js";

test("the catalogue keeps a LoRA prompt style, up to ten tags and its own negative", () => {
  assert.deepEqual(
    loraPromptMetadata({
      promptStyle: "mixed",
      tags: [" a ", "", 3, ...Array.from({ length: 12 }, (_, i) => `t${i}`)],
      negative: " smudge ",
    }),
    {
      promptStyle: "mixed",
      tags: ["a", "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"],
      negative: "smudge",
    },
  );
  assert.deepEqual(loraPromptMetadata({ promptStyle: "poetic", tags: [] }), {});
  assert.equal(loraPromptStyle({}), "natural");
  assert.equal(loraPromptStyle({ promptStyle: "tags" }), "tags");
});

test("enabled LoRAs’ trigger words lead the prompt in stack order, once each, unless already said", () => {
  const infos = {
    first: { triggers: ["ohwx"] },
    second: { triggers: ["glowfx", "[]", "OHWX"] },
    said: { triggers: ["Dusk"] },
    off: { triggers: ["offword"] },
    disabled: { triggers: ["unused"] },
  };
  const stack = [
    { name: "second" },
    { name: "first", triggers: true },
    { name: "said" },
    { name: "off", triggers: false },
    { name: "disabled", enabled: false },
  ];
  assert.equal(
    withLoraTriggers("A harbour at dusk.", stack, infos),
    "glowfx, OHWX, A harbour at dusk.",
  );
  assert.equal(
    withLoraTriggers("ohwx, a harbour at dusk", stack, infos),
    "glowfx, ohwx, a harbour at dusk",
  );
  assert.equal(withLoraTriggers("A harbour", [], infos), "A harbour");
});

test("tag-trained LoRAs add one short line of the tags that fit the request; natural ones add none", () => {
  const infos = {
    tags: { promptStyle: "tags", tags: ["film grain", "portrait", "neon sign", "rain"] },
    natural: { tags: ["ignored"] },
    mixed: { promptStyle: "mixed", tags: ["rain", "bokeh"] },
  };
  assert.deepEqual(relevantTags(infos.tags, "a rainy portrait", ""), ["portrait"]);
  assert.deepEqual(relevantTags(infos.tags, "a cat", ""), ["film grain", "portrait", "neon sign"]);
  assert.equal(
    withLoraTags(
      "A woman under a neon sign in the rain",
      [{ name: "tags" }, { name: "natural" }, { name: "mixed" }],
      infos,
      "neon rain portrait",
    ),
    "A woman under a neon sign in the rain\nportrait",
  );
});

test("a recommended negative fills above cfg 1 with the LoRAs’ own; optional and none never do", () => {
  const recommended = { negative: { effect: "recommended", default: "blurry" } };
  const infos = { a: { negative: "colour bleed" }, b: {} };
  assert.equal(
    recommendedNegative(recommended, { cfg: 4, stack: [{ name: "a" }, { name: "b" }], infos }),
    "blurry, colour bleed",
  );
  assert.equal(recommendedNegative(recommended, { cfg: 1 }), "");
  assert.equal(recommendedNegative(recommended, { cfg: 4, takesNegative: false }), "");
  assert.equal(
    recommendedNegative({ negative: { effect: "optional", default: "blurry" } }, { cfg: 4 }),
    "",
  );
  assert.equal(recommendedNegative({}, { cfg: 4 }), "");
  assert.equal(negativeUnused({ negative: { effect: "none" } }), true);
  assert.equal(negativeUnused({}), false);
});
