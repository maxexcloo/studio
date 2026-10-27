import { expect, type Locator, type Page } from "@playwright/test";

export const stamp = "2026-10-23T00:00:00.000Z";
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

export async function fixtures(page: Page) {
  const sessions: any[] = [];
  const jobs: any[] = [];
  const presets: any[] = [];
  const gallery: any[] = [];
  const messages: any[] = [];
  const chatRequests: any[] = [];
  const referenceRequests: any[] = [];
  const uploads: any[] = [];
  const galleryRequests: string[] = [];
  const loraLibrary = {
    strengths: {},
    snapshots: {} as Record<string, any[]>,
    favorites: [] as string[],
    recents: [],
  };
  const loraOperations: any[] = [];
  let clock = Date.parse(stamp);
  const nextStamp = () => new Date((clock += 1000)).toISOString();
  const comparisons: any[] = [];
  const showComparison = (comparison: any) => ({
    id: comparison.id,
    seed: comparison.seed,
    vote: comparison.vote,
    ...(new Set(comparison.requests.map((variant: any) => variant.input.prompt)).size === 1
      ? { prompt: comparison.requests[0].input.prompt }
      : {}),
    variants: comparison.jobIds.map((jobId: string, index: number) => ({
      jobId,
      label: comparison.labels[index],
      item: gallery.find((item) => item.jobId === jobId) || null,
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
        features: {
          imageGeneration: true,
          videoGeneration: true,
          gallery: true,
          cloudModels: false,
          nsfwModels: false,
        },
      },
    ],
    availableProfiles: ["image:test", "image:fast", "video:test"],
    defaultAccessProfileId: "users",
    requireApproval: true,
    lockedFeatures: {},
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
    if (path === "/api/accounts/status") return respond({ mode: "single-user" });
    if (path === "/api/models")
      return respond({ profiles, features: { library: true, presets: true } });
    // Local video is running: Animate takes the local video profile.
    if (path === "/api/animate/profile")
      return respond({ profileId: "video:test", label: "Motion Quality", cloud: false, note: "" });
    if (path === "/api/chat/status")
      return respond({
        available: true,
        models: [{ id: "text:test", label: "Studio Assistant", provider: "Fixture Gateway" }],
        defaultModelId: "text:test",
      });
    if (path.match(/^\/api\/sessions\/[^/]+\/chat$/)) {
      const sessionId = path.split("/")[3];
      if (method === "GET")
        return respond({
          available: true,
          messages: messages.filter((message) => message.sessionId === sessionId),
        });
      chatRequests.push(body);
      const user = {
        id: `message-${messages.length + 1}`,
        sessionId,
        role: "user",
        content: body.content,
        status: "completed",
        revision: body.revision,
        createdAt: nextStamp(),
      };
      const assistant: any = {
        id: `message-${messages.length + 2}`,
        sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: nextStamp(),
      };
      const events: any[] = [
        { event: "message", data: user },
        { event: "message", data: { ...assistant } },
        {
          event: "delta",
          data: {
            id: assistant.id,
            text: "## Lighting Direction\n\nLet's shape the lighting before we generate.\n\n- Soft daylight\n- Gentle contrast\n\n[Lighting reference](https://example.com/lighting)",
          },
        },
      ];
      assistant.content =
        "## Lighting Direction\n\nLet's shape the lighting before we generate.\n\n- Soft daylight\n- Gentle contrast\n\n[Lighting reference](https://example.com/lighting)";
      if (
        body.content === "Create a blue bird" ||
        body.revision ||
        body.content.startsWith("Generate a variation:")
      ) {
        assistant.content = body.revision
          ? "I’ll use your revised settings for this variation."
          : "I’ll create a blue bird with your selected settings.";
        const input = {
          ...(body.revision?.input || body.generation.input),
          prompt:
            body.revision?.input.prompt ||
            (body.content === "Create a blue bird"
              ? "A blue bird in soft daylight"
              : body.generation.input.prompt),
          operation: body.revision?.operation || body.generation.operation || "image",
          parentJobId: body.revision?.sourceJobId || body.generation?.parentJobId,
        };
        const job = recordGeneration(input, sessionId);
        assistant.jobId = job.id;
        assistant.draft = { operation: "image", input };
        events.push({ event: "generation", data: { job } });
      }
      assistant.status = "completed";
      messages.push(user, assistant);
      events.push({ event: "message", data: assistant }, { event: "done", data: {} });
      return route.fulfill({
        contentType: "text/event-stream",
        body: events
          .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          .join(""),
      });
    }
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
          case "favorite":
            loraLibrary.favorites = operation.on
              ? [...new Set([...loraLibrary.favorites, operation.name])]
              : loraLibrary.favorites.filter((name) => name !== operation.name);
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
        runtime: {
          configured: false,
          automaticLifecycle: false,
          reason:
            "Studio runtime control is not configured; GPU workloads are neither observed nor switched.",
        },
      });
    if (path === "/api/queue") return respond({ jobs: jobs.filter((job) => !job.cleared) });
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
    if (path === "/api/sessions" && method === "GET") return respond({ sessions });
    if (path === "/api/sessions" && method === "POST") {
      const session = {
        id: `session-${sessions.length + 1}`,
        title: body.title || "New Chat",
        inputs: body.inputs,
        createdAt: stamp,
        updatedAt: stamp,
      };
      sessions.push(session);
      return respond({ session });
    }
    if (path.match(/^\/api\/sessions\/[^/]+\/generations$/)) {
      const sessionId = path.split("/")[3];
      const job = recordGeneration(body, sessionId);
      return respond({ jobId: job.id, sessionId, status: "queued" });
    }
    if (path.match(/^\/api\/sessions\/[^/]+$/)) {
      const session = sessions.find((s) => s.id === path.split("/")[3]);
      if (method === "PATCH") Object.assign(session, { title: body.title, titleSource: "user" });
      if (method === "DELETE") {
        const owned = jobs.filter((job) => job.sessionId === session.id);
        if (owned.some((job) => !["completed", "failed", "cancelled"].includes(job.status)))
          return respond(
            {
              reason: "active-jobs",
              error: "This chat has generations in progress. Cancel them before deleting the chat.",
            },
            409,
          );
        const ids: string[] = body.mediaIds || [];
        sessions.splice(sessions.indexOf(session), 1);
        for (const job of owned) jobs.splice(jobs.indexOf(job), 1);
        gallery.splice(0, gallery.length, ...gallery.filter((item) => !ids.includes(item.id)));
        return respond({ ok: true, media: { removed: ids, failed: [] } });
      }
      return respond({ session, jobs: jobs.filter((j) => j.sessionId === session?.id) });
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
            recordGeneration({ ...variant.input, seed, operation: "image" }, sessionId).id,
        ),
        labels: body.variants.map((variant: any) => variant.label),
        vote: null,
      };
      comparisons.push(comparison);
      return respond(showComparison(comparison), 201);
    }
    const comparison = comparisons.find((entry) => entry.id === path.split("/")[3]);
    if (comparison && path.endsWith("/vote") && method === "PUT") {
      comparison.vote = body.jobId;
      return respond(showComparison(comparison));
    }
    if (comparison && method === "GET") return respond(showComparison(comparison));
    if (path === "/api/gallery/favorite" && method === "POST") {
      gallery
        .filter((item) => body.ids.includes(item.id))
        .forEach((item) => (item.favorite = body.favorite));
      return respond({ ok: true });
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
          { value: "1:1", label: "1:1" },
          { value: "other", label: "Other" },
        ],
        chats: sessions.map((session) => ({ value: session.id, label: session.title })),
      });
    if (path === "/api/gallery") {
      galleryRequests.push(url.search);
      return respond({
        items: gallery.filter(
          (i) =>
            (!url.searchParams.get("q") || i.prompt.includes(url.searchParams.get("q"))) &&
            (!url.searchParams.has("chat") ||
              url.searchParams.getAll("chat").includes(i.sessionId)),
        ),
        hasMore: false,
        nextCursor: "",
      });
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
    if (path === "/api/reference-assets" && method === "GET")
      return respond({ items: uploads, hasMore: false, nextCursor: "" });
    if (path === "/api/reference-assets/upload") {
      const asset = {
        id: uploads.length ? `asset-upload-${uploads.length + 1}` : "asset-upload",
        source: "upload",
        name: "reference.png",
        thumbnailUrl: image,
        url: image,
        width: 1024,
        height: 1024,
      };
      uploads.unshift(asset);
      return respond({ asset });
    }
    const saved = path.match(/^\/api\/reference-assets\/([^/]+)\/gallery$/);
    if (saved && method === "POST") {
      const item = {
        id: `saved-${saved[1]}`,
        jobId: `upload-${saved[1]}`,
        type: "image",
        status: "done",
        prompt: "",
        url: image,
        thumbnailUrl: image,
        width: 1024,
        height: 1024,
        createdAt: nextStamp(),
      };
      if (!gallery.some((entry) => entry.id === item.id)) gallery.unshift(item);
      return respond({ ok: true, item });
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
    if (path === "/api/gallery/captions")
      return respond({
        state: "finished",
        active: false,
        reason: "",
        done: 0,
        failed: 0,
        remaining: 0,
        total: 0,
        perMinute: 0,
        etaSeconds: null,
      });
    if (path === "/api/workers")
      return respond({
        workers: [{ id: "gpu", label: "Media Worker", capabilities: ["image", "video"] }],
      });
    return respond({ ok: true });
  });
  return {
    sessions,
    jobs,
    presets,
    gallery,
    administration,
    ownAccount,
    messages,
    chatRequests,
    referenceRequests,
    uploads,
    galleryRequests,
    loraLibrary,
    loraOperations,
    comparisons,
  };
}
/** Serves `/api/models` with these profiles in place of the fixture catalogue. */
export async function serveProfiles(
  page: Page,
  profiles: Profile[],
  features?: { library: boolean; presets: boolean },
) {
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { profiles, features } }),
  );
}

