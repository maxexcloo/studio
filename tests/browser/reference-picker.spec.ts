import { expect, test, type Page } from "@playwright/test";
import { closeReferences, create, fixtures, image, profiles, stamp } from "./fixtures";
import type { Profile } from "../../frontend/src/types";

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
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { profiles: [profile], features: { library: true, presets: true } } }),
  );
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

test("Reference slots fill by tap, targeted drop and paste, and pasted files save to Images", async ({
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
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await slots.getByRole("button", { name: "Reference 2 · Style", exact: true }).click();
  await page
    .getByRole("menu", { name: "Reference 2 · Style", exact: true })
    .getByRole("menuitem", { name: "Save to Images", exact: true })
    .click();
  await expect(page.getByText("Saved to Images", { exact: true })).toBeVisible();
  expect(state.gallery.some((item) => item.id === "saved-asset-upload")).toBe(true);
  await closeReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-alpha", slot: "start" },
    { assetId: "asset-upload", slot: "images" },
    { assetId: "asset-beta", slot: "end" },
  ]);
});

test("Escape closes only the innermost reference layer; phones confirm at the safe bottom", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  const chip = page.getByRole("button", { name: "Choose References", exact: true });
  await chip.click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  const done = picker.getByRole("button", { name: "Use References", exact: true });
  await picker.getByRole("button", { name: "Use reference: Alpha", exact: true }).click();
  if (isMobile) {
    const box = (await done.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 48);
    await picker.getByRole("button", { name: "Back", exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByRole("img", { name: "Reference 1 · Start", exact: true })).toBeVisible();
    return;
  }
  await expect(done).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await picker.getByRole("button", { name: "Reference 1 · Start", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Reference 1 · Start", exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await picker.getByRole("button", { name: "Filter By Size", exact: true }).click();
  const size = picker.getByRole("dialog");
  await expect(size).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(size).toBeHidden();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Filter By Size", exact: true }).press("Escape");
  await expect(picker).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Generation Controls", exact: true }),
  ).toBeVisible();
});
