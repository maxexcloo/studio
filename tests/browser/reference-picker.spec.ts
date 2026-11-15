import { type Page, expect, test } from "@playwright/test";

import type { Profile } from "../../frontend/src/types";
import {
  closeReferences,
  create,
  expandComposer,
  fixtures,
  image,
  pickerTab,
  profiles,
  serveProfiles,
  showUploads,
  stamp,
} from "./fixtures";

async function setup(page: Page) {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    mediaInputs: [
      { id: "start", label: "Start", role: "start", required: true },
      { id: "images", label: "Style", max: 2 },
      { id: "end", label: "End", role: "end" },
    ],
  };
  await serveProfiles(page, [profile]);
  for (const prompt of ["Alpha", "Beta"])
    state.gallery.push({
      id: prompt.toLowerCase(),
      jobId: `job-${prompt}`,
      type: "image",
      status: "done",
      prompt,
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      createdAt: stamp,
    });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Combine the references");
  return state;
}

test("Reference slots fill by tap, targeted drop and paste, and pasted files list under Uploads", async ({
  page,
  isMobile,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  const slots = picker.getByRole("group", { name: "Reference Slots", exact: true });
  for (const name of ["Slot 1 · Start · Required", "Slot 2 · Style", "Slot 3 · End"])
    await expect(slots.getByRole("button", { name, exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Use reference: Alpha", exact: true }).click();
  await expect(
    slots.getByRole("button", { name: "Reference 1 · Start", exact: true }),
  ).toBeVisible();
  const beta = picker.getByRole("button", { name: "Use reference: Beta", exact: true });
  const end = slots.getByRole("button", { name: "Slot 3 · End", exact: true });
  // Desktop drags onto a specific slot; touch chooses the slot, then taps.
  if (isMobile) {
    await end.click();
    await beta.click();
  } else await beta.dragTo(end);
  await expect(slots.getByRole("button", { name: "Reference 3 · End", exact: true })).toBeVisible();
  await closeReferences(page);
  // A file pasted anywhere in the composer fills the next empty slot.
  await page.getByRole("textbox", { name: "Prompt", exact: true }).evaluate((prompt) => {
    const data = new DataTransfer();
    data.items.add(new File(["fixture"], "pasted.png", { type: "image/png" }));
    prompt.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole("img", { name: "Reference 2 · Style", exact: true })).toBeVisible();
  // The pasted file is an uploaded gallery image, shown only under the Uploads filter.
  expect(state.gallery.find((item) => item.id === "upload")?.uploaded).toBe(true);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await expect(picker.getByRole("button", { name: /reference: Alpha$/ })).toBeVisible();
  await expect(picker.getByRole("button", { name: /reference: Upload/ })).toHaveCount(0);
  await showUploads(page);
  await expect(
    picker.getByRole("button", { name: "Remove reference: Upload 1", exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole("button", { name: /reference: Alpha/ })).toHaveCount(0);
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-alpha", slot: "start" },
    { assetId: "asset-upload", slot: "images" },
    { assetId: "asset-beta", slot: "end" },
  ]);
});

test("Escape closes only the innermost reference layer; selection applies at once", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  const chip = page.getByRole("button", { name: "Choose References", exact: true });
  await chip.click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  await picker.getByRole("button", { name: "Use reference: Alpha", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use References", exact: true })).toHaveCount(0);
  if (isMobile) {
    await page.getByRole("button", { name: "Close References", exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByRole("img", { name: "Reference 1 · Start", exact: true })).toBeVisible();
    return;
  }
  await picker.getByRole("button", { name: "Reference 1 · Start", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Reference 1 · Start", exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Filter Gallery", exact: true }).click();
  const models = picker.getByRole("combobox", { name: "Models", exact: true });
  await models.click();
  const options = picker.getByRole("listbox");
  await expect(options).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(picker).toBeVisible();
  // Each Escape closes the topmost layer: the filters, then the picker.
  await models.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filters", exact: true })).toBeHidden();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(page.getByRole("region", { name: "Generate", exact: true })).toBeVisible();
});

test("The compact composer expands on interaction and keeps picked or dragged references", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["Picked Study", "Dragged Study"].map((prompt, index) => ({
      id: `reference-${index}`,
      jobId: `source-${index}`,
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      prompt,
      settings: { profileId: "image:test" },
    })),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Preserve the working direction");
  await expandComposer(page);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Picked Study", exact: true }).click();
  await closeReferences(page);
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Preserve the working direction",
  );
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  expect(state.referenceRequests[0].galleryItemId).toBe("reference-0");
  if (testInfo.project.use.isMobile) await page.keyboard.press("Escape");
  else await page.getByRole("link", { name: "Images", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
  if (!testInfo.project.use.isMobile) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .getByRole("button", { name: "Open image: Dragged Study", exact: true })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    await page
      .locator("[data-composer-dock]")
      .dispatchEvent("dragover", { dataTransfer: transfer });
    await page.locator("[data-composer-dock]").dispatchEvent("drop", { dataTransfer: transfer });
    await expect.poll(() => state.referenceRequests.length).toBe(2);
    expect(state.referenceRequests[1].galleryItemId).toBe("reference-1");
  }
});

test("Reference slots preserve optional End-only inputs and reuse one asset in two roles", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile = {
    ...profiles[0],
    id: "image:slots",
    mediaInputs: [
      { id: "start", label: "Start", required: false, max: 1 },
      { id: "end", label: "End", required: false, max: 1 },
    ],
  };
  await serveProfiles(page, [profile]);
  state.gallery.push({
    id: "slot-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Slot Source",
    width: 1024,
    height: 1024,
  });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("End-only study");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Slot 2 · End", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Slot Source", exact: true }).click();
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-slot-source", slot: "end" },
  ]);
  await expandComposer(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  // A second tap removes a selected image; choosing a slot first places it there too.
  await expect(
    page.getByRole("button", { name: "Remove reference: Slot Source", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Slot 1 · Start", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Slot Source", exact: true }).click();
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.referenceAssets).toEqual([
    { assetId: "asset-slot-source", slot: "start" },
    { assetId: "asset-slot-source", slot: "end" },
  ]);
});

test("Owned uploads can be reused from the Uploads filter without another upload", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "past-upload",
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
    .fill("Reuse an earlier photograph");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await showUploads(page);
  await page.getByRole("button", { name: "Use reference: Upload 1", exact: true }).click();
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-past-upload", slot: "image" },
  ]);
  expect(state.referenceRequests).toEqual([{ galleryItemId: "past-upload" }]);
  expect(state.gallery.filter((item) => item.uploaded)).toHaveLength(1);
  expect(
    state.galleryRequests.some((search) => new URLSearchParams(search).get("uploads") === "1"),
  ).toBe(true);
});

