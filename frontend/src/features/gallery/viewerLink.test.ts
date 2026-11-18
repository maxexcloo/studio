import assert from "node:assert/strict";
import test from "node:test";

import { viewerPath, viewerPathId } from "./viewerLink.ts";

test("a viewer path reads back the ID it was made from, an encoded subfolder included", () => {
  const id = "/comfy/view?filename=a_00001_.png&subfolder=studio%2Faccounts%2Fabc&type=media";
  assert.equal(viewerPathId(viewerPath({ id, type: "image" })), id);
  assert.equal(viewerPathId(viewerPath({ id, number: 12, type: "video" })), "12");
  assert.equal(viewerPathId("/images"), "");
});
