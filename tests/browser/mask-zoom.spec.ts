import { expect, test } from "@playwright/test";
import { create, fixtures } from "./fixtures";

test("Mask zoom and Hand pan preserve painting history and saved masks", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await create(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload Reference", exact: true }).click();
  await (
    await upload
  ).setFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Paint Mask", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paint the Area to Refine", exact: true });
  const canvas = dialog.locator('canvas[aria-label="Mask Painting"]');
  const pixels = () =>
    canvas.evaluate((node: HTMLCanvasElement) => {
      const data = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
      let painted = 0,
        hash = 2166136261;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index]) painted++;
        hash = Math.imul(hash ^ data[index], 16777619);
      }
      return { painted, hash };
    });
  const viewport = dialog.locator('[aria-label="Mask Viewport"]');
  await expect
    .poll(async () => {
      const image = await canvas.boundingBox(),
        frame = await viewport.boundingBox();
      return image && frame
        ? image.width <= frame.width + 1 && image.height <= frame.height + 1
        : false;
    })
    .toBe(true);
  await canvas.click();
  await expect.poll(async () => (await pixels()).painted).toBeGreaterThan(0);
  const painted = await pixels();
  const originalBounds = (await canvas.boundingBox())!;
  await dialog.getByRole("button", { name: "Zoom Mask In", exact: true }).click();
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeGreaterThan(originalBounds.width);
  await dialog.getByText("Hand", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Hand", exact: true })).toBeChecked();
  const frame = (await viewport.boundingBox())!;
  const x = frame.x + frame.width / 2,
    y = frame.y + frame.height / 2;
  const beforePan = (await canvas.boundingBox())!;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y + 25, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const after = (await canvas.boundingBox())!;
      return Math.abs(after.x - beforePan.x) + Math.abs(after.y - beforePan.y);
    })
    .toBeGreaterThan(5);
  expect(await pixels()).toEqual(painted);
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await pixels()).painted).toBe(0);
  await expect(dialog.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(pixels).toEqual(painted);

  if (testInfo.project.use.browserName !== "webkit") {
    await dialog.getByText("Paint", { exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Paint", exact: true })).toBeChecked();
    const beforePinch = (await canvas.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    try {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: x - 30, y }],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: x - 30, y },
          { x: x + 30, y },
        ],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: x - 60, y },
          { x: x + 60, y },
        ],
      });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await touch.detach();
    }
    await expect
      .poll(async () => (await canvas.boundingBox())!.width)
      .toBeGreaterThan(beforePinch.width);
    expect(await pixels()).toEqual(painted);
    await dialog.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await pixels()).painted).toBe(0);
    await expect(dialog.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Redo", exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Fit Mask", exact: true }).click();
  await expect
    .poll(async () => {
      const image = (await canvas.boundingBox())!,
        bounds = (await viewport.boundingBox())!;
      return (
        image.x >= bounds.x - 1 &&
        image.y >= bounds.y - 1 &&
        image.x + image.width <= bounds.x + bounds.width + 1 &&
        image.y + image.height <= bounds.y + bounds.height + 1
      );
    })
    .toBe(true);
  await dialog.getByRole("button", { name: "Use Mask", exact: true }).click();
  await page.getByRole("button", { name: "Edit Mask", exact: true }).click();
  await expect.poll(pixels).toEqual(painted);
});
