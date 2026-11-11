import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationInput } from "../../shared/queue.ts";
import type { GenerationScope } from "./admission.ts";
import { createFaceCheck, type Identity } from "./face-check.ts";
import { createFaceRedo } from "./face-redo.ts";
import { queuePriority, type OwnedJob, type QueueOrigin } from "./store.ts";

const now = Date.parse("2026-11-11T12:00:00Z");
const job = (id: string, extra: Partial<OwnedJob> = {}): OwnedJob => ({
  id,
  jobId: id,
  ownerId: "artist",
  resource: "worker:gpu",
  sessionId: "session-1",
  operation: "image",
  status: "completed",
  reason: "",
  input: {
    prompt: "The person from the reference image on a beach.",
    profileId: "custom:qwen-edit",
    seed: "1234",
    count: 4,
    clientJobId: id,
    referenceAssets: [{ slot: "image", assetId: "mara-front" }],
  },
  items: [],
  outputs: [],
  createdAt: "2026-11-11T11:00:00Z",
  updatedAt: "2026-11-11T11:00:00Z",
  ...extra,
});

test("a drifted character result is redone once, and neither its redo nor a plain result is", async () => {
  const jobs = [job("first"), job("plain"), job("redo", { faceRedo: true, parentItemId: "older" })];
  const shot = (id: string, jobId: string, assetIds: string[]) => ({
    id,
    jobId,
    url: `/media/${id}.png`,
    type: "image",
    status: "done",
    ownerId: "artist",
    createdAt: "2026-11-11T11:05:00Z",
    settings: { referenceAssets: assetIds.map((assetId) => ({ assetId })) },
    identity: undefined as Identity | undefined,
  });
  const items = [
    shot("drifted", "first", ["mara-front"]),
    shot("redo-drifted", "redo", ["mara-front"]),
    // No character's image among its references: Face Check leaves it alone.
    shot("no-character", "plain", ["a-hat"]),
  ];
  const admitted: [GenerationInput, GenerationScope, QueueOrigin][] = [];
  const redo = createFaceRedo({
    enabled: () => true,
    account: () => ({ userId: "artist", role: "user", authenticated: true }),
    job: (ownerId, id) => jobs.find((each) => each.ownerId === ownerId && each.id === id),
    sessionJobs: () => jobs,
    admit: async (input, _account, scope, origin) => {
      admitted.push([input, scope, origin]);
      const queued = job(`queued-${admitted.length}`, {
        parentItemId: scope.parentItemId,
        faceRedo: origin.faceRedo,
      });
      jobs.push(queued);
      return { status: 200, payload: { jobId: queued.id } };
    },
    now: () => now,
    log: { info: () => {} },
  });
  const check = createFaceCheck({
    enabled: () => true,
    // Every face is someone else's.
    faces: {
      unavailable: () => "",
      embed: async (bytes) => ({
        vector:
          new TextDecoder().decode(bytes) === "mara-front"
            ? Float32Array.of(1, 0)
            : Float32Array.of(0, 1),
        faces: 1,
      }),
    },
    idle: () => true,
    items: () => items,
    visible: () => true,
    characters: () => [{ id: "chr-mara", referenceIds: ["mara-front"] }],
    image: async (item) => new TextEncoder().encode(item.id),
    reference: async (_ownerId, assetId) => new TextEncoder().encode(assetId),
    save: (item, identity) => {
      item.identity = identity;
      void redo(item as (typeof items)[number], identity);
    },
    load: () => null,
    persist: () => {},
    now: () => now,
    log: { info: () => {} },
  });
  check.startPass("missing");
  await check.settled();
  await new Promise((resolve) => setImmediate(resolve));
  // Checked again (a later pass), the original already has its redo.
  assert.equal(await redo(items[0], items[0].identity!), undefined);
  assert.deepEqual(
    items.map((item) => [item.id, item.identity?.drifted]),
    [
      ["drifted", true],
      ["redo-drifted", true],
      ["no-character", undefined],
    ],
  );
  assert.equal(admitted.length, 1);
  const [[input, scope, origin]] = admitted;
  // Run Again's input: the same prompt, profile and references, a new seed and one image.
  assert.deepEqual(input, {
    prompt: "The person from the reference image on a beach.",
    profileId: "custom:qwen-edit",
    seed: "",
    count: 1,
    referenceAssets: [{ slot: "image", assetId: "mara-front" }],
  });
  assert.deepEqual(scope, {
    sessionId: "session-1",
    operation: "image",
    parentJobId: "first",
    parentItemId: "drifted",
  });
  assert.deepEqual(origin, { priority: queuePriority.manual, faceRedo: true });
});

test("no redo for a gone account, an old result or with the switch off", async () => {
  const drifted: Identity = {
    characterId: "chr-mara",
    score: 0.1,
    faces: 1,
    drifted: true,
    checkedAt: "2026-11-11T12:00:00Z",
  };
  const item = {
    id: "drifted",
    jobId: "first",
    ownerId: "artist",
    createdAt: "2026-11-11T11:05:00Z",
  };
  let queued = 0;
  const redo = (options: { enabled?: boolean; gone?: boolean; now?: number }) =>
    createFaceRedo({
      enabled: () => options.enabled ?? true,
      account: () => (options.gone ? null : { userId: "artist", role: "user" }),
      job: () => job("first"),
      sessionJobs: () => [],
      admit: async () => {
        queued += 1;
        return { status: 200, payload: { jobId: "queued" } };
      },
      now: () => options.now ?? now,
    });
  assert.equal(await redo({ enabled: false })(item, drifted), undefined);
  assert.equal(await redo({ gone: true })(item, drifted), undefined);
  assert.equal(await redo({ now: now + 2 * 24 * 60 * 60 * 1000 })(item, drifted), undefined);
  assert.equal(await redo({})(item, { ...drifted, drifted: false }), undefined);
  assert.equal(queued, 0);
  assert.equal(await redo({})(item, drifted), "queued");
});
