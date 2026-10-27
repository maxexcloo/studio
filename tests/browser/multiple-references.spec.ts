import { expect, test } from "@playwright/test";
import {
  closeReferences,
  create,
  fixtures,
  image,
  openNav,
  profiles,
  serveProfiles,
  stamp,
} from "./fixtures";
import type { Profile } from "../../frontend/src/types";

test("Multiple owned references preserve order, role identity and capacity through generation and Chat", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    mediaInputs: [
      { id: "images", label: "Inputs", max: 2 },
      { id: "end", label: "End", role: "end" },
    ],
  };
  await serveProfiles(page, [profile], { library: true, presets: true });
  for (const id of ["first", "second", "third"])
    state.gallery.push({
      id,
      jobId: `job-${id}`,
      type: "image",
      status: "done",
      prompt: `${id} study`,
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      createdAt: stamp,
    });
  await page.route("**/api/reference-assets/from-gallery", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        asset: {
          id: `asset-${body.galleryItemId}`,
          galleryItemId: body.galleryItemId,
          name: "private-upload-name.png",
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
        },
      },
    });
  });
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Combine these reference compositions");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  const slots = picker.getByRole("group", { name: "Reference Slots", exact: true });
  // Taps fill the next empty slot: both Inputs, then End.
  for (const name of ["first", "second", "third"])
    await picker.getByRole("button", { name: `Use reference: ${name} study`, exact: true }).click();
  await expect(slots.getByRole("button", { name: "Reference 3 · End", exact: true })).toBeVisible();
  // With every slot filled, a selected image can still be removed.
  await expect(
    picker.getByRole("button", { name: "Remove reference: first study", exact: true }),
  ).toBeEnabled();
  await slots.getByRole("button", { name: "Reference 1 · Inputs", exact: true }).click();
  await page
    .getByRole("menu", { name: "Reference 1 · Inputs", exact: true })
    .getByRole("menuitem", { name: "Move Later", exact: true })
    .click();
  await slots.getByRole("button", { name: "Reference 3 · End", exact: true }).click();
  await page
    .getByRole("menu", { name: "Reference 3 · End", exact: true })
    .getByRole("menuitem", { name: "Replace", exact: true })
    .click();
  await expect(
    slots.getByRole("button", { name: "Reference 3 · End", exact: true }),
  ).toHaveAttribute("data-target", "true");
  await picker.getByRole("button", { name: "Use reference: first study", exact: true }).click();
  await closeReferences(page);
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("img", { name: "Reference 1 · Inputs", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Reference 3 · End", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  const expected = [
    { assetId: "asset-second", slot: "images" },
    { assetId: "asset-first", slot: "images" },
    { assetId: "asset-first", slot: "end" },
  ];
  expect(state.jobs[0].input.referenceAssets).toEqual(expected);
  expect(
    state.jobs[0].input.referenceDetails.map((asset: any) => ({
      assetId: asset.id,
      slot: asset.slot,
    })),
  ).toEqual(expected);
  await openNav(page, "Chat");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  for (const name of ["second", "first"])
    await page.getByRole("button", { name: `Use reference: ${name} study`, exact: true }).click();
  // The same image fills End too once that slot is chosen.
  await page.getByRole("button", { name: "Slot 3 · End", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: first study", exact: true }).click();
  await closeReferences(page);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Explain how the selected references fit together");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect.poll(() => state.chatRequests.length).toBe(1);
  expect(state.chatRequests[0].references).toEqual(["asset-second", "asset-first", "asset-first"]);
  expect(state.chatRequests[0].generation.input.referenceAssets).toEqual(expected);
  expect(state.jobs).toHaveLength(1);
});

test("Removing a picked reference keeps its upload; confirmed deletion removes only the owned upload", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    mediaInputs: [
      { id: "images", label: "Inputs", max: 2 },
      { id: "end", label: "End", role: "end" },
    ],
  };
  await serveProfiles(page, [profile], { library: true, presets: true });
  state.gallery.push({
    id: "kept",
    jobId: "kept-job",
    type: "image",
    status: "done",
    prompt: "Kept gallery result",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  const uploads = ["owned-upload", "another-upload"].map((id) => ({
    id,
    name: "private-file.png",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
  }));
  await page.route("**/api/reference-assets?*", (route) =>
    route.fulfill({ json: { items: uploads, hasMore: false, nextCursor: "" } }),
  );
  const deleted: string[] = [];
  let refuse = true;
  await page.route("**/api/reference-assets/owned-upload", (route) => {
    expect(route.request().method()).toBe("DELETE");
    deleted.push("owned-upload");
    if (refuse)
      return route.fulfill({
        status: 404,
        json: { error: "That upload is no longer available to this account." },
      });
    uploads.splice(
      uploads.findIndex((asset) => asset.id === "owned-upload"),
      1,
    );
    return route.fulfill({ json: { ok: true, deleted: true } });
  });
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Keep the gallery reference");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page
    .getByRole("button", { name: "Use reference: Kept gallery result", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Delete Upload 1", exact: true })).toHaveCount(0);
  await page.getByText("Uploads", { exact: true }).click();
  const slots = page.getByRole("group", { name: "Reference Slots", exact: true });
  await slots.getByRole("button", { name: "Slot 3 · End", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Reference 1", exact: true }).click();
  // One upload can fill several slots: choose the slot, then the selected image.
  await slots.getByRole("button", { name: "Slot 2 · Inputs", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Reference 1", exact: true }).click();
  await expect(slots.getByRole("button", { name: "Reference 3 · End", exact: true })).toBeVisible();
  await slots.getByRole("button", { name: "Reference 2 · Inputs", exact: true }).click();
  await page
    .getByRole("menu", { name: "Reference 2 · Inputs", exact: true })
    .getByRole("menuitem", { name: "Remove", exact: true })
    .click();
  expect(deleted).toEqual([]);
  await expect(slots.getByRole("button", { name: "Slot 2 · Inputs", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Upload 1", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete Upload", exact: true });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(deleted).toEqual([]);
  await page.getByRole("button", { name: "Delete Upload 1", exact: true }).click();
  await confirmation.getByRole("button", { name: "Delete Upload", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toContainText(
    "no longer available to this account",
  );
  await expect(confirmation).toBeVisible();
  expect(uploads).toHaveLength(2);
  refuse = false;
  await confirmation.getByRole("button", { name: "Delete Upload", exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(deleted).toEqual(["owned-upload", "owned-upload"]);
  expect(uploads.map((asset) => asset.id)).toEqual(["another-upload"]);
  await expect(slots.getByRole("button", { name: /^Reference / })).toHaveCount(1);
  await expect(
    slots.getByRole("button", { name: "Reference 1 · Inputs", exact: true }),
  ).toBeVisible();
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([{ assetId: "asset-kept", slot: "images" }]);
  expect(state.gallery.some((item) => item.id === "kept")).toBe(true);
});
