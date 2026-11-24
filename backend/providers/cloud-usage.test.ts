import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { cloudHeld, createCloudUsage } from "./cloud-usage.ts";

const billing = {
  config: {
    currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-11-29T23:09:36+00:00" },
    creditUsagePercent: 71.0,
  },
};

function management(answer: () => { status_code: number; body: string }) {
  const calls: { url: string; body?: { auth_index: string; url: string } }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer management");
    return Response.json(
      url.endsWith("/credentials")
        ? {
            files: [
              { provider: "codex", auth_index: "a" },
              { provider: "xai", auth_index: "b" },
              { provider: "xai", auth_index: "c", disabled: true },
            ],
          }
        : answer(),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("Grok usage comes from its weekly credits and is read at most once a minute", async () => {
  let time = 0;
  const { calls, fetchImpl } = management(() => ({
    status_code: 200,
    body: JSON.stringify(billing),
  }));
  const usage = createCloudUsage({
    base: "http://cliproxy:8317/",
    managementKey: "management",
    fetchImpl,
    now: () => time,
  });
  const expected = [
    {
      label: "Grok",
      used: 71,
      reason: "Grok's weekly credits used.",
      resetsAt: "2026-11-29T23:09:36+00:00",
    },
  ];
  assert.deepEqual(await usage(), expected);
  assert.deepEqual(
    calls.map((call) => [call.url, call.body?.auth_index]),
    [
      ["http://cliproxy:8317/v8/management/credentials", undefined],
      ["http://cliproxy:8317/v8/management/requests/api-call", "b"],
    ],
  );
  time = 59_000;
  await usage();
  assert.equal(calls.length, 2);
  // Once stale, the last reading answers while the next one loads.
  time = 60_000;
  assert.deepEqual(await usage(), expected);
  await setImmediate();
  assert.equal(calls.length, 4);
});

test("A failed read keeps Grok's last usage until its window resets", async () => {
  let time = 0;
  let answer = { status_code: 200, body: JSON.stringify(billing) };
  const usage = createCloudUsage({
    base: "http://cliproxy",
    managementKey: "management",
    fetchImpl: management(() => answer).fetchImpl,
    now: () => time,
  });
  const known = await usage();
  answer = { status_code: 502, body: "" };
  time = 60_000;
  await usage();
  await setImmediate();
  assert.deepEqual(await usage(), known);
  time = Date.parse(billing.config.currentPeriod.end);
  await usage();
  await setImmediate();
  assert.deepEqual(await usage(), [{ label: "Grok", reason: "Grok's billing returned HTTP 502." }]);
});

test("Unreadable Grok usage reads as unknown", async () => {
  const { fetchImpl } = management(() => ({ status_code: 401, body: "" }));
  assert.deepEqual(
    await createCloudUsage({ base: "http://cliproxy", managementKey: "management", fetchImpl })(),
    [{ label: "Grok", reason: "Grok's billing returned HTTP 401." }],
  );
  assert.deepEqual(await createCloudUsage({ base: "http://cliproxy", fetchImpl })(), [
    { label: "Grok", reason: "Set STUDIO_CLIPROXYAPI_MANAGEMENT_KEY to read Grok's usage." },
  ]);
});

test("Cloud work holds back only once every account's known usage reaches the limit", () => {
  const grok = (used?: number) => ({
    label: "Grok",
    reason: "",
    ...(used === undefined ? {} : { used }),
  });
  assert.equal(cloudHeld([grok(83)], {}), true);
  assert.equal(cloudHeld([grok(79)], {}), false);
  assert.equal(cloudHeld([grok(83), grok(40)], {}), false);
  assert.equal(cloudHeld([grok(83), grok()], {}), false);
  assert.equal(cloudHeld([grok()], {}), false);
  assert.equal(cloudHeld(undefined, {}), false);
  assert.equal(cloudHeld([grok(83)], { STUDIO_CLOUD_USAGE_LIMIT: "90" }), false);
});
