import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  compatibilityNote,
  compatibleLoras,
  loraCompatibility,
  loraName,
  sameLoraFamily,
  strengthRange,
} from "./lora-policy.js";
import { enrichLocalLoraInfo, optionalLoraPolicyIssue } from "./lora-catalogue.js";

const profile = {
  id: "custom:fl",
  family: "minimax_h3",
  baseModel: "models/h3.safetensors",
  recipe: { conditioning: "FL2VA" },
};
const effect = {
  families: ["minimax_h3"],
  compatibility: { conditionings: ["FL2VA"], unlisted: "other" },
};

test("explicit conditioning support separates FL and Ref without changing family-only compatibility", () => {
  assert.equal(loraCompatibility(effect, profile), "fits");
  assert.equal(
    loraCompatibility(effect, { ...profile, recipe: { conditioning: "Ref2VA" } }),
    "other",
  );
  assert.equal(loraCompatibility(effect, { ...profile, recipe: undefined }), "unknown");
  assert.equal(
    loraCompatibility(
      { families: effect.families },
      { ...profile, recipe: { conditioning: "Ref2VA" } },
    ),
    "fits",
  );
  assert.match(
    optionalLoraPolicyIssue({ name: "effect", strength: 1 }, effect, {
      ...profile,
      recipe: { conditioning: "Ref2VA" },
    }),
    /conditioning variant/,
  );
});

test("Boogu verified base and turbo targets leave unverified edit variants available with a warning", () => {
  const info = {
    families: ["boogu"],
    compatibility: { baseModels: ["boogu_base.safetensors", "boogu_turbo.safetensors"] },
  };
  const base = { family: "boogu", defaults: { model: "models/boogu_base.safetensors" } };
  assert.equal(loraCompatibility(info, base), "fits");
  const edit = { ...base, defaults: { model: "boogu_edit.safetensors" } };
  assert.equal(loraCompatibility(info, edit), "unknown");
  assert.match(compatibilityNote(info, edit), /not been verified/);
  assert.equal(optionalLoraPolicyIssue({ name: "effect", strength: 1 }, info, edit), "");
  assert.equal(loraCompatibility(undefined, edit), "unknown");
});

test("exact profile and model allowlists are combined, with missing context marked unknown", () => {
  const info = {
    families: effect.families,
    compatibility: { baseModels: ["h3.safetensors"], profileIds: ["custom:fl"], unlisted: "other" },
  };
  assert.equal(loraCompatibility(info, profile), "fits");
  assert.equal(loraCompatibility(info, { ...profile, id: "custom:other" }), "other");
  assert.equal(loraCompatibility(info, { family: "minimax_h3" }), "unknown");
  assert.equal(
    loraCompatibility(info, { family: "minimax_h3", id: "custom:fl", model: "custom:fl" }),
    "unknown",
  );
});

test("only valid explicit publisher strength bounds replace fallback controls", () => {
  const info = { strengthRange: { min: -3, max: 10, step: 0.05 } };
  assert.deepEqual(strengthRange(info), info.strengthRange);
  assert.equal(strengthRange({ strengthRange: { min: -3, max: 10, step: 0 } }), null);
  assert.equal(strengthRange({}), null);
  assert.equal(optionalLoraPolicyIssue({ name: "slider", strength: 10 }, info, profile), "");
  assert.match(
    optionalLoraPolicyIssue({ name: "slider", strength: 11 }, info, profile),
    /-3 to 10/,
  );
  assert.equal(optionalLoraPolicyIssue({ name: "unknown", strength: 10 }, {}, profile), "");
});

test("local and provider policy enrichment retains explicit constraints without fabricating family evidence", () => {
  const entry = {
    compatibility: { conditionings: ["FL2VA"], unlisted: "other" },
    strengthRange: { min: -10, max: 10, step: 0.1 },
  };
  const enriched = enrichLocalLoraInfo(
    { families: ["minimax_h3"] },
    "effect",
    { effect: entry },
    () => [],
    { minimax_h3: { label: "MiniMax H3" } },
  );
  assert.deepEqual(enriched.compatibility, entry.compatibility);
  assert.deepEqual(enriched.strengthRange, entry.strengthRange);
  assert.deepEqual(enriched.families, ["minimax_h3"]);
});

