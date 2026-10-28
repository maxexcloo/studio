import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { compareUpscale, fixtures, image, stamp } from "./fixtures";

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#46a3ff" } })
    .png()
    .toBuffer();
const original = await png(800, 1200);
const upscale = await png(1600, 2400);

test("Comparison zoom keeps both layers aligned while panning and using its keyboard slider", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "comparison-zoom",
    jobId: "comparison-source",
    type: "image",
    status: "done",
    prompt: "Portrait comparison",
    url: "/test-media/compare-original.png",
    thumbnailUrl: "/test-media/compare-original.png",
    width: 800,
    height: 1200,
    createdAt: stamp,
    upscale: { url: "/test-media/compare-upscale.png", status: "done", width: 1600, height: 2400 },
  });
  await page.route("**/test-media/compare-original.png", (route) =>
    route.fulfill({ contentType: "image/png", body: original }),
  );
  await page.route("**/test-media/compare-upscale.png", (route) =>
    route.fulfill({ contentType: "image/png", body: upscale }),
  );
  await page.goto("/images");
  const opener = page.getByRole("button", { name: "Open image: Portrait comparison", exact: true });
  await opener.click();
  await compareUpscale(page);
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  const viewport = dialog.locator('[aria-label="Comparison Viewport"]');
  const picture = dialog.getByRole("button", { name: "Change Comparison Zoom", exact: true });
  const upscaled = dialog.getByRole("img", { name: "Upscaled Result", exact: true });
  const source = dialog.getByRole("img", { name: "Original Result", exact: true });
  await expect
    .poll(() => upscaled.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(1600);
  await expect.poll(() => source.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(800);
  const fitted = async () => {
    const image = (await upscaled.boundingBox())!,
      frame = (await viewport.boundingBox())!;
    return (
      image.width > 0 &&
      image.height > 0 &&
      image.x >= frame.x - 1 &&
      image.y >= frame.y - 1 &&
      image.x + image.width <= frame.x + frame.width + 1 &&
      image.y + image.height <= frame.y + frame.height + 1
    );
  };
  await expect.poll(fitted).toBe(true);
  const fitWidth = (await upscaled.boundingBox())!.width;
  await picture.focus();
  await page.keyboard.press("Equal");
  await expect.poll(async () => (await upscaled.boundingBox())!.width).toBeGreaterThan(fitWidth);
  await expect(viewport).toHaveAttribute("data-zoom-mode", "Custom");
  const frame = (await viewport.boundingBox())!;
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  const beforeWheel = (await upscaled.boundingBox())!.width;
  if (testInfo.project.use.browserName === "webkit")
    await dialog.getByRole("button", { name: "Zoom In", exact: true }).click();
  else await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await upscaled.boundingBox())!.width).toBeGreaterThan(beforeWheel);
  const beforePan = (await upscaled.boundingBox())!;
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width / 2 + 40, frame.y + frame.height / 2 + 30, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const after = (await upscaled.boundingBox())!;
      return Math.abs(after.x - beforePan.x) + Math.abs(after.y - beforePan.y);
    })
    .toBeGreaterThan(5);
  await expect(dialog).toBeVisible();
  await expect(viewport).toHaveAttribute("data-zoom-mode", "Custom");
  await expect
    .poll(async () => {
      const a = (await source.boundingBox())!,
        b = (await upscaled.boundingBox())!;
      return Math.max(
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs(a.width - b.width),
        Math.abs(a.height - b.height),
      );
    })
    .toBeLessThan(1);
  const slider = dialog.getByRole("slider", { name: "Comparison Position", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "51");
  await expect(viewport).toHaveAttribute("data-zoom-mode", "Custom");
  await expect(dialog).toBeVisible();
  await picture.focus();
  await page.keyboard.press("Digit0");
  await expect(viewport).toHaveAttribute("data-zoom-mode", "Fit");
  await expect.poll(fitted).toBe(true);
  const bounds = (await upscaled.boundingBox())!,
    area = (await viewport.boundingBox())!;
  const blank =
    bounds.x - area.x > 4
      ? { x: area.x + 2, y: area.y + area.height / 2 }
      : // Clear of the top-centre zoom controls' near-miss margin.
        { x: area.x + area.width / 4, y: area.y + 2 };
  expect(
    blank.x < bounds.x ||
      blank.x > bounds.x + bounds.width ||
      blank.y < bounds.y ||
      blank.y > bounds.y + bounds.height,
  ).toBe(true);
  await page.mouse.click(blank.x, blank.y);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
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
  await compareUpscale(page);
  const slider = page.getByRole("slider", { name: "Comparison Position", exact: true });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "51");
  await expect(page.getByRole("img", { name: "Original Result", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Upscaled Result", exact: true })).toBeVisible();
});
