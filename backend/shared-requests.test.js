import assert from "node:assert/strict";
import test from "node:test";
import { sharedRequests } from "./shared-requests.js";

test("callers share a request on its way, per key, until it settles", async () => {
  const share = sharedRequests();
  let calls = 0;
  let release;
  const start = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = share("a", start);
  const second = share("a", start);
  assert.equal(first, second);
  assert.equal(calls, 0, "it starts on the next tick, once");
  await Promise.resolve();
  assert.equal(calls, 1);
  release("done");
  assert.equal(await second, "done");
  share("a", () => {
    calls += 1;
    return "again";
  });
  assert.equal(await share("a", () => "unused"), "again", "a settled request is not reused");
  assert.equal(calls, 2);
});

test("failures are shared and forgotten", async () => {
  const share = sharedRequests();
  const failing = share("b", () => {
    throw new Error("down");
  });
  await assert.rejects(failing, /down/);
  assert.equal(await share("b", () => "back"), "back");
});