test("packaged server catalogue imports and applies policy without a source tree", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-packaged-lora-policy-"));
  try {
    fs.mkdirSync(path.join(scratch, "server"));
    fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ type: "module" }));
    for (const name of ["lora-policy.js", "lora-catalogue.js"]) {
      fs.copyFileSync(
        fileURLToPath(new URL(name, import.meta.url)),
        path.join(scratch, "server", name),
      );
    }
    assert.equal(fs.existsSync(path.join(scratch, "src")), false);
    const packaged = await import(
      pathToFileURL(path.join(scratch, "server", "lora-catalogue.js")).href
    );
    assert.match(
      packaged.optionalLoraPolicyIssue({ name: "effect", strength: 1 }, effect, {
        ...profile,
        recipe: { conditioning: "Ref2VA" },
      }),
      /conditioning variant/,
    );
    assert.equal(
      packaged.optionalLoraPolicyIssue({ name: "effect", strength: 1 }, effect, profile),
      "",
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("FLUX.3 adapters fit built-in and imported Klein family identifiers", () => {
  assert.equal(loraCompatibility({ families: ["flux3"] }, { family: "flux3" }), "fits");
  assert.equal(loraCompatibility({ families: ["flux3"] }, { family: "flux3_klein" }), "fits");
  assert.equal(loraCompatibility({ families: ["flux3_klein"] }, { family: "flux3" }), "fits");
  assert.equal(loraCompatibility({ families: ["flux3"] }, { family: "flux1" }), "other");
});

// Kromafine Turbo as deployed on Bento (ai/config/studio/workflows): a Krea 2 derivative.
const kromafine = {
  id: "custom:bento-image-kromafine-turbo-int8-convrot",
  family: "krea2",
  label: "Kromafine Turbo V1.0 · Fast · 8 Steps · Optional Reference · INT8",
  defaults: { model: "kromafineTurboBF16FP8_v10_3291478.safetensors" },
};
const loraholic = { families: ["zimage"], base: "Z-Image", title: "ass_2_loraholic" };

test("a LoRA for another family is refused on submit, whether or not its publisher lists variants", () => {
  assert.equal(loraCompatibility(loraholic, kromafine), "other");
  assert.match(
    optionalLoraPolicyIssue(
      { name: "ass_2_loraholic.safetensors", strength: 1 },
      loraholic,
      kromafine,
    ),
    /^ass_2_loraholic is for Z-Image, not Kromafine Turbo V1\.0 · Fast/,
  );
  assert.equal(
    optionalLoraPolicyIssue(
      { name: "krea.safetensors", strength: 1 },
      { families: ["krea2"] },
      kromafine,
    ),
    "",
  );
  assert.equal(
    optionalLoraPolicyIssue(
      { name: "unread.safetensors", strength: 1 },
      { families: [] },
      kromafine,
    ),
    "",
    "unverified LoRAs stay usable",
  );
  assert.equal(
    optionalLoraPolicyIssue({ name: "custom.safetensors", strength: 1 }, loraholic, {
      family: "custom",
    }),
    "",
    "an imported workflow without a family is unknown",
  );
});

test("compatibleLoras drops only other-family LoRAs from reused settings and counts them", () => {
  const infos = {
    "ass_2_loraholic.safetensors": loraholic,
    "krea-style.safetensors": { families: ["krea2"] },
    "unread.safetensors": { families: [] },
  };
  const stack = [
    { name: "krea-style.safetensors", strength: 0.8, enabled: true },
    { name: "ass_2_loraholic.safetensors", strength: 1, enabled: true },
    { name: "unread.safetensors", strength: 0.5, enabled: false },
    { name: "missing.safetensors", strength: 0.5 },
  ];
  const result = compatibleLoras(stack, infos, kromafine);
  assert.deepEqual(
    result.loras,
    [stack[0], stack[2], stack[3]],
    "order and shape are kept; unknown entries stay",
  );
  assert.equal(result.dropped, 1);
  assert.deepEqual(result.droppedNames, ["ass_2_loraholic.safetensors"]);
  assert.deepEqual(
    compatibleLoras(
      ["ass_2_loraholic.safetensors", "krea-style.safetensors"],
      (name) => infos[name],
      kromafine,
    ),
    {
      loras: ["krea-style.safetensors"],
      dropped: 1,
      droppedNames: ["ass_2_loraholic.safetensors"],
    },
  );
  assert.deepEqual(compatibleLoras(undefined, infos, kromafine), {
    loras: [],
    dropped: 0,
    droppedNames: [],
  });
  assert.equal(
    compatibleLoras(stack, infos, { ...kromafine, family: "zimage" }).droppedNames[0],
    "krea-style.safetensors",
  );
});

test("a LoRA reads by its catalogue title, else a cleaned Title Case stem", () => {
  assert.equal(loraName("pawg_krea2.safetensors", { title: "PAWG Krea 2" }), "PAWG Krea 2");
  assert.equal(loraName("loras/krea/soft_light-v3.safetensors"), "Soft Light V3");
  assert.equal(loraName("detailer.gguf", { title: "   " }), "Detailer");
});

test("model changes retain stacks only within a known shared LoRA family", () => {
  assert.equal(
    sameLoraFamily({ id: "base", family: "moss" }, { id: "fast", family: "moss" }),
    true,
  );
  assert.equal(sameLoraFamily({ family: "flux3_klein" }, { family: "flux3" }), true);
  assert.equal(sameLoraFamily({ family: "minimax-h3" }, { family: "minimax_h3" }), true);
  assert.equal(sameLoraFamily({ family: "moss" }, { family: "boogu" }), false);
  assert.equal(sameLoraFamily({ family: "custom" }, { family: "custom" }), false);
  assert.equal(
    sameLoraFamily({ id: "same", family: "custom" }, { id: "same", family: "custom" }),
    true,
  );
  assert.equal(sameLoraFamily(undefined, { family: "moss" }), false);
});
