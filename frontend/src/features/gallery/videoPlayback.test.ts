import assert from "node:assert/strict";
import test from "node:test";

import { playVideo } from "./videoPlayback.ts";

test("opened video keeps sound when autoplay is refused, then pauses and releases on close", async (t) => {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const previous = globalThis.document;
  Object.assign(globalThis, { document: page });
  t.after(() => Object.assign(globalThis, { document: previous }));
  let refused = false;
  let pauses = 0;
  let loads = 0;
  const media = {
    muted: false,
    src: "sample.webm",
    play: () => Promise.reject(new Error("User gesture required")),
    pause: () => pauses++,
    removeAttribute: () => {
      media.src = "";
    },
    load: () => loads++,
  };
  const close = playVideo(media as unknown as HTMLVideoElement, () => {
    refused = true;
  });
  await Promise.resolve();
  assert.equal(refused, true);
  assert.equal(media.muted, false);
  page.hidden = true;
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(pauses, 1);
  close();
  assert.equal(media.src, "");
  assert.equal(loads, 1);
  assert.equal(pauses, 2);
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(pauses, 2);
});

test("an explicitly muted video stays muted and late autoplay failure cannot reopen controls", async (t) => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: new EventTarget() });
  t.after(() => Object.assign(globalThis, { document: previous }));
  let fail: (reason: Error) => void;
  let refused = false;
  const media = {
    muted: true,
    play: () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    pause() {},
    removeAttribute() {},
    load() {},
  };
  const close = playVideo(media as unknown as HTMLVideoElement, () => {
    refused = true;
  });
  close();
  fail!(new Error("Closed"));
  await Promise.resolve();
  assert.equal(media.muted, true);
  assert.equal(refused, false);
});
