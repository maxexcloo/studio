import { expect, test } from "@playwright/test";
import { fixtures, stamp, videoClip, viewerAction } from "./fixtures";

const clip = videoClip();
test.skip(!clip, "Video encoder unavailable");

test("A video's Edit menu reverses or trims it into a new version", async ({
  page,
  browserName,
}) => {
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
    return route.fulfill({ status: 201, json: { ok: true, id: "trimmed", jobId: "job-trim" } });
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Reverse", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Saved as New Version", exact: true }),
  ).toBeVisible();
  expect(edits).toEqual([{ galleryItemId: "clip", kind: "reverse" }]);
  // The menu stays open after an edit.
  await page.getByRole("menuitem", { name: "Trim…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trim Video", exact: true });
  await expect(dialog).toBeVisible();
  test.skip(browserName === "webkit", "WebKit test builds may not play WebM.");
  const save = dialog.getByRole("button", { name: "Save Version", exact: true });
  await expect(save).toBeEnabled();
  // The fixture WebM stores no length; the dialog still reads a real one.
  await expect(dialog).not.toContainText("Infinity");
  await dialog.getByRole("slider", { name: "Start", exact: true }).focus();
  for (let step = 0; step < 20; step++) await page.keyboard.press("ArrowRight");
  await save.click();
  await expect.poll(() => edits.length).toBe(2);
  expect(edits[1]).toMatchObject({ galleryItemId: "clip", kind: "trim", start: 200 });
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved as a new version.", { exact: true })).toBeVisible();
});
