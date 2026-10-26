import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createGenerationAdmission } from "./admission.ts";
import { registerCompareRoutes, type ComparisonRecord } from "./compare.ts";
import type { GenerationQueue } from "./queue.ts";
import { RewriteStore } from "./store.ts";

test("compare runs queue one seeded set, read back per owner and record the starred winner", async (t) => {
  const store = new RewriteStore(":memory:");
  let records: ComparisonRecord[] = [
    // A legacy record: gallery job IDs only, no labels.
    {
      id: "legacy",
      ownerId: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
      seed: "7",
      jobIds: ["old-a", "old-b"],
      vote: null,
    },
  ];
  let gallery: Record<string, unknown>[] = [
    { id: "old-a-0", jobId: "old-a", ownerId: "alice", type: "image", status: "done", prompt: "p" },
  ];
  const admit = createGenerationAdmission({
    store,
    queue: { tick: async () => undefined } as unknown as GenerationQueue,
    validate: async (input) =>
      input.profileId === "broken"
        ? { status: 400, payload: { ok: false, error: "That profile is unavailable." } }
        : { status: 200, payload: { ok: true } },
    resourceFor: async () => "local-media",
    pendingItems: (id, input) => [
      { id: `${id}-0`, jobId: id, type: "image", status: "pending", prompt: input.prompt },
    ],
    revision: () => 0,
    jobLimit: 10,
  });
  const votes: string[][] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: String(req.headers["x-user"]), role: "user" } });
    next();
  });
  registerCompareRoutes(app as unknown as Parameters<typeof registerCompareRoutes>[0], {
    store,
    admit,
    cancel: async (ownerId, id) => store.save({ ...store.job(ownerId, id)!, status: "cancelled" }),
    read: () => structuredClone(records),
    write: (next) => {
      records = structuredClone(next);
    },
    gallery: (req) =>
      gallery.filter((item) => item.ownerId === (req.studioAccount?.userId || "")) as never,
    pendingItems: (id, input) => [
      { id: `${id}-0`, jobId: id, type: "image", status: "pending", prompt: input.prompt },
    ],
    voted: (ownerId, jobId) => votes.push([ownerId, jobId]),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.close();
  });
  const request = async (route: string, body?: unknown, method = "POST", user = "alice") => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/comparisons${route}`,
      {
        method: body === undefined ? "GET" : method,
        headers: { "content-type": "application/json", "x-user": user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const variant = (label: string, patch: Record<string, unknown> = {}) => ({
    label,
    input: { prompt: "a fox", profileId: "flux", seed: "", count: 3, ...patch },
  });

  // A refused variant cancels the variants already queued and records nothing.
  const refused = await request("/run", {
    variants: [variant("Flux"), variant("Broken", { profileId: "broken" })],
  });
  assert.equal(refused.status, 400);
  assert.deepEqual(
    store.jobs("alice").map((job) => job.status),
    ["cancelled"],
  );
  assert.equal(records.length, 1);

  const run = await request("/run", {
    variants: [variant("Steps 20", { steps: 20 }), variant("Steps 40", { steps: 40 })],
  });
  assert.equal(run.status, 201);
  const jobs = run.body.variants.map((entry: { jobId: string }) =>
    store.job("alice", entry.jobId)!,
  );
  assert.match(run.body.seed, /^\d+$/);
  assert.deepEqual(
    jobs.map((job: { input: Record<string, unknown> }) => [job.input.seed, job.input.count]),
    [
      [run.body.seed, 1],
      [run.body.seed, 1],
    ],
  );
  assert.equal(new Set(jobs.map((job: { queueSet?: string }) => job.queueSet)).size, 1);
  assert.equal(new Set(jobs.map((job: { sessionId: string }) => job.sessionId)).size, 1);
  assert.equal(run.body.prompt, "a fox");
  assert.deepEqual(
    run.body.variants.map((entry: { label: string; item: { status: string } }) => [
      entry.label,
      entry.item.status,
    ]),
    [
      ["Steps 20", "pending"],
      ["Steps 40", "pending"],
    ],
  );
  assert.equal((await request(`/${run.body.id}`, undefined, "GET", "bob")).status, 404);

  // Only a finished variant can win; the choice is stored for the taste profile.
  const [winner] = run.body.variants;
  assert.equal((await request(`/${run.body.id}/vote`, { jobId: winner.jobId }, "PUT")).status, 400);
  gallery = [
    ...gallery,
    {
      id: "w-0",
      jobId: winner.jobId,
      ownerId: "alice",
      type: "image",
      status: "done",
      prompt: "a fox",
    },
  ];
  const voted = await request(`/${run.body.id}/vote`, { jobId: winner.jobId }, "PUT");
  assert.equal(voted.body.vote, winner.jobId);
  assert.equal(records[0].vote, winner.jobId);
  assert.ok(records[0].votedAt);
  // The winner is a taste signal; a refused vote is not.
  assert.deepEqual(votes, [["alice", winner.jobId]]);

  // Existing jobs, such as an MCP fan-out run, form a set; foreign jobs are refused.
  const created = await request("", {
    jobIds: jobs.map((job: { id: string }) => job.id),
    labels: ["Flux", "Qwen"],
  });
  assert.equal(created.status, 201);
  assert.deepEqual(
    created.body.variants.map((entry: { label: string }) => entry.label),
    ["Flux", "Qwen"],
  );
  assert.equal((await request("", { jobIds: [jobs[0].id, "old-a"] }, "POST", "bob")).status, 404);

  const history = (await request("")).body.comparisons;
  assert.deepEqual(
    history.map((entry: { id: string }) => entry.id),
    [created.body.id, run.body.id, "legacy"],
  );
  assert.deepEqual(
    history[2].variants.map((entry: { label: string; item: unknown }) => [
      entry.label,
      Boolean(entry.item),
    ]),
    [
      ["Variant A", true],
      ["Variant B", false],
    ],
  );
});
