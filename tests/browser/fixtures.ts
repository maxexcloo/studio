import { execFileSync } from "node:child_process";

import { type Locator, type Page, expect } from "@playwright/test";

import {
  type KeepRates,
  dreamCardCounts,
  dreamDefaults,
  dreamOverrideKeys,
  dreamTimingSettings,
} from "../../shared/dream";
import type { QueueRetryResponse } from "../../shared/queue";

const noKeepRates: KeepRates = { profiles: {}, loras: {}, tags: {} };

/** Family names as `/api/models` serves them from the catalogue, for the families fixtures use. */
const familyLabels = { flux1: "FLUX.1", sdxl: "SDXL" };

export const stamp = "2026-10-23T00:00:00.000Z";
/** A ready upscale worker with face detail. */
export const upscaleCapabilities = {
  ok: true,
  ready: true,
  nodesInstalled: true,
  missingNodes: [],
  missingModels: [],
  qualities: ["fast", "balanced", "high"],
  targets: [2048, 4096],
  substituting: false,
  fallbackFile: "",
  faceDetail: {
    nodesInstalled: true,
    missingNodes: [],
    detectors: ["bbox/face_yolov8m.pt"],
    samModels: [],
  },
};
export const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#303036"/><circle cx="512" cy="512" r="190" fill="#ffb31a"/></svg>',
  );
import type { Profile } from "../../frontend/src/types";
export const profiles: Profile[] = [
  {
    familyName: "Studio Images",
    baseModel: "image.safetensors",
    recipe: { modelLabel: "Studio Image", label: "Quality" },
    workerIds: ["worker-a", "worker-b"],
    id: "image:test",
    label: "Image Quality",
    kind: "image",
    model: "image.safetensors",
    workflow: "family:test",
    family: "test",
    ready: true,
    defaults: { width: 1024, height: 1024, steps: 20, cfg: 5 },
    capabilities: { negativePrompt: true, cfg: true, lora: true, inpaint: true },
    mediaInputs: [{ id: "image", role: "start" }],
    options: { loras: ["detail.safetensors", "soft-style.safetensors"] },
  },
  {
    id: "video:test",
    label: "Motion Quality",
    kind: "video",
    model: "video.safetensors",
    workflow: "family:motion",
    family: "motion",
    ready: true,
    defaults: { width: 1024, height: 1024, frames: 81, fps: 24 },
    capabilities: { imageInput: true },
    mediaInputs: [{ id: "start", required: true }],
  },
];
profiles.push({
  ...profiles[0],
  id: "image:fast",
  label: "Image Fast",
  recipe: { modelLabel: "Studio Image", label: "Fast" },
  defaults: { width: 1024, height: 1024, steps: 4, cfg: 1 },
});

/** Two image backends with different reference and LoRA capacities. */
export function combinedImageProfile(radianceReferences = 4): Profile {
  const shared = {
    ...profiles[0],
    id: "custom:combined",
    label: "Combined Image",
    backend: "radiance",
  };
  const variants = [
    { id: "comfyui", references: 10, width: 2048, maxLoras: 8 },
    { id: "radiance", references: radianceReferences, width: 1536, maxLoras: 4 },
  ].map((backend) => ({
    id: backend.id,
    label: backend.id === "radiance" ? "Radiance" : "ComfyUI",
    ready: true,
    references: backend.references,
    profile: {
      ...shared,
      backend: backend.id,
      defaults: { ...shared.defaults, width: backend.width, height: backend.width },
      maxLoras: backend.maxLoras,
      capabilities: { ...shared.capabilities, startImage: backend.references > 0 },
      mediaInputs: Array.from({ length: backend.references }, (_, index) => ({
        id: index ? `reference-${index + 1}` : "reference",
        label: "Reference Image",
        ...(index ? { follows: index > 1 ? `reference-${index}` : "reference" } : {}),
      })),
    },
  }));
  return { ...variants[1].profile, backendOptions: variants };
}

