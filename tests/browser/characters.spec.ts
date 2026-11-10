import { expect, test, type Page } from "@playwright/test";
import { closeReferences, create, fixtures, image, stamp } from "./fixtures";

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
