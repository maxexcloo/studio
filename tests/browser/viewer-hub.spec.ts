import { expect, test, type Page } from "@playwright/test";
import type { Profile } from "../../frontend/src/types";
import {
  closeLoras,
  fixtures,
  image,
  profiles,
  serveProfiles,
  stamp,
  viewerAction,
} from "./fixtures";

async function seed(
  page: Page,
  extra: Record<string, unknown> = {},
  routes?: (page: Page) => Promise<unknown>,
) {
  const state = await fixtures(page);
  const settings = { profileId: "image:test", seed: 1234567, steps: 28, count: 2 };
  const item = {
    id: "hub",
    jobId: "job-hub",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "An amber bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings,
    ...extra,
  };
  state.sessions.push({
    id: "session-hub",
    title: "Hub",
    inputs: {},
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push({
    id: "job-hub",
    jobId: "job-hub",
    sessionId: "session-hub",
    status: "completed",
    operation: "image",
    input: { kind: "image", prompt: item.prompt, ...settings },
    items: [item],
    outputs: [item],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.gallery.push(item);
  // Registered after the shared fixtures, these take precedence over them.
  await routes?.(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  return { state, viewer: page.getByRole("dialog", { name: "Generation", exact: true }) };
}

test("The viewer prompt bar queues variations into a strip and choosing one makes it current", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  const prompt = viewer.getByRole("textbox", { name: "Variation Prompt", exact: true });
  await expect(prompt).toHaveValue("An amber bird");
  await prompt.fill("An amber bird in snow");
  await prompt.press("Enter");
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    sessionId: "session-hub",
    parentJobId: "job-hub",
    operation: "image",
    input: { prompt: "An amber bird in snow", seed: "", count: 1, steps: 28 },
  });
  const strip = viewer.getByRole("list", { name: "Variations", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await strip.getByRole("listitem", { name: "Show Variation 2", exact: true }).click();
  await expect(
    viewer.getByRole("img", { name: "An amber bird in snow", exact: true }),
  ).toBeVisible();
  await expect(strip.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "true");

  await viewer.getByRole("button", { name: "Regenerate Options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Exact Repeat", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2]).toMatchObject({ parentJobId: state.jobs[1].id, input: { count: 1 } });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
});

test("Regenerate and Recreate draw a new seed; only Exact Repeat keeps it", async ({ page }) => {
  const { state, viewer } = await seed(page);
  // One click regenerates with a new seed; the menu holds New Seed and Exact Repeat.
  await viewer.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({ seed: "", steps: 28 });
  await viewer.getByRole("button", { name: "Regenerate Options", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Seed", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2].input).toMatchObject({ seed: "", steps: 28 });
  await viewer.getByRole("button", { name: "Regenerate Options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Exact Repeat", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(4);
  expect(state.jobs[3].input).toMatchObject({ seed: 1234567, steps: 28 });
  await viewerAction(page, "Recreate in Composer");
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
  await expect(page.getByRole("button", { name: /^Clear Seed/ })).toHaveCount(0);
});

/** A profile with a ComfyUI and a Radiance backend that runs on `backend`, defining `defined`. */
const combined = (backend: string, defined = ["comfyui", "radiance"]) => ({
  ...profiles[0],
  id: "custom:krea",
  label: "Krea 2 Turbo · Fast",
  model: "custom:krea",
  workflow: "custom:krea",
  backend,
  backendOptions: defined.map((id) => ({
    id,
    label: id === "comfyui" ? "ComfyUI" : "Radiance",
    ready: true,
  })),
});
const ranOn = (backend: string) => ({
  settings: { profileId: "custom:krea", profileBackend: backend, seed: 1234567, steps: 28 },
});

test("Exact Repeat and Recreate keep the backend a combined profile ran on", async ({ page }) => {
  const { state, viewer } = await seed(page, ranOn("radiance"), () =>
    serveProfiles(page, [combined("comfyui"), ...profiles.slice(1)]),
  );
  await viewer.getByRole("button", { name: "Regenerate Options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Exact Repeat", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({
    profileId: "custom:krea",
    profileBackend: "radiance",
    seed: 1234567,
  });
  await viewerAction(page, "Recreate in Composer");
  await expect(viewer).toBeHidden();
  // The picker shows the backend this draft runs on, not the profile's current one.
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    "Radiance",
  );
});

test("A rerun whose backend the profile no longer has runs on its current one and says so", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, ranOn("radiance"), () =>
    serveProfiles(page, [combined("comfyui", ["comfyui"]), ...profiles.slice(1)]),
  );
  await viewer.getByRole("button", { name: "Regenerate Options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Exact Repeat", exact: true }).click();
  await expect(
    page.getByText(
      "Radiance is no longer a backend of Krea 2 Turbo · Fast, so this run uses ComfyUI.",
    ),
  ).toBeVisible();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.profileBackend).toBeUndefined();
});

test("An Animate theme queues a video in one click; the queue item writes its motion prompt", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Spicy", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    parentJobId: "job-hub",
    input: {
      kind: "video",
      prompt: "",
      writing: { kind: "animate", theme: "living", source: "An amber bird" },
      referenceAssets: [{ assetId: "asset-hub", slot: "start" }],
    },
  });
});

test("A queue item streams its prompt's thinking; the result keeps it collapsed under the prompt", async ({
  page,
}, testInfo) => {
  const thinking = "The bird is perched, so a gentle take-off reads best.";
  const { state, viewer } = await seed(page, {
    writing: { kind: "animate", model: "ai/text", thinking },
  });
  state.jobs.push({
    id: "job-writing",
    jobId: "job-writing",
    sessionId: "session-hub",
    status: "writing",
    operation: "animate",
    input: { kind: "video", prompt: "", writing: { kind: "animate", theme: "action" } },
    progress: { thinking: "Wings first, then", prompt: "The bird spreads its wings" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  if (testInfo.project.use.isMobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    details = page.getByRole("dialog", { name: "An amber bird", exact: true });
  }
  await expect(details.getByText("Written by ai/text", { exact: true })).toBeVisible();
  const toggle = details.getByRole("button", { name: "Thinking", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(details.getByText(thinking, { exact: true })).toBeHidden();
  await toggle.click();
  await expect(details.getByText(thinking, { exact: true })).toBeVisible();
  // The queue item, as a fresh page loads it.
  await page.goto("/images");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
  await expect(queue.getByText("Writing Prompt", { exact: true })).toBeVisible();
  await expect(queue.getByText("Wings first, then", { exact: true })).toBeVisible();
  await expect(queue.getByText("The bird spreads its wings", { exact: true })).toBeVisible();
});

// Local video is stopped and the account is granted Grok: Animate goes there and says so first.
const grok: Profile = {
  id: "grok:video",
  label: "Grok Imagine Video",
  kind: "video",
  model: "grok:video",
  workflow: "grok:video",
  family: "grok",
  provider: "cliproxyapi",
  ready: true,
  defaults: { width: 1280, height: 720, duration: 6 },
  capabilities: { imageInput: true },
  mediaInputs: [{ id: "reference", label: "Reference Image" }],
};
const note = "Local video isn't running, so this runs on Grok Imagine Video.";
async function offline(page: Page) {
  await serveProfiles(page, [...profiles, grok]);
  await page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        profileId: grok.id,
        label: grok.label,
        cloud: true,
        note,
        size: { width: 960, height: 960 },
      },
    }),
  );
}

test("With local video stopped, an Animate theme says it runs on Grok and queues there", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, {}, offline);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Cinematic Camera", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    input: {
      kind: "video",
      profileId: grok.id,
      writing: { kind: "animate", theme: "cinematic" },
      width: 960,
      height: 960,
      duration: 6,
      referenceAssets: [{ assetId: "asset-hub", slot: "reference" }],
    },
  });
});