export async function fixtures(page: Page) {
  let sessions = 0;
  const jobs: any[] = [];
  const presets: any[] = [];
  const gallery: any[] = [];
  const referenceRequests: any[] = [];
  const characters: any[] = [];
  const outfits: any[] = [];
  const scenes: any[] = [];
  const cards = { characters, outfits, scenes };
  const galleryRequests: string[] = [];
  const loraLibrary = {
    strengths: {},
    ratings: {} as Record<string, string>,
    recents: [],
  };
  const loraOperations: any[] = [];
  const queuePause = { mine: false, all: false };
  let clock = Date.parse(stamp);
  const nextStamp = () => new Date((clock += 1000)).toISOString();
  const comparisons: any[] = [];
  const showComparison = (comparison: any) => ({
    id: comparison.id,
    seed: comparison.seed,
    vote: comparison.vote,
    rating: comparison.rating ?? null,
    winnerItemId: comparison.winnerItemId || null,
    ...(comparison.dream ? { dream: comparison.dream } : {}),
    ...(new Set(comparison.requests.map((variant: any) => variant.input.prompt)).size === 1
      ? { prompt: comparison.requests[0].input.prompt }
      : {}),
    ...(comparison.itemIds ? {} : { set: comparison.id }),
    ...(comparison.card ? { card: comparison.card } : {}),
    variants: comparison.jobIds.map((jobId: string, index: number) => ({
      jobId,
      label: comparison.labels[index],
      item:
        gallery.find(
          (item) =>
            item.jobId === jobId &&
            (!comparison.itemIds?.[index] || item.id === comparison.itemIds[index]),
        ) || null,
    })),
  });
  function recordGeneration(body: any, sessionId: string) {
    const id = `job-${jobs.length + 1}`,
      createdAt = nextStamp();
    const item = {
      id: `${id}:0`,
      jobId: id,
      sessionId,
      status: "done",
      type: body.kind,
      url: image,
      thumbnailUrl: image,
      prompt: body.prompt,
      width: 1024,
      height: 1024,
      createdAt,
      settings: { ...body },
      ...(body.resultSet ? { resultSet: body.resultSet } : {}),
    };
    const job = {
      id,
      jobId: id,
      sessionId,
      input: body,
      operation: body.operation,
      parentJobId: body.parentJobId,
      parentItemId: body.parentItemId,
      status: "completed",
      items: [item],
      outputs: [item],
      createdAt,
      updatedAt: createdAt,
    };
    jobs.push(job);
    gallery.unshift(item);
    return job;
  }
  const ownAccount = {
    id: "admin",
    username: "admin@example.test",
    provider: "local",
    canChangeEmail: true,
    canChangePassword: true,
  };

  const deploymentDream = dreamPolicyFixture();
  let deploymentTextProfile = "";
  const administration = {
    accounts: [
      {
        id: "admin",
        username: "admin@example.test",
        role: "administrator",
        disabled: false,
      },
      {
        id: "member",
        username: "member@example.test",
        role: "user",
        accessProfileId: "users",
        disabled: false,
      },
    ],
    accessProfiles: [
      {
        id: "users",
        name: "Users",
        allModels: true,
        generationProfiles: ["image:test"],
        features: { cloudModels: false, loras: false, uncensoredModels: false },
      },
    ],
    availableProfiles: ["image:test", "image:fast", "video:test"],
    defaultAccessProfileId: "users",
  };
  // Each account's gallery, storage and last 30 days, as Settings › Users shows them.
  const galleryOwners: Record<
    string,
    {
      items: number;
      images: number;
      videos: number;
      cloudJobs: number;
      gpuMs: number;
      bytes: number;
    }
  > = {};

  const preferences = {
    preferences: {
      loras: true,
      tileCaptions: false,
      uncensoredModels: true,
    } as Record<string, unknown>,
    saved: [] as string[],
    grants: { loras: false, uncensoredModels: false },
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    let body: any = {};
    try {
      body = request.postDataJSON() || {};
    } catch {}
    const respond = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === "/api/accounts/me") {
      if (method === "PATCH") {
        if (body.username) ownAccount.username = body.username;
      }
      return respond({ account: ownAccount });
    }
    if (path === "/api/accounts/admin") return respond(administration);
    if (path === "/api/runtime/benchmarks") return respond({ configured: false, runs: [] });
    if (path === "/api/runtime/queue") return respond({ workloads: {} });
    if (path === "/api/gallery/owners") return respond({ ok: true, owners: galleryOwners });
    if (path.startsWith("/api/gallery/owners/") && method === "DELETE") {
      delete galleryOwners[decodeURIComponent(path.split("/")[4])];
      return respond({ ok: true });
    }
    if (path === "/api/preferences") {
      if (method === "PATCH") {
        const { previousGalleryViews: _previousGalleryViews, ...patch } = body;
        Object.assign(preferences.preferences, patch);
        preferences.saved = [...new Set([...preferences.saved, ...Object.keys(patch)])];
      }
      return respond(preferences);
    }
    if (path === "/api/settings/deployment") {
      if (method === "POST") {
        const setting = Object.values(deploymentDream).find((entry) => entry.key === body.key);
        if (setting) setting.value = body.value;
        if (body.key === "STUDIO_DEFAULT_TEXT_PROFILE") deploymentTextProfile = body.value;
      }
      const setting = (key: string) => ({
        key,
        configured: "",
        effective: "",
        source: "default",
        locked: false,
      });
      return respond({
        defaults: {
          image: setting("STUDIO_DEFAULT_IMAGE_PROFILE"),
          video: setting("STUDIO_DEFAULT_VIDEO_PROFILE"),
          text: {
            ...setting("STUDIO_DEFAULT_TEXT_PROFILE"),
            configured: deploymentTextProfile,
            effective: deploymentTextProfile || "cloud/auto",
          },
          textModels: ["cloud/auto", "local/auto"],
          profiles: [],
        },
        catalogue: [
          {
            key: "STUDIO_GALLERY_CAPTIONS",
            label: "Gallery Captions",
            description: "Caption images for search.",
            value: true,
            source: "default",
            locked: false,
          },
        ],
        dream: deploymentDream,
      });
    }
    if (path.match(/^\/api\/accounts\/profiles\/[^/]+$/) && method === "DELETE") {
      administration.accessProfiles = administration.accessProfiles.filter(
        (group) => group.id !== decodeURIComponent(path.split("/")[4]),
      );
      return respond({ ok: true });
    }
    if (path.match(/^\/api\/accounts\/users\/[^/]+$/) && method === "DELETE") {
      administration.accounts = administration.accounts.filter(
        (account) => account.id !== path.split("/")[4],
      );
      return respond({ ok: true });
    }
    if (path === "/api/accounts/profiles") {
      administration.accessProfiles = administration.accessProfiles.filter(
        (group) => group.id !== body.id,
      );
      administration.accessProfiles.push(body);
      return respond({ profile: body });
    }
    if (path.match(/^\/api\/accounts\/users\/[^/]+$/) && method === "PATCH") {
      const account = administration.accounts.find((account) => account.id === path.split("/")[4]);
      Object.assign(account!, body);
      return respond({ account });
    }
    if (path === "/api/accounts/status")
      return respond({ mode: "single-user", chatUrl: "https://chat.example.test" });
    if (path === "/api/models") return respond({ profiles, familyLabels });
    if (path === "/api/upscale/status") return respond(upscaleCapabilities);
    // Local video is running and the account has no Cloud: Animate takes the local video profile.
    if (path === "/api/animate/profile")
      return respond({
        profileId: "video:test",
        label: "Motion Quality",
        cloud: false,
        offers: { cloud: false, local: true },
      });
    if (path === "/api/loras/library") return respond({ found: true, library: loraLibrary });
    if (path === "/api/loras/library/ops" && method === "POST") {
      for (const operation of body.ops) {
        loraOperations.push(operation);
        switch (operation.op) {
          case "rating":
            if (operation.rating) loraLibrary.ratings[operation.name] = operation.rating;
            else delete loraLibrary.ratings[operation.name];
            break;
          default:
            throw new Error(`Unsupported fixture LoRA operation: ${operation.op}`);
        }
      }
      return respond({ ok: true, library: loraLibrary });
    }
    if (path === "/api/loras/previews")
      return respond({
        previews: Object.fromEntries(
          gallery
            .flatMap((item) =>
              (item.settings?.loras || []).map((lora: any) => [lora.name, item.thumbnailUrl]),
            )
            .reverse(),
        ),
        uses: {},
      });
    if (path === "/api/loras/info")
      return respond({
        loras: {
          "detail.safetensors": {
            title: "Detail Slider",
            families: ["test"],
            type: "slider",
            strengthRange: { min: -3, max: 10, step: 0.05, default: 0.8 },
          },
          "soft-style.safetensors": { title: "Soft Style", families: ["test"], type: "style" },
        },
      });
    if (path === "/api/prompts") return respond({ enabled: true, prompts: [] });
    if (path === "/api/assistant")
      return respond({
        available: true,
        defaultPreset: "improve",
        presets: [{ id: "improve", label: "Improve" }],
        themes: [
          { id: "action", label: "Action" },
          { id: "cinematic", label: "Cinematic Camera" },
          { id: "dialogue", label: "Dialogue" },
          { id: "living", label: "Living Photo" },
          { id: "custom", label: "Custom" },
        ],
        changes: [],
      });
    if (path === "/api/suggestions")
      return respond({
        suggestions: [],
        reason: "Like a few results so Studio learns your taste.",
      });
    if (path === "/api/assistant/rewrite")
      return respond({ prompt: "A cinematic amber bird", source: "model" });
    if (path === "/api/services/status")
      return respond({
        services: {
          image: {
            state: "healthy",
            reason: "Image endpoint is ready.",
            endpoints: [
              {
                id: "worker-a",
                label: "Image Worker",
                state: "healthy",
                reason: "Ready",
                endpoint: "https://images.example.test/system_stats",
                device: "Fixture GPU",
              },
            ],
          },
          video: {
            state: "offline",
            reason: "Video endpoint is offline.",
            endpoints: [
              { id: "worker-video", label: "Video Worker", state: "offline", reason: "Offline" },
            ],
          },
          text: {
            state: "healthy",
            reason: "Text endpoint is ready.",
            endpoints: [{ id: "text", label: "Text Worker", state: "healthy", reason: "Ready" }],
          },
        },
        cloud: [{ label: "Grok", used: 40, reason: "Weekly usage." }],
        workers: [
          {
            id: "primary",
            label: "Image Worker",
            capabilities: ["image", "upscale", "models"],
            state: "healthy",
            reason: "The direct media worker is ready.",
            currentJob: "fixture-job",
            queued: 2,
            loadedModel: "image:test",
            memoryFree: 8 * 1024 ** 3,
            freeAt: Date.now() + 5 * 60_000,
          },
          {
            id: "video",
            label: "Video Worker",
            capabilities: ["video"],
            state: "offline",
            reason: "The direct runtime could not be reached.",
            queued: 0,
          },
        ],
        runtime: {
          configured: false,
          reason:
            "Studio runtime control is not configured; GPU workloads are neither observed nor switched.",
        },
      });
    if (path === "/api/queue") {
      // Jobs change in place here, so a poll since a change gets every job back as changed.
      const listed = jobs.filter((job) => !job.cleared);
      const failedSets = new Set(
        listed.filter((job) => job.queueSet && job.status === "failed").map((job) => job.queueSet),
      );
      return respond({
        jobs: listed,
        clearableFailedSets: [...failedSets].filter((set) =>
          jobs.every((job) => job.queueSet !== set || ["failed", "cancelled"].includes(job.status)),
        ),
        ...(url.searchParams.has("since") ? { ids: listed.map((job) => job.id) } : {}),
        paused: queuePause,
      });
    }
    const pause = /^\/api\/queue\/(pause|resume)(-all)?$/.exec(path);
    if (pause) {
      queuePause[pause[2] ? "all" : "mine"] = pause[1] === "pause";
      const held = queuePause.mine || queuePause.all;
      for (const job of jobs)
        if (["queued", "waiting"].includes(job.status))
          Object.assign(job, { status: "queued", reason: held ? "Paused" : "" });
      return respond({ ok: true });
    }
    if (path.match(/^\/api\/queue\/[^/]+\/move$/)) {
      // The fixture has one account, so its waiting items trade places among themselves.
      const waiting = jobs.filter((job) => ["writing", "queued", "waiting"].includes(job.status));
      const job = jobs.find((j) => j.id === path.split("/")[3]);
      const from = waiting.indexOf(job);
      const to = Math.min(waiting.length - 1, body.to);
      const slots = waiting.map((item) => jobs.indexOf(item));
      waiting.splice(to, 0, ...waiting.splice(from, 1));
      slots.forEach((slot, index) => (jobs[slot] = waiting[index]));
      return respond({ ok: true });
    }
    const setMove = /^\/api\/queue\/sets\/([^/]+)\/move$/.exec(path);
    if (setMove) {
      // The set's waiting items move together, in their order, among the account's others.
      const waiting = jobs.filter((job) => ["writing", "queued", "waiting"].includes(job.status));
      const slots = waiting.map((item) => jobs.indexOf(item));
      const block = waiting.filter((job) => job.queueSet === setMove[1]);
      const order = waiting.filter((job) => !block.includes(job));
      order.splice(Math.min(order.length, body.to), 0, ...block);
      slots.forEach((slot, index) => (jobs[slot] = order[index]));
      return respond({ ok: true });
    }
    if (path === "/api/queue/clear-failed") {
      const failed = jobs.filter((job) => job.status === "failed" && !job.cleared);
      failed.forEach((job) => (job.cleared = true));
      return respond({ cleared: failed.length });
    }
    const clearSet = /^\/api\/queue\/sets\/([^/]+)\/clear-failed$/.exec(path);
    if (clearSet) {
      const failed = jobs.filter(
        (job) => job.queueSet === clearSet[1] && job.status === "failed" && !job.cleared,
      );
      failed.forEach((job) => (job.cleared = true));
      return respond({ cleared: failed.length });
    }
    if (path.match(/^\/api\/queue\/[^/]+\/clear$/)) {
      const job = jobs.find((j) => j.id === path.split("/")[3]);
      job.cleared = true;
      return respond({ job });
    }
    if (path === "/api/queue/cancel-all") {
      const active = jobs.filter(
        (job) => !["completed", "cancelled", "failed"].includes(job.status),
      );
      active.forEach((job) => (job.status = "cancelled"));
      return respond({ outcomes: active.map((job) => ({ job, cancelRequested: false })) });
    }
    if (path.match(/^\/api\/queue\/[^/]+\/cancel$/)) {
      const job = jobs.find((j) => j.id === path.split("/")[3]);
      job.status = "cancelled";
      return respond({ job });
    }
    if (path === "/api/sessions" && method === "POST") {
      sessions += 1;
      return respond({
        session: { id: `session-${sessions}`, title: "", createdAt: stamp, updatedAt: stamp },
      });
    }
    if (path.match(/^\/api\/sessions\/[^/]+\/generations$/)) {
      const sessionId = path.split("/")[3];
      const job = recordGeneration(body, sessionId);
      return respond({ jobId: job.id, sessionId, status: "queued" });
    }
    if (path === "/api/comparisons/recreate" && method === "POST") {
      const original = gallery.find(({ id }) => id === body.itemId)!;
      const source = jobs.find(({ id }) => id === original.jobId)!;
      const job = recordGeneration(
        { ...body.input, parentJobId: source.id, parentItemId: original.id },
        source.sessionId,
      );
      const comparison = {
        id: `compare-${comparisons.length + 1}`,
        seed: String(body.input.seed),
        jobIds: [source.id, job.id],
        itemIds: [original.id, ""],
        labels: body.labels,
        requests: [original, ...job.items].map((item) => ({ input: { prompt: item.prompt } })),
        createdAt: stamp,
        vote: null,
      };
      comparisons.push(comparison);
      return respond(showComparison(comparison), 201);
    }
    // Compare Selected records chosen gallery images.
    if (path === "/api/comparisons" && method === "POST") {
      const comparison = {
        id: `compare-${comparisons.length + 1}`,
        seed: "",
        requests: body.itemIds.map((id: string, index: number) => ({
          input: {
            prompt: gallery.find((item) =>
              id ? item.id === id : item.jobId === body.jobIds[index],
            )?.prompt,
          },
        })),
        jobIds: body.jobIds,
        itemIds: body.itemIds,
        labels:
          body.labels ?? body.jobIds.map((_: string, index: number) => `Variant ${"ABCD"[index]}`),
        vote: null,
      };
      comparisons.push(comparison);
      return respond(showComparison(comparison), 201);
    }
    if (path === "/api/comparisons" && method === "GET")
      return respond({
        comparisons:
          url.searchParams.get("members") === "1"
            ? comparisons.map(({ id, jobIds, itemIds }) => ({
                id,
                jobIds,
                ...(itemIds ? { itemIds } : {}),
              }))
            : [...comparisons].reverse().map(showComparison),
      });
    if (path === "/api/comparisons/run") {
      const seed = String(body.variants[0].input.seed || "4242");
      const sessionId = body.sessionId || "session-compare";
      const id = `compare-${comparisons.length + 1}`;
      const comparison = {
        id,
        seed,
        requests: body.variants,
        jobIds: body.variants.map(
          (variant: any, index: number) =>
            recordGeneration(
              {
                ...variant.input,
                resultSet: { id, title: "Comparison", index, variation: variant.label },
                seed,
                operation: "image",
                parentJobId: body.parentJobId,
                parentItemId: body.parentItemId,
              },
              sessionId,
            ).id,
        ),
        labels: body.variants.map((variant: any) => variant.label),
        vote: null,
      };
      comparisons.push(comparison);
      return respond(showComparison(comparison), 201);
    }
    const comparison = comparisons.find((entry) => entry.id === path.split("/")[3]);
    if (comparison && path.endsWith("/rating") && method === "PUT") {
      comparison.rating = body.rating;
      return respond({ id: comparison.id, rating: comparison.rating });
    }
    if (comparison && path.endsWith("/vote") && method === "PUT") {
      const winner = gallery.find((item) => item.id === body.itemId);
      comparison.vote = winner?.jobId || null;
      comparison.winnerItemId = winner?.id || null;
      // Generate References: the winner joins the card's images.
      const waiting =
        comparison.card &&
        cards[comparison.card.kind as "characters"].find(
          (card: any) => card.id === comparison.card.id,
        );
      if (waiting && winner && !waiting.referenceIds.includes(winner.id)) {
        waiting.referenceIds.push(winner.id);
        waiting.references.push({
          id: winner.id,
          name: "Reference",
          thumbnailUrl: image,
          url: image,
        });
      }
      return respond(showComparison(comparison));
    }
    if (comparison && method === "GET") return respond(showComparison(comparison));
    if (path === "/api/gallery/favorite" && method === "POST") {
      const items = gallery
        .filter((item) => body.ids.includes(item.id) && (item.rating ?? null) !== body.rating)
        .map((item) => {
          const was = item.rating ?? null;
          item.rating = body.rating ?? undefined;
          return { ...item, was };
        });
      return respond({ ok: true, items });
    }
    const review = path.match(/^\/api\/gallery\/library-review\/([^/]+)$/);
    if (review && method === "POST") {
      const item = gallery.find((item) => item.id === decodeURIComponent(review[1]));
      if (!item) return respond({ error: "Result not found" }, 404);
      if (body.reviewed) item.libraryReviewedAt = Date.now();
      else delete item.libraryReviewedAt;
      return respond({ ok: true });
    }
    if (path === "/api/gallery/delete" && method === "POST") {
      const removed = body.ids.filter((id: string) => gallery.some((item) => item.id === id));
      gallery.splice(0, gallery.length, ...gallery.filter((item) => !removed.includes(item.id)));
      return respond({ ok: true, removed });
    }
    if (path.startsWith("/api/gallery/") && method === "DELETE") {
      const index = gallery.findIndex((item) => item.id === decodeURIComponent(path.split("/")[3]));
      if (index >= 0) gallery.splice(index, 1);
      return respond({ ok: true });
    }
    if (path.startsWith("/api/gallery/results/")) {
      const item = gallery.find((item) => item.number === Number(path.split("/")[4]));
      return item
        ? respond({ item })
        : respond({ error: "That item is no longer in the gallery." }, 404);
    }
    if (path.startsWith("/api/gallery/items/")) {
      const item = gallery.find((i) => i.id === decodeURIComponent(path.split("/")[4]));
      return item
        ? respond({ item })
        : respond({ error: "That item is no longer in the gallery." }, 404);
    }
    if (path === "/api/gallery/filters")
      return respond({
        models: ["image.safetensors", "video.safetensors"],
        loras: ["detail.safetensors", "soft-style.safetensors"],
        sizes: [{ value: "up-to-1k", label: "Up to 1K", description: "1024 px or less" }],
        aspects: [
          { value: "landscape", label: "Landscape" },
          { value: "portrait", label: "Portrait" },
          { value: "square", label: "Square" },
        ],
        // The caption tags in the fixture gallery, most used first.
        tags: [
          ...gallery
            .flatMap((item) => item.caption?.tags || [])
            .reduce((counts, tag) => counts.set(tag, (counts.get(tag) || 0) + 1), new Map()),
        ]
          .sort(([, a], [, b]) => b - a)
          .map(([tag, count]) => ({ value: tag, label: tag, count })),
      });
    if (path === "/api/gallery") {
      galleryRequests.push(url.search);
      const rating = url.searchParams.get("rating");
      const sort = url.searchParams.get("sort");
      const similar = url.searchParams.get("similar");
      const unrated = url.searchParams.get("unrated") === "1";
      const unreviewed = url.searchParams.get("unreviewed") === "1";
      const finished = unrated || unreviewed || url.searchParams.get("finished") === "1";
      const since = url.searchParams.get("since");
      const items = gallery.filter(
        (i) =>
          (url.searchParams.get("select") !== "failed" || i.status === "failed") &&
          (!finished || i.status === "done") &&
          (!unrated || !i.rating) &&
          (!unreviewed || !i.libraryReviewedAt) &&
          (!since || Date.parse(i.createdAt) >= Date.parse(since)) &&
          (!url.searchParams.get("q") || i.prompt.includes(url.searchParams.get("q"))) &&
          (!url.searchParams.get("type") || i.type === url.searchParams.get("type")) &&
          Boolean(i.uploaded) === (url.searchParams.get("uploads") === "1") &&
          (rating
            ? i.rating === rating
            : url.searchParams.get("includeDisliked") === "1" ||
              (!similar && sort === "disliked") ||
              i.rating !== "disliked") &&
          (!url.searchParams.has("tag") ||
            url.searchParams.getAll("tag").some((tag) => i.caption?.tags?.includes(tag))) &&
          (url.searchParams.get("drifted") !== "1" || i.identity?.drifted) &&
          (!url.searchParams.has("character") ||
            i.identity?.characterId === url.searchParams.get("character")) &&
          (!url.searchParams.has("set") || i.resultSet?.id === url.searchParams.get("set")) &&
          (!url.searchParams.has("chat") ||
            i.chat?.conversationId === url.searchParams.get("chat")) &&
          (!url.searchParams.has("turn") || i.chat?.turnId === url.searchParams.get("turn")),
      );
      // Similar ranks the image first.
      if (similar) items.sort((a, b) => Number(b.id === similar) - Number(a.id === similar));
      else if (sort === "oldest")
        items.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      else if (sort === "liked" || sort === "disliked")
        items.sort((a, b) => Number(b.rating === sort) - Number(a.rating === sort));
      return respond({ items, hasMore: false, nextCursor: "", totalApprox: items.length });
    }
    // Character, outfit and scene cards, their images shown as reference assets.
    const cardKind = path.match(/^\/api\/(characters|outfits|scenes)\b/)?.[1] as
      | "characters"
      | "outfits"
      | "scenes"
      | undefined;
    if (cardKind) {
      const list = cards[cardKind];
      const noun = cardKind.slice(0, -1);
      const card = (fields: any, id: string) => ({
        ...fields,
        id,
        name: fields.name,
        description: fields.description,
        createdAt: stamp,
        updatedAt: stamp,
        rating: null,
        referenceIds: fields.referenceIds,
        references: fields.referenceIds.map((asset: string) => ({
          id: asset,
          name: "Character Image",
          thumbnailUrl: image,
          url: image,
          width: 1024,
          height: 1024,
        })),
        missing: 0,
      });
      const id = decodeURIComponent(path.split("/")[3] || "");
      const index = list.findIndex((item) => item.id === id);
      // Make Sheet's job, which the card follows until a test gives it panels.
      if (path.endsWith("/sheet")) {
        characters[index].sheet = { jobId: "sheet-job", at: stamp, status: "making", panels: [] };
        return respond({ ok: true, jobId: "sheet-job", profile: "Qwen-Image 2.1" });
      }
      // Generate References: the card saved waiting on a comparison of its candidates.
      if (path.endsWith("/references")) {
        const comparisonId = `compare-${comparisons.length + 1}`;
        const saved = {
          ...card(body, body.id || `${noun}-${list.length + 1}`),
          candidates: comparisonId,
        };
        if (body.id) list[list.findIndex((item) => item.id === body.id)] = saved;
        else list.push(saved);
        const labels = ["Seed 1", "Seed 2", "Seed 3", "Seed 4"];
        const requests = labels.map(() => ({
          input: {
            kind: "image",
            profileId: body.profileId,
            prompt: `A reference of ${body.description}`,
          },
        }));
        const comparison = {
          id: comparisonId,
          seed: "",
          requests,
          labels,
          card: { kind: cardKind, id: saved.id, name: saved.name },
          jobIds: requests.map(
            ({ input }, index) =>
              recordGeneration(
                {
                  ...input,
                  resultSet: {
                    id: comparisonId,
                    title: "Comparison",
                    index,
                    variation: labels[index],
                  },
                  seed: String(index + 1),
                  operation: "image",
                },
                "session-references",
              ).id,
          ),
          vote: null,
        };
        comparisons.push(comparison);
        return respond({ ok: true, [noun]: saved, comparison: showComparison(comparison) }, 201);
      }
      if (method === "POST") {
        list.push(card(body, `${noun}-${list.length + 1}`));
        return respond({ ok: true, [noun]: list.at(-1) }, 201);
      }
      if (method === "PUT") {
        list[index] = { ...card(body, id), rating: list[index].rating };
        return respond({ ok: true, [noun]: list[index] });
      }
      if (method === "PATCH") {
        list[index] = { ...list[index], rating: body.rating };
        return respond({ ok: true, [noun]: list[index] });
      }
      if (method === "DELETE") {
        list.splice(index, 1);
        return respond({ ok: true });
      }
      return respond({ [cardKind]: list });
    }
    if (method === "GET" && path.startsWith("/api/reference-assets/")) {
      const id = decodeURIComponent(path.split("/")[3]);
      return respond({
        asset: {
          id,
          name: "Saved Reference",
          thumbnailUrl: image,
          url: image,
          width: 1024,
          height: 1024,
        },
      });
    }
    if (path === "/api/gallery/frame") {
      referenceRequests.push({ save: true, ...body });
      return respond({ asset: { id: "frame-upload", name: "Saved Frame", url: image } }, 201);
    }
    if (path === "/api/reference-assets/from-gallery") {
      referenceRequests.push(body);
      return respond({
        asset: {
          id: `asset-${body.galleryItemId}`,
          source: "generation",
          galleryItemId: body.galleryItemId,
          name: "Generated Reference",
          thumbnailUrl: image,
          url: image,
          width: 1024,
          height: 1024,
        },
      });
    }
    // An upload is an uploaded gallery image, listed under the gallery's Uploads filter.
    if (path === "/api/reference-assets/upload") {
      const count = gallery.filter((item) => item.uploaded).length;
      const id = count ? `upload-${count + 1}` : "upload";
      gallery.unshift({
        id,
        uploaded: true,
        type: "image",
        status: "done",
        prompt: "",
        url: image,
        thumbnailUrl: image,
        width: 1024,
        height: 1024,
        createdAt: nextStamp(),
      });
      const asset = {
        id: `asset-${id}`,
        source: "upload",
        galleryItemId: id,
        name: "reference.png",
        thumbnailUrl: image,
        url: image,
        width: 1024,
        height: 1024,
      };
      return respond({ asset }, 201);
    }
    if (path.match(/^\/api\/user-presets\/[^/]+$/) && method === "PATCH") {
      const preset = presets.find((preset) => preset.id === path.split("/")[3]);
      Object.assign(preset, body);
      return respond({ preset });
    }
    if (path.match(/^\/api\/user-presets\/[^/]+$/) && method === "DELETE") {
      presets.splice(
        presets.findIndex((preset) => preset.id === path.split("/")[3]),
        1,
      );
      return respond({ ok: true });
    }
    if (path === "/api/user-presets" && method === "GET") return respond({ presets });
    if (path === "/api/user-presets" && method === "POST") {
      const preset = { id: `preset-${presets.length + 1}`, savedAt: nextStamp(), ...body };
      presets.push(preset);
      return respond({ preset });
    }
    if (path === "/api/library/imports")
      return method === "GET"
        ? respond({
            imports: [
              {
                id: "import-1",
                name: "Watercolour Inspiration",
                state: "needs-files",
                audit: "needs-files",
                grade: { value: "partial", reasons: ["Watercolour LoRA is missing"] },
                resources: [
                  { name: "watercolour.safetensors", status: "missing", downloadable: true },
                ],
              },
            ],
          })
        : respond({ import: { id: "import-2" } });
    if (path === "/api/library/items")
      return respond({
        items: [
          {
            key: "detail",
            title: "Detail LoRA",
            installed: true,
            kind: "lora",
            folder: "loras",
            type: "slider",
            families: ["Test"],
          },
          {
            key: "base",
            title: "Base Model",
            installed: false,
            kind: "checkpoint",
            folder: "checkpoints",
            families: ["Test"],
          },
        ],
      });
    if (path === "/api/presets")
      return respond({
        presets: [
          {
            id: "1",
            name: "Amber Study",
            prompt: "Amber bird study",
            negative: "blur",
            thumbnailUrl: image,
            settings: { steps: 24 },
            resources: [{ profileId: "image:test" }],
          },
        ],
      });
    if (
      [
        "/api/gallery/captions",
        "/api/gallery/captions/me",
        "/api/gallery/embeddings",
        "/api/gallery/faces",
      ].includes(path)
    )
      return respond({
        state: "finished",
        active: false,
        reason: "",
        done: 0,
        failed: 0,
        remaining: 0,
        total: 0,
        scope: "outdated",
        scopes: { all: 0, outdated: 0, missing: 0 },
        perMinute: 0,
        etaSeconds: null,
      });
    // Dream paused, as a new account sees it; serveDream replaces this for Dream's own specs.
    if (path === "/api/dream/history") return respond({ items: [] });
    if (path === "/api/dream/keep-rates") return respond(noKeepRates);
    if (path === "/api/gallery/library-review")
      return respond({ items: [], remaining: 0, nextCursor: "" });
    if (path === "/api/dream/count")
      return respond({ unseen: 0, images: 0, videos: 0, active: false });
    if (path === "/api/dream")
      return respond({
        settings: dreamDefaults,
        locked: [],
        today: { images: 0, videos: 0 },
        unseen: [],
        status: "paused",
      });
    return respond({ ok: true });
  });
  return {
    jobs,
    presets,
    gallery,
    administration,
    galleryOwners,
    ownAccount,
    preferences,
    referenceRequests,
    characters,
    outfits,
    scenes,
    galleryRequests,
    loraLibrary,
    loraOperations,
    comparisons,
    queuePause,
  };
}
export async function serveRetries(
  page: Page,
  { jobs, gallery }: Pick<Awaited<ReturnType<typeof fixtures>>, "jobs" | "gallery">,
  admit: (
    ids: string[],
  ) => QueueRetryResponse["outcomes"] | Promise<QueueRetryResponse["outcomes"]>,
) {
  await page.route("**/api/queue/retry", async (route) => {
    const { ids } = route.request().postDataJSON() as { ids: string[] };
    const outcomes = await admit(ids);
    const accepted = new Set(
      outcomes.flatMap((outcome) => ("replacement" in outcome ? [outcome.id] : [])),
    );
    for (const job of jobs) if (accepted.has(job.id)) job.cleared = true;
    for (let index = gallery.length - 1; index >= 0; index--) {
      const item = gallery[index];
      if (item.status === "failed" && accepted.has(item.jobId)) gallery.splice(index, 1);
    }
    await route.fulfill({ status: 202, json: { outcomes } });
  });
}