test("An image shared to the installed app opens the composer with it as a reference", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/images?compose=1&shared=shared-asset");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/images\?compose=1$/);
});

test("On touch screens, Paste reads a copied photo from the clipboard into the next slot", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Desktop pastes with its keys");
  await page.addInitScript(() => {
    const photo = new Blob(["fixture"], { type: "image/png" });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        read: async () => [new ClipboardItem({ "text/plain": "caption", "image/png": photo })],
      },
    });
  });
  const state = await setup(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  await picker.getByRole("button", { name: "Paste Reference", exact: true }).click();
  await expect(
    picker
      .getByRole("group", { name: "Reference Slots", exact: true })
      .getByRole("button", { name: "Reference 1 · Start", exact: true }),
  ).toBeVisible();
  expect(state.gallery.find((item) => item.id === "upload")?.uploaded).toBe(true);
});

test("The reference grid pages and virtualises as it scrolls, and a tile previews above it", async ({
  page,
}) => {
  await setup(page);
  const fullPrompt = `Result 147, ${"A quiet harbour beneath a wide evening sky. ".repeat(24)}`;
  const items = Array.from({ length: 150 }, (_, index) => ({
    id: `result-${index}`,
    jobId: `job-${index}`,
    type: "image",
    status: "done",
    prompt: index === 147 ? fullPrompt : `Result ${index}`,
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
  }));
  let recovered = false;
  await page.route("**/api/gallery?**", async (route) => {
    const start = Number(new URL(route.request().url()).searchParams.get("cursor") || 0);
    if (start === 120 && !recovered)
      return route.fulfill({ status: 503, json: { error: "Fixture next page is offline" } });
    const end = start + 60;
    await route.fulfill({
      json: {
        items: items.slice(start, end),
        nextCursor: String(end),
        hasMore: end < items.length,
      },
    });
  });
  // The picker shares the gallery's loaded pages, so the gallery loads again from these.
  await create(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  const grid = picker.getByRole("list", { name: "References Choices", exact: true });
  await expect(grid.getByRole("button", { name: "Use reference: Result 0" })).toBeVisible();
  const toEnd = () =>
    grid.evaluate((element) => {
      const viewport = element.closest<HTMLElement>(".mantine-ScrollArea-viewport")!;
      viewport.scrollTop = viewport.scrollHeight;
    });
  // Scrolling to the end loads the next page, until one fails and offers Retry.
  const retry = picker.getByRole("button", { name: "Retry", exact: true });
  await expect(async () => {
    await toEnd();
    // The query retries a failed page itself before it gives up.
    await expect(retry).toBeVisible({ timeout: 10000 });
  }).toPass();
  recovered = true;
  await retry.click();
  await expect(async () => {
    await toEnd();
    await expect(grid.getByRole("button", { name: "Use reference: Result 149" })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  // Only the tiles near the view render.
  await expect(grid.getByRole("button", { name: "Use reference: Result 0" })).toHaveCount(0);
  expect(await grid.getByRole("listitem").count()).toBeLessThan(150);
  // Choosing stays a tap; Preview opens the image above the picker. Space on a tile opens it too
  // on touch screens; on desktop it shows the image beside the tile, as hovering Preview does.
  const tile = grid.getByRole("button", { name: "Use reference: Result 148", exact: true });
  await tile.click();
  const chosen = grid.getByRole("button", { name: "Remove reference: Result 148", exact: true });
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  const previewButton = grid
    .getByRole("listitem")
    .filter({
      has: page.getByRole("button", { name: `Use reference: ${fullPrompt}`, exact: true }),
    })
    .getByRole("button", { name: "Preview", exact: true });
  await previewButton.click();
  const preview = page.getByRole("dialog", { name: /^Result 147/ });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("img", { name: fullPrompt, exact: true })).toBeVisible();
  const heading = preview.getByRole("button", { name: "Result 147 · 148 of 150", exact: true });
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await expect(preview.getByText(fullPrompt, { exact: true })).toHaveCount(0);
  await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await expect(preview.getByText(fullPrompt, { exact: true })).toBeVisible();
  await heading.click();
  await expect(preview.getByText(fullPrompt, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(picker).toBeVisible();
  await chosen.focus();
  await page.keyboard.press("Space");
  if (test.info().project.use.hasTouch) {
    await expect(page.getByRole("dialog", { name: /^Result 148/ })).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    const beside = (name: string) =>
      page.locator("[data-popup]").getByRole("img", { name, exact: true });
    await expect(beside("Result 148")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /^Result 148/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(beside("Result 148")).toBeHidden();
    await expect(chosen).toBeFocused();
    await page.mouse.move(0, 0);
    await previewButton.hover();
    await expect(beside(fullPrompt)).toBeVisible();
    // Pressing Preview while the image shows opens it full screen.
    await previewButton.click();
    await expect(preview).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
  }
  await expect(picker).toBeVisible();
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
});

test("The first Uploads tile keeps its target through cancellation and failure, then places the upload", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  await expect(picker.getByRole("radio", { name: "Liked", exact: true })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "Upload Reference", exact: true })).toHaveCount(
    0,
  );
  await picker.getByRole("button", { name: "Slot 3 · End", exact: true }).click();
  await showUploads(page);
  const grid = picker.getByRole("list", { name: "References Choices", exact: true });
  const upload = grid
    .getByRole("listitem")
    .first()
    .getByRole("button", { name: "Upload Reference", exact: true });
  await expect(upload).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await upload.click();
  await (await chooser).setFiles([]);
  expect(state.referenceRequests).toHaveLength(0);
  expect(state.gallery.filter((item) => item.uploaded)).toHaveLength(0);
  let fail = true;
  await page.route("**/api/reference-assets/upload", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: "Fixture upload unavailable" } });
    else await route.fallback();
  });
  const file = { name: "end.png", mimeType: "image/png", buffer: Buffer.from("fixture") };
  await picker.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("Fixture upload unavailable", { exact: true })).toBeVisible();
  await expect(upload).toBeEnabled();
  await expect(picker.getByRole("button", { name: "Slot 3 · End", exact: true })).toBeVisible();
  fail = false;
  await picker.locator('input[type="file"]').setInputFiles(file);
  await expect(
    picker.getByRole("button", { name: "Reference 3 · End", exact: true }),
  ).toBeVisible();
  await expect(
    grid
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: "Upload Reference", exact: true }),
  ).toBeVisible();
  await expect(
    grid.getByRole("button", { name: "Remove reference: Upload 1", exact: true }),
  ).toBeVisible();
  await pickerTab(page, "References", "Gallery");
  await picker.getByRole("button", { name: "Use reference: Alpha", exact: true }).click();
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-alpha", slot: "start" },
    { assetId: "asset-upload", slot: "end" },
  ]);
});

test("Virtualised uploads retain their asset IDs and numbering after the leading upload tile", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `owned-upload-${index}`,
      uploaded: true,
      type: "image",
      status: "done",
      prompt: "",
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      createdAt: stamp,
    })),
  );
  await create(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await showUploads(page);
  const picker = page.getByRole("region", { name: "References", exact: true });
  const grid = picker.getByRole("list", { name: "References Choices", exact: true });
  await expect(
    grid
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: "Upload Reference", exact: true }),
  ).toBeVisible();
  await expect(async () => {
    await grid.evaluate((element) => {
      const viewport = element.closest<HTMLElement>(".mantine-ScrollArea-viewport")!;
      viewport.scrollTop = viewport.scrollHeight;
    });
    await expect(
      grid.getByRole("button", { name: "Use reference: Upload 100", exact: true }),
    ).toBeVisible();
  }).toPass();
  await expect(grid.getByRole("button", { name: "Upload Reference", exact: true })).toHaveCount(0);
  await grid.getByRole("button", { name: "Use reference: Upload 100", exact: true }).click();
  await expect.poll(() => state.referenceRequests).toEqual([{ galleryItemId: "owned-upload-99" }]);
  expect(await grid.getByRole("listitem").count()).toBeLessThan(100);
});
