import { type Page, expect, test } from "@playwright/test";

import { closeReferences, create, fixtures, image, openReferenceChoices, stamp } from "./fixtures";

function referenceItem() {
  return {
    id: "copper-reference",
    jobId: "reference-source",
    type: "image",
    status: "done",
    rating: "liked",
    url: image,
    thumbnailUrl: image,
    prompt: "Copper bird reference",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  };
}
async function finishReferences(page: Page) {
  const references = page.getByRole("region", { name: "Reference Choices", exact: true });
  await closeReferences(page);
  await expect(references).toBeHidden();
}
async function referenceSearch(page: Page) {
  const references = page.getByRole("region", { name: "Reference Choices", exact: true });
  await expect(references).toBeVisible();
  return references.getByRole("textbox", { name: "Search Gallery", exact: true });
}

test("Reference browsing keeps its scroll, query and filters in the gallery editor", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(referenceItem());
  for (let index = 0; index < 30; index++)
    state.gallery.push({ ...referenceItem(), id: `study-${index}`, prompt: `Study ${index}` });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A copper bird study");
  await openReferenceChoices(page);
  const references = page.getByRole("region", { name: "Reference Choices", exact: true });
  const listing = references.locator(".mantine-ScrollArea-viewport");
  await expect(
    references.getByRole("button", { name: "Use reference: Study 0", exact: true }),
  ).toBeVisible();
  await listing.evaluate((element) => element.scrollTo({ top: 120 }));
  await finishReferences(page);
  await openReferenceChoices(page);
  await expect.poll(() => listing.evaluate((element) => element.scrollTop)).toBe(120);
  await (await referenceSearch(page)).fill("Copper");
  await references.getByRole("button", { name: "Filter Gallery", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filters", exact: true });
  const square = filters.getByRole("button", { name: "Square", exact: true });
  await square.click();
  await square.press("Escape");
  await expect(filters).toBeHidden();
  await finishReferences(page);
  await openReferenceChoices(page);
  await expect(
    references.getByRole("textbox", { name: "Search Gallery", exact: true }),
  ).toHaveValue("Copper");
  await references.getByRole("button", { name: "Filter Gallery", exact: true }).click();
  await expect(square).toHaveAttribute("aria-pressed", "true");
  await square.press("Escape");
  await expect(filters).toBeHidden();
  await page
    .getByRole("button", { name: "Use reference: Copper bird reference", exact: true })
    .click();
  await finishReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
});