test("With local video stopped, Animate in Composer pre-selects Grok", async ({ page }) => {
  const { state, viewer } = await seed(page, {}, offline);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Animate in Composer", exact: true }).click();
  await expect(page).toHaveURL(/\/video\?compose=1/);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    grok.label,
  );
  expect(state.jobs).toHaveLength(1);
});

test("With neither local video nor Grok, Animate says why and queues nothing", async ({ page }) => {
  const reason =
    "Local video isn't running and this account has no Grok access (Cloud Models), so nothing can animate this image right now.";
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 409, json: { ok: false, error: reason } }),
    ),
  );
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Living Photo", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Animate in Composer", exact: true }),
  ).toBeDisabled();
  expect(state.jobs).toHaveLength(1);
});

test("Details copy the prompt in one click and Copy Settings copies every input", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copied = text;
        },
      },
    });
  });
  const { viewer } = await seed(page, {
    negative: "blurry",
    settings: {
      profileId: "image:test",
      seed: 1234567,
      steps: 28,
      cfg: 4,
      sampler: "euler",
      vae: "models/vae/ae.safetensors",
    },
  });
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  if (testInfo.project.use.isMobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    details = page.getByRole("dialog", { name: "An amber bird", exact: true });
  }
  await details.getByRole("button", { name: "Copy Prompt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe("An amber bird");
  await details.getByRole("button", { name: "Copy Settings", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copied))
    .toBe(
      [
        "An amber bird",
        "Negative Prompt: blurry",
        "Profile: Image Quality",
        "VAE: ae",
        "Steps: 28",
        "CFG: 4",
        "Sampler: euler",
        "Seed: 1234567",
        "Dimensions: 1024 × 1024",
      ].join("\n"),
    );
});