/** Serves `/api/models` with these profiles in place of the fixture catalogue. */
export async function serveProfiles(page: Page, profiles: Profile[]) {
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { profiles, familyLabels } }),
  );
}

/** Signs `account` in to a multi-user instance. */
export async function signIn(
  page: Page,
  account: { id: string; role: string; username?: string; features?: Record<string, boolean> },
) {
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({ json: { mode: "multi-user", signedIn: true, account } }),
  );
}

export async function create(page: Page) {
  await page.goto("/images?compose=1");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
}
/** Expands the collapsed composer (on phones, the Generate sheet). */
export async function expandComposer(page: Page) {
  await page.locator("[data-composer-prompt]").click();
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  // The compact bar leaves once the composer has opened and focused its prompt.
  await expect(page.locator("[data-composer-prompt]")).toHaveCount(0);
}
/**
 * While a phone sheet's text box has focus its bar holds Done in place of Generate; Done returns
 * to the sheet. Elsewhere there is nothing to finish.
 */
export async function finishTyping(page: Page) {
  const done = page
    .getByRole("group", { name: "Generation Actions", exact: true })
    .getByRole("button", { name: "Done", exact: true });
  if (await done.count()) await done.click();
}
/** Presses the composer's Generate, finishing any typing first. */
export async function pressGenerate(page: Page, name = "Generate Image") {
  await finishTyping(page);
  await page.getByRole("button", { name, exact: true }).click();
}
export async function openNav(page: Page, label: string) {
  if (["Library", "Settings"].includes(label)) {
    await page.getByRole("button", { name: "More Options", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("link", { name: label, exact: true }).first().click();
}

export async function openTheme(page: Page) {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
}

/** A toolbar's search box: in the toolbar on desktop, opened from its icon on phones. */
export async function toolbarSearch(scope: Page | Locator, label = "Gallery") {
  const open = scope.getByRole("button", { name: `Search ${label}`, exact: true });
  const box = scope.getByRole("textbox", { name: `Search ${label}`, exact: true });
  // Phones show a button that opens the box; wait until the page shows either.
  await expect(open.or(box).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  return box;
}

/** A labelled action in the gallery selection bar. */
export function selectionAction(page: Page, label: string, role: "button" | "link" = "button") {
  return page
    .getByRole("group", { name: "Selected Item Actions", exact: true })
    .getByRole(role, { name: label, exact: true });
}

/** Dispatches one touch event at `y` on `target`, as a finger pressing, moving or lifting. */
export async function touch(target: Locator, type: string, y = 100) {
  await target.evaluate(
    (element, { type, y }) => {
      const contact = { identifier: 1, target: element, clientX: 100, clientY: y };
      const touches = type === "touchend" ? [] : [contact];
      const event = document.createEvent("TouchEvent");
      event.initEvent(type, true, true);
      Object.defineProperties(event, {
        touches: { value: touches },
        targetTouches: { value: touches },
        changedTouches: { value: [contact] },
      });
      element.dispatchEvent(event);
    },
    { type, y },
  );
}

/** An option of a selection bar's group, such as Edit's Upscale. */
export async function selectionMenuItem(page: Page, group: string, label: string) {
  await selectionAction(page, group).click();
  return page.getByRole("menuitem", { name: label, exact: true });
}

/** Turns on Compare Upscale in the viewer's Upscale menu. */
export async function compareUpscale(page: Page) {
  await viewerAction(page, "Upscale", "Compare Upscale");
}

/** Chooses a text box's tool from its ⋯ menu, such as Recent Prompts from the Prompt's. */
export async function promptTool(scope: Page | Locator, box: string, label: string) {
  const menu = await promptMenu(scope, box);
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
}

/** Opens a text box's tools menu. */
export async function promptMenu(scope: Page | Locator, box: string) {
  const page = "page" in scope ? scope.page() : scope;
  const button = scope.getByRole("button", { name: new RegExp(`^(AI|More) ${box} Actions$`) });
  // The phone Generate sheet shows a box's AI menu at rest, and its other tools while it is typed in.
  const text = page
    .getByRole("dialog", { name: "Generate", exact: true })
    .getByRole("textbox", { name: box, exact: true });
  if (!(await button.isVisible()) && (await text.isVisible())) await text.click();
  await button.click();
  return page.getByRole("menu").first();
}

/** Takes back an assistant proposal from its box's AI menu. */
export async function undoProposal(scope: Page | Locator, box: string) {
  const menu = await promptMenu(scope, box);
  await menu.getByRole("menuitem", { name: "Undo", exact: true }).click();
}

/** Edit or Recreate in the viewer's action bar. */
export function viewerChangeButton(page: Page, action: "Edit" | "Recreate" = "Edit") {
  return page
    .getByRole("dialog", { name: "Generation", exact: true })
    .getByRole("button", { name: action, exact: true });
}

/** Opens the viewer's prompt-change options. */
export async function viewerChangeMenu(page: Page, action?: "Edit" | "Recreate") {
  await viewerChangeButton(page, action).click();
  return page.getByRole("menu").first();
}

export async function backToActionMenu(scope: Page | Locator) {
  const back = scope.getByRole("menuitem", { name: "Back", exact: true });
  if (await back.isVisible()) await back.click();
}

export async function expandAssistantMenu(
  scope: Page | Locator,
  label: "Suggestions" | "Templates",
) {
  await backToActionMenu(scope);
  const section = scope.getByRole("menuitem", { name: label, exact: true });
  await expect(section).toBeEnabled();
  if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
}

/** Returns from the shared phone text editor when a test continues on its parent surface. */
export async function closeTextEditor(page: Page, title: string) {
  const editor = page.getByRole("dialog", { name: title, exact: true, includeHidden: true });
  if (await editor.count())
    await editor.getByRole("button", { name: `Close ${title}`, exact: true }).click();
  await expect(editor).toHaveCount(0);
}

/** Opens a tool's options in a box's phone editor. */
export async function editorMenu(scope: Page | Locator, box: string, tool: string) {
  await scope.getByRole("textbox", { name: box, exact: true }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page
    .getByRole("dialog", { name: box, exact: true })
    .getByRole("button", { name: new RegExp(`^(AI|More) ${box} Actions$`) })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText(tool, { exact: true })).toBeVisible();
  return menu;
}

/** Opens the gallery's thumbnail strips. */
export async function showViewerThumbnails(viewer: Locator) {
  await expect(viewer).toBeVisible();
  const chrome = viewer.locator("[data-viewer-chrome]");
  if (!(await chrome.count())) return;
  const stage = viewer.locator("[data-viewer-stage]");
  await expect(async () => {
    if ((await chrome.getAttribute("data-viewer-chrome")) !== "full") await stage.press("c");
    await expect(chrome).toHaveAttribute("data-viewer-chrome", "full", { timeout: 500 });
  }).toPass({ timeout: 5000 });
}

/**
 * Clicks a viewer action on its bar, then any `options` in turn (Edit, Upscale); a control with
 * options left to pick opens its menu for the test.
 */
export async function viewerAction(page: Page, label: string, ...options: string[]) {
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await viewer
    .getByRole("button", { name: label, exact: true })
    .or(viewer.getByRole("link", { name: label, exact: true }))
    .click();
  for (const option of options)
    await page.getByRole("menuitem", { name: option, exact: true }).click();
}

export async function section(page: Page, workspace: "Library" | "Settings", label: string) {
  const select = page.getByRole("combobox", { name: `${workspace} Section`, exact: true });
  if ((page.viewportSize()?.width || 1440) < 768) {
    await select.click();
    await page.getByRole("option", { name: label, exact: true }).click();
  } else
    await page
      .getByRole("navigation", { name: `${workspace} Sections`, exact: true })
      .getByRole("link", { name: label, exact: true })
      .click();
}

/** Opens Library › Profiles or Guides and the editor of the first listed profile or guide. */
export async function editDefinition(page: Page, kind: "Profile" | "Guide") {
  const editor = page.getByRole("dialog", { name: `Edit ${kind}`, exact: true });
  const table = page.getByRole("table", { name: `Editable ${kind}s`, exact: true });
  if (!(await table.isVisible())) {
    await page.goto("/images");
    await openNav(page, "Library");
    await section(page, "Library", `${kind}s`);
  }
  await table
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  return editor;
}

/** Chooses one of a Library or Settings list's segmented views, such as Models › Available. */
export async function chooseView(page: Page, list: string, view: string) {
  // Phones list the views in a menu named by the current one.
  if (page.viewportSize()!.width < 768) {
    await page.getByRole("button", { name: `${list} View`, exact: true }).click();
    await page.getByRole("menuitem", { name: view, exact: true }).click();
    return;
  }
  await page
    .getByRole("radiogroup", { name: `${list} View`, exact: true })
    .getByText(view, { exact: true })
    .click();
}

/** Closes a chip's popup with Escape, leaving the composer open. */
async function closePopup(page: Page, title: string) {
  const popup = page.getByRole("dialog", { name: title, exact: true });
  await popup.press("Escape");
  await expect(popup).toBeHidden();
}

/** Runs `steps` with the generation Settings open. */
export async function withSettings(page: Page, steps: () => Promise<void>) {
  await page
    .getByRole("group", { name: "Generation Inputs", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await steps();
  await closePopup(page, "Settings");
}

/** Opens one of the gallery's views from its toolbar. */
export async function showGalleryView(
  page: Page,
  choice: "Gallery" | "Uploads" | "Comparisons" | "Review",
) {
  const view = page.getByRole("button", { name: "Gallery View", exact: true });
  if ((await view.innerText()) !== choice) {
    await view.click();
    await page.getByRole("menuitem", { name: choice, exact: true }).click();
  }
  await expect(view).toHaveText(choice);
}

/** Shows Liked, Uploads or the unfiltered Gallery. */
export async function showOnly(page: Page, choice: "All" | "Liked" | "Uploads") {
  await showGalleryView(page, choice === "Uploads" ? "Uploads" : "Gallery");
  // Liked is a Filters choice, shown as a removable chip while on.
  const chip = page.getByRole("button", { name: "Remove Liked Filter", exact: true });
  if ((await chip.count()) > 0 !== (choice === "Liked")) await toggleGalleryFilter(page, "Liked");
  await expect(chip).toHaveCount(choice === "Liked" ? 1 : 0);
}

/** Turns one of the gallery's Show filters (Liked, Disliked) on or off in its Filters popup. */
export async function toggleGalleryFilter(page: Page, name: "Liked" | "Disliked") {
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page
    .getByRole("group", { name: "Show", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  await page.keyboard.press("Escape");
}

/** Shows the reference picker's Uploads tab, which lists uploaded images. */
export async function showUploads(page: Page) {
  await pickerTab(page, "References", "Uploads");
}

/**
 * Opens the reference choices: the popup on desktop, or Add References over the stack on phones.
 * Returns them.
 */
export async function openReferenceChoices(page: Page) {
  // The triggers say whether their popups are open, so one fading out after a pick doesn't count.
  const expanded = (name: string) =>
    page.getByRole("button", { name, exact: true, expanded: true }).isVisible();
  if (!(await expanded("Choose References")))
    await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const phone = await page.evaluate(() => "phone" in document.documentElement.dataset);
  if (phone) {
    const add = page.getByRole("button", { name: "Add References", exact: true });
    await expect(add).toBeAttached();
    if ((await add.getAttribute("aria-expanded")) === "false") await add.click();
  }
  const choices = page.getByRole("region", { name: "Reference Choices", exact: true });
  await expect(choices).toBeVisible();
  return choices;
}

/**
 * Returns from the phone's reference choices to the stack, unless a pick returned already; desktop
 * shows both.
 */
export async function showReferenceStack(page: Page) {
  const picking = page
    .getByRole("region", { name: "Reference Choices", exact: true, includeHidden: true })
    .and(page.locator('[aria-busy="true"]'));
  await expect(picking).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add References", exact: true, expanded: true });
  const adding = page.getByRole("dialog", {
    name: "Add References",
    exact: true,
    includeHidden: true,
  });
  // A successful pick can close the choices as the Done button is being clicked.
  await expect(async () => {
    if (await add.count())
      await adding.getByRole("button", { name: "Done", exact: true }).click({ timeout: 1000 });
    await expect(adding).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 5000 });
}

/**
 * Closes the References popup, leaving the composer open: Done in its footer, else Escape. A pick
 * filling the last slot closes it already, so it may be fading out.
 */
export async function closeReferences(page: Page) {
  await showReferenceStack(page);
  const references = page.getByRole("dialog", { name: "References", exact: true });
  if (!(await references.isVisible())) return;
  const done = references.getByRole("button", { name: "Done", exact: true });
  await (
    (await done.isVisible())
      ? done.click({ timeout: 2000 })
      : references.press("Escape", { timeout: 2000 })
  ).catch(() => {});
  await expect(references).toBeHidden();
}

/**
 * Saves the draft as a new preset from the open popup: the Presets chip's, or the LoRA stack's.
 * `toggle` switches what a new preset saves from the defaults, such as References.
 */
export async function saveCurrent(page: Page, name: string, toggle: string[] = []) {
  if (toggle.length) {
    await page.getByRole("button", { name: "Preset Actions", exact: true }).click();
    for (const part of toggle)
      await page.getByRole("menuitem", { name: part, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  const field = page.getByRole("combobox", { name: "Preset Name", exact: true });
  await field.click();
  await field.fill(name);
  await page.getByRole("option", { name: `Save as New Preset “${name}”`, exact: true }).click();
  await expect(field).toHaveValue(name);
}

/** Opens the Presets picker unless it is already open. */
export async function openPresets(page: Page) {
  if (!(await page.getByRole("dialog", { name: "Presets", exact: true }).isVisible()))
    await page.getByRole("button", { name: "Presets", exact: true }).click();
}

/** Closes the Presets picker. */
export async function closePresets(page: Page) {
  await closePopup(page, "Presets");
}

/**
 * Loads a saved preset from the open popup's name field, confirming when it replaces what the
 * draft has.
 */
export async function loadSaved(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Preset Name", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  const replace = page.getByRole("button", { name: "Replace", exact: true });
  if (await replace.isVisible()) await replace.click();
}

/** Renames the current preset from the open popup's menu. */
export async function renamePreset(page: Page, name: string) {
  await page.getByRole("button", { name: "Preset Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const field = page.getByRole("combobox", { name: "Preset Name", exact: true });
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press("Enter");
  await expect(field).toHaveValue(name);
}

/** Chooses a picker tab, such as LoRAs › Stacks. */
export async function pickerTab(page: Page, picker: string, tab: string) {
  await page
    .getByRole("radiogroup", { name: `${picker} View`, exact: true })
    .getByText(tab, { exact: true })
    .click();
}

/** Opens the LoRA choices: the popup on desktop, or Add LoRAs over the stack on phones. */
export async function openLoraChoices(page: Page) {
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  if (await page.evaluate(() => "phone" in document.documentElement.dataset)) {
    const add = page.getByRole("button", { name: "Add LoRAs", exact: true });
    await expect(add).toBeAttached();
    if ((await add.getAttribute("aria-expanded")) === "false") await add.click();
  }
  await expect(page.getByRole("textbox", { name: "Search LoRAs", exact: true })).toBeVisible();
}

/** Returns from the phone's LoRA choices to the stack; desktop shows both. */
export async function showLoraStack(page: Page) {
  const chip = page.getByRole("button", {
    name: "Choose LoRAs",
    exact: true,
    expanded: true,
    includeHidden: true,
  });
  if (
    !(await chip.count()) ||
    !(await page.evaluate(() => "phone" in document.documentElement.dataset))
  )
    return;
  const stack = page.getByRole("dialog", { name: "LoRAs", exact: true });
  await expect(stack).toBeVisible();
  const add = stack.getByRole("button", { name: "Add LoRAs", exact: true, expanded: true });
  if (!(await add.count())) return;
  const adding = page.getByRole("dialog", { name: "Add LoRAs", exact: true });
  await adding.getByRole("button", { name: "Done", exact: true }).click();
  await expect(adding).toBeHidden();
}

/** Closes the LoRA picker. */
export async function closeLoras(page: Page) {
  await showLoraStack(page);
  await closePopup(page, "LoRAs");
}

/** A finished, unseen Dream result. */
export const dreamItem = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  jobId: `job-${id}`,
  type: "image",
  status: "done",
  url: image,
  thumbnailUrl: image,
  width: 1024,
  height: 1024,
  prompt: `Dream prompt ${id}`,
  createdAt: stamp,
  settings: { profileId: "image:test" },
  dream: {
    prompt: `Dream prompt ${id}`,
    why: `Because you like ${id}.`,
    at: stamp,
    state: "unseen",
  },
  ...extra,
});
/** Serves `/api/dream` from this state and records each verdict and settings change. */
export async function serveDream(
  page: Page,
  options: {
    enabled?: boolean;
    unseen?: any[];
    discarded?: any[];
    history?: import("../../shared/taste").DreamActivity[];
    uncensoredAvailable?: boolean;
    /** The settings an administrator forces, which the account can't change. */
    locked?: (keyof typeof dreamDefaults)[];
    library?: any[];
    /** Why Dream can't run, which makes it unavailable. */
    reason?: string;
    /** The taste profile `/api/taste` serves; edits keep learnt words separate. */
    taste?: Record<string, unknown>;
    keepRates?: KeepRates;
    /** Dream's projects, which create, edit, Pause, Undo and Delete change. */
    projects?: any[];
    /** Each project's stats, by id. */
    stats?: Record<string, any>;
    /** What the Inbox proposes; Accept applies a rule or brief edit, Dismiss and Clear drop them. */
    proposals?: any[];
    /** When the visit before this one ended. */
    since?: string;
    /** What Dream › This Week shows. */
    week?: import("../../shared/dream").DreamDigest<any>;
  } = {},
) {
  const state = {
    settings: {
      ...dreamDefaults,
      enabled: options.enabled ?? true,
      paused: false,
    },
    unseen: options.unseen ?? [],
    discarded: options.discarded ?? [],
    uncensoredAvailable: options.uncensoredAvailable ?? false,
    library: options.library ?? [],
    today: { images: 12, videos: 1 },
    usage: undefined as import("../../shared/dream").DreamCounts | undefined,
    reviewed: new Set<string>(),
    /** Every Dream result served, so Undo can bring one back. */
    known: new Map<string, any>(),
    projects: options.projects ?? [],
    proposals: options.proposals ?? [],
    requests: [] as { method: string; path: string; body: any }[],
  };
  const show = () => ({
    settings: state.settings,
    unseen: state.unseen,
    since: options.since ?? null,
    today: state.today,
    usage: state.usage,
    uncensoredAvailable: state.uncensoredAvailable,
    locked: options.locked ?? [],
    status: !state.settings.enabled
      ? "off"
      : state.settings.paused
        ? "paused"
        : options.reason
          ? "unavailable"
          : "waiting",
    reason: options.reason,
  });
  const fields = {
    likes: [],
    avoid: [],
    exclusions: [],
    styles: [],
    note: "",
    rules: [],
    models: [],
    loras: [],
    shapes: [],
    tags: [],
  };
  const taste = {
    summary: "",
    ...fields,
    loraScores: [],
    updatedAt: "",
    signals: 0,
    writer: false,
    ...options.taste,
    preferences: {},
    learnt: Object.fromEntries(
      Object.entries(fields).map(([key, none]) => [key, options.taste?.[key] ?? none]),
    ),
  };
  const none = { recent: null, earlier: null, converging: false, examples: [] };
  await page.route(/\/api\/taste\/reflection(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { sameness: { made: none, liked: none }, days: [] } }),
  );
  await page.route(/\/api\/taste$/, (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      state.requests.push({ method: "PUT", path: "/api/taste", body: request.postDataJSON() });
      const body = request.postDataJSON();
      for (const [key, value] of Object.entries(body.preferences || {})) {
        if (value === null) delete (taste.preferences as Record<string, unknown>)[key];
        else (taste.preferences as Record<string, unknown>)[key] = value;
        Object.assign(taste, {
          [key]: value === null ? (taste.learnt as Record<string, unknown>)[key] : value,
        });
      }
    }
    return route.fulfill({ json: taste });
  });
  await page.route(/\/api\/gallery\/library-review(?:\/[^/?]+)?(?:\?.*)?$/, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      state.requests.push({ method: "POST", path: url.pathname, body });
      if (body.reviewed) state.reviewed.add(id);
      else state.reviewed.delete(id);
      return route.fulfill({ json: { ok: true } });
    }
    const offset = Number(url.searchParams.get("cursor") || 0);
    const media = url.searchParams.get("media");
    const entries = state.library
      .slice(offset)
      .filter(
        (item) => (!media || item.type === media) && !item.rating && !state.reviewed.has(item.id),
      );
    const items = entries.slice(0, 2);
    const next = items.length ? state.library.indexOf(items.at(-1)) + 1 : 0;
    return route.fulfill({
      json: {
        items,
        remaining: entries.length,
        nextCursor: entries.length > 2 ? String(next) : "",
      },
    });
  });
  await page.route(/\/api\/dream(?:\/.*)?$/, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: any = {};
    try {
      body = request.postDataJSON() || {};
    } catch {}
    if (path === "/api/dream/visit")
      return route.fulfill({ json: { since: options.since ?? null } });
    if (path === "/api/dream/keep-rates")
      return route.fulfill({ json: options.keepRates ?? noKeepRates });
    if (method !== "GET") state.requests.push({ method, path, body });
    for (const item of [...state.unseen, ...state.discarded]) state.known.set(item.id, item);
    // As the backend: Undo returns results to unseen.
    if (path === "/api/dream/undo") {
      for (const id of body.ids) {
        const item = state.known.get(id);
        if (!item) continue;
        state.discarded = state.discarded.filter((entry) => entry !== item);
        item.rating = undefined;
        item.dream = { ...item.dream, state: "unseen" };
        if (!state.unseen.includes(item)) state.unseen.push(item);
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/dream") return route.fulfill({ json: show() });
    if (path === "/api/dream/week") return route.fulfill({ json: options.week });
    if (path === "/api/dream/history")
      return route.fulfill({
        json: {
          items: (options.history || []).filter(
            (entry) =>
              !url.searchParams.has("media") ||
              (entry.item.media === url.searchParams.get("media") &&
                (!entry.other || entry.other.media === url.searchParams.get("media"))),
          ),
        },
      });
    if (path === "/api/dream/count")
      return route.fulfill({ json: dreamCardCounts(state.unseen, state.settings) });
    if (path === "/api/dream/settings") {
      Object.assign(state.settings, body);
      return route.fulfill({ json: show() });
    }
    if (path === "/api/dream/reset-limit") {
      state.usage = {
        ...(state.usage ?? state.today),
        [body.kind === "image" ? "images" : "videos"]: 0,
      };
      return route.fulfill({ json: show() });
    }
    if (path === "/api/dream/discarded") {
      if (method === "DELETE") {
        const deleted = state.discarded.length;
        state.discarded = [];
        return route.fulfill({ json: { deleted } });
      }
      const filtered = state.discarded.filter(
        (item) => !url.searchParams.has("media") || item.type === url.searchParams.get("media"),
      );
      const start = Number(url.searchParams.get("cursor") || 0);
      const limit = Number(url.searchParams.get("limit") || 40);
      return route.fulfill({
        json: {
          items: filtered.slice(start, start + limit),
          nextCursor: start + limit < filtered.length ? String(start + limit) : "",
        },
      });
    }
    if (path === "/api/dream/notes") return route.fulfill({ json: { notes: [] } });
    // As the backend: Accept applies a rule or a brief edit (as edited), Dismiss and Clear drop.
    const inbox = () => ({ proposals: state.proposals });
    if (path === "/api/dream/inbox") return route.fulfill({ json: inbox() });
    if (path === "/api/dream/inbox/clear") {
      state.proposals = [];
      return route.fulfill({ json: inbox() });
    }
    const proposalRoute = /^\/api\/dream\/inbox\/([^/]+)\/(accept|dismiss|undo)$/.exec(path);
    if (proposalRoute) {
      const proposal = state.proposals.find((entry) => entry.id === proposalRoute[1]);
      if (proposalRoute[2] === "undo") return route.fulfill({ json: inbox() });
      state.proposals = state.proposals.filter((entry) => entry !== proposal);
      if (proposalRoute[2] === "dismiss") return route.fulfill({ json: inbox() });
      const change = body.change ?? proposal.change;
      if (change.rule) Object.assign(taste, { rules: [...(taste.rules as string[]), change.rule] });
      const project = state.projects.find((entry) => entry.id === proposal.projectId);
      if (project && change.brief) project.brief = { ...project.brief, ...change.brief };
      return route.fulfill({
        json: { ...inbox(), accepted: { id: proposal.id, title: proposal.title } },
      });
    }
    if (path === "/api/dream/projects") {
      if (method === "GET")
        return route.fulfill({ json: { projects: state.projects, stats: options.stats ?? {} } });
      const project = { ...body, id: `project-${state.projects.length + 1}`, changes: [] };
      state.projects.push(project);
      return route.fulfill({ json: { project } });
    }
    if (/^\/api\/dream\/projects\/[^/]+\/results$/.test(path))
      return route.fulfill({ json: { items: [] } });
    // As the backend: each change is listed, and Undo takes back only the latest.
    const projectRoute = /^\/api\/dream\/projects\/([^/]+)(\/undo)?$/.exec(path);
    if (projectRoute) {
      const project = state.projects.find((entry) => entry.id === projectRoute[1]);
      if (method === "DELETE") {
        state.projects = state.projects.filter((entry) => entry !== project);
        return route.fulfill({ json: { ok: true } });
      }
      const { id, previous, changes = [], ...content } = project;
      if (projectRoute[2]) {
        const { change: _change, ...restored } = previous;
        Object.assign(project, restored, {
          changes: changes.map((entry: any, index: number) =>
            index ? entry : { ...entry, undone: true },
          ),
        });
        delete project.previous;
      } else {
        const change = {
          id: `change-${changes.length + 1}`,
          at: stamp,
          by: "you",
          why: "",
          fields: Object.keys(body),
        };
        Object.assign(project, body, {
          previous: { ...content, change: change.id },
          changes: [change, ...changes],
        });
      }
      return route.fulfill({ json: { project } });
    }
    if (path === "/api/dream/pass") {
      const passed = state.unseen.filter((item) => body.ids.includes(item.id));
      for (const item of passed) {
        item.dream = { ...item.dream, state: "discarded" };
        item.rating = body.reason === "taste" ? "disliked" : undefined;
      }
      state.discarded.unshift(...passed);
      state.unseen = state.unseen.filter((item) => !body.ids.includes(item.id));
      return route.fulfill({ json: { ok: true } });
    }
    if (/^\/api\/dream\/sets\/[^/]+\/answer$/.test(path)) {
      const liked = body.verdict === "like" ? (body.likedId ?? body.ids[0]) : undefined;
      for (const item of state.unseen) {
        if (!body.ids.includes(item.id)) continue;
        const override = body.overrides?.[item.id];
        const discarded = (override ?? body.verdict) === "discard";
        item.dream = { ...item.dream, state: discarded ? "discarded" : "kept" };
        item.rating = discarded
          ? "disliked"
          : override === "like" || item.id === liked
            ? "liked"
            : undefined;
        if (discarded) state.discarded.unshift(item);
      }
      state.unseen = state.unseen.filter((item) => !body.ids.includes(item.id));
      return route.fulfill({ json: { ok: true } });
    }
    const answered = /^\/api\/dream\/pairs\/([^/]+)\/answer$/.exec(path);
    if (answered) {
      const pairId = decodeURIComponent(answered[1]);
      if (body.like) {
        const winner = state.unseen.find(
          (item) =>
            item.dream?.pair?.id === pairId &&
            item.dream.pair.side === ["a", "b", "c"].indexOf(body.answer),
        );
        if (winner) winner.rating = "liked";
      }
      state.unseen = state.unseen.filter((item) => item.dream?.pair?.id !== pairId);
      return route.fulfill({ json: { items: [] } });
    }
    const [, , , rawId, verdict] = path.split("/");
    const item = [...state.unseen, ...state.discarded].find(
      (entry) => entry.id === decodeURIComponent(rawId),
    );
    if (!item)
      return route.fulfill({ status: 404, json: { error: "That Dream result is unavailable." } });
    state.unseen = state.unseen.filter((entry) => entry !== item);
    state.discarded = state.discarded.filter((entry) => entry !== item);
    item.dream = { ...item.dream, state: verdict === "discard" ? "discarded" : "kept" };
    if (verdict === "super-like") item.rating = "liked";
    if (verdict === "discard") state.discarded.unshift(item);
    return route.fulfill({
      status: verdict === "variations" ? 202 : 200,
      json: verdict === "variations" ? { item, jobId: "job-variations" } : { item },
    });
  });
  // As the backend: rating an unseen result keeps or discards it.
  await page.route(/\/api\/gallery\/favorite$/, (route) => {
    const body = route.request().postDataJSON();
    state.requests.push({ method: "POST", path: "/api/gallery/favorite", body });
    for (const item of state.unseen) state.known.set(item.id, item);
    for (const item of state.library)
      if (body.ids.includes(item.id)) item.rating = body.rating ?? undefined;
    if (body.rating) state.unseen = state.unseen.filter((item) => !body.ids.includes(item.id));
    return route.fulfill({ json: { ok: true, items: [] } });
  });
  return state;
}

/**
 * A one-second WebM clip the browser can play (WebKit's test builds may not decode it), or
 * undefined when ffmpeg is not installed.
 */
export function videoClip() {
  try {
    return execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
      ...["-i", "testsrc=size=160x90:rate=24:duration=1", "-c:v", "libvpx", "-f", "webm", "pipe:1"],
    ]);
  } catch {
    return undefined;
  }
}

/** Dream administration with shared default delays and no account overrides. */
export const dreamPolicyFixture = () =>
  Object.fromEntries([
    ...Object.entries(dreamOverrideKeys).map(
      ([name, key]): [string, { key: string; value: unknown; source: string; locked: boolean }] => [
        name,
        { key, value: null, source: "default", locked: false },
      ],
    ),
    ...Object.entries(dreamTimingSettings).map(
      ([name, { key, defaultValue }]) =>
        [name, { key, value: defaultValue, source: "default", locked: false }] as const,
    ),
  ]);
