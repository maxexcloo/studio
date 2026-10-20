import assert from "node:assert/strict";
import test from "node:test";
import { partName, partOptions } from "../src/app/partNames.js";

test("model parts read as names, not file names", () => {
  assert.equal(partName("qwen3vl_8b_int8_convrot.safetensors"), "Qwen3 VL 8B INT8 ConvRot");
  assert.equal(partName("ae.safetensors"), "AE");
  assert.equal(partName("t5xxl_fp16.safetensors"), "T5 XXL FP16");
  assert.equal(partName("split/umt5_xxl_fp8_e4m3fn_scaled.safetensors"), "UMT5 XXL FP8 E4M3FN Scaled");
  assert.equal(partName("fp8_e4m3fn"), "FP8 (E4M3)");
  assert.equal(partName("default"), "Default");
  assert.deepEqual(partOptions(["ae.safetensors", { label: "Built into the Checkpoint", value: "__builtin" }]), [
    { value: "ae.safetensors", label: "AE", detail: "ae.safetensors" },
    { value: "__builtin", label: "Built into the Checkpoint", detail: "" }
  ]);
});