test("Near-misses beside the viewer's controls keep it open; the empty stage closes it", async ({
  page,
}) => {
  const { viewer } = await seed(page);
  const prompt = (await viewer
    .getByRole("textbox", { name: "Variation Prompt", exact: true })
    .boundingBox())!;
  await page.mouse.click(prompt.x + prompt.width / 2, prompt.y - 10);
  await expect(viewer).toBeVisible();
  const stage = (await viewer.locator("[data-zoom-mode]").boundingBox())!;
  const picture = (await viewer
    .getByRole("button", { name: "Change Image Zoom", exact: true })
    .boundingBox())!;
  // The square image leaves empty stage above or beside it.
  const blank =
    picture.x - stage.x > 80
      ? { x: stage.x + 20, y: stage.y + stage.height / 3 }
      : { x: stage.x + stage.width / 2, y: stage.y + 20 };
  await page.mouse.click(blank.x, blank.y);
  await expect(viewer).toBeHidden();
});

test("An opened video plays, muted when the browser refuses sound", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as any).played = { muted: this.muted };
      return this.muted
        ? Promise.resolve()
        : Promise.reject(new DOMException("Sound needs a gesture", "NotAllowedError"));
    };
  });
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/test-media/clip.mp4",
    prompt: "A rolling wave",
    width: 1280,
    height: 720,
    createdAt: stamp,
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).played)).toEqual({ muted: true });
});

test("Details show the gallery caption and its tags", async ({ page }, testInfo) => {
  const { viewer } = await seed(page, {
    caption: {
      text: "A small amber bird perched on a mossy branch, soft morning light.",
      tags: ["branch", "bird"],
      model: "vision-model",
      at: stamp,
      version: 2,
    },
  });
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  if (testInfo.project.use.isMobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    details = page.getByRole("dialog", { name: "An amber bird", exact: true });
  }
  await expect(
    details.getByText("A small amber bird perched on a mossy branch, soft morning light.", {
      exact: true,
    }),
  ).toBeVisible();
  const tags = details.getByLabel("Caption Tags", { exact: true });
  await expect(tags.getByRole("link")).toHaveText(["bird", "branch"]);
  // A tag searches the gallery for it and closes the viewer.
  await tags.getByRole("link", { name: "Search branch", exact: true }).click();
  await expect(viewer).toBeHidden();
  if (!testInfo.project.use.isMobile)
    await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
      "branch",
    );
});

