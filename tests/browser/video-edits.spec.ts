import { expect, test } from "@playwright/test";

import { fixtures, stamp, videoClip, viewerAction } from "./fixtures";

const clip = videoClip();
test.skip(!clip, "Video encoder unavailable");

test("A video's Edit menu reverses it into a new version", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/test-media/clip.webm",
    prompt: "A rolling wave",
    width: 160,
    height: 90,
    createdAt: stamp,
  });
  await page.route("**/test-media/clip.webm", (route) =>
    route.fulfill({ contentType: "video/webm", body: clip! }),
  );
  const edits: unknown[] = [];
  await page.route("**/api/gallery/video-edit", (route) => {
    edits.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: { ok: true, id: "reversed", jobId: "job-reversed" },
    });
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: Rolling Wave", exact: true }).click();
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Reverse", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Saved as New Version", exact: true }),
  ).toBeVisible();
  expect(edits).toEqual([{ galleryItemId: "clip", kind: "reverse" }]);
});
