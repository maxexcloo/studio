import assert from "node:assert/strict";
import test from "node:test";

import { temporaryFolder } from "./fixtures/temporary.js";

process.env.STUDIO_DATA_DIR = temporaryFolder("studio-account-preferences-");
const { accountPreferences, reloadAccountPreferences, saveAccountPreferences } =
  await import("./account-preferences.js");

test("Saved gallery views follow the account and refuse malformed views", () => {
  const view = {
    id: "view-1",
    name: "Kromafine · Liked · Past Week",
    search: "",
    sort: "newest",
    filters: { model: ["Kromafine"], date: "week", rating: "liked", uploads: false },
  };
  saveAccountPreferences("alice", { galleryViews: [view] });
  reloadAccountPreferences();
  assert.deepEqual(accountPreferences("alice").galleryViews, [view]);
  assert.equal(accountPreferences("bob").galleryViews, undefined);
  for (const galleryViews of [
    [{ ...view, name: " " }],
    [{ ...view, sort: "random" }],
    [{ ...view, filters: { model: [{}] } }],
    [view, view],
  ])
    assert.throws(() => saveAccountPreferences("alice", { galleryViews }), /gallery views/);
});
