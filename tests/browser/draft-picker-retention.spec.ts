import { expect, test, type Page } from "@playwright/test";
import { create, fixtures, image, stamp } from "./fixtures";

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
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(references).toBeHidden();
}
async function referenceSearch(page: Page) {
  const references = page.getByRole("region", { name: "References", exact: true });
  await expect(references).toBeVisible();
  const search = references.getByRole("button", { name: "Search Gallery", exact: true });
  if (await search.isVisible()) await search.click();
  return references.getByRole("textbox", { name: "Search Gallery", exact: true });
}

test("Mode navigation keeps the unsent Chat reference and resumes the selected source lineage", async ({
  page,
  isMobile,
}) => {
  const state = await fixtures(page);
  state.gallery.push(referenceItem());
  await page.goto("/chat");
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Create a blue bird");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page
    .getByRole("button", { name: "Use reference: Copper bird reference", exact: true })
    .click();
  await finishReferences(page);
  await page.getByRole("link", { name: "Images", exact: true }).first().click();
  const galleryPrompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await galleryPrompt.fill("Independent gallery direction");
  await page.getByRole("link", { name: "Chat", exact: true }).first().click();
  await expect(message).toHaveValue("Create a blue bird");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  const sessionId = state.jobs[0].sessionId;
  await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`));
  expect(state.chatRequests[0].references).toEqual(["asset-copper-reference"]);
  await message.fill("Keep the same source, but discuss softer lighting");
  await page.getByRole("link", { name: "Images", exact: true }).first().click();
  await expect(galleryPrompt).toHaveValue("Independent gallery direction");
  await page.getByRole("link", { name: "Chat", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`));
  await expect(message).toHaveValue("Keep the same source, but discuss softer lighting");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect.poll(() => state.chatRequests.length).toBe(2);
  expect(state.chatRequests[1].generation.parentJobId).toBe(state.jobs[0].id);
  expect(state.chatRequests[1].references).toEqual(state.chatRequests[0].references);
  expect(state.sessions).toHaveLength(1);
  if (isMobile) await page.getByRole("button", { name: "Open Status", exact: true }).click();
  await page.getByRole("link", { name: "New Session", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
  await message.fill("A new independent discussion");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect.poll(() => state.sessions.length).toBe(2);
  await expect.poll(() => state.chatRequests.length).toBe(3);
  expect(state.chatRequests[2].references).toEqual([]);
  expect(state.chatRequests[2].generation.parentJobId).toBeUndefined();
});

test("Reference browsing keeps its scroll, query, filters and source in gallery and timeline editors", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(referenceItem());
  for (let index = 0; index < 30; index++)
    state.gallery.push({ ...referenceItem(), id: `study-${index}`, prompt: `Study ${index}` });
  await page.route("**/api/reference-assets?*", (route) =>
    route.fulfill({ json: { items: [], hasMore: false, nextCursor: "" } }),
  );
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
  await references.getByRole("button", { name: "Close Search", exact: true }).click();
  await references.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await references.getByRole("button", { name: "Starred", exact: true }).click();
  await finishReferences(page);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await references.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await expect(references.getByRole("button", { name: "Starred", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await references.getByRole("button", { name: "Close Filters", exact: true }).click();
  await expect(await referenceSearch(page)).toHaveValue("Copper");
  await page
    .getByRole("button", { name: "Use reference: Copper bird reference", exact: true })
    .click();
  await finishReferences(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  await page.goto(`/chat/${state.jobs[0].sessionId}`);
  await page.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
  await page
    .getByRole("article", { name: "Iteration 1", exact: true })
    .getByRole("button", { name: "Choose References", exact: true })
    .click();
  await page.getByText("Uploads", { exact: true }).click();
  await page.getByRole("textbox", { name: "Search Uploads", exact: true }).fill("Watercolour");
  await finishReferences(page);
  await page
    .getByRole("article", { name: "Iteration 1", exact: true })
    .getByRole("button", { name: "Choose References", exact: true })
    .click();
  await expect(page.getByRole("radio", { name: "Uploads", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Search Uploads", exact: true })).toHaveValue(
    "Watercolour",
  );
  await finishReferences(page);
  await page
    .getByRole("textbox", { name: "Variation Prompt", exact: true })
    .fill("Keep the picked copper reference");
  await page.getByRole("button", { name: "Generate Variation", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.referenceAssets).toEqual(state.jobs[0].input.referenceAssets);
});
