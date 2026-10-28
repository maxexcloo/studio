import assert from "node:assert/strict";
import test from "node:test";
import { quantFromName } from "./family-catalog.js";

test("quantized formats are told from the file name", () => {
  assert.equal(quantFromName("svdq-int4_r32-flux.1-dev.safetensors"), "svdq");
  assert.equal(quantFromName("flux1-dev-bnb-nf4-v2.safetensors"), "nf4");
  assert.equal(quantFromName("flux1-dev-fp8.safetensors"), "");
});
