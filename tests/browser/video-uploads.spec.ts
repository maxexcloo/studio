import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { create, fixtures, image, showUploads, stamp, viewerAction } from "./fixtures";

// A one-second clip; WebKit's test builds may not decode it, which only the viewer's player needs.
const clip = execFileSync(createRequire(import.meta.url)("ffmpeg-static"), [
  ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
  ...["-i", "testsrc=size=160x90:rate=24:duration=1", "-c:v", "libvpx", "-f", "webm", "pipe:1"],
]);

test("A video uploads as a reference, and Recreate runs an upload's suggested prompt as its version", async ({
  page,
}) => {
  const state = await fixtures(page);
  const uploads: string[] = [];
  await page.route("**/api/reference-assets/upload", (route) => {
    uploads.push(route.request().postDataBuffer()?.toString("latin1") || "");
    return route.fulfill({
      status: 201,
      json: {
        asset: {
          id: "gallery:clip:frame-0",
          source: "upload",
          galleryItemId: "clip",
          name: "clip frame at 0.0 s.png",
          mime: "image/png",
          thumbnailUrl: image,
          width: 160,
          height: 90,
        },
      },
    });
  });
  await create(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await showUploads(page);
  await page
    .getByRole("region", { name: "References", exact: true })
    .locator('input[type="file"]')
    .setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]).toContain("Content-Type: video/webm");

  state.gallery.push({
    id: "clip",
    uploaded: true,
    type: "video",
    status: "done",
    url: "/test-media/clip.webm",
    thumbnailUrl: image,
    prompt: "",
    suggestedPrompt: "A lighthouse at dusk, waves breaking",
    width: 160,
    height: 90,
    createdAt: stamp,
  });
  await page.route("**/test-media/clip.webm", (route) =>
    route.fulfill({ contentType: "video/webm", body: clip }),
  );
  const recreated: unknown[] = [];
  await page.route("**/api/gallery/recreate", (route) => {
    recreated.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, sessionId: "session-recreate", jobId: "job-clip" } });
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Uploads", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.locator('[data-media-id="clip"]').click();
  // An upload video's Recreate has the one option, its suggested prompt, so it runs at once.
  await viewerAction(page, "Recreate");
  await expect.poll(() => recreated).toEqual([{ galleryItemId: "clip" }]);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("A lighthouse at dusk, waves breaking");
  // This video model starts from a picture: the clip's first frame.
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await showUploads(page);
  await page
    .getByRole("region", { name: "References", exact: true })
    .locator('input[type="file"]')
    .setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
  await expect.poll(() => uploads.length).toBe(2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate Video", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0]).toMatchObject({
    sessionId: "session-recreate",
    parentJobId: "job-clip",
    parentItemId: "clip",
    input: { kind: "video", prompt: "A lighthouse at dusk, waves breaking" },
  });
});
