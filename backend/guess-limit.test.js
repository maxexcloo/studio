import assert from "node:assert/strict";
import test from "node:test";
import { createGuessLimiter } from "./guess-limit.js";

test("guessing: a few free tries, then doubling lockouts, one try at a time, and this computer untouched", async () => {
  let clock = 0;
  const limiter = createGuessLimiter({ freeTries: 3, baseMs: 1000, now: () => clock });
  const wrong = () => Promise.resolve(false);
  for (let index = 0; index < 2; index += 1)
    assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).retryAfterMs, 0);
  assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).retryAfterMs, 1000);
  assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).reason, "locked");
  clock += 1000;
  assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).retryAfterMs, 2000);
  // Another address and this computer are not held up by it.
  assert.equal((await limiter.attempt("192.168.1.41", false, wrong)).reason, "wrong");
  for (let index = 0; index < 20; index += 1)
    assert.equal((await limiter.attempt("127.0.0.1", true, wrong)).retryAfterMs, 0);
  assert.equal(
    (await limiter.attempt("127.0.0.1", true, () => Promise.resolve("key"))).value,
    "key",
  );
  // Parallel guesses from one address: only one is checked.
  let release;
  const slow = limiter.attempt(
    "192.168.1.60",
    false,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  assert.equal((await limiter.attempt("192.168.1.60", false, wrong)).reason, "busy");
  release(true);
  assert.equal((await slow).ok, true);
});
