import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { fixtures, stamp } from "./fixtures";

const original = await sharp({
  create: { width: 800, height: 1200, channels: 3, background: "#46a3ff" },
})
  .png()
  .toBuffer();
const upscaled = await sharp({
  create: { width: 2048, height: 3072, channels: 3, background: "#46a3ff" },
})
  .png()
  .toBuffer();

for (const failFirst of [false, true]) {
  test(`Show Upscale keeps decoded image content visible ${failFirst ? "through failure and retry" : "until the replacement loads"}`, async ({
    page,
  }) => {
    const state = await fixtures(page);
    const originalUrl = "/test-media/transition-original.png";
    const upscaleUrl = "/test-media/transition-upscaled.png";
    const item = {
      id: "transition-image",
      jobId: "transition-source",
      type: "image",
      status: "done",
      prompt: "A blue portrait",
      url: originalUrl,
      thumbnailUrl: originalUrl,
      width: 800,
      height: 1200,
      createdAt: stamp,
      upscaleActive: false,
      upscale: { url: upscaleUrl, status: "done", width: 2048, height: 3072 },
    };
    state.gallery.push(item);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    let attempts = 0;
    await page.route("**/test-media/transition-original.png", (route) =>
      route.fulfill({ contentType: "image/png", body: original }),
    );
    await page.route("**/test-media/transition-upscaled.png", async (route) => {
      // Details reads the file size with a one-byte range request; only image loads count.
      if (route.request().headers().range)
        return route.fulfill({
          status: 206,
          headers: { "content-range": "bytes 0-0/1" },
          body: "",
        });
      requested = true;
      const attempt = ++attempts;
      await pending;
      if (failFirst && attempt === 1) return route.fulfill({ status: 503 });
      await route.fulfill({ contentType: "image/png", body: upscaled });
    });
    const toggles: unknown[] = [];
    await page.route("**/api/upscale/toggle", (route) => {
      const body = route.request().postDataJSON();
      toggles.push(body);
      item.upscaleActive = body.active;
      return route.fulfill({ json: { ok: true, upscaleActive: body.active, revision: 1 } });
    });
    await page.goto("/images");
    await page.getByRole("button", { name: "Open image: A blue portrait", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
    const image = viewer.getByRole("img", { name: item.prompt, exact: true });
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(800);
    await image.evaluate((node: HTMLImageElement) => node.decode());
    const originalImage = await image.elementHandle();
    const picture = await viewer
      .getByRole("button", { name: "Change Image Zoom", exact: true })
      .elementHandle();
    expect(originalImage).not.toBeNull();
    expect(picture).not.toBeNull();
    try {
      // With an upscale, Upscale's click shows it.
      const version = viewer.getByRole("button", { name: "Upscale", exact: true });
      await version.click();
      await expect(version).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => requested).toBe(true);
      expect(toggles).toEqual([{ galleryItemId: item.id, active: true }]);
      await expect(image).toHaveAttribute("src", originalUrl);
      await expect(image).toBeVisible();
      expect(await image.evaluate((node, previous) => node === previous, originalImage)).toBe(true);
      expect(
        await picture!.evaluate(
          (node, previous) => node.isConnected && node.contains(previous),
          originalImage,
        ),
      ).toBe(true);
      expect(
        await originalImage!.evaluate((node: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.drawImage(node, 0, 0, 1, 1);
          return {
            width: node.naturalWidth,
            height: node.naturalHeight,
            pixel: [...context.getImageData(0, 0, 1, 1).data],
          };
        }),
      ).toEqual({ width: 800, height: 1200, pixel: [70, 163, 255, 255] });
    } finally {
      release();
    }
    if (failFirst) {
      await expect(viewer.getByRole("alert")).toHaveText(
        "The selected version could not be loaded. The previous image is still shown.",
      );
      await expect(image).toHaveAttribute("src", originalUrl);
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
        .toBe(800);
      await viewer.getByRole("button", { name: "Retry Selected Version", exact: true }).click();
    }
    await expect(image).toHaveAttribute("src", upscaleUrl);
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(2048);
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalHeight))
      .toBe(3072);
    await image.evaluate((node: HTMLImageElement) => node.decode());
    await expect(image).toBeVisible();
    expect(await image.evaluate((node, previous) => node === previous, originalImage)).toBe(true);
    await expect
      .poll(() =>
        image.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          const stage = node.closest("[data-zoom-mode]")!;
          const frame = stage.getBoundingClientRect();
          return {
            mode: stage.getAttribute("data-zoom-mode"),
            contained:
              bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.left >= frame.left - 1 &&
              bounds.top >= frame.top - 1 &&
              bounds.right <= frame.right + 1 &&
              bounds.bottom <= frame.bottom + 1,
          };
        }),
      )
      .toEqual({ mode: "Fit", contained: true });
  });
}

test("The viewer fits a large image but never enlarges a small one beyond its actual size", async ({
  page,
}) => {
  const state = await fixtures(page);
  const small = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#46a3ff" },
  })
    .png()
    .toBuffer();
  for (const [id, url, width, height] of [
    ["small", "/test-media/small.png", 120, 80],
    ["large", "/test-media/large.png", 2048, 3072],
  ] as const)
    state.gallery.push({
      id,
      jobId: `job-${id}`,
      type: "image",
      status: "done",
      prompt: `A ${id} image`,
      url,
      thumbnailUrl: url,
      width,
      height,
      createdAt: stamp,
    });
  await page.route("**/test-media/small.png", (route) =>
    route.fulfill({ contentType: "image/png", body: small }),
  );
  await page.route("**/test-media/large.png", (route) =>
    route.fulfill({ contentType: "image/png", body: upscaled }),
  );
  await page.goto("/images");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const zoom = viewer.locator("[data-zoom-mode]");
  await page.getByRole("button", { name: "Open image: A small image", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "A small image", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await zoom.getAttribute("data-zoom-scale"))).toBe(1);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await page.getByRole("button", { name: "Open image: A large image", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "A large image", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await zoom.getAttribute("data-zoom-scale"))).toBeLessThan(1);
});
