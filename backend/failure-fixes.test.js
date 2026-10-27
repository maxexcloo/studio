import test from "node:test";
import assert from "node:assert/strict";
import { packForNode, withFixes } from "./failure-fixes.js";
import { describeFailure } from "./failures.js";

test("a missing node from a known pack gets that pack's install", () => {
  const failure = withFixes(
    describeFailure({
      message:
        "Node 'FaceDetailer' not found. The custom node may not be installed. missing_node_type",
    }),
  );
  assert.equal(failure.nodePack?.id, "impactpack");
  assert.ok(failure.install?.commands?.length);
});

test("a node no known pack brings keeps the hint only", () => {
  const failure = withFixes(
    describeFailure({ message: "Node 'SomethingExotic' not found. missing_node_type" }),
  );
  assert.equal(failure.nodePack, undefined);
  assert.equal(packForNode("SomethingExotic"), null);
});

test("a damaged catalog file can be downloaded again; any other file cannot", () => {
  const catalog = withFixes(
    describeFailure({
      message: "Error while deserializing header: invalid header in ae.safetensors",
      nodeType: "VAELoader",
    }),
  );
  assert.equal(catalog.redownload?.file, "ae.safetensors");
  assert.equal(catalog.redownload?.folder, "vae");
  const unknown = withFixes(
    describeFailure({
      message: "Error while deserializing header: invalid header in myvae.safetensors",
      nodeType: "VAELoader",
    }),
  );
  assert.equal(unknown.redownload, undefined);
});
