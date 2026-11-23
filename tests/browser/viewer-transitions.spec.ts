import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { fixtures, showViewerThumbnails, stamp, viewerAction } from "./fixtures";

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
    await page.getByRole("button", { name: "Open image: Blue Portrait", exact: true }).click();
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
      // With an upscale, Upscale's first option shows it.
      await viewerAction(page, "Upscale");
      await page.getByRole("menuitem", { name: "Show Upscale", exact: true }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
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
      await expect(viewer.getByRole("alert")).toHaveText("This version couldn't be loaded.");
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
  await page.getByRole("button", { name: "Open image: Small Image", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "A small image", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await zoom.getAttribute("data-zoom-scale"))).toBe(1);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await page.getByRole("button", { name: "Open image: Large Image", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "A large image", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await zoom.getAttribute("data-zoom-scale"))).toBeLessThan(1);
});

test("Gallery Fit keeps both wide and tall media between the header and dock", async ({ page }) => {
  const state = await fixtures(page);
  for (const [shape, width, height, model] of [
    ["wide", 2048, 768, "Wide Rendering Profile"],
    ["tall", 800, 3072, "Tall Rendering Profile"],
  ] as const) {
    const url = `/test-media/${shape}-badge.png`;
    const png = await sharp({ create: { width, height, channels: 3, background: "#254866" } })
      .png()
      .toBuffer();
    state.gallery.push({
      id: shape,
      type: "image",
      status: "done",
      prompt: `A ${shape} scene`,
      url,
      width,
      height,
      createdAt: stamp,
      settings: { profileName: model },
      resultSet: { id: "fitted", title: "Fitted", index: shape === "wide" ? 0 : 1 },
    });
    await page.route(`**${url}`, (route) => route.fulfill({ contentType: "image/png", body: png }));
  }
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Wide Scene", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const header = viewer.getByRole("group", { name: "Viewer Header", exact: true });
  const actions = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  const close = header.getByRole("button", { name: "Close Generation", exact: true });
  for (const [index, shape, model] of [
    [1, "wide", "Wide Rendering Profile"],
    [2, "tall", "Tall Rendering Profile"],
  ] as const) {
    if (index === 2) await page.keyboard.press("ArrowRight");
    const picture = viewer.getByRole("img", { name: `A ${shape} scene`, exact: true });
    const position = header.getByRole("status", { name: "Current Result", exact: true });
    const badge = header.getByText(model, { exact: true });
    await expect(picture).toBeVisible();
    await expect(position).toHaveText(new RegExp(`${index} / 2$`));
    await expect(badge).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = (await picture.boundingBox())!;
        const stage = (await viewer.locator("[data-zoom-mode]").boundingBox())!;
        const heading = (await header.boundingBox())!;
        const dock = (await actions.boundingBox())!;
        const label = (await badge.boundingBox())!;
        const dismiss = (await close.boundingBox())!;
        return {
          centred: Math.abs(2 * (bounds.y - stage.y) + bounds.height - stage.height) <= 2,
          fitted:
            shape === "wide"
              ? Math.abs(bounds.width - stage.width) <= 2
              : Math.abs(bounds.height - stage.height) <= 2,
          headerClear: bounds.y >= heading.y + heading.height - 1,
          dockClear: bounds.y + bounds.height <= dock.y + 1,
          titleFits: label.x + label.width < dismiss.x,
        };
      })
      .toEqual({
        centred: true,
        fitted: true,
        headerClear: true,
        dockClear: true,
        titleFits: true,
      });
    if (shape === "tall") {
      const standard = (await picture.boundingBox())!;
      const thumbnails = viewer.getByRole("list", { name: "Set: Fitted", exact: true });
      const zoom = viewer.getByRole("group", { name: "Image Zoom", exact: true });
      await expect(actions).toBeVisible();
      await expect(thumbnails).toBeHidden();
      await page.keyboard.press("Digit0");
      await expect
        .poll(async () => {
          const controls = await zoom.boundingBox();
          const dock = await actions.boundingBox();
          return !!controls && !!dock && controls.y + controls.height <= dock.y;
        })
        .toBe(true);
      await showViewerThumbnails(viewer);
      await expect(thumbnails).toBeVisible();
      await page.keyboard.press("Digit0");
      await expect
        .poll(async () => {
          const controls = await zoom.boundingBox();
          const dock = await thumbnails.boundingBox();
          const bounds = await picture.boundingBox();
          return (
            !!controls &&
            !!dock &&
            !!bounds &&
            controls.y + controls.height <= dock.y &&
            bounds.y + bounds.height <= dock.y + 1 &&
            bounds.height < standard.height
          );
        })
        .toBe(true);
      await page.keyboard.press("c");
      await expect(header).toBeHidden();
      await expect(actions).toBeHidden();
      await expect(thumbnails).toBeHidden();
      await expect
        .poll(async () => {
          const bounds = await picture.boundingBox();
          return (
            !!bounds &&
            bounds.height > standard.height &&
            bounds.y + bounds.height > standard.y + standard.height
          );
        })
        .toBe(true);
    }
  }
});

test("The viewer shows a server picture's display copy, and its original once zoom passes the copy", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "large",
    jobId: "job-large",
    type: "image",
    status: "done",
    prompt: "A large image",
    url: "/comfy/view?filename=large.png&subfolder=&type=output",
    thumbnailUrl: "/comfy/thumb?filename=large.png&subfolder=&type=output",
    width: 4096,
    height: 4096,
    createdAt: stamp,
  });
  const copy = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#46a3ff" },
  })
    .webp()
    .toBuffer();
  const full = await sharp({
    create: { width: 4096, height: 4096, channels: 3, background: "#46a3ff" },
  })
    .png()
    .toBuffer();
  const originals: string[] = [];
  await page.route("**/comfy/thumb*", (route) =>
    route.fulfill({ contentType: "image/webp", body: copy }),
  );
  await page.route("**/comfy/view*", async (route) => {
    // Details reads the original's file size from a one-byte range request.
    if (!(await route.request().headerValue("range"))) originals.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: full });
  });
  await page.goto("/images");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await page.getByRole("button", { name: "Open image: Large Image", exact: true }).click();
  const image = viewer.getByRole("img", { name: "A large image", exact: true });
  await expect(image).toHaveAttribute(
    "src",
    "/comfy/thumb?filename=large.png&subfolder=&type=output&size=display",
  );
  // The copy stands in at the original's size, so Actual Size is the original's pixels.
  await expect(image).toHaveAttribute("width", "4096");
  expect(originals).toEqual([]);
  const zoom = viewer.getByRole("button", { name: "Change Image Zoom", exact: true });
  await zoom.press("Enter");
  await zoom.press("Enter");
  await expect(
    viewer.getByRole("button", { name: "Zoom: Actual Size", exact: true }),
  ).toBeVisible();
  await expect(image).toHaveAttribute(
    "src",
    "/comfy/view?filename=large.png&subfolder=&type=output",
  );
});
