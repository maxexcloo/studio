import { expect, test, type Page } from "@playwright/test";

const stamp = "2026-10-23T00:00:00.000Z";
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#303036"/><circle cx="512" cy="512" r="190" fill="#ffb31a"/></svg>',
  );
import type { Profile } from "../../src/types";
const profiles: Profile[] = [
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

async function fixtures(page: Page) {
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
    if (path === "/api/models") return respond({ profiles });
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
      return respond({ items: [{ key: "detail", title: "Detail LoRA", installed: true }] });
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
async function create(page: Page) {
  await page.goto("/images?compose=1");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
}
async function openNav(page: Page, label: string) {
  const more = page.getByRole("button", { name: "More Options" });
  if (["Library", "Settings"].includes(label) && (await more.isVisible())) {
    await more.click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("link", { name: label, exact: true }).first().click();
}

async function openTheme(page: Page) {
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

async function section(page: Page, workspace: "Library" | "Settings", label: string) {
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

test("Image → Refine → Animate retains one session and can reopen saved work", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  await page.goto("/chat/session-1");
  await expect(page.getByRole("button", { name: "Open image: An amber bird" })).toBeVisible();
  await page
    .getByRole("article", { name: "Iteration 1", exact: true })
    .getByRole("button", { name: "Refine", exact: true })
    .click();
  const variationPrompt = page.getByRole("textbox", { name: "Variation Prompt", exact: true });
  await expect(variationPrompt).toBeVisible();
  await variationPrompt.fill("An amber bird with silver wings");
  await page.getByRole("button", { name: "Generate Variation", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  await page
    .getByRole("article", { name: "Iteration 2", exact: true })
    .getByRole("button", { name: "Animate", exact: true })
    .click();
  await variationPrompt.fill("The bird spreads its wings");
  await page.getByRole("button", { name: "Generate Variation", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs.map((j) => j.operation)).toEqual(["image", "refine", "animate"]);
  expect(state.jobs[1].parentJobId).toBe("job-1");
  expect(state.jobs[2].parentJobId).toBe("job-2");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open video: The bird spreads its wings" }),
  ).toBeVisible();
  await openNav(page, "Images");
  await expect(
    page.getByRole("button", { name: "Open image: An amber bird", exact: true }),
  ).toBeVisible();
});

test("References, masking, expert controls and runtime presets remain editable", async ({
  page,
}) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Upload Reference", exact: true }).click();
  await (
    await upload
  ).setFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("img", { name: "reference.png", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Paint Mask", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Paint the Area to Refine" })).toBeVisible();
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.getByRole("button", { name: "Use Mask", exact: true }).click();
  await page.getByRole("button", { name: "Edit Mask", exact: true }).click();
  const canvas = page.locator("canvas");
  const painted = () =>
    canvas.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) total++;
      return total;
    });
  await expect.poll(painted).toBeGreaterThan(0);
  const beforeErase = await painted();
  await page.getByText("Erase", { exact: true }).click();
  await canvas.click({ position: { x: 40, y: 40 } });
  await expect.poll(painted).toBeLessThan(beforeErase);
  const erased = await painted();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(painted).toBe(beforeErase);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(painted).toBe(erased);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Use Mask", exact: true }).click();

  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await page.getByRole("textbox", { name: "Seed", exact: true }).fill("42");
  await page.getByRole("checkbox", { name: "Allow Fallback to Another Worker" }).check();
  await page.getByRole("button", { name: "Saved Presets", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("Bird Study");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect.poll(() => state.presets.length).toBe(1);
  expect(state.presets[0].input.seed).toBe("42");
  expect(state.presets[0].input.inpaint.mask).toMatch(/^data:image\/png/);
  expect(state.presets[0].input.allowFallback).toBe(true);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An updated amber bird");
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("Updated Bird Study");
  await page.getByRole("button", { name: "Update Preset", exact: true }).click();
  await expect.poll(() => state.presets[0].title).toBe("Updated Bird Study");
  expect(state.presets[0].input.prompt).toBe("An updated amber bird");
  expect(state.presets).toHaveLength(1);
});

test("Chat keeps discussion, requested generation inputs and variation results together", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/chat");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Let’s discuss soft daylight");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect(
    page.getByText("Let's shape the lighting before we generate.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/session-1$/);
  await expect(page.getByRole("heading", { name: "Lighting Direction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lighting reference" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(state.jobs).toHaveLength(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Create a blue bird");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  const first = page.getByRole("article", { name: "Iteration 1", exact: true });
  await expect(first.getByText("A blue bird in soft daylight", { exact: true })).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Open image: A blue bird in soft daylight", exact: true }),
  ).toBeVisible();
  expect(state.chatRequests[1].generation.input.profileId).toBe("image:test");
  expect(state.chatRequests[1].generation.input.backendId).toBe("worker-a");
  await first.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
  await first
    .getByRole("textbox", { name: "Variation Prompt", exact: true })
    .fill("A blue bird in watercolour");
  await first.getByRole("button", { name: "Generate Variation", exact: true }).click();
  const variation = page.getByRole("article", { name: "Iteration 2", exact: true });
  await expect(
    variation.getByRole("button", { name: "Open image: A blue bird in watercolour", exact: true }),
  ).toBeVisible();
  await expect(first.getByText("A blue bird in soft daylight", { exact: true })).toBeVisible();
  expect(state.jobs[1].parentJobId).toBe(state.jobs[0].id);
  expect(state.chatRequests[2].revision.input.prompt).toBe("A blue bird in watercolour");
  expect(state.chatRequests[2].modelId).toBe("text:test");
  await page.reload();
  await expect(
    page.getByText("I’ll create a blue bird with your selected settings.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "Iteration 2", exact: true })).toBeVisible();
});

test("The compact composer expands on interaction and keeps picked or dragged references", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["Picked Study", "Dragged Study"].map((prompt, index) => ({
      id: `reference-${index}`,
      jobId: `source-${index}`,
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      prompt,
      settings: { profileId: "image:test" },
    })),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Preserve the working direction");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose Profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Picked Study", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Preserve the working direction",
  );
  await expect(page.getByRole("img", { name: "Generated Reference", exact: true })).toBeVisible();
  expect(state.referenceRequests[0].galleryItemId).toBe("reference-0");
  if (testInfo.project.use.isMobile) await page.keyboard.press("Escape");
  else await page.getByRole("link", { name: "Images", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Generation Inputs", exact: true })).toBeVisible();
  if (!testInfo.project.use.isMobile) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .getByRole("button", { name: "Open image: Dragged Study", exact: true })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    await page
      .locator(".studio-composer-dock")
      .dispatchEvent("dragover", { dataTransfer: transfer });
    await page.locator(".studio-composer-dock").dispatchEvent("drop", { dataTransfer: transfer });
    await expect.poll(() => state.referenceRequests.length).toBe(2);
    expect(state.referenceRequests[1].galleryItemId).toBe("reference-1");
  }
});

test("Header appearance preferences persist across reloads", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  await openTheme(page);
  const popup = await page.locator('.mantine-Popover-dropdown[role="dialog"]').boundingBox();
  expect(popup!.y).toBeGreaterThanOrEqual(68);
  await page.getByRole("button", { name: "Use Blue Colour", exact: true }).click();
  await page.getByRole("button", { name: "Use Warm Background", exact: true }).click();
  await page.getByText("Fast", { exact: true }).click();
  await page.getByText("Round", { exact: true }).click();
  await page.getByText("Dark", { exact: true }).click();
  await page.getByText("Fixed Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await openTheme(page);
  await expect(page.getByRole("button", { name: "Use Blue Colour", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Use Warm Background", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(23, 19, 15)");
  await expect(page.getByRole("radio", { name: "Round", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Fixed Width", exact: true })).toBeChecked();
});

test("Prompt assistance finishes before a generation is submitted", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("bird");
  await page.getByRole("button", { name: "Improve Prompt", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A cinematic amber bird",
  );
  await page.getByRole("textbox", { name: "Prompt", exact: true }).press("Control+Enter");
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A cinematic amber bird");
});

test("Library shows import grades and reuses compatible inspiration settings", async ({ page }) => {
  const state = await fixtures(page);
  await page.route("**/api/presets", (route) =>
    route.fulfill({
      json: {
        presets: [
          {
            id: "plain",
            name: "Amber Study",
            prompt: "Amber bird study",
            negative: "blur",
            settings: { steps: 24 },
            resources: [{ profileId: "image:test" }],
          },
          {
            id: "missing",
            name: "Missing Style Study",
            prompt: "A missing style study",
            negative: "",
            settings: { model: "foreign-model" },
            resources: [{ folder: "loras", status: "missing", weight: 0.8 }],
          },
        ],
      },
    }),
  );
  await create(page);
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).click();
  await page.getByRole("option", { name: "Detail Slider", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).press("Escape");
  const close = page.getByRole("button", { name: "Close Generation Controls", exact: true });
  if (await close.isVisible()) await close.click();
  else await page.getByRole("textbox", { name: "Prompt", exact: true }).press("Escape");
  await openNav(page, "Library");
  await expect(page.getByText("Watercolour Inspiration", { exact: true })).toBeVisible();
  await expect(page.getByText("Watercolour LoRA is missing", { exact: true })).toBeVisible();
  await section(page, "Library", "Inspiration");
  const missing = page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByText("Missing Style Study", { exact: true }) });
  await expect(missing.getByRole("button", { name: "Use Settings", exact: true })).toBeDisabled();
  await expect(missing.getByRole("button", { name: "Use Prompt", exact: true })).toBeEnabled();
  await page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByText("Amber Study", { exact: true }) })
    .getByRole("button", { name: "Use Settings", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Amber bird study",
  );
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.profileId).toBe("image:test");
  expect(state.jobs[0].input.loras).toEqual([]);
});

test("Sign-in gate keeps account data behind authentication", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({ json: { mode: "multi-user", signedIn: false, oidc: { label: "Pocket ID" } } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In With Pocket ID" })).toHaveAttribute(
    "href",
    "/api/accounts/oidc/start",
  );
  await expect(page.getByRole("link", { name: "Images", exact: true })).toHaveCount(0);
});

test("Offline views report the API error and support retry", async ({ page }) => {
  await fixtures(page);
  let fails = true;
  await page.route("**/api/gallery?**", (route) =>
    fails
      ? route.fulfill({ status: 503, json: { error: "The gallery is temporarily unavailable" } })
      : route.fulfill({ json: { items: [], hasMore: false } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("The gallery is temporarily unavailable");
  fails = false;
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(page.getByText("No Images", { exact: true })).toBeVisible();
});

test("Images and Videos tabs keep an expanding bottom composer while Chat keeps sessions beside the media", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const primary = page.getByRole("button", { name: "Generate Image", exact: true });
  await expect(primary).toBeEnabled();
  const visual = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const label = element.querySelector("svg")!;
    return {
      color: style.color,
      background: style.backgroundColor,
      clipped: label.getBoundingClientRect().width === 0,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(visual.color),
    b = luminance(visual.background);
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(visual.clipped).toBe(false);
  expect(visual.overflow).toBe(false);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect(page).toHaveURL("/images");
  await expect.poll(() => state.jobs.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Open image: An amber bird", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generation Inputs", exact: true }).click();
  await page.getByRole("button", { name: "Choose Profile", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Family", exact: true })).toHaveValue(
    "Studio Images",
  );
  await expect(page.getByRole("combobox", { name: "Model & Finetune", exact: true })).toHaveValue(
    "Studio Image",
  );
  await page
    .getByRole("combobox", { name: "Fast, Quality & Workflow Preset", exact: true })
    .click();
  await page.getByRole("option", { name: "Fast", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.profileId).toBe("image:fast");
  expect(state.jobs[1].input.backendId).toBe("worker-a");
  if (testInfo.project.use.isMobile)
    await expect(page.getByRole("dialog", { name: "Generation Controls" })).toBeHidden();
  await page.screenshot({
    path: `/tmp/studio-rewrite-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await expect(page).toHaveURL(/\/video$/);
  await expect(page.getByRole("heading", { name: "Videos", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate Video", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Chat", exact: true }).first().click();
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
  await expect(page.getByRole("link", { name: /An amber bird/ }).first()).toBeVisible();
});

test("Generation controls preserve the draft and return keyboard focus with reduced motion", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Keep this direction");
  await page.getByRole("button", { name: "Generation Inputs", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("Keep this direction");
  await prompt.fill("Keep this direction, in soft daylight");
  await prompt.press("Escape");
  if (testInfo.project.use.isMobile)
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  const controls = page.getByRole("button", { name: "Generation Inputs", exact: true });
  await expect(controls).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this direction, in soft daylight",
  );
  await controls.press("Enter");
  await expect(page.getByRole("button", { name: "Choose Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this direction, in soft daylight",
  );
});

test("LoRAs use catalogue family and type metadata", async ({ page }) => {
  await fixtures(page);
  await create(page);
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRA Type", exact: true }).click();
  await page.getByRole("option", { name: "Style", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).click();
  await page.getByRole("option", { name: "Soft Style", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Soft Style", exact: true })).toBeVisible();
});

test("Waiting jobs show their reason and cancellation is scoped to the recorded job", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.sessions.push({
    id: "session-1",
    title: "Waiting Study",
    createdAt: stamp,
    updatedAt: stamp,
    inputs: {},
  });
  state.jobs.push({
    id: "job-wait",
    jobId: "job-wait",
    sessionId: "session-1",
    operation: "image",
    status: "waiting",
    reason: "Waiting for Media Worker to become available.",
    input: { prompt: "Waiting bird", kind: "image", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await page.goto("/chat/session-1");
  await expect(page.getByText("Waiting for Media Worker to become available.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
});

test("Administrator accounts retain worker visibility and attribution", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: {
        mode: "multi-user",
        signedIn: true,
        account: { id: "account-a", role: "administrator" },
      },
    }),
  );
  await page.goto("/settings");
  await expect(
    page.getByRole("region", { name: "Your Account" }).getByText("Administrator", { exact: true }),
  ).toBeVisible();
  await section(page, "Settings", "Workers");
  await expect(page.getByRole("heading", { name: "Workers", exact: true })).toBeVisible();
  await expect(page.getByText("Media Worker", { exact: true })).toBeVisible();
  await section(page, "Settings", "About");
  await expect(page.getByText(/MantineHub theme includes MIT/)).toBeVisible();
});

test("Upscale comparison uses one bounded slider and preserves the original result", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "original",
    jobId: "job-original",
    url: image,
    thumbnailUrl: image,
    type: "image",
    status: "done",
    prompt: "Comparison Study",
    width: 1024,
    height: 1024,
    settings: { profileId: "image:test" },
    upscale: { url: image, status: "done" },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open image: Comparison Study", exact: true }).click();
  await page.getByRole("button", { name: "Generation Details", exact: true }).click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Comparison Position", exact: true });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "51");
  await expect(page.getByRole("img", { name: "Original Result", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Upscaled Result", exact: true })).toBeVisible();
});

test("Administrators save and verify per-user cloud and NSFW access through assigned groups", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "administrator" } },
    }),
  );
  await page.goto("/settings");
  await section(page, "Settings", "Accounts");
  await page.getByRole("button", { name: "Access Groups", exact: true }).click();
  await page.getByRole("textbox", { name: "Group Name", exact: true }).fill("Member Cloud");
  await page.getByRole("textbox", { name: "Group ID", exact: true }).fill("member-cloud");
  await page.getByRole("checkbox", { name: "Cloud Models", exact: true }).check();
  await page.getByRole("checkbox", { name: "NSFW Models", exact: true }).check();
  await page.getByRole("checkbox", { name: "Image Generation", exact: true }).check();
  await page.getByRole("button", { name: "Save Access Group", exact: true }).click();
  await expect
    .poll(
      () =>
        state.administration.accessProfiles.find((group) => group.id === "member-cloud")?.features
          .cloudModels,
    )
    .toBe(true);
  const member = page.getByRole("row", { name: "Account Member", exact: true });
  await member.getByRole("combobox", { name: "Access Group for Member", exact: true }).click();
  await page.getByRole("option", { name: "Member Cloud", exact: true }).click();
  await expect(member.getByText("Cloud Models On", { exact: true })).toBeVisible();
  await expect(member.getByText("NSFW Models On", { exact: true })).toBeVisible();
  await member.getByRole("button", { name: "Disable Account", exact: true }).click();
  await expect(member.getByText("Disabled", { exact: true })).toBeVisible();
  expect(state.administration.accounts.find((account) => account.id === "member")?.disabled).toBe(
    true,
  );
});

test("Users update their own display name and retain password-protected email controls", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "user" } },
    }),
  );
  await page.goto("/settings");
  const own = page.getByRole("region", { name: "Your Account", exact: true });
  await own.getByRole("textbox", { name: "Display Name", exact: true }).fill("Studio Maker");
  await own.getByRole("button", { name: "Save Display Name", exact: true }).click();
  await expect.poll(() => state.ownAccount.displayName).toBe("Studio Maker");
  await expect(own.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue(
    "Studio Maker",
  );
  await own.getByRole("button", { name: "Email & Password", exact: true }).click();
  await expect(own.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
    "admin@example.test",
  );
  await expect(own.getByRole("textbox", { name: "Current Password", exact: true })).toBeVisible();
  await expect(
    own.getByRole("button", { name: "Save Email & Password", exact: true }),
  ).toBeDisabled();
});

test("Account menu opens the account workspace and reflects the saved name", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "user" } },
    }),
  );
  await page.goto("/");
  async function account() {
    if (testInfo.project.use.isMobile)
      await page.getByRole("button", { name: "More Options", exact: true }).click();
    else await page.getByRole("button", { name: "Your Account", exact: true }).click();
  }
  await account();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/settings#account$/);
  await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Studio Artist");
  await page.getByRole("button", { name: "Save Display Name", exact: true }).click();
  await expect.poll(() => state.ownAccount.displayName).toBe("Studio Artist");
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await account();
  await expect(page.getByText("Studio Artist", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign Out", exact: true })).toBeEnabled();
});

test("Fullscreen viewer preserves media interaction and closes on the surrounding blurred stage", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "viewer",
    jobId: "job-viewer",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Viewer Study",
    width: 1024,
    height: 1024,
    settings: { profileId: "image:test" },
  });
  state.gallery.push({
    ...state.gallery[0],
    id: "viewer-next",
    jobId: "job-viewer-next",
    prompt: "Next Viewer Study",
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Viewer Study", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds?.width).toBe(viewport.width);
  expect(bounds?.height).toBe(viewport.height);
  await dialog.getByRole("button", { name: "Next Generation", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Viewer Study", exact: true })).toBeVisible();
  await dialog.getByRole("img", { name: "Viewer Study", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom: Fill", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Fill", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Fit Image", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Zoom: Fit", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(dialog.getByText("Prompt", { exact: true })).toBeVisible();
  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open image: Viewer Study", exact: true }),
  ).toBeFocused();
});

test("Chat layout respects workspace width and keeps a structural sessions sidebar", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  if (!testInfo.project.use.isMobile) await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Creative Modes" });
  expect(
    await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))),
  ).toEqual(["Chat", "Images", "Videos"]);
  await openTheme(page);
  await page.getByText("Fixed Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  const fixed = await page.locator(".studio-chat-workspace").boundingBox();
  if (!testInfo.project.use.isMobile) {
    expect(fixed?.width).toBe(1600);
    const side = await page.locator(".studio-session-sidebar").boundingBox();
    expect(side?.y).toBe(68);
    expect(side!.height + side!.y).toBe(1000);
  }
  await openTheme(page);
  await page.getByText("Full Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  const full = await page.locator(".studio-chat-workspace").boundingBox();
  if (!testInfo.project.use.isMobile) expect(full!.width).toBeGreaterThan(fixed!.width);
  const composer = await page.locator(".studio-composer-dock").boundingBox();
  expect(composer!.width).toBeLessThanOrEqual(780);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("Gallery search preserves the query and status panel cancels only active work", async ({
  page,
}) => {
  const state = await fixtures(page);
  for (const [id, status] of [
    ["waiting-job", "waiting"],
    ["queued-job", "queued"],
    ["finished-job", "completed"],
  ])
    state.jobs.push({
      id,
      jobId: id,
      sessionId: "s",
      operation: "image",
      status,
      input: { prompt: id },
      items: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(search).toBeFocused();
  await search.fill("birds");
  await search.press("Escape");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await expect(search).toHaveValue("birds");
  await search.press("Escape");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.getByRole("button", { name: "Starred", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  if (await page.getByRole("button", { name: "Open Status", exact: true }).isVisible())
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
  else await page.getByRole("button", { name: "Open Queue", exact: true }).click();
  const queue = page.getByRole("dialog", { name: /^(Status|Queue)$/ });
  await expect(queue.getByText("waiting-job", { exact: true })).toBeVisible();
  await expect(queue.getByText("queued-job", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "Cancel All", exact: true }).click();
  await expect
    .poll(() => state.jobs.map((job) => job.status))
    .toEqual(["cancelled", "cancelled", "completed"]);
  await expect(queue.getByText("Empty Queue", { exact: true })).toBeVisible();
});

test("LoRA stack ordering is preserved in submitted inputs", async ({ page }, testInfo) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An ordered adapter study");
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "LoRAs", exact: true });
  await picker.click();
  await page.getByRole("option", { name: "Detail Slider", exact: true }).click();
  await page.getByRole("option", { name: "Soft Style", exact: true }).click();
  await picker.press("Escape");
  const earlier = page.getByRole("button", { name: "Move Soft Style Earlier", exact: true });
  await earlier.focus();
  await earlier.press("Enter");
  if (!testInfo.project.use.isMobile) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .getByRole("button", { name: "Drag Detail Slider", exact: true })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    await page
      .getByRole("listitem", { name: "loras Soft Style", exact: true })
      .dispatchEvent("dragover", { dataTransfer: transfer });
    await page
      .getByRole("listitem", { name: "loras Soft Style", exact: true })
      .dispatchEvent("drop", { dataTransfer: transfer });
  }
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.loras.map((lora: { name: string }) => lora.name)).toEqual(
    testInfo.project.use.isMobile
      ? ["soft-style.safetensors", "detail.safetensors"]
      : ["detail.safetensors", "soft-style.safetensors"],
  );
});

test("Reference slots preserve optional End-only inputs and reuse one asset in two roles", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile = {
    ...profiles[0],
    id: "image:slots",
    mediaInputs: [
      { id: "start", label: "Start", required: false, max: 1 },
      { id: "end", label: "End", required: false, max: 1 },
    ],
  };
  await page.route("**/api/models", (route) => route.fulfill({ json: { profiles: [profile] } }));
  state.gallery.push({
    id: "slot-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Slot Source",
    width: 1024,
    height: 1024,
  });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("End-only study");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("combobox", { name: "Reference Slot", exact: true }).click();
  await page.getByRole("option", { name: "End · Optional · Up to 1", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Slot Source", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-slot-source", slot: "end" },
  ]);
  await page.getByRole("button", { name: "Generation Inputs", exact: true }).click();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("combobox", { name: "Reference Slot", exact: true }).click();
  await page.getByRole("option", { name: "Start · Optional · Up to 1", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Slot Source", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.referenceAssets).toEqual([
    { assetId: "asset-slot-source", slot: "end" },
    { assetId: "asset-slot-source", slot: "start" },
  ]);
});

test("Gallery selection stars, downloads and deletes only selected finished records", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["First Study", "Second Study", "Pending Study"].map((prompt, index) => ({
      id: `selection-${index}`,
      jobId: `selection-job-${index}`,
      type: "image",
      status: index === 2 ? "running" : "done",
      url: image,
      thumbnailUrl: image,
      prompt,
      width: 1024,
      height: 1024,
      settings: { profileId: "image:test" },
    })),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "Select All Loaded", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("2 Selected");
  await expect(page.getByRole("link", { name: "Download Selected", exact: true })).toHaveAttribute(
    "href",
    /ids=selection-0%2Cselection-1/,
  );
  await page.getByRole("button", { name: "Star Selected", exact: true }).click();
  await expect.poll(() => state.gallery.filter((item) => item.favorite).length).toBe(2);
  await page.getByRole("button", { name: "Delete Selected", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Selected Items", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => state.gallery.map((item) => item.id)).toEqual(["selection-2"]);
  await page.getByRole("button", { name: "Done Selecting", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
});

test("Gallery facets submit repeated models together with LoRA, size and aspect filters", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Gallery", exact: true }).fill("bird");
  await page.getByRole("textbox", { name: "Search Gallery", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Filter By Models", exact: true }).click();
  await page.getByRole("checkbox", { name: "Studio Image", exact: true }).check();
  await page.getByRole("checkbox", { name: "Motion Quality", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By LoRAs", exact: true }).click();
  await page.getByRole("checkbox", { name: "Detail Slider", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By Size", exact: true }).click();
  await page.getByRole("checkbox", { name: "Up to 1K", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By Aspect Ratio", exact: true }).click();
  await page.getByRole("checkbox", { name: "1:1", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return {
        model: query.getAll("model"),
        lora: query.getAll("lora"),
        size: query.getAll("size"),
        aspect: query.getAll("aspect"),
        q: query.get("q"),
      };
    })
    .toEqual({
      model: ["image.safetensors", "video.safetensors"],
      lora: ["detail.safetensors"],
      size: ["up-to-1k"],
      aspect: ["1:1"],
      q: "bird",
    });
  await page.getByRole("button", { name: "Clear Filters", exact: true }).click();
  await expect
    .poll(() => new URLSearchParams(state.galleryRequests.at(-1)).getAll("model"))
    .toEqual([]);
  await page.getByRole("button", { name: "Close Filters", exact: true }).click();
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "bird",
  );
});

test("Legacy Recreate retains reference slots, disabled LoRAs and exact profile settings", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "legacy-item",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Legacy study",
    width: 1024,
    height: 1024,
    settings: {
      profileId: "image:test",
      model: "image.safetensors",
      referenceAssets: [{ assetId: "owned-asset", slot: "image" }],
      referenceRole: "reference",
      loras: [{ name: "detail.safetensors", enabled: false, strength: 0.8 }],
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open image: Legacy study", exact: true }).click();
  await page.getByRole("button", { name: "Generation Details", exact: true }).click();
  await page.getByRole("button", { name: "Recreate", exact: true }).click();
  await page.getByRole("button", { name: "Generation Inputs", exact: true }).click();
  await expect(page.getByRole("img", { name: "Saved Reference", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([{ assetId: "owned-asset", slot: "image" }]);
  expect(state.jobs[0].input.referenceRole).toBe("reference");
  expect(state.jobs[0].input.loras[0]).toEqual({
    name: "detail.safetensors",
    enabled: true,
    strength: 0.8,
  });
});

test("Generation size presets and custom dimensions preserve profile constraints", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile = {
    ...profiles[0],
    aspectPresets: [
      { label: "Square", w: 1024, h: 1024 },
      { label: "Landscape", w: 1536, h: 1024 },
    ],
    constraints: {
      width: { min: 512, max: 2048, step: 64 },
      height: { min: 512, max: 2048, step: 64 },
    },
  };
  await page.route("**/api/models", (route) => route.fulfill({ json: { profiles: [profile] } }));
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A wide landscape");
  await page.getByRole("button", { name: "Image Size", exact: true }).click();
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await page.getByText("Custom", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Width", exact: true })).toHaveValue("1536");
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("1600");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.width).toBe(1600);
  expect(state.jobs[0].input.height).toBe(1024);
});
