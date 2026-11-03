import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fixtures } from "./fixtures";

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
