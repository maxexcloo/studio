import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, type Locator, type Page } from "@playwright/test";

/** Family names as `/api/models` serves them from the catalogue, for the families fixtures use. */
const familyLabels = { flux1: "Flux.1", sdxl: "SDXL" };

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
    snapshots: {} as Record<string, any[]>,
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
    winnerItemId: comparison.winnerItemId || null,
    ...(new Set(comparison.requests.map((variant: any) => variant.input.prompt)).size === 1
      ? { prompt: comparison.requests[0].input.prompt }
      : {}),
    variants: comparison.jobIds.map((jobId: string, index: number) => ({
      jobId,
      label: comparison.labels[index],
      item:
        gallery.find(
          (item) =>
            item.jobId === jobId && (!comparison.itemIds || item.id === comparison.itemIds[index]),
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
      cloudModels: true,
      loras: true,
      spicyPrompts: false,
      tileCaptions: false,
      uncensoredModels: true,
    } as Record<string, unknown>,
    saved: [] as string[],
    grants: { cloudModels: false, loras: false, spicyPrompts: false, uncensoredModels: false },
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
    if (path === "/api/gallery/owners") return respond({ ok: true, owners: galleryOwners });
    if (path.startsWith("/api/gallery/owners/") && method === "DELETE") {
      delete galleryOwners[decodeURIComponent(path.split("/")[4])];
      return respond({ ok: true });
    }
    if (path === "/api/preferences") {
      if (method === "PATCH") {
        Object.assign(preferences.preferences, body);
        preferences.saved = [...new Set([...preferences.saved, ...Object.keys(body)])];
      }
      return respond(preferences);
    }
    if (path === "/api/settings/deployment") {
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
          profiles: [],
        },
        catalogue: [],
        integrations: {
          civitai: { token: { set: false } },
          huggingFace: { token: { set: false } },
          assistant: { available: false },
        },
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
        offers: { cloud: false, fast: false, quality: true },
      });
    if (path === "/api/loras/library") return respond({ found: true, library: loraLibrary });
    if (path === "/api/loras/library/ops" && method === "POST") {
      for (const operation of body.ops) {
        loraOperations.push(operation);
        const stacks = loraLibrary.snapshots[operation.key] || [];
        switch (operation.op) {
          case "stack.add":
            loraLibrary.snapshots[operation.key] = [...stacks, operation.stack];
            break;
          case "stack.update":
            loraLibrary.snapshots[operation.key] = stacks.map((stack) =>
              stack.id === operation.id ? { ...stack, loras: operation.loras } : stack,
            );
            break;
          case "stack.rename":
            loraLibrary.snapshots[operation.key] = stacks.map((stack) =>
              stack.id === operation.id ? { ...stack, name: operation.name } : stack,
            );
            break;
          case "stack.delete":
            loraLibrary.snapshots[operation.key] = stacks.filter(
              (stack) => stack.id !== operation.id,
            );
            break;
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
    if (path === "/api/assistant")
      return respond({
        available: true,
        defaultPreset: "improve",
        presets: [{ id: "improve", label: "Improve" }],
      });
    if (path === "/api/suggestions")
      return respond({
        suggestions: [],
        reason: "Star a few results so Studio learns your taste.",
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
          automaticLifecycle: false,
          reason:
            "Studio runtime control is not configured; GPU workloads are neither observed nor switched.",
        },
      });
    if (path === "/api/queue")
      return respond({ jobs: jobs.filter((job) => !job.cleared), paused: queuePause });
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
    if (path === "/api/queue/cancel-pending") {
      jobs
        .filter((j) => ["queued", "waiting"].includes(j.status))
        .forEach((j) => (j.status = "cancelled"));
      return respond({ cancelled: jobs.length });
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
    // Compare Selected records chosen gallery images.
    if (path === "/api/comparisons" && method === "POST") {
      const comparison = {
        id: `compare-${comparisons.length + 1}`,
        seed: "",
        requests: body.itemIds.map((id: string) => ({
          input: { prompt: gallery.find((item) => item.id === id)?.prompt },
        })),
        jobIds: body.jobIds,
        itemIds: body.itemIds,
        labels: body.jobIds.map((_: string, index: number) => `Variant ${"ABCD"[index]}`),
        vote: null,
      };
      comparisons.push(comparison);
      return respond(showComparison(comparison), 201);
    }
    if (path === "/api/comparisons/run") {
      const seed = String(body.variants[0].input.seed || "4242");
      const sessionId = body.sessionId || "session-compare";
      const comparison = {
        id: `compare-${comparisons.length + 1}`,
        seed,
        requests: body.variants,
        jobIds: body.variants.map(
          (variant: any) =>
            recordGeneration(
              {
                ...variant.input,
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
    if (comparison && path.endsWith("/vote") && method === "PUT") {
      const winner = gallery.find((item) => item.id === body.itemId);
      comparison.vote = winner?.jobId || null;
      comparison.winnerItemId = winner?.id || null;
      return respond(showComparison(comparison));
    }
    if (comparison && method === "GET") return respond(showComparison(comparison));
    if (path === "/api/gallery/favorite" && method === "POST") {
      gallery
        .filter((item) => body.ids.includes(item.id))
        .forEach((item) => (item.favorite = body.favorite));
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
      const items = gallery.filter(
        (i) =>
          (!url.searchParams.get("q") || i.prompt.includes(url.searchParams.get("q"))) &&
          (!url.searchParams.get("type") || i.type === url.searchParams.get("type")) &&
          Boolean(i.uploaded) === (url.searchParams.get("uploads") === "1") &&
          (url.searchParams.get("favorites") !== "1" || i.favorite) &&
          (!url.searchParams.has("tag") ||
            url.searchParams.getAll("tag").some((tag) => i.caption?.tags?.includes(tag))) &&
          (!url.searchParams.has("set") || i.resultSet?.id === url.searchParams.get("set")),
      );
      // Similar ranks the image first.
      const similar = url.searchParams.get("similar");
      if (similar) items.sort((a, b) => Number(b.id === similar) - Number(a.id === similar));
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
        id,
        name: fields.name,
        description: fields.description,
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
      // Generate References' jobs, listed with their gallery results.
      if (path.endsWith("/generated")) {
        characters[index].generated = {
          jobIds: body.jobIds,
          at: stamp,
          results: gallery
            .filter((item) => body.jobIds.includes(item.jobId))
            .map((item) => ({
              galleryItemId: item.id,
              jobId: item.jobId,
              status: item.status,
              thumbnailUrl: item.thumbnailUrl,
              prompt: item.prompt,
            })),
        };
        return respond({ ok: true, character: characters[index] });
      }
      // Make Sheet's job, which the card follows until a test gives it panels.
      if (path.endsWith("/sheet")) {
        characters[index].sheet = { jobId: "sheet-job", at: stamp, status: "making", panels: [] };
        return respond({ ok: true, jobId: "sheet-job", profile: "Qwen-Image 2.1" });
      }
      if (method === "POST") {
        list.push(card(body, `${noun}-${list.length + 1}`));
        return respond({ ok: true, [noun]: list.at(-1) }, 201);
      }
      if (method === "PUT") {
        list[index] = card(body, id);
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
    if (path === "/api/user-presets" && method === "GET") return respond({ presets });
    if (path === "/api/user-presets" && method === "POST") {
      const preset = { id: "preset-1", ...body };
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
                grade: { value: "partial", reasons: ["Watercolour LoRA is missing"] },
                resources: [{ name: "watercolour.safetensors", status: "missing" }],
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
    if (["/api/gallery/captions", "/api/gallery/embeddings", "/api/gallery/faces"].includes(path))
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
/** Serves `/api/models` with these profiles in place of the fixture catalogue. */
export async function serveProfiles(page: Page, profiles: Profile[]) {
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { profiles, familyLabels } }),
  );
}

/** Signs `account` in to a multi-user instance. */
export async function signIn(
  page: Page,
  account: { id: string; role: string; features?: Record<string, boolean> },
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
}
export async function openNav(page: Page, label: string) {
  const more = page.getByRole("button", { name: "More Options" });
  if (["Library", "Settings"].includes(label))
    await expect(
      more.or(page.getByRole("link", { name: label, exact: true }).first()),
    ).toBeVisible();
  if (["Library", "Settings"].includes(label) && (await more.isVisible())) {
    await more.click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("link", { name: label, exact: true }).first().click();
}

export async function openTheme(page: Page) {
  const theme = page.getByRole("button", { name: "Appearance", exact: true });
  await expect(
    theme.or(page.getByRole("button", { name: "More Options", exact: true })),
  ).toBeVisible();
  if (await theme.isVisible()) await theme.click();
  else {
    await page.getByRole("button", { name: "More Options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Appearance", exact: true }).click();
  }
}

/** The gallery search box: in the toolbar on desktop, opened from its icon on phones. */
export async function gallerySearch(scope: Page | Locator) {
  const open = scope.getByRole("button", { name: "Search Gallery", exact: true });
  const box = scope.getByRole("textbox", { name: "Search Gallery", exact: true });
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

/** A selection action: on the bar, or an item of the phone's More when the bar has no room for it. */
export async function selectionMenuItem(page: Page, label: string) {
  const inline = selectionAction(page, label);
  if ((page.viewportSize()?.width || 1440) >= 768 || (await inline.isVisible())) return inline;
  await selectionAction(page, "More").click();
  return page.getByRole("menuitem", { name: label, exact: true });
}

/** Turns on Compare Upscale in the viewer's Upscale menu. */
export async function compareUpscale(page: Page) {
  await viewerAction(page, "Upscale");
  await page.getByRole("menuitem", { name: "Compare Upscale", exact: true }).click();
}

/** Clicks a viewer action on its bar; a control with options opens its menu for the test to pick. */
/** Chooses a text box's tool from its ⋯ menu, such as Recent Prompts from the Prompt's. */
export async function promptTool(scope: Page | Locator, box: string, label: string) {
  await scope.getByRole("button", { name: `More ${box} Actions`, exact: true }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

/** Opens a text box's ⋯ menu, which lists each tool's options under its name, one level deep. */
export async function promptMenu(scope: Page | Locator, box: string) {
  await scope.getByRole("button", { name: `More ${box} Actions`, exact: true }).click();
  const page = "page" in scope ? scope.page() : scope;
  return page.getByRole("menu");
}

/** Opens a tool's options in a box's phone editor, which shows its tools as buttons. */
export async function editorMenu(scope: Page | Locator, box: string, tool: string) {
  await scope.getByRole("textbox", { name: box, exact: true }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page
    .getByRole("dialog", { name: box, exact: true })
    .getByRole("button", { name: tool, exact: true })
    .click();
  return page.getByRole("menu");
}

/** Runs a viewer bar action, which every bar, the phone's included, shows. */
export async function viewerAction(page: Page, label: string) {
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await viewer
    .getByRole("button", { name: label, exact: true })
    .or(viewer.getByRole("link", { name: label, exact: true }))
    .click();
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
  await page.getByRole("menuitem", { name: `Edit ${kind}`, exact: true }).click();
  return editor;
}

/** Chooses one of a Library or Settings list's segmented views, such as Models › Available. */
export async function chooseView(page: Page, list: string, view: string) {
  await page
    .getByRole("radiogroup", { name: `${list} View`, exact: true })
    .getByText(view, { exact: true })
    .click();
}

/** Closes a chip's popup with Escape, leaving the composer open. */
export async function closePopup(page: Page, title: string) {
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

/** Chooses what an open Filters popup shows: All, Starred or Uploads. */
/** Shows the gallery's Starred or Uploads alone with its toolbar toggle, or All with neither. */
export async function showOnly(page: Page, choice: "All" | "Starred" | "Uploads") {
  const toggle = (name: string) => page.getByRole("button", { name, exact: true });
  for (const name of ["Starred", "Uploads"]) {
    const on = (await toggle(name).getAttribute("aria-pressed")) === "true";
    if (on !== (name === choice)) await toggle(name).click();
    await expect(toggle(name)).toHaveAttribute("aria-pressed", String(name === choice));
  }
}

/** Shows the reference picker's Uploads tab, which lists uploaded images. */
export async function showUploads(page: Page) {
  await pickerTab(page, "References", "Uploads");
}

/**
 * Closes the References popup, leaving the composer open: Apply in the phone sheet's footer,
 * Escape on desktop. A pick filling the last slot closes it already, so it may be fading out.
 */
export async function closeReferences(page: Page) {
  const references = page.getByRole("dialog", { name: "References", exact: true });
  if (!(await references.isVisible())) return;
  const apply = references.getByRole("button", { name: "Apply", exact: true });
  await (
    (await apply.isVisible())
      ? apply.click({ timeout: 2000 })
      : references.press("Escape", { timeout: 2000 })
  ).catch(() => {});
  await expect(references).toBeHidden();
}

/** Saves the draft as a named stack or preset from its picker. */
export async function saveCurrent(
  page: Page,
  noun: "Preset" | "Stack",
  name: string,
  /** A preset's parts to switch from the defaults, such as References. */
  toggle: string[] = [],
) {
  await page.getByRole("button", { name: `Save ${noun}`, exact: true }).click();
  const field = page.getByRole("textbox", { name: `${noun} Name`, exact: true });
  await field.fill(name);
  if (toggle.length) {
    const parts = page.getByRole("button", { name: "Preset Parts", exact: true });
    await parts.click();
    for (const part of toggle)
      await page.getByRole("menuitem", { name: part, exact: true }).click();
    await parts.click();
  }
  await field.press("Enter");
}

/** Opens the Presets picker unless it is already open. */
export async function openPresets(page: Page) {
  if (!(await page.getByRole("button", { name: "Save Preset", exact: true }).isVisible()))
    await page.getByRole("button", { name: "Presets", exact: true }).click();
}

/** Closes the Presets picker. */
export async function closePresets(page: Page) {
  await closePopup(page, "Presets");
}

/** Loads a saved stack or preset, or an inspiration, confirming when it replaces what the draft has. */
export async function loadSaved(
  page: Page,
  noun: "Preset" | "Stack" | "Inspiration",
  name: string,
) {
  await page.getByRole("button", { name: `Load ${noun}: ${name}`, exact: true }).click();
  const replace = page.getByRole("button", { name: "Replace", exact: true });
  if (await replace.isVisible()) await replace.click();
}

/** Runs one action from a saved stack's or preset's row menu. */
export async function savedAction(
  page: Page,
  noun: "Preset" | "Stack",
  name: string,
  action: string,
) {
  await page.getByRole("button", { name: `${noun} Actions for ${name}`, exact: true }).click();
  const item = page.getByRole("menuitem", { name: action, exact: true });
  await item.click();
  // The next click must not land while the menu is still closing over the row.
  await expect(item).toBeHidden();
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
  if (await page.evaluate(() => "phone" in document.documentElement.dataset))
    await page.getByRole("button", { name: "Add LoRAs", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search LoRAs", exact: true })).toBeVisible();
}

/** Returns from the phone's LoRA choices to the stack; desktop shows both. */
export async function showLoraStack(page: Page) {
  const adding = page.getByRole("dialog", { name: "Add LoRAs", exact: true });
  if (!(await adding.isVisible())) return;
  await adding.getByRole("button", { name: "Apply", exact: true }).click();
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
    why: `Because you star ${id}.`,
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
    spicyAvailable?: boolean;
    /** Older gallery images offered for calibration until judged. */
    calibration?: any[];
    /** Why Dream can't run, which makes it unavailable. */
    reason?: string;
    /** The taste profile `/api/taste` serves; `PUT` replaces its avoids. */
    taste?: Record<string, unknown>;
    /** Dream's projects, which create, edit, Undo and Delete change. */
    projects?: any[];
  } = {},
) {
  const state = {
    settings: {
      enabled: options.enabled ?? true,
      paused: false,
      dailyImages: 40,
      dailyVideos: 4,
      videos: false,
      spicy: false,
    },
    unseen: options.unseen ?? [],
    discarded: options.discarded ?? [],
    spicyAvailable: options.spicyAvailable ?? false,
    calibration: options.calibration ?? [],
    judged: new Set<string>(),
    projects: options.projects ?? [],
    requests: [] as { method: string; path: string; body: any }[],
  };
  const show = () => ({
    settings: state.settings,
    unseen: state.unseen,
    today: { images: 12, videos: 1 },
    spicyAvailable: state.spicyAvailable,
    status: !state.settings.enabled
      ? "off"
      : state.settings.paused
        ? "paused"
        : options.reason
          ? "unavailable"
          : "waiting",
    reason: options.reason,
  });
  const taste = {
    summary: "",
    likes: [],
    styles: [],
    avoid: [],
    addedAvoid: [],
    note: "",
    profiles: { image: [], video: [] },
    loras: [],
    updatedAt: "",
    signals: 0,
    writer: false,
    ...options.taste,
  };
  await page.route(/\/api\/taste$/, (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      state.requests.push({ method: "PUT", path: "/api/taste", body: request.postDataJSON() });
      taste.addedAvoid = request.postDataJSON().avoid;
    }
    return route.fulfill({ json: taste });
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
    if (method !== "GET") state.requests.push({ method, path, body });
    if (path === "/api/dream") return route.fulfill({ json: show() });
    if (path === "/api/dream/settings") {
      Object.assign(state.settings, body);
      return route.fulfill({ json: show() });
    }
    if (path === "/api/dream/calibration") {
      if (method === "GET")
        return route.fulfill({
          json: { items: state.calibration.filter((item) => !state.judged.has(item.id)) },
        });
      for (const id of [...(body.liked || []), ...(body.passed || [])]) state.judged.add(id);
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/dream/discarded") {
      if (method === "DELETE") {
        const deleted = state.discarded.length;
        state.discarded = [];
        return route.fulfill({ json: { deleted } });
      }
      const start = Number(url.searchParams.get("cursor") || 0);
      const limit = Number(url.searchParams.get("limit") || 40);
      return route.fulfill({
        json: {
          items: state.discarded.slice(start, start + limit),
          nextCursor: start + limit < state.discarded.length ? String(start + limit) : "",
        },
      });
    }
    if (path === "/api/dream/projects") {
      if (method === "GET") return route.fulfill({ json: { projects: state.projects } });
      const project = { ...body, id: `project-${state.projects.length + 1}` };
      state.projects.push(project);
      return route.fulfill({ json: { project } });
    }
    const projectRoute = /^\/api\/dream\/projects\/([^/]+)(\/undo)?$/.exec(path);
    if (projectRoute) {
      const project = state.projects.find((entry) => entry.id === projectRoute[1]);
      if (method === "DELETE") {
        state.projects = state.projects.filter((entry) => entry !== project);
        return route.fulfill({ json: { ok: true } });
      }
      const { id, previous, ...content } = project;
      if (projectRoute[2]) {
        const { by: _by, ...restored } = previous;
        Object.assign(project, restored);
        delete project.previous;
      } else Object.assign(project, body, { previous: { ...content, by: "studio" } });
      return route.fulfill({ json: { project } });
    }
    const answered = /^\/api\/dream\/pairs\/([^/]+)\/answer$/.exec(path);
    if (answered) {
      const pairId = decodeURIComponent(answered[1]);
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
    if (verdict === "discard") state.discarded.unshift(item);
    return route.fulfill({
      status: verdict === "variations" ? 202 : 200,
      json: verdict === "variations" ? { item, jobId: "job-variations" } : { item },
    });
  });
  // As the backend: starring an unseen result keeps it.
  await page.route(/\/api\/gallery\/favorite$/, (route) => {
    const body = route.request().postDataJSON();
    state.requests.push({ method: "POST", path: "/api/gallery/favorite", body });
    if (body.favorite) state.unseen = state.unseen.filter((item) => !body.ids.includes(item.id));
    return route.fulfill({ json: { ok: true, items: [] } });
  });
  return state;
}

/**
 * A one-second WebM clip the browser can play (WebKit's test builds may not decode it), or
 * undefined when no encoder runs: ffmpeg-static's binary download can fail on install, and the
 * system ffmpeg is the fallback.
 */
export function videoClip() {
  let encoder = "ffmpeg";
  try {
    encoder = createRequire(import.meta.url)("ffmpeg-static");
  } catch {}
  try {
    return execFileSync(encoder, [
      ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
      ...["-i", "testsrc=size=160x90:rate=24:duration=1", "-c:v", "libvpx", "-f", "webm", "pipe:1"],
    ]);
  } catch {
    return undefined;
  }
}
