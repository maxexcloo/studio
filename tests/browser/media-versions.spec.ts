import { expect, test } from "@playwright/test";
import { fixtures, image, stamp, viewerAction } from "./fixtures";

for (const kind of ["image", "video"] as const) {
  test(`${kind} version selection persists and downloads the displayed format`, async ({
    page,
  }) => {
    const state = await fixtures(page);
    // Native sharing replaces the row's Download on phones; this checks the downloaded version.
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined }),
    );
    const originalExtension = kind === "image" ? "webp" : "webm";
    const upscaleExtension = kind === "image" ? "png" : "mp4";
    const originalUrl = `/test-media/original.${originalExtension}`;
    const upscaleUrl = `/test-media/upscaled.${upscaleExtension}`;
    const prompt = `Version ${kind}`;
    const item = {
      id: `version-${kind}`,
      jobId: `source-${kind}`,
      type: kind,
      status: "done",
      prompt,
      url: originalUrl,
      thumbnailUrl: "/test-media/original-thumbnail.svg",
      filename: `source.${originalExtension}`,
      width: 800,
      height: 1200,
      createdAt: stamp,
      upscaleActive: false,
      upscale: {
        url: upscaleUrl,
        thumbnailUrl: "/test-media/upscale-thumbnail.svg",
        status: "done",
        width: 2048,
        height: 3072,
      },
    };
    state.gallery.push(item);
    await page.route("**/test-media/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: decodeURIComponent(image.slice(image.indexOf(",") + 1)),
      }),
    );
    const toggles: { galleryItemId: string; active: boolean }[] = [];
    await page.route("**/api/upscale/toggle", (route) => {
      const body = route.request().postDataJSON();
      toggles.push(body);
      item.upscaleActive = body.active;
      return route.fulfill({
        json: { ok: true, upscaleActive: item.upscaleActive, revision: toggles.length },
      });
    });
    await page.goto(kind === "image" ? "/images" : "/video");
    await page.getByRole("button", { name: `Open ${kind}: ${prompt}`, exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
    const media =
      kind === "image"
        ? viewer.getByRole("img", { name: prompt, exact: true })
        : viewer.locator("video");
    const download = viewer.getByRole("link", { name: "Download", exact: true });
    await expect(media).toHaveAttribute("src", originalUrl);
    await expect(download).toHaveAttribute("href", originalUrl);
    await expect(download).toHaveAttribute("download", `source.${originalExtension}`);
    await viewerAction(page, "Upscale");
    const version = page.getByRole("switch", { name: "Show Upscale", exact: true });
    await expect(version).not.toBeChecked();
    await version.click();
    await expect(version).toBeChecked();
    await expect.poll(() => toggles.length).toBe(1);
    expect(toggles[0]).toEqual({ galleryItemId: item.id, active: true });
    await expect(media).toHaveAttribute("src", upscaleUrl);
    await expect(download).toHaveAttribute("href", upscaleUrl);
    await expect(download).toHaveAttribute("download", `source.${upscaleExtension}`);
    // Upscale's options compare an image's upscale with its original.
    const compare = page.getByRole("switch", { name: "Compare Upscale", exact: true });
    if (kind === "image") await expect(compare).toBeVisible();
    else await expect(compare).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: `Open ${kind}: ${prompt}`, exact: true }).click();
    await viewerAction(page, "Upscale");
    await expect(version).toBeChecked();
    await expect(media).toHaveAttribute("src", upscaleUrl);
    await expect(download).toHaveAttribute("href", upscaleUrl);
    await version.click();
    await expect(version).not.toBeChecked();
    await expect.poll(() => toggles.length).toBe(2);
    expect(toggles[1]).toEqual({ galleryItemId: item.id, active: false });
    await expect(media).toHaveAttribute("src", originalUrl);
    await expect(download).toHaveAttribute("href", originalUrl);
    await expect(download).toHaveAttribute("download", `source.${originalExtension}`);
    await page.reload();
    await page.getByRole("button", { name: `Open ${kind}: ${prompt}`, exact: true }).click();
    await viewerAction(page, "Upscale");
    await expect(version).not.toBeChecked();
    await expect(media).toHaveAttribute("src", originalUrl);
  });
}
