import { expect, test } from "@playwright/test";
import { fixtures, image, stamp, upscaleCapabilities, viewerAction } from "./fixtures";
import type { UpscaleRequest } from "../../shared/upscale";

const source = {
  id: "upscale-source",
  jobId: "source-job",
  url: image,
  thumbnailUrl: image,
  type: "image",
  status: "done",
  prompt: "Upscale Study",
  width: 1024,
  height: 1024,
  createdAt: stamp,
  settings: {
    model: "source.safetensors",
    textEncoder: "encoder.safetensors",
    vae: "vae.safetensors",
  },
};

test("Upscale's menu sets quality and Face Detail like Animate's settings and runs with them", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({ ...source });
  const submitted: UpscaleRequest[] = [];
  await page.route("**/api/upscale", (route) => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({
      json: { ok: true, jobId: `upscale-${submitted.length}`, revision: 1, plan: {} },
    });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Upscale Study", exact: true }).click();
  await viewerAction(page, "Upscale");
  // Quality is a segmented control at the top, Balanced until another is chosen.
  const quality = page.getByRole("radiogroup", { name: "Upscale Quality", exact: true });
  await expect(quality.getByRole("radio", { name: "Balanced", exact: true })).toBeChecked();
  const run = page.getByRole("menuitem", { name: "Upscale Image", exact: true });
  await run.click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toEqual({
    galleryItemId: source.id,
    quality: "balanced",
    target: 0,
    faceDetail: false,
  });
  // The settings keep the menu open and are remembered for the next run.
  await viewerAction(page, "Upscale");
  await quality.getByText("High", { exact: true }).click();
  const face = page.getByRole("menuitem", { name: "Face Detail", exact: true });
  await expect(face).toHaveAttribute("aria-checked", "false");
  await face.click();
  await expect(face).toHaveAttribute("aria-checked", "true");
  await run.click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1]).toMatchObject({ quality: "high", faceDetail: true });
  await viewerAction(page, "Upscale");
  await expect(quality.getByRole("radio", { name: "High", exact: true })).toBeChecked();
  await expect(face).toHaveAttribute("aria-checked", "true");
});

test("Upscale lists Face Detail, disabled and off when the worker can't run it", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({ ...source });
  await page.route("**/api/upscale/status*", (route) =>
    route.fulfill({
      json: {
        ...upscaleCapabilities,
        quality: "balanced",
        faceDetail: { nodesInstalled: true, missingNodes: [], detectors: [], samModels: [] },
      },
    }),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Upscale Study", exact: true }).click();
  await viewerAction(page, "Upscale");
  const face = page.getByRole("menuitem", { name: "Face Detail", exact: true });
  await expect(face).toBeDisabled();
  await expect(face).toHaveAttribute("aria-checked", "false");
});

test("Upscale quality, 2K/4K size and face detail reach one submission while pending", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({ ...source });
  const submitted: UpscaleRequest[] = [],
    checkedQualities: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/upscale/status*", (route) => {
    const quality = new URL(route.request().url()).searchParams.get("quality") || "balanced";
    checkedQualities.push(quality);
    return route.fulfill({ json: { ...upscaleCapabilities, quality } });
  });
  await page.route("**/api/upscale", async (route) => {
    const body: UpscaleRequest = route.request().postDataJSON();
    submitted.push(body);
    if (submitted.length === 1) await pending;
    const size = body.target || 2048;
    await route.fulfill({
      json: {
        ok: true,
        jobId: `upscale-${submitted.length}`,
        revision: 1,
        plan: {
          quality: body.quality,
          sourceWidth: 1024,
          sourceHeight: 1024,
          estimatedWidth: size,
          estimatedHeight: size,
          scale: size / 1024,
        },
      },
    });
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Open image: Upscale Study", exact: true }).click();
    // Every setting is in the menu: quality, size and Face Detail.
    await viewerAction(page, "Upscale");
    const quality = page.getByRole("radiogroup", { name: "Upscale Quality", exact: true });
    const size = page.getByRole("radiogroup", { name: "Upscale Size", exact: true });
    const face = page.getByRole("menuitem", { name: "Face Detail", exact: true });
    const run = page.getByRole("menuitem", { name: "Upscale Image", exact: true });
    await expect(size.getByRole("radio", { name: "Auto", exact: true })).toBeChecked();
    await quality.getByText("High", { exact: true }).click();
    await size.getByText("4K", { exact: true }).click();
    await face.click();
    await run.click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toEqual({
      galleryItemId: source.id,
      quality: "high",
      target: 4096,
      faceDetail: true,
    });
    // One run at a time: Upscale waits for the first.
    const upscale = page
      .getByRole("dialog", { name: "Generation", exact: true })
      .getByRole("button", { name: "Upscale", exact: true });
    await expect(upscale).toBeDisabled();
    release();
    await expect(upscale).toBeEnabled();
    await upscale.click();
    // The settings were remembered.
    await expect(quality.getByRole("radio", { name: "High", exact: true })).toBeChecked();
    await expect(size.getByRole("radio", { name: "4K", exact: true })).toBeChecked();
    await quality.getByText("Fast", { exact: true }).click();
    await size.getByText("2K", { exact: true }).click();
    await face.click();
    await run.click();
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toEqual({
      galleryItemId: source.id,
      quality: "fast",
      target: 2048,
      faceDetail: false,
    });
    expect(checkedQualities).toEqual(expect.arrayContaining(["high", "fast"]));
  } finally {
    release();
  }
});

test("Offline workers and unavailable upscale models explain why submission is disabled", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({ ...source });
  let offline = true;
  const submitted: unknown[] = [];
  await page.route("**/api/upscale/status*", (route) =>
    offline
      ? route.fulfill({ status: 503, json: { error: "The selected upscale worker is offline." } })
      : route.fulfill({
          json: {
            ...upscaleCapabilities,
            quality: "balanced",
            ready: false,
            missingModels: ["dit"],
            faceDetail: {
              nodesInstalled: false,
              missingNodes: ["FaceDetailer"],
              detectors: [],
              samModels: [],
            },
          },
        }),
  );
  await page.route("**/api/upscale", (route) => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Upscale Study", exact: true }).click();
  await viewerAction(page, "Upscale");
  // The menu says why, above its settings, and offers to check again.
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("The selected upscale worker is offline.");
  await expect(page.getByRole("menuitem", { name: "Upscale Image", exact: true })).toHaveCount(0);
  offline = false;
  await page.getByRole("menuitem", { name: "Check Again", exact: true }).click();
  await expect(menu).toContainText("This worker has no upscale models.");
  await expect(page.getByRole("menuitem", { name: "Face Detail", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Upscale Image", exact: true })).toBeDisabled();
  expect(submitted).toHaveLength(0);
});
