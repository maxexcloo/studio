import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  expandAssistantMenu,
  fixtures,
  image,
  selectionMenuItem,
  showOnly,
  signIn,
  stamp,
  viewerChangeMenu,
} from "./fixtures";

const png = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(name) });

test("Import uploads many files or a folder, lists each failure and shows the new uploads", async ({
  page,
}) => {
  const state = await fixtures(page);
  const sent: string[] = [];
  await page.route("**/api/reference-assets/upload", (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") || "";
    sent.push(body.match(/filename="([^"]+)"/)?.[1] || "");
    return body.includes("broken.png")
      ? route.fulfill({ status: 400, json: { ok: false, error: "That image can't be read." } })
      : route.fallback();
  });
  await page.goto("/images");

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "From Clipboard",
    "From URL…",
    "Upload Files…",
    "Upload Folder…",
  ]);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload Files…", exact: true }).click();
  await (await chooser).setFiles([png("one.png"), png("broken.png"), png("two.png")]);
  const notice = page.getByText("Uploaded 2 files to Uploads. 1 file failed.", { exact: true });
  await expect(notice).toBeVisible();
  await expect(
    page.getByText("broken.png: That image can't be read.", { exact: true }),
  ).toBeVisible();
  expect(sent).toEqual(["one.png", "broken.png", "two.png"]);
  // A failure stays until dismissed; on phones it covers the toolbar.
  await page.getByRole("button", { name: "Dismiss Notification", exact: true }).click();
  // The gallery turns to Uploads to show them.
  await expect(page.getByRole("button", { name: "Gallery View", exact: true })).toHaveText(
    "Uploads",
  );
  await expect(page.locator("[data-media-id]")).toHaveCount(2);
  // The view menu counts what each view holds.
  await page.getByRole("button", { name: "Gallery View", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Uploads", exact: true })).toContainText("2");
  await page.keyboard.press("Escape");

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

test("Recreate › Run Suggested Prompts on several uploads uses saved prompts and captions for versions and counts the rest", async ({
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
    { ...upload("b", " "), caption: { text: "A lighthouse at dusk" } },
    upload("c"),
  );
  const recreated: string[] = [];
  await page.route("**/api/gallery/recreate", (route) => {
    const { galleryItemId: id, savedPromptOnly } = route.request().postDataJSON();
    expect(savedPromptOnly).toBe(true);
    recreated.push(id);
    return route.fulfill({
      json: {
        ok: true,
        sessionId: `session-${id}`,
        jobId: `job-${id}`,
        prompt: id === "a" ? "A red barn at noon" : "A lighthouse at dusk",
      },
    });
  });
  const queued: { path: string; body: Record<string, unknown> }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/sessions\/[^/]+\/generations$/.test(url.pathname))
      queued.push({ path: url.pathname, body: request.postDataJSON() });
  });
  await page.goto("/images");
  await showOnly(page, "Uploads");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  for (const id of ["a", "b", "c"])
    await page.getByRole("button", { name: `Select image: Upload ${id}`, exact: true }).click();
  await (await selectionMenuItem(page, "Recreate", "Run Suggested Prompts")).click();
  await expect(
    page.getByText("Queued 2 recreations. 1 upload has no saved prompt or caption yet.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(recreated).toEqual(["a", "b"]);
  expect(
    queued.map(({ path, body }) => [path, body.prompt, body.parentJobId, body.parentItemId]),
  ).toEqual([
    ["/api/sessions/session-a/generations", "A red barn at noon", "job-a", "a"],
    ["/api/sessions/session-b/generations", "A lighthouse at dusk", "job-b", "b"],
  ]);
});

test("A Recreate template on an upload queues a new version of the upload", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "imported-barn",
    title: "Imported Barn",
    uploaded: true,
    type: "image",
    status: "done",
    prompt: "",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      json: {
        available: true,
        presets: [],
        themes: [],
        changes: [
          {
            id: "night",
            label: "After Dark",
            instruction: "Show the same scene at night.",
            actions: ["recreate"],
          },
        ],
      },
    }),
  );
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    if (body.surface !== "change") return route.fallback();
    expect(body).toMatchObject({
      itemId: "imported-barn",
      actions: ["recreate"],
      request: "Show the same scene at night.",
    });
    return route.fulfill({
      json: {
        suggestions: [
          {
            action: "recreate",
            label: "After Dark",
            request: body.request,
            prompt: "A barn at night",
          },
        ],
      },
    });
  });
  await page.route("**/api/gallery/recreate", (route) =>
    route.fulfill({ json: { sessionId: "import-session", jobId: "import-source" } }),
  );

  await page.goto("/images");
  await showOnly(page, "Uploads");
  await page.getByRole("button", { name: "Open image: Imported Barn", exact: true }).click();
  await viewerChangeMenu(page, "Recreate");
  await expandAssistantMenu(page, "Templates");
  await page.getByRole("menuitem", { name: "After Dark", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0]).toMatchObject({
    sessionId: "import-session",
    input: { prompt: "A barn at night" },
    parentJobId: "import-source",
    parentItemId: "imported-barn",
  });
});

test("An ordinary account imports a Reddit post From URL with retry and partial failure feedback", async ({
  page,
}) => {
  const state = await fixtures(page);
  await signIn(page, { id: "member", role: "user" });
  const requests: unknown[] = [];
  await page.route("**/api/gallery/import/link", (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      return route.fulfill({
        status: 400,
        json: { ok: false, error: "Reddit is unavailable. Try again." },
      });
    state.gallery.push({
      id: "reddit-bird",
      title: "Birds",
      uploaded: true,
      type: "image",
      status: "done",
      prompt: "",
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      createdAt: stamp,
    });
    return route.fulfill({
      status: 201,
      json: { imported: 1, failed: [{ image: 2, error: "The image is unavailable." }] },
    });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("menuitem", { name: "From URL…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import From URL", exact: true });
  const link = dialog.getByRole("textbox", { name: "Link", exact: true });
  const url = "https://www.reddit.com/r/birds/comments/abc/birds/";
  await link.fill(url);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("menuitem", { name: "From URL…", exact: true }).click();
  await expect(link).toHaveValue(url);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    dialog.getByText("Reddit is unavailable. Try again.", { exact: true }),
  ).toBeVisible();
  await expect(link).toHaveValue(url);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Gallery View", exact: true })).toHaveText(
    "Uploads",
  );
  await expect(page.locator('[data-media-id="reddit-bird"]')).toBeVisible();
  await expect(
    page.getByText("1 image added to Uploads. Image 2: The image is unavailable.", { exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([{ url }, { url }]);
});
