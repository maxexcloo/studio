import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fixtures, image, selectionMenuItem, stamp } from "./fixtures";

const png = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(name) });

test("Upload takes many files or a folder, lists each failure and shows the new uploads", async ({
  page,
}) => {
  const state = await fixtures(page);
  const sent: string[] = [];
  await page.route("**/api/reference-assets/upload", (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") || "";
    sent.push(body.match(/filename="([^"]+)"/)?.[1] || "");
    return body.includes("broken.png")
      ? route.fulfill({ status: 400, json: { ok: false, error: "That image can’t be read." } })
      : route.fallback();
  });
  await page.goto("/images");

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  // Reddit posts import from Library › Import, not this menu.
  await expect(page.getByRole("menuitem")).toHaveText(["Upload Files…", "Upload Folder…"]);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload Files…", exact: true }).click();
  await (await chooser).setFiles([png("one.png"), png("broken.png"), png("two.png")]);
  const notice = page.getByText("Uploaded 2 files to Uploads. 1 file failed.", { exact: true });
  await expect(notice).toBeVisible();
  await expect(
    page.getByText("broken.png: That image can’t be read.", { exact: true }),
  ).toBeVisible();
  expect(sent).toEqual(["one.png", "broken.png", "two.png"]);
  // The gallery turns to Uploads to show them.
  await expect(
    page.getByRole("button", { name: "Remove Uploads Filter", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-media-id]")).toHaveCount(2);

  // A folder uploads what it holds that Studio takes, and says what it skipped.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-upload-folder-"));
  fs.writeFileSync(path.join(folder, "three.png"), "three");
  fs.writeFileSync(path.join(folder, "notes.txt"), "notes");
  await page.locator('input[aria-label="Upload Folder"]').setInputFiles(folder);
  await expect(
    page.getByText("Uploaded 1 file to Uploads. 1 other file skipped.", { exact: true }),
  ).toBeVisible();
  expect(sent.at(-1)).toMatch(/three\.png$/);
  expect(state.gallery.filter((item) => item.uploaded)).toHaveLength(3);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("Recreate on several uploads queues each suggested prompt as its version and counts the rest", async ({
  page,
}) => {
  const state = await fixtures(page);
  const upload = (id: string, suggestedPrompt?: string) => ({
    id,
    title: `Upload ${id}`,
    uploaded: true,
    type: "image",
    status: "done",
    prompt: "",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
    ...(suggestedPrompt ? { suggestedPrompt } : {}),
  });
  state.gallery.push(
    upload("a", "A red barn at noon"),
    upload("b", "A lighthouse at dusk"),
    upload("c"),
  );
  const recreated: string[] = [];
  await page.route("**/api/gallery/recreate", (route) => {
    const id = route.request().postDataJSON().galleryItemId;
    recreated.push(id);
    return route.fulfill({ json: { ok: true, sessionId: `session-${id}`, jobId: `job-${id}` } });
  });
  const queued: { path: string; body: Record<string, unknown> }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/sessions\/[^/]+\/generations$/.test(url.pathname))
      queued.push({ path: url.pathname, body: request.postDataJSON() });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Uploads", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  for (const id of ["a", "b", "c"])
    await page.getByRole("button", { name: `Select image: Upload ${id}`, exact: true }).click();
  await (await selectionMenuItem(page, "Recreate")).click();
  await expect(
    page.getByText("Queued 2 recreations. 1 upload has no suggested prompt yet.", { exact: true }),
  ).toBeVisible();
  expect(recreated).toEqual(["a", "b"]);
  expect(
    queued.map(({ path, body }) => [path, body.prompt, body.parentJobId, body.parentItemId]),
  ).toEqual([
    ["/api/sessions/session-a/generations", "A red barn at noon", "job-a", "a"],
    ["/api/sessions/session-b/generations", "A lighthouse at dusk", "job-b", "b"],
  ]);
});
