import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { createDreamDigest } from "./dream-digest.ts";
import { registerDreamRoutes } from "./dream-routes.ts";
import type { Dream, DreamItem } from "./dream.ts";

const now = Date.parse("2026-11-24T00:00:00Z");
const day = 86_400_000;
const result = (
  id: string,
  state: "kept" | "discarded",
  extra: { profileId?: string; loras?: unknown[]; tags?: string[] } & Partial<DreamItem> = {},
  passReason?: "taste" | "similar" | "glitch" | "skip",
): DreamItem => {
  const { profileId = "flux", loras = [], tags = [], ...item } = extra;
  return {
    id,
    type: "image",
    settings: { profileId, loras },
    caption: { tags } as DreamItem["caption"],
    dream: {
      prompt: id,
      why: "",
      at: "",
      state,
      decidedAt: new Date(now - day).toISOString(),
      ...(passReason ? { passReason } : {}),
    },
    ...item,
  };
};
const items: Record<string, DreamItem[]> = {
  alice: [
    result("a1", "kept", { tags: ["forest"], loras: [{ name: "film.safetensors" }] }),
    result("a2", "kept", { tags: ["forest"], rating: "liked" }),
    result("a3", "kept", { profileId: "qwen", tags: ["city"] }),
    result("a4", "discarded", { profileId: "qwen", tags: ["city"] }, "taste"),
    result("a5", "discarded", { profileId: "qwen", tags: ["city"] }, "glitch"),
    result("a6", "discarded", { tags: ["forest"], loras: [{ name: "film.safetensors" }] }),
    result("a7", "kept", {
      profileId: "qwen",
      dream: { prompt: "", why: "", at: "", state: "kept", superLiked: true },
    }),
  ],
  bob: [result("b1", "kept")],
};

function digestFixture() {
  const reads: string[] = [];
  const digest = createDreamDigest({
    decided: (ownerId, since) => {
      reads.push(`${ownerId}@${since}`);
      return items[ownerId] || [];
    },
    taste: () => ({ models: ["flux", "gone"], loras: ["film.safetensors"], tags: ["forest"] }),
    projects: () =>
      [
        { id: "p1", name: "Harbour", paused: true },
        { id: "p2", name: "Lighthouse" },
        { id: "p3", name: "Moss", favoured: true },
      ] as never,
    exploring: () => 0.95,
    profiles: async () => [
      { id: "flux", label: "Flux 2" },
      { id: "qwen", label: "Qwen Image" },
    ],
    loraName: (name) => name.replace(/\.safetensors$/, ""),
    now: () => now,
  });
  return { digest, reads };
}

test("This Week summarises the account's verdicts from its records", async () => {
  const { digest, reads } = digestFixture();
  const week = await digest("alice");
  assert.deepEqual(reads, [`alice@${new Date(now - 7 * day).toISOString()}`]);
  assert.equal(week.kept, 4);
  assert.equal(week.passed, 3);
  // Super Liked first, then liked, then newest.
  assert.deepEqual(
    week.top.map((item) => item.id),
    ["a7", "a2", "a1", "a3"],
  );
  assert.deepEqual(week.best.models, [
    { name: "Flux 2", kept: 2, passed: 1 },
    { name: "Qwen Image", kept: 2, passed: 2 },
  ]);
  assert.deepEqual(week.best.loras, [{ name: "film", kept: 1, passed: 1 }]);
  assert.deepEqual(week.best.themes, [
    { name: "forest", kept: 2, passed: 1 },
    { name: "city", kept: 1, passed: 2 },
  ]);
  assert.deepEqual(week.passedThemes, [
    { name: "city", kept: 1, passed: 2 },
    { name: "forest", kept: 2, passed: 1 },
  ]);
  assert.deepEqual(week.reasons, [
    { reason: "glitch", count: 1 },
    { reason: "skip", count: 1 },
    { reason: "taste", count: 1 },
  ]);
  assert.deepEqual(week.next, {
    models: ["Flux 2", "gone"],
    loras: ["film"],
    themes: ["forest"],
    projects: ["Moss", "Lighthouse"],
    explore: 0.95,
  });
  await digest("alice");
  assert.equal(reads.length, 1, "a second look within a minute reads nothing again");
});

test("GET /api/dream/week answers only the caller's own digest, and only with Dream", async (t) => {
  const { digest } = digestFixture();
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: String(req.headers["x-user"]), role: "user" } });
    next();
  });
  registerDreamRoutes(app as never, {
    dream: { access: (ownerId: string) => (ownerId === "carol" ? null : {}) } as unknown as Dream,
    projects: {} as never,
    inbox: {} as never,
    digest,
    listed: (list) => list.map((item) => ({ ...item, listed: true })),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const request = async (user: string) => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dream/week`,
      { headers: { "x-user": user } },
    );
    return { status: response.status, body: await response.json() };
  };
  const bob = await request("bob");
  assert.equal(bob.status, 200);
  assert.deepEqual(
    bob.body.top.map((item: { id: string; listed: boolean }) => [item.id, item.listed]),
    [["b1", true]],
  );
  assert.equal(bob.body.kept, 1);
  assert.equal((await request("carol")).status, 403);
});
