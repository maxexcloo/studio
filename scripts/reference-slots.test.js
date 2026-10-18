import assert from "node:assert/strict";
import test from "node:test";
import { arrangeReferences, referenceRoleFor, withReference, withoutReferences } from "../src/app/referenceSlots.js";

// Flux.2-style slots, as server/family-profiles.js referenceSlots(3) builds them.
const three = [
  { id: "reference" },
  { id: "reference_2", follows: "reference" },
  { id: "reference_3", follows: "reference_2" }
];
const one = [{ id: "reference" }];
const asset = (id) => ({ id, name: `${id}.png` });
const ids = (list) => list.map((item) => `${item.slot}=${item.asset.id}`);

test("comes out in slot order, whatever order the picks came in", () => {
  const picked = [{ slot: "reference_2", asset: asset("b") }, { slot: "reference", asset: asset("a") }];
  assert.deepEqual(ids(arrangeReferences(picked, three)), ["reference=a", "reference_2=b"]);
});

test("a picture saved under a slot this model lacks takes the first empty slot, so it can be removed", () => {
  const saved = [{ slot: "image", asset: asset("old") }];
  const shown = arrangeReferences(saved, one);
  assert.deepEqual(ids(shown), ["reference=old"]);
  assert.deepEqual(withoutReferences(saved, one, ["reference"]), []);
});

test("removing the first reference moves the others up instead of leaving a ghost", () => {
  const picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference_2", asset: asset("b") }, { slot: "reference_3", asset: asset("c") }];
  assert.deepEqual(ids(withoutReferences(picked, three, ["reference"])), ["reference=b", "reference_2=c"]);
  assert.deepEqual(ids(withoutReferences(picked, three, ["reference_2"])), ["reference=a", "reference_2=c"]);
  assert.deepEqual(withoutReferences(picked, three, ["reference", "reference_2", "reference_3"]), []);
});

test("every reference can be removed one at a time from the front", () => {
  let picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference_2", asset: asset("b") }];
  picked = withoutReferences(picked, three, ["reference"]);
  picked = withoutReferences(picked, three, ["reference"]);
  assert.deepEqual(picked, []);
});

test("picking replaces the slot's picture and keeps the rest", () => {
  const picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference_2", asset: asset("b") }];
  assert.deepEqual(ids(withReference(picked, three, "reference", asset("z"))), ["reference=z", "reference_2=b"]);
  assert.deepEqual(ids(withReference(picked, three, "reference_3", asset("c"))), ["reference=a", "reference_2=b", "reference_3=c"]);
  assert.deepEqual(ids(withReference(picked, three, "nope", asset("x"))), ["reference=a", "reference_2=b"]);
});

test("duplicates and empty entries are dropped; no slots keeps nothing", () => {
  const picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference", asset: asset("b") }, { slot: "reference_2", asset: null }];
  assert.deepEqual(ids(arrangeReferences(picked, three)), ["reference=a"]);
  assert.deepEqual(arrangeReferences(picked, []), []);
  assert.deepEqual(arrangeReferences(undefined, three), []);
});

test("Reference only applies where the switch is offered; elsewhere, and with a mask, it's an edit", () => {
  const flux2 = { aspectPolicy: "reference", workflow: "family:flux2" };
  assert.equal(referenceRoleFor(flux2, "reference"), "reference");
  assert.equal(referenceRoleFor(flux2, "edit"), "edit");
  assert.equal(referenceRoleFor(flux2, undefined), "edit");
  assert.equal(referenceRoleFor(flux2, "reference", true), "edit", "a painted mask edits");
  // A bundled edit workflow framed by its reference has no switch: Reference picked on Flux.2 must not carry over.
  assert.equal(referenceRoleFor({ aspectPolicy: "reference", workflow: "flux2-real-dream-image-edit.json" }, "reference"), "edit");
  assert.equal(referenceRoleFor({ workflow: "family:sdxl" }, "reference"), "edit");
  assert.equal(referenceRoleFor(null, "reference"), "edit");
});


test('removing a start frame preserves the end frame in its semantic slot', () => {
  const inputs = [{ id: 'start', role: 'start' }, { id: 'end', follows: 'start', role: 'end' }];
  const asset = { id: 'same-picture' };
  const selected = [{ slot: 'start', asset }, { slot: 'end', asset }];
  assert.deepEqual(withoutReferences(selected, inputs, ['start']), [{ slot: 'end', asset }]);
  assert.deepEqual(withReference([{ slot: 'end', asset }], inputs, 'start', { id: 'replacement' }), [{ slot: 'start', asset: { id: 'replacement' } }, { slot: 'end', asset }]);
});
