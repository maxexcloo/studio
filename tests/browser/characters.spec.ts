import { expect, test, type Page } from "@playwright/test";
import { characterShots } from "../../shared/characters";
import {
  closeReferences,
  create,
  fixtures,
  image,
  profiles,
  serveProfiles,
  signIn,
  stamp,
} from "./fixtures";

const mara = {
  id: "chr-mara",
  name: "Mara",
  description: "red-haired ranger, green cloak, scar over left eye",
  referenceIds: ["asset-front", "asset-side"],
  references: ["asset-front", "asset-side"].map((id) => ({
    id,
    name: "Character Image",
    thumbnailUrl: image,
    url: image,
    width: 1024,
    height: 1024,
  })),
  missing: 0,
};

async function openCharacters(page: Page) {
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const references = page.getByRole("region", { name: "References", exact: true });
  await references.getByText("Characters", { exact: true }).click();
  return references;
}

test("Picking a character fills the reference slots and adds its description, and picking it again takes both out", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.characters.push(mara);
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("A misty forest path at dawn");
  const references = await openCharacters(page);
  // The test profile takes one reference, so the card says it uses the first of its two.
  await expect(references.getByText("Uses 1 of 2 images", { exact: true })).toBeVisible();
  await expect(
    references.getByText(
      "Image Quality takes 1 reference, so a card with more adds its first image.",
    ),
  ).toBeVisible();
  // The test profile starts from its reference (img2img), which the tab says.
  await expect(
    references.getByText(
      "Image Quality starts from a reference image (img2img), so a character's pose and layout carry over. For new scenes, choose a model that edits with references.",
    ),
  ).toBeVisible();
  await references.getByRole("button", { name: "Use character: Mara", exact: true }).click();
  await expect(
    references.getByRole("button", { name: "Remove character: Mara", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await closeReferences(page);
  await expect(prompt).toHaveValue(
    "A misty forest path at dawn, red-haired ranger, green cloak, scar over left eye",
  );
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await openCharacters(page);
  await page.getByRole("button", { name: "Remove character: Mara", exact: true }).click();
  await closeReferences(page);
  await expect(prompt).toHaveValue("A misty forest path at dawn");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toHaveCount(0);
});

test("New Character saves a name, description and gallery images from the References sheet", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "portrait",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Portrait of a ranger",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await create(page);
  const references = await openCharacters(page);
  await references.getByRole("button", { name: "New Character", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New Character", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Mara");
  await editor.getByRole("textbox", { name: "Description", exact: true }).click();
  // Phones edit the description full screen; desktops type in place.
  const description = page.getByRole("textbox", { name: "Description", exact: true }).last();
  await description.fill("red-haired ranger");
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible()) await done.click();
  await editor
    .getByRole("button", { name: "Add image: Portrait of a ranger", exact: true })
    .click();
  await expect(editor.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(
    state.characters.map(({ name, description, referenceIds }) => [
      name,
      description,
      referenceIds,
    ]),
  ).toEqual([["Mara", "red-haired ranger", ["asset-portrait"]]]);
  await expect(
    references.getByRole("button", { name: "Use character: Mara", exact: true }),
  ).toBeVisible();
});

test("Make Character starts a card from a gallery image in Library › Characters, described by the assistant", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "ranger",
    jobId: "ranger-job",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "A ranger in a green cloak",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ json: { available: true, vision: true, presets: [] } }),
  );
  const described: unknown[] = [];
  await page.route("**/api/assistant/character", (route) => {
    described.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, description: "red-haired ranger, green cloak" } });
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: A ranger in a green cloak", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Make Character/ }).click();
  await expect(page).toHaveURL(/\/library#characters$/);
  const editor = page.getByRole("dialog", { name: "New Character", exact: true });
  await expect(editor.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Mara");
  await editor.getByRole("button", { name: "Describe Image", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "red-haired ranger, green cloak",
  );
  expect(described).toEqual([{ assetId: "asset-ranger" }]);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  const cards = page.getByRole("list", { name: "Characters", exact: true });
  await expect(cards.getByRole("listitem", { name: "Mara", exact: true })).toContainText(
    "red-haired ranger, green cloak",
  );
  // Delete asks first and leaves the gallery image.
  await page.getByRole("button", { name: "Actions for Mara", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete Character", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Character", exact: true })
    .getByRole("button", { name: "Delete Character", exact: true })
    .click();
  await expect(page.getByText("No Characters", { exact: true })).toBeVisible();
  expect(state.characters).toEqual([]);
});

test("A member sees only Characters in the Library, and a group without Characters has neither tab nor Library", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "member", role: "user", features: {} });
  await page.goto("/library");
  await expect(page.getByText("No Characters", { exact: true })).toBeVisible();
  // The administration sections stay hidden.
  const select = page.getByRole("combobox", { name: "Library Section", exact: true });
  const nav = page.getByRole("navigation", { name: "Library Sections", exact: true });
  await expect(select.or(nav)).toBeVisible();
  if (await nav.isVisible()) await expect(nav.getByRole("link")).toHaveText(["Characters"]);
  else await expect(select).toHaveValue("Characters");
  await signIn(page, { id: "member", role: "user", features: { characters: false } });
  await page.goto("/library");
  await expect(page).toHaveURL(/\/images$/);
  await page.goto("/images?compose=1");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "References", exact: true }).getByText("Characters", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("Generate References queues one view per shot on a shared seed with the card's image, then the editor picks which to keep", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.characters.push(structuredClone(mara));
  // The card's image goes only to a model that edits with references, never as an img2img start.
  await serveProfiles(page, [{ ...profiles[0], editReferences: true }, ...profiles.slice(1)]);
  await page.goto("/library#characters");
  await page.getByRole("button", { name: "Actions for Mara", exact: true }).click();
  await page.getByRole("menuitem", { name: "Generate References", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(4);
  expect(state.jobs.map((job) => job.input.prompt)).toEqual(characterShots(mara.description));
  expect(new Set(state.jobs.map((job) => job.input.seed)).size).toBe(1);
  expect(state.jobs.every((job) => job.input.referenceAssets[0].assetId === "asset-front")).toBe(
    true,
  );
  await expect.poll(() => state.characters[0].generated?.jobIds.length).toBe(4);
  // Tiles follow the queued jobs, the first view first.
  const picked = `${state.characters[0].generated.jobIds[0]}:0`;
  await page.getByRole("button", { name: "Pick References", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Character", exact: true });
  const generated = editor.getByRole("list", { name: "Generated References", exact: true });
  await generated.getByRole("button", { name: "Add generated reference 1", exact: true }).click();
  await expect(editor.getByRole("img", { name: "Image 3", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(state.characters[0].referenceIds).toEqual([
    "asset-front",
    "asset-side",
    `asset-${picked}`,
  ]);
});