/** Signs `account` in to a multi-user instance. */
export async function signIn(page: Page, account: { id: string; role: string }) {
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({ json: { mode: "multi-user", signedIn: true, account } }),
  );
}

export async function create(page: Page) {
  await page.goto("/images?compose=1");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
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
  const theme = page.getByRole("button", { name: "Change Theme", exact: true });
  await expect(
    theme.or(page.getByRole("button", { name: "More Options", exact: true })),
  ).toBeVisible();
  if (await theme.isVisible()) await theme.click();
  else {
    await page.getByRole("button", { name: "More Options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Theme", exact: true }).click();
  }
}

/** The gallery search box: in the toolbar on desktop, opened from its icon on phones. */
export async function gallerySearch(scope: Page | Locator) {
  const open = scope.getByRole("button", { name: "Search Gallery", exact: true });
  if (await open.isVisible()) await open.click();
  return scope.getByRole("textbox", { name: "Search Gallery", exact: true });
}

/** Runs a viewer action from its bar, or from More Viewer Actions where phones move it. */
export async function viewerAction(page: Page, label: string) {
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const action = viewer.getByRole("button", { name: label, exact: true });
  if (await action.isVisible()) return action.click();
  await viewer.getByRole("button", { name: "More Viewer Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

export async function viewerOptions(page: Page) {
  await page
    .getByRole("dialog", { name: "Generation", exact: true })
    .getByRole("button", { name: "Viewer Options", exact: true })
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

/** Opens a Settings › Profiles view and the editor of its first listed definition. */
export async function editDefinition(page: Page, kind: "Profile" | "Guide") {
  const editor = page.getByRole("dialog", { name: `Edit ${kind}`, exact: true });
  const table = page.getByRole("table", { name: `Editable ${kind}s`, exact: true });
  if (!(await table.isVisible())) {
    await page.goto("/images");
    await openNav(page, "Settings");
    await section(page, "Settings", "Profiles");
    if (kind === "Guide") await chooseView(page, "Profiles", "Guides");
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

/** Runs `steps` with Expert Settings open: a popover on desktop, an inline panel on phones. */
export async function withExpertSettings(page: Page, steps: () => Promise<void>) {
  await page.getByRole("button", { name: "Expert Settings", exact: true }).click();
  await steps();
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible()) await done.click();
  else await page.getByRole("button", { name: "Expert Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Expert Settings", exact: true })).toBeHidden();
}

/** Phones confirm the reference sheet; desktop closes the popover with Escape, leaving the composer open. */
export async function closeReferences(page: Page) {
  const done = page.getByRole("button", { name: "Use References", exact: true });
  const references = page.getByRole("region", { name: "References", exact: true });
  if (await done.isVisible()) await done.click();
  else
    await references
      .getByRole("radiogroup", { name: "References View", exact: true })
      .getByRole("radio", { checked: true })
      .press("Escape");
  await expect(references).toBeHidden();
}

/** Saves the draft as a named stack or preset from its picker's footer. */
export async function saveCurrent(page: Page, noun: "Preset" | "Stack", name: string) {
  await page.getByRole("button", { name: `Save ${noun}`, exact: true }).click();
  const field = page.getByRole("textbox", { name: `${noun} Name`, exact: true });
  await field.fill(name);
  await field.press("Enter");
}

/** Opens the Presets picker unless it is already open. */
export async function openPresets(page: Page) {
  if (!(await page.getByRole("button", { name: "Save Preset", exact: true }).isVisible()))
    await page.getByRole("button", { name: "Presets", exact: true }).click();
}

/** Closes the Presets picker: Done in the phone panel, its own chip on desktop (an outside click only dismisses). */
export async function closePresets(page: Page) {
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible()) await done.click();
  else await page.getByRole("button", { name: "Presets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save Preset", exact: true })).toBeHidden();
}

/** Loads a saved stack or preset, confirming when it replaces what the draft has. */
export async function loadSaved(page: Page, noun: "Preset" | "Stack", name: string) {
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
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Chooses a picker tab, such as LoRAs › Stacks. */
export async function pickerTab(page: Page, picker: string, tab: string) {
  await page
    .getByRole("radiogroup", { name: `${picker} View`, exact: true })
    .getByText(tab, { exact: true })
    .click();
}

/** Closes the LoRA picker: Use LoRAs on phones, Escape in the desktop popover. */
export async function closeLoras(page: Page) {
  const use = page.getByRole("button", { name: "Use LoRAs", exact: true });
  if (await use.isVisible()) await use.click();
  else await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "LoRA Controls", exact: true })).toBeHidden();
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
  } = {},
) {
  const state = {
    settings: {
      enabled: options.enabled ?? true,
      paused: false,
      buffer: 12,
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
    requests: [] as { method: string; path: string; body: any }[],
  };
  const show = () => ({
    settings: state.settings,
    unseen: state.unseen,
    today: { images: 3, videos: 0 },
    spicyAvailable: state.spicyAvailable,
    status: !state.settings.enabled ? "off" : state.settings.paused ? "paused" : "waiting",
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
      const start = Number(url.searchParams.get("cursor") || 0);
      const limit = Number(url.searchParams.get("limit") || 40);
      return route.fulfill({
        json: {
          items: state.discarded.slice(start, start + limit),
          nextCursor: start + limit < state.discarded.length ? String(start + limit) : "",
        },
      });
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