test("Desktop details stay where the viewer left them", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones show details in a sheet.");
  const { viewer } = await seed(page);
  const details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await expect(details.getByText("1234567", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(details).toBeHidden();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "Generation Details", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(details).toBeHidden();
});

test("Phone swipes reveal details and close the viewer", async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  const { viewer } = await seed(page);
  const picture = viewer.getByRole("img", { name: "An amber bird", exact: true });
  await expect(picture).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  async function swipe(dy: number) {
    const box = (await picture.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + dy }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await swipe(-120);
  const sheet = page.getByRole("dialog", { name: "An amber bird", exact: true });
  await expect(sheet.getByText("1234567", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
  await expect(sheet).toBeHidden();
  await swipe(120);
  await expect(viewer).toBeHidden();
});

test("Fullscreen viewer preserves media interaction and closes on the surrounding blurred stage", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  // Native sharing would replace the row's Download on WebKit phones.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined }),
  );
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
  const firstTile = page.getByRole("button", { name: "Open image: Viewer Study", exact: true });
  await firstTile.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Open image: Next Viewer Study", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(firstTile).toBeFocused();
  await firstTile.click();
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds?.width).toBe(viewport.width);
  expect(bounds?.height).toBe(viewport.height);
  const download = dialog.getByRole("link", { name: "Download", exact: true });
  await expect(download).toHaveAttribute("href", image);
  await expect(download).toHaveAttribute("download", "studio-viewer.png");
  await dialog.getByRole("button", { name: "Next Generation", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Viewer Study", exact: true })).toBeVisible();
  if (testInfo.project.use.browserName !== "webkit") {
    const picture = await dialog
      .getByRole("img", { name: "Viewer Study", exact: true })
      .boundingBox();
    const touch = await page.context().newCDPSession(page);
    const y = picture!.y + picture!.height / 2;
    const start = picture!.x + picture!.width * 0.8;
    const end = picture!.x + picture!.width * 0.2;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: start, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: end, y }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("img", { name: "Viewer Study", exact: true })).toBeVisible();
  }
  const zoom = dialog.locator("[data-zoom-mode]");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeGreaterThan(0);
  const fitScale = Number(await zoom.getAttribute("data-zoom-scale"));
  await page.keyboard.press("Equal");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeGreaterThan(fitScale);
  await page.keyboard.press("Digit0");
  await expect(zoom).toHaveAttribute("data-zoom-mode", "Fit");
  await dialog.getByRole("img", { name: "Viewer Study", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom: Fill", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Fill", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Zoom: Fit", exact: true })).toBeVisible();
  // Desktop details are open beside the image; phones open them as a sheet.
  if (testInfo.project.use.isMobile) {
    await dialog.getByRole("button", { name: "Generation Details", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Viewer Study", exact: true });
    await expect(sheet.getByText("Prompt", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
    await expect(sheet).toBeHidden();
  } else await expect(dialog.getByText("Prompt", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const picture = await dialog
        .getByRole("img", { name: "Viewer Study", exact: true })
        .boundingBox();
      const viewport = await zoom.boundingBox();
      return picture && viewport
        ? picture.width <= viewport.width + 1 && picture.height <= viewport.height + 1
        : false;
    })
    .toBe(true);
  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open image: Viewer Study", exact: true }),
  ).toBeFocused();
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
  await viewerAction(page, "Recreate in Composer");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).press("Enter");
  await expect(page.getByRole("region", { name: "LoRA Controls", exact: true })).toBeVisible();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await closeLoras(page);
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

test("Viewer deletion retains failed media and waits for confirmed removal", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "delete-study",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Delete Study",
    width: 1024,
    height: 1024,
  });
  let attempts = 0;
  let release!: () => void;
  const removed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gallery/delete-study", async (route) => {
    if (++attempts === 1)
      return route.fulfill({ status: 503, json: { error: "Storage is temporarily unavailable." } });
    await removed;
    return route.fallback();
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Open image: Delete Study", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
    await viewerAction(page, "Delete");
    const confirmation = page.getByRole("dialog", { name: "Delete Item", exact: true });
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      confirmation.getByText("1 item could not be deleted. You can try again."),
    ).toBeVisible();
    await expect(viewer).toBeVisible();
    expect(state.gallery).toHaveLength(1);
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    await expect(viewer).toBeVisible();
    release();
    await expect(viewer).toBeHidden();
    await expect(confirmation).toBeHidden();
    await expect(page.getByText("No Images", { exact: true })).toBeVisible();
    expect(state.gallery).toHaveLength(0);
  } finally {
    release();
  }
});
