import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";

import {
  expandComposer,
  finishTyping,
  fixtures,
  image,
  pressGenerate,
  serveRetries,
  stamp,
  viewerAction,
} from "./fixtures";

const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: "#46a3ff" } })
  .png()
  .toBuffer();

test("Prompt paste attaches an owned reference before submission", async ({ page }) => {
  const state = await fixtures(page);
  let uploads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/reference-assets/upload", async (route) => {
    const number = ++uploads;
    if (number === 1) await held;
    await route.fulfill({
      json: {
        asset: {
          id: `upload-${number}`,
          name: `Reference ${number}`,
          type: "image",
          source: "upload",
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
        },
      },
    });
  });
  try {
    await page.goto("/images");
    await expandComposer(page);
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Use this pasted image");
    const files = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array([1, 2, 3])], "capture.png", { type: "image/png" }),
      );
      return transfer;
    });
    await page
      .getByRole("textbox", { name: "Prompt", exact: true })
      .evaluate(
        (element, clipboardData) =>
          element.dispatchEvent(
            new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
          ),
        files,
      );
    await expect.poll(() => uploads).toBe(1);
    await finishTyping(page);
    await expect(page.getByRole("button", { name: "Generate Image", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
    await pressGenerate(page);
    await expect.poll(() => state.jobs.length).toBe(1);
    expect(state.jobs[0].input).toMatchObject({
      prompt: "Use this pasted image",
      referenceAssets: [{ assetId: "upload-1", slot: "image" }],
    });
  } finally {
    release();
  }
});

test("Share downloads the image, and phones that share natively also share it", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ files }: { files: File[] }) => {
        (window as any).sharedMedia = files.map((file) => ({ name: file.name, type: file.type }));
      },
    });
  });
  await page.route("**/api/fixture-media.png*", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  state.gallery.push({
    id: "share-image",
    type: "image",
    status: "done",
    prompt: "Transfer Study",
    url: "/api/fixture-media.png",
    thumbnailUrl: "/api/fixture-media.png",
    width: 24,
    height: 16,
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Transfer Study", exact: true }).click();
  await viewerAction(page, "Share");
  const download = page.getByRole("menuitem", { name: "Download", exact: true });
  await expect(download).toHaveAttribute("href", "/api/fixture-media.png");
  const share = page.getByRole("menuitem", { name: "Share", exact: true });
  if (!testInfo.project.use.isMobile) return await expect(share).toHaveCount(0);
  await share.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).sharedMedia?.[0]?.type))
    .toBe("image/png");
});

async function failedGeneration(page: Page) {
  const state = await fixtures(page);
  const job = {
    id: "failed-job",
    sessionId: "failed-session",
    status: "failed",
    reason: "Worker lost connection",
    input: { kind: "image", profileId: "image:test", prompt: "Failed Study" },
    operation: "image",
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  state.jobs.push(job);
  const item = {
    id: "failed-item",
    jobId: job.id,
    type: "image",
    status: "failed",
    url: "",
    prompt: "Failed Study",
    settings: job.input,
  };
  state.gallery.push(item);
  return { state, job, item };
}

test("Retrying a failed entry in the viewer replaces it with the new run", async ({ page }) => {
  const { state, job, item } = await failedGeneration(page);
  let retries = 0;
  // Like the durable queue, a retry admits a new job whose pending item joins the gallery.
  await serveRetries(page, state, ([id]) => {
    retries++;
    const retried = { ...job, id: "retried-job", status: "running", reason: "Generation resumed" };
    state.jobs.push(retried);
    state.gallery.unshift({
      ...item,
      id: "retried-item",
      jobId: retried.id,
      status: "running",
    });
    return [{ id, replacement: retried.id }];
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Failed Study", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const status = viewer.getByRole("status", { name: "Generation Status", exact: true });
  await expect(status).toContainText("Generation Failed");
  await expect(status).toContainText("Worker lost connection");
  await expect(viewer.getByRole("button", { name: "Retry", exact: true })).toHaveCount(1);
  await expect(viewer.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Generation Details", exact: true }),
  ).toBeVisible();
  await status.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(status).toContainText("Generation resumed");
  expect(retries).toBe(1);
  await expect(status.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(state.gallery.map((item) => item.id)).toEqual(["retried-item"]);
});

test("A cleared failure in the viewer keeps its recorded error and Edit", async ({ page }) => {
  const { state, job } = await failedGeneration(page);
  state.jobs[0].cleared = true;
  state.gallery[0].error = job.reason;
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Failed Study", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const status = viewer.getByRole("status", { name: "Generation Status", exact: true });
  await expect(status).toContainText(job.reason);
  await expect(status).toContainText("Use Edit to review the prompt and settings.");
  await expect(viewer.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
});

test("A delayed Retry finishes on its source after navigating to another image", async ({
  page,
}, testInfo) => {
  const { state, job, item } = await failedGeneration(page);
  job.reason = "The worker lost its connection while saving this result. ".repeat(75);
  const neighbour = {
    id: "neighbour",
    type: "image",
    status: "done",
    url: image,
    prompt: "A mountain lake",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  };
  state.gallery.push(neighbour);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await serveRetries(page, state, async ([id]) => {
    expect(id).toBe(job.id);
    await held;
    const retried = { ...job, id: "retried-job", status: "running", reason: "Generation resumed" };
    state.jobs.push(retried);
    state.gallery.push({ ...item, id: "retried-item", jobId: retried.id, status: "running" });
    return [{ id, replacement: retried.id }];
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Open image: Failed Study", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
    const status = viewer.getByRole("status", { name: "Generation Status", exact: true });
    const retry = status.getByRole("button", { name: "Retry", exact: true });
    const requested = page.waitForRequest("**/api/queue/retry");
    await retry.click();
    await requested;
    await expect(retry).toBeDisabled();

    const { isMobile, browserName } = testInfo.project.use;
    if (!isMobile) {
      await viewer.getByRole("button", { name: "Next Generation", exact: true }).click();
    } else {
      const box = (await status.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (browserName === "webkit") {
        await status.evaluate(
          (element, { x, y }) => {
            for (const [type, clientX] of [
              ["pointerdown", x],
              ["pointermove", x - 150],
              ["pointerup", x - 150],
            ] as const)
              element.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  pointerId: 7,
                  pointerType: "touch",
                  isPrimary: true,
                  clientX,
                  clientY: y,
                }),
              );
          },
          { x, y },
        );
      } else {
        const touch = await page.context().newCDPSession(page);
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x - 150, y }],
        });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
    }
    const picture = viewer.getByRole("img", { name: neighbour.prompt, exact: true });
    await expect(picture).toBeVisible();
    await expect(retry).toHaveCount(0);
    await viewerAction(page, "Like");
    const like = viewer.getByRole("button", { name: "Like", exact: true });
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await expect(like).toBeEnabled();

    const refreshed = page.waitForResponse(async (response) => {
      if (new URL(response.url()).pathname !== "/api/gallery" || !response.ok()) return false;
      const { items } = await response.json();
      return (
        items.some(({ id }: { id: string }) => id === "retried-item") &&
        !items.some(({ id }: { id: string }) => id === item.id)
      );
    });
    release();
    await refreshed;
    await expect(picture).toBeVisible();
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await expect(viewer.getByText("Generation resumed", { exact: true })).toHaveCount(0);
    await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open image: Mountain Lake", exact: true }),
    ).toBeFocused();
  } finally {
    release();
  }
});
