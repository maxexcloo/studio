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
    if (path === "/api/loras/info")
      return respond({
        loras: {
          "detail.safetensors": { title: "Detail Slider", families: ["test"], type: "slider" },
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
      const id = `job-${jobs.length + 1}`,
        sessionId = path.split("/")[3];
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
        createdAt: stamp,
        settings: { ...body, profileName: body.profileName },
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
        createdAt: stamp,
        updatedAt: stamp,
      };
      jobs.push(job);
      gallery.unshift(item);
      return respond({ jobId: id, sessionId, status: "queued" });
    }
    if (path.match(/^\/api\/sessions\/[^/]+$/)) {
      const session = sessions.find((s) => s.id === path.split("/")[3]);
      return respond({ session, jobs: jobs.filter((j) => j.sessionId === session?.id) });
    }
    if (path === "/api/gallery")
      return respond({
        items: gallery.filter(
          (i) => !url.searchParams.get("q") || i.prompt.includes(url.searchParams.get("q")),
        ),
        hasMore: false,
        nextCursor: "",
      });
    if (path === "/api/reference-assets/from-gallery")
      return respond({
        asset: {
          id: "asset-result",
          name: "Generated Reference",
          thumbnailUrl: image,
          url: image,
          width: 1024,
          height: 1024,
        },
      });
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
  return { sessions, jobs, presets, gallery, administration, ownAccount };
}
async function create(page: Page) {
  await page.goto("/?compose=1");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
}
async function openNav(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "Toggle Navigation" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("link", { name: label, exact: true }).first().click();
}

test("Image → Refine → Animate retains one session and can reopen saved work", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  await page.goto("/sessions/session-1");
  await expect(page.getByRole("button", { name: "Open image: An amber bird" })).toBeVisible();
  await page
    .getByRole("article", { name: "Iteration 1", exact: true })
    .getByRole("button", { name: "Refine", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Refine Image", exact: true })).toBeVisible();
  await expect(page.getByText("Generated Reference", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("An amber bird with silver wings");
  await page.getByRole("button", { name: "Refine Image", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/session-1$/);
  await page
    .getByRole("article", { name: "Iteration 2", exact: true })
    .getByRole("button", { name: "Animate", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Generate Video", exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("The bird spreads its wings");
  await page.getByRole("button", { name: "Generate Video", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/session-1$/);
  expect(state.jobs.map((j) => j.operation)).toEqual(["image", "refine", "animate"]);
  expect(state.jobs[1].parentJobId).toBe("job-1");
  expect(state.jobs[2].parentJobId).toBe("job-2");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open video: The bird spreads its wings" }),
  ).toBeVisible();
  await openNav(page, "Image");
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
  await page.getByRole("button", { name: "Upload Reference" }).click();
  await (
    await upload
  ).setFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await expect(page.getByText("reference.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Paint Mask", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Paint the Area to Refine" })).toBeVisible();
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
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

test("Prompt assistance finishes before a generation is submitted", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("bird");
  await page.getByRole("button", { name: "Improve Prompt", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A cinematic amber bird",
  );
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A cinematic amber bird");
});

test("Library shows import grades and reuses inspiration settings", async ({ page }) => {
  await fixtures(page);
  await page.goto("/library");
  await expect(page.getByText("Watercolour Inspiration", { exact: true })).toBeVisible();
  await expect(page.getByText("Watercolour LoRA is missing", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Inspiration", exact: true }).click();
  await page.getByRole("button", { name: "Use Settings", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Amber bird study",
  );
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
  await expect(page.getByRole("link", { name: "Image", exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "Make Something Yours" })).toBeVisible();
});

test("Image and Video tabs keep an expanding bottom composer while Chat keeps sessions beside the media", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const primary = page.getByRole("button", { name: "Generate Image", exact: true });
  await expect(primary).toBeEnabled();
  const visual = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const label = element.querySelector(".mantine-Button-label")!;
    return {
      color: style.color,
      background: style.backgroundColor,
      clipped: label.scrollWidth > label.clientWidth,
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
  await expect(page).toHaveURL("/");
  await expect.poll(() => state.jobs.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Open image: An amber bird", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Image Quality", exact: true }).click();
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
  await page.getByRole("link", { name: "Video", exact: true }).first().click();
  await expect(page).toHaveURL(/type=video/);
  await expect(page.getByRole("button", { name: "Generate Video", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Chat", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Where should we take it?" })).toBeVisible();
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByRole("link", { name: /An amber bird/ }).first()).toBeVisible();
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
  await page.goto("/sessions/session-1");
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
  await expect(page.getByRole("heading", { name: "Workers", exact: true })).toBeVisible();
  await expect(page.getByText("Media Worker", { exact: true })).toBeVisible();
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
  const member = page.getByRole("region", { name: "Account Member", exact: true });
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
