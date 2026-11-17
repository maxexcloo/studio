import { expect, test } from "@playwright/test";

import type { Profile } from "../../frontend/src/types";
import {
  closeReferences,
  create,
  fixtures,
  image,
  openReferenceChoices,
  profiles,
  serveProfiles,
  showReferenceStack,
  showUploads,
  stamp,
} from "./fixtures";

test("Multiple owned references preserve order, role identity and capacity through generation", async ({
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
  await serveProfiles(page, [profile]);
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
  const picker = await openReferenceChoices(page);
  const slots = page.getByRole("group", { name: "Reference Slots", exact: true });
  // Taps fill the next empty slot: both Inputs, then End, which returns phones to the stack.
  for (const name of ["first", "second", "third"])
    await picker.getByRole("button", { name: `Use reference: ${name} study`, exact: true }).click();
  await expect(slots.getByRole("button", { name: "Reference 3 · End", exact: true })).toBeVisible();
  // With every slot filled, a selected image can still be removed.
  await expect(
    (await openReferenceChoices(page)).getByRole("button", {
      name: "Remove reference: first study",
      exact: true,
    }),
  ).toBeEnabled();
  await showReferenceStack(page);
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
  await (
    await openReferenceChoices(page)
  )
    .getByRole("button", { name: "Use reference: first study", exact: true })
    .click();
  await closeReferences(page);
  await expect(page.getByRole("dialog", { name: "References", exact: true })).toBeHidden();
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
});

test("Removing a picked reference keeps its upload, one upload fills several slots, and the picker deletes nothing", async ({
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
  await serveProfiles(page, [profile]);
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
  for (const id of ["owned-upload", "another-upload"])
    state.gallery.push({
      id,
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
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Keep the gallery reference");
  const picker = await openReferenceChoices(page);
  await picker
    .getByRole("button", { name: "Use reference: Kept gallery result", exact: true })
    .click();
  // Uploads are deleted in the gallery, not here.
  await showUploads(page);
  await expect(
    picker.getByRole("button", { name: "Use reference: Upload 1", exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  await showReferenceStack(page);
  const slots = page.getByRole("group", { name: "Reference Slots", exact: true });
  // One upload can fill several slots: choose the slot, then the image; each pick returns to the
  // stack on phones.
  for (const slot of ["Slot 3 · End", "Slot 2 · Inputs"]) {
    await slots.getByRole("button", { name: slot, exact: true }).click();
    await (
      await openReferenceChoices(page)
    )
      .getByRole("button", { name: "Use reference: Upload 1", exact: true })
      .click();
    await showReferenceStack(page);
  }
  await expect(slots.getByRole("button", { name: "Reference 3 · End", exact: true })).toBeVisible();
  await slots.getByRole("button", { name: "Reference 2 · Inputs", exact: true }).click();
  await page
    .getByRole("menu", { name: "Reference 2 · Inputs", exact: true })
    .getByRole("menuitem", { name: "Remove", exact: true })
    .click();
  await expect(slots.getByRole("button", { name: "Slot 2 · Inputs", exact: true })).toBeVisible();
  expect(state.gallery.filter((item) => item.uploaded)).toHaveLength(2);
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-kept", slot: "images" },
    { assetId: "asset-owned-upload", slot: "end" },
  ]);
});

test("Each reference takes one Strength: a guiding one its own, an img2img start image the denoise", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    capabilities: { ...profiles[0].capabilities, denoise: true },
    mediaInputs: [
      { id: "image", label: "Image" },
      {
        id: "style",
        label: "Style",
        role: "style",
        strength: { min: 0, max: 2, step: 0.05, default: 0.6 },
      },
    ],
  };
  await serveProfiles(page, [profile]);
  for (const id of ["first", "second"])
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
          name: "upload.png",
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
        },
      },
    });
  });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A lighthouse at dusk");
  const choices = await openReferenceChoices(page);
  for (const name of ["first", "second"])
    await choices
      .getByRole("button", { name: `Use reference: ${name} study`, exact: true })
      .click();
  // Filling both slots returns phones to the stack, which holds each reference's Strength.
  await showReferenceStack(page);
  const picker = page.getByRole("region", { name: "Reference Stack", exact: true });
  // The test profile doesn't edit with its references, so the first one is where the result starts.
  await expect(picker.getByText("Reference 1 is the start image", { exact: false })).toBeVisible();
  await picker
    .getByRole("textbox", { name: "Reference 1 · Image Strength", exact: true })
    .fill("0.4");
  const strength = picker.getByRole("textbox", {
    name: "Reference 2 · Style Strength",
    exact: true,
  });
  await expect(strength).toHaveValue("0.6");
  await strength.fill("1.2");
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-first", slot: "image" },
    { assetId: "asset-second", slot: "style", strength: 1.2 },
  ]);
  expect(state.jobs[0].input.denoise).toBe(0.4);
});
