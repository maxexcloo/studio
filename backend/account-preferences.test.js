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

test("Video sizing defaults follow the account and can be cleared", () => {
  saveAccountPreferences("alice", { videoAspect: "9:16", videoResolution: "1080p" });
  reloadAccountPreferences();
  assert.equal(accountPreferences("alice").videoAspect, "9:16");
  assert.equal(accountPreferences("alice").videoResolution, "1080p");
  assert.equal(accountPreferences("bob").videoResolution, undefined);
  assert.throws(() => saveAccountPreferences("alice", { videoAspect: "12:7" }), /videoAspect/);
  assert.throws(
    () => saveAccountPreferences("alice", { videoResolution: "4K" }),
    /videoResolution/,
  );
  saveAccountPreferences("alice", { videoAspect: null, videoResolution: null });
  assert.equal(accountPreferences("alice").videoAspect, undefined);
  assert.equal(accountPreferences("alice").videoResolution, undefined);
});
