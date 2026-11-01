import { expect, test, type Page } from "@playwright/test";
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
/** Upscale's ▾ › Upscale Options…, the form with quality, size and Face Detail. */
async function upscaleOptions(page: Page) {
  await viewerAction(page, "Upscale Options");
  await page.getByRole("menuitem", { name: "Upscale Options…", exact: true }).click();
}

test("Upscale queues Balanced in one click and its menu runs a quality or Face Detail directly", async ({
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
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toEqual({
    galleryItemId: source.id,
    quality: "balanced",
    target: 0,
    faceDetail: false,
  });
  await viewerAction(page, "Upscale Options");
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1]).toMatchObject({ quality: "high", faceDetail: false });
  await viewerAction(page, "Upscale Options");
  await page.getByRole("menuitem", { name: "Balanced with Face Detail", exact: true }).click();
  await expect.poll(() => submitted.length).toBe(3);
  expect(submitted[2]).toMatchObject({ quality: "balanced", faceDetail: true });
});

test("Upscale lists Face Detail and says why when the worker can't run it", async ({ page }) => {
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
  await viewerAction(page, "Upscale Options");
  await expect(
    page.getByRole("menuitem", { name: "Balanced with Face Detail", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Face Detail needs the worker’s face detector and Impact Pack nodes.", {
      exact: true,
    }),
  ).toBeVisible();
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
    await upscaleOptions(page);
    await page.getByRole("combobox", { name: "Upscale Quality", exact: true }).click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page.getByRole("combobox", { name: /^Upscale Size/ }).click();
    await page.getByRole("option", { name: "4K · 4096px Long Edge", exact: true }).click();
    await page.getByRole("switch", { name: /^Face Detail/ }).check();
    const queue = page.getByRole("button", { name: "Queue Upscale", exact: true });
    await expect(queue).toBeEnabled();
    await queue.click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toEqual({
      galleryItemId: source.id,
      quality: "high",
      target: 4096,
      faceDetail: true,
    });
    await expect(queue).toBeDisabled();
    await expect(
      page.getByRole("combobox", { name: "Upscale Quality", exact: true }),
    ).toBeDisabled();
    await queue.evaluate((button: HTMLButtonElement) => button.click());
    expect(submitted).toHaveLength(1);
    release();
    await expect(queue).toBeHidden();
    await upscaleOptions(page);
    await page.getByRole("combobox", { name: "Upscale Quality", exact: true }).click();
    await page.getByRole("option", { name: "Fast", exact: true }).click();
    await page.getByRole("combobox", { name: /^Upscale Size/ }).click();
    await page.getByRole("option", { name: "2K · 2048px Long Edge", exact: true }).click();
    await page.getByRole("switch", { name: /^Face Detail/ }).uncheck();
    await expect(queue).toBeEnabled();
    await queue.click();
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
  await upscaleOptions(page);
  await expect(page.getByRole("alert")).toContainText("The selected upscale worker is offline.");
  const queue = page.getByRole("button", { name: "Queue Upscale", exact: true });
  await expect(queue).toBeDisabled();
  offline = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Upscale Quality", exact: true })).toHaveValue(
    "Balanced",
  );
  await expect(page.getByRole("alert")).toContainText(
    "The upscale models are unavailable on this worker.",
  );
  await expect(page.getByRole("switch", { name: /^Face Detail/ })).toBeDisabled();
  await expect(queue).toBeDisabled();
  expect(submitted).toHaveLength(0);
});
