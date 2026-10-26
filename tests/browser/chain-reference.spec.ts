import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  closeReferences,
  create,
  fixtures,
  image,
  profiles,
  serveProfiles,
  stamp,
} from "./fixtures";
import type { Profile } from "../../frontend/src/types";

const workflow = JSON.parse(
  readFileSync(
    new URL("../../backend/fixtures/profiles/flux3-klein-base-10-references.json", import.meta.url),
    "utf8",
  ),
);
const declared: NonNullable<Profile["mediaInputs"]> = workflow.heissUi.mediaInputs;
const slots = declared.map((slot, index) => ({
  ...slot,
  ...(index ? { follows: declared[index - 1].id } : {}),
}));

test("A linked ten-reference stack fills declared slots and keeps Start/End independent", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    mediaInputs: [
      ...slots,
      { id: "start", label: "Start", role: "start" },
      { id: "end", label: "End", role: "end" },
    ],
  };
  await serveProfiles(page, [profile]);
  state.gallery.push({
    id: "shared",
    jobId: "saved",
    type: "image",
    status: "done",
    prompt: "Shared frame",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  let uploaded = 0;
  await page.route("**/api/reference-assets/upload", (route) =>
    route.fulfill({
      json: {
        asset: {
          id: `upload-${++uploaded}`,
          name: "private-name.png",
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
        },
      },
    }),
  );
  await page.route("**/api/reference-assets/from-gallery", (route) =>
    route.fulfill({
      json: {
        asset: {
          id: "shared-frame",
          name: "private-name.png",
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
        },
      },
    }),
  );
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Combine all ten references");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  const cells = picker.getByRole("group", { name: "Reference Slots", exact: true });
  await expect(cells.getByRole("button", { name: /^Slot / })).toHaveText(["1", "2", "3"]);
  await picker.getByText("Uploads", { exact: true }).click();
  await picker.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 13 }, (_, index) => ({
      name: `input-${index + 1}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    })),
  );
  // The stack fills its ten declared slots, then Start and End; nothing is left for the 13th.
  await expect(picker.getByText("Reference Image · 10/10", { exact: true })).toBeVisible();
  await expect(
    cells.getByRole("button", { name: "Reference 12 · End", exact: true }),
  ).toBeVisible();
  expect(uploaded).toBe(12);
  await expect(
    picker.getByRole("button", { name: "Upload Reference", exact: true }),
  ).toBeDisabled();
  await cells.getByRole("button", { name: "Reference 10 · Reference Image", exact: true }).click();
  await page
    .getByRole("menu", { name: "Reference 10 · Reference Image", exact: true })
    .getByRole("menuitem", { name: "Move Earlier", exact: true })
    .click();
  await picker.getByText("Gallery", { exact: true }).click();
  for (const label of ["Reference 11 · Start", "Reference 12 · End"]) {
    await cells.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("menu", { name: label, exact: true })
      .getByRole("menuitem", { name: "Replace", exact: true })
      .click();
    await picker.getByRole("button", { name: "Use reference: Shared frame", exact: true }).click();
  }
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  const expected = slots.map((slot, index) => ({ assetId: `upload-${index + 1}`, slot: slot.id }));
  [expected[8], expected[9]] = [expected[9], expected[8]];
  expect(state.jobs[0].input.referenceAssets).toEqual([
    ...expected,
    { assetId: "shared-frame", slot: "start" },
    { assetId: "shared-frame", slot: "end" },
  ]);
});
