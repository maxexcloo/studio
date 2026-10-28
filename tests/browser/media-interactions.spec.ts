import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { fixtures, image, stamp } from "./fixtures";

const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: "#46a3ff" } })
  .png()
  .toBuffer();

test("Prompt paste and Chat file drop attach owned references before submission", async ({
  page,
}) => {
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
    await expect(page.getByRole("button", { name: "Generate Image", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Generate Image", exact: true }).click();
    await expect.poll(() => state.jobs.length).toBe(1);
    expect(state.jobs[0].input.referenceAssets).toEqual([{ assetId: "upload-1", slot: "image" }]);
    await page.getByRole("link", { name: "Chat", exact: true }).first().click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Discuss the dropped reference");
    await page.locator("[data-composer-dock]").dispatchEvent("dragover", { dataTransfer: files });
    await page.locator("[data-composer-dock]").dispatchEvent("drop", { dataTransfer: files });
    await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send Message", exact: true }).click();
    await expect.poll(() => state.chatRequests.length).toBe(1);
    expect(state.chatRequests[0].references).toEqual(["upload-2"]);
  } finally {
    release();
  }
});

test("Phones that share natively share the image where desktop downloads it", async ({
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
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const download = viewer.getByRole("link", { name: "Download", exact: true });
  if (!testInfo.project.use.isMobile) {
    await expect(download).toHaveAttribute("href", "/api/fixture-media.png");
    await expect(viewer.getByRole("button", { name: /^Share/ })).toHaveCount(0);
    return;
  }
  await expect(download).toHaveCount(0);
  await viewer.getByRole("button", { name: "Share Image", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).sharedMedia?.[0]?.type))
    .toBe("image/png");
});

test("Retrying a failed entry in the viewer replaces it with the new run", async ({ page }) => {
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
  state.gallery.push({
    id: "failed-item",
    jobId: job.id,
    type: "image",
    status: "error",
    url: "",
    prompt: "Failed Study",
    settings: job.input,
  });
  let retries = 0;
  // Like the durable queue, a retry admits a new job whose pending item joins the gallery.
  await page.route("**/api/queue/failed-job/retry", async (route) => {
    retries++;
    const retried = { ...job, id: "retried-job", status: "running", reason: "Generation resumed" };
    state.jobs.push(retried);
    state.gallery.unshift({
      ...state.gallery[0],
      id: "retried-item",
      jobId: retried.id,
      status: "running",
    });
    await route.fulfill({ json: { job: retried } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Failed Study", exact: true }).click();
  const status = page.getByRole("status", { name: "Generation Status", exact: true });
  await expect(status).toContainText("Worker lost connection");
  await status.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(status).toContainText("Generation resumed");
  expect(retries).toBe(1);
  await expect(status.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(state.gallery.map((item) => item.id)).toEqual(["retried-item"]);
});
