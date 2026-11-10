import { expect, test, type Page } from "@playwright/test";
import { closePopup, closeReferences, create, fixtures, image, showOnly, stamp } from "./fixtures";

function referenceItem() {
  return {
    id: "copper-reference",
    jobId: "reference-source",
    type: "image",
    status: "done",
    favorite: true,
    url: image,
    thumbnailUrl: image,
    prompt: "Copper bird reference",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  };
}
async function finishReferences(page: Page) {
  const references = page.getByRole("region", { name: "References", exact: true });
  await closeReferences(page);
  await expect(references).toBeHidden();
}
async function referenceSearch(page: Page) {
  const references = page.getByRole("region", { name: "References", exact: true });
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
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const references = page.getByRole("region", { name: "References", exact: true });
  const listing = references.locator(".mantine-ScrollArea-viewport");
  await expect(
    references.getByRole("button", { name: "Use reference: Study 29", exact: true }),
  ).toBeVisible();
  await listing.evaluate((element) => element.scrollTo({ top: 120 }));
  await finishReferences(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await expect.poll(() => listing.evaluate((element) => element.scrollTop)).toBe(120);
  await (await referenceSearch(page)).fill("Copper");
  const filters = page.getByRole("dialog", { name: "Filters", exact: true });
  await references.getByRole("button", { name: "Filter Gallery", exact: true }).click();
  await showOnly(page, "Starred");
  await closePopup(page, "Filters");
  await finishReferences(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await references.getByRole("button", { name: "Filter Gallery", exact: true }).click();
  await expect(filters.getByRole("radio", { name: "Starred", exact: true })).toBeChecked();
  await closePopup(page, "Filters");
  await expect(await referenceSearch(page)).toHaveValue("Copper");
  await page
    .getByRole("button", { name: "Use reference: Copper bird reference", exact: true })
    .click();
  await finishReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
});
