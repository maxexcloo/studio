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
  const close = playVideo(
    media as unknown as HTMLVideoElement,
    () => {
      refused = true;
    },
    () => assert.fail("an unrelated playback error cannot change mute"),
  );
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
  const close = playVideo(
    media as unknown as HTMLVideoElement,
    () => {
      refused = true;
    },
    () => assert.fail("a closed video cannot change mute"),
  );
  close();
  fail!(new Error("Closed"));
  await Promise.resolve();
  assert.equal(media.muted, true);
  assert.equal(refused, false);
});

test("an audible autoplay policy failure retries muted", async (t) => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: new EventTarget() });
  t.after(() => Object.assign(globalThis, { document: previous }));
  const attempts: boolean[] = [];
  const silent: boolean[] = [];
  const media = {
    muted: false,
    play() {
      attempts.push(this.muted);
      return this.muted
        ? Promise.resolve()
        : Promise.reject(new DOMException("Audio needs a tap", "NotAllowedError"));
    },
    pause() {},
    removeAttribute() {},
    load() {},
  };
  const close = playVideo(
    media as unknown as HTMLVideoElement,
    () => assert.fail("muted playback succeeded"),
    (value) => silent.push(value),
  );
  await Promise.resolve();
  assert.deepEqual(attempts, [false, true]);
  assert.deepEqual(silent, [true]);
  close();
});
