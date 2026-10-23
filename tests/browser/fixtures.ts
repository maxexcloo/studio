import { expect, type Page } from "@playwright/test";

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
  const galleryRequests: string[] = [];
  let clock = Date.parse(stamp);
  const nextStamp = () => new Date((clock += 1000)).toISOString();
  function recordGeneration(body: any, sessionId: string) {
    const id = `job-${jobs.length + 1}`,
      createdAt = nextStamp();
    const item = {
      id: `${id}:0`,
      jobId: id,
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
    displayName: "Administrator",
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
        displayName: "Administrator",
        role: "administrator",
        disabled: false,
      },
      {
        id: "member",
        username: "member@example.test",
        displayName: "Member",
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
    if (path === "/api/access/status")
      return respond({ signedIn: true, canAdmin: true, studioPassword: { set: false } });
    if (path === "/api/accounts/me") {
      if (method === "PATCH") {
        if (body.displayName) ownAccount.displayName = body.displayName;
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
          reason: "Workload control remains with AI Control until cutover.",
        },
      });
    if (path === "/api/queue") return respond({ jobs });
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
        title: body.title,
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
      return respond({ session, jobs: jobs.filter((j) => j.sessionId === session?.id) });
    }
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
      });
    if (path === "/api/gallery") {
      galleryRequests.push(url.search);
      return respond({
        items: gallery.filter(
          (i) => !url.searchParams.get("q") || i.prompt.includes(url.searchParams.get("q")),
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
          name: "Generated Reference",
          thumbnailUrl: image,
          url: image,
          width: 1024,
          height: 1024,
        },
      });
    }
    if (path === "/api/reference-assets/upload")
      return respond({
        asset: {
          id: "asset-upload",
          name: "reference.png",
          thumbnailUrl: image,
          url: image,
          width: 1024,
          height: 1024,
        },
      });
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
    galleryRequests,
  };
}
export async function create(page: Page) {
  await page.goto("/images?compose=1");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
}
export async function openNav(page: Page, label: string) {
  const more = page.getByRole("button", { name: "More Options" });
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
