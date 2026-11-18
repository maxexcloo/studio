import { type Page, expect, test } from "@playwright/test";

import { maxCharacterTrait, outfitPart, scenePart, withCharacter } from "../../shared/characters";
import {
  closeReferences,
  closeTextEditor,
  create,
  editorMenu,
  fixtures,
  image,
  openReferenceChoices,
  pickerTab,
  profiles,
  promptMenu,
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
  const references = await openReferenceChoices(page);
  await references.getByText("Characters", { exact: true }).click();
  return references;
}

test("Picking a character places its first image and leads the prompt with it, and picking it again takes both out", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.characters.push(mara);
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("A misty forest path at dawn");
  const references = await openCharacters(page);
  await expect(references.getByText("2 images", { exact: true })).toBeVisible();
  // The test profile starts from its reference (img2img) and no model edits with them, which the
  // tab says.
  await expect(
    references.getByText(
      "Image Quality keeps a reference's pose and layout. For new scenes, choose a model that edits with references.",
    ),
  ).toBeVisible();
  await references.getByRole("button", { name: "Use character: Mara", exact: true }).click();
  await expect(
    references.getByRole("button", { name: "Remove character: Mara", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await closeReferences(page);
  await expect(prompt).toHaveValue(withCharacter("A misty forest path at dawn", mara.description));
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await openCharacters(page);
  await page.getByRole("button", { name: "Remove character: Mara", exact: true }).click();
  await closeReferences(page);
  await expect(prompt).toHaveValue("A misty forest path at dawn");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toHaveCount(0);
});

for (const count of [1, 2])
  test(`Applying and removing a character preserves ${count} pre-existing manual references`, async ({
    page,
  }) => {
    const state = await fixtures(page);
    state.characters.push(mara);
    const profile = {
      ...profiles[0],
      editReferences: true,
      keepsCharacters: true,
      mediaInputs: [{ id: "image", max: 2 }],
    };
    await serveProfiles(page, [profile]);
    const references = (count === 1 ? [mara.references[1]] : mara.references).map((asset) => ({
      ...asset,
      slot: "image",
    }));
    await page.addInitScript(
      ({ references, profileId }) => {
        localStorage.setItem(
          "studio-composer-draft:local",
          JSON.stringify({
            image: {
              input: {
                kind: "image",
                profileId,
                prompt: "A forest path.",
                referenceAssets: references.map((asset) => ({
                  assetId: asset.id,
                  slot: asset.slot,
                })),
              },
              references,
              sessionId: "",
              operation: "image",
            },
          }),
        );
      },
      { references, profileId: profile.id },
    );
    await create(page);
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
      "A forest path.",
    );
    await openCharacters(page);
    await page.getByRole("button", { name: "Use character: Mara", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Remove character: Mara", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Remove character: Mara", exact: true }).click();
    await closeReferences(page);
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
      "A forest path.",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("studio-composer-draft:local")!).image.references.map(
            (asset: { id: string }) => asset.id,
          ),
        ),
      )
      .toEqual(references.map((asset) => asset.id));
  });

test("Picking a character on an img2img model moves the composer to a model that keeps characters", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.characters.push(mara);
  const keeper = {
    ...profiles[0],
    id: "image:keeper",
    label: "Keeper Fast",
    displayName: "Keeper Fast",
    editReferences: true,
    keepsCharacters: true,
  };
  await serveProfiles(page, [...profiles, keeper]);
  await create(page);
  const references = await openCharacters(page);
  await references.getByRole("button", { name: "Use character: Mara", exact: true }).click();
  await expect(
    references.getByText(
      "Switched to Keeper Fast, which keeps a character's face and build in new scenes.",
    ),
  ).toBeVisible();
  await closeReferences(page);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    withCharacter("", mara.description),
  );
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
});

test("Use in Composer stages Library cards in the composer, moving to a model that keeps characters", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.characters.push(mara);
  const harbour = "a foggy harbour at dawn";
  state.scenes.push({ id: "scene-1", name: "Harbour", description: harbour, references: [] });
  const keeper = {
    ...profiles[0],
    id: "image:keeper",
    label: "Keeper Fast",
    displayName: "Keeper Fast",
    editReferences: true,
    keepsCharacters: true,
  };
  await serveProfiles(page, [...profiles, keeper]);
  await page.goto("/library#characters");
  await page.getByRole("button", { name: "Actions for Mara", exact: true }).click();
  await expect(page.getByRole("menuitem").first()).toHaveText("Edit Character");
  await page.getByRole("menuitem", { name: "Use in Composer", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  await expect(
    page.getByText(
      "Switched to Keeper Fast, which keeps a character's face and build in new scenes.",
    ),
  ).toBeVisible();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue(withCharacter("", mara.description));
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();

  await page.goto("/library#scenes");
  await page.getByRole("button", { name: "Actions for Harbour", exact: true }).click();
  await page.getByRole("menuitem", { name: "Use in Composer", exact: true }).click();
  await expect(prompt).toHaveValue(withCharacter(scenePart(harbour, true), mara.description));
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
  const done = page.getByRole("button", { name: "Close Description", exact: true });
  if (await done.isVisible()) await done.click();
  const likes = editor.getByRole("combobox", { name: "Likes", exact: true });
  await likes.fill("Tea, Earl Grey");
  await likes.press("Enter");
  const boundaryTag = "G".repeat(maxCharacterTrait - "Tea, Earl Grey".length - 1);
  await likes.fill(boundaryTag);
  await likes.press("Enter");
  const dislikes = editor.getByRole("combobox", { name: "Dislikes", exact: true });
  await dislikes.fill("Noise");
  await dislikes.press("Enter");
  // Add Images opens the gallery choices in a popup of their own.
  await editor.getByRole("button", { name: "Add Images", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add Images", exact: true });
  // Escape closes only the popup, leaving the card under it.
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Add Images", exact: true }).click();
  // Upload is the Uploads tab's first tile, as in References, rather than a toolbar button.
  await expect(picker.getByRole("button", { name: "Upload Image", exact: true })).toHaveCount(0);
  await pickerTab(page, "Images", "Uploads");
  await expect(
    picker.getByRole("listitem").first().getByRole("button", { name: "Upload Image" }),
  ).toBeEnabled();
  await pickerTab(page, "Images", "Gallery");
  // Preview opens above the popup, and Escape closes only the preview.
  await picker
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Add image: Portrait of a ranger" }) })
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  await expect(preview.getByRole("img", { name: "Portrait of a ranger" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", { name: "Add image: Portrait of a ranger", exact: true })
    .click();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(
    editor.getByRole("button", { name: "Reference 1 · Images", exact: true }),
  ).toBeVisible();
  await expect(likes).toHaveAttribute("maxlength", "0");
  // TagsInput handles pasted phrases directly, so they also need whole-field validation.
  await likes.evaluate((input) => {
    const data = new DataTransfer();
    data.setData("text/plain", "One More, Whole Phrase");
    input.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(
    editor.getByText(`Keep the likes within ${maxCharacterTrait} characters.`, { exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.characters).toHaveLength(0);
  // Removing only the extra phrase makes the unchanged 500-character field saveable again.
  await likes.press("Backspace");
  await expect(likes).not.toHaveAttribute("aria-invalid", "true");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(
    state.characters.map(({ name, description, referenceIds, likes, dislikes }) => [
      name,
      description,
      referenceIds,
      likes,
      dislikes,
    ]),
  ).toEqual([
    ["Mara", "red-haired ranger", ["asset-portrait"], `Tea, Earl Grey\n${boundaryTag}`, "Noise"],
  ]);
  await expect(
    references.getByRole("button", { name: "Use character: Mara", exact: true }),
  ).toBeVisible();
});

test("Use as Character starts a card from a gallery image in Library › Characters, named and described by the assistant", async ({
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
    route.fulfill({
      json: { available: true, vision: true, presets: [], themes: [], changes: [] },
    }),
  );
  const asked: { field: string; assetIds: string[] }[] = [];
  await page.route("**/api/assistant/cards/ideas", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    const options =
      body.field === "name"
        ? ["Wren", "Mara", "Ivy", "Ash", "Rook", "Sloane"]
        : [
            "red-haired ranger, green cloak",
            "freckled redhead, slim build",
            "young ranger",
            "green-eyed ranger",
            "scarred ranger",
            "tall ranger",
          ];
    return route.fulfill({ json: { ok: true, options } });
  });
  const rated: unknown[] = [];
  await page.route("**/api/assistant/cards/rate", (route) => {
    rated.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, ratings: [{ rating: 4, note: "Clear face" }] } });
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: Ranger in a Green Cloak", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Use as Character/ }).click();
  await expect(page).toHaveURL(/\/library#characters$/);
  const editor = page.getByRole("dialog", { name: "New Character", exact: true });
  await expect(
    editor.getByRole("button", { name: "Reference 1 · Images", exact: true }),
  ).toBeVisible();
  // Name and Description each offer ideas written from the images; a pick has Undo.
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await editor.getByRole("button", { name: "Suggest Name", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Ash",
    "Ivy",
    "Mara",
    "Rook",
    "Sloane",
    "Wren",
    "Refresh",
    "Custom…",
  ]);
  await page.getByRole("menuitem", { name: "Wren", exact: true }).click();
  await expect(name).toHaveValue("Wren");
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(name).toHaveValue("");
  await editor.getByRole("button", { name: "Suggest Name", exact: true }).click();
  await page.getByRole("menuitem", { name: "Mara", exact: true }).click();
  await expect(name).toHaveValue("Mara");
  if (
    (await editor
      .getByRole("textbox", { name: "Description", exact: true })
      .getAttribute("inputmode")) === "none"
  )
    await editorMenu(editor, "Description", "Suggested");
  else await promptMenu(editor, "Description");
  await expect(page.getByRole("menuitem")).toHaveText([
    "freckled redhead, slim build",
    "green-eyed ranger",
    "red-haired ranger, green cloak",
    "scarred ranger",
    "tall ranger",
    "young ranger",
    "Refresh",
    "Custom…",
  ]);
  await page.getByRole("menuitem", { name: "red-haired ranger, green cloak", exact: true }).click();
  await closeTextEditor(page, "Description");
  await expect(editor.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "red-haired ranger, green cloak",
  );
  // Each field asks once; its ideas stay for the images.
  expect(asked).toEqual([
    { kind: "characters", field: "name", assetIds: ["asset-ranger"] },
    { kind: "characters", field: "description", assetIds: ["asset-ranger"] },
  ]);
  // Rate Images scores each image as the card's reference.
  await editor.getByRole("button", { name: "Rate Images", exact: true }).click();
  const ratings = editor.getByLabel("Image Ratings");
  await expect(ratings).toContainText("Image 1");
  await expect(ratings).toContainText("4/5");
  await expect(ratings).toContainText("Clear face");
  expect(rated).toEqual([{ kind: "characters", assetIds: ["asset-ranger"] }]);
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

test("A result's chat character offers Create Character in Details, starting the card with its name, description and image", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "ivo",
    jobId: "ivo-job",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "A tall smith at the forge",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    resultSet: {
      id: "set-ivo",
      title: "Forge Tales",
      index: 0,
      context: {
        character: { name: "Ivo", description: "tall smith, shaved head" },
        series: "Forge Tales",
      },
    },
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: Tall Smith at the Forge", exact: true })
    .click();
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(page.getByRole("link", { name: "Ivo", exact: true })).toHaveAttribute(
    "href",
    "/images",
  );
  await page.getByRole("button", { name: "Create Character", exact: true }).click();
  await expect(page).toHaveURL(/\/library#characters$/);
  const editor = page.getByRole("dialog", { name: "New Character", exact: true });
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Ivo");
  await expect(editor.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "tall smith, shaved head",
  );
  await editor.getByRole("textbox", { name: "Age", exact: true }).fill("40");
  await editor.getByRole("textbox", { name: "Job", exact: true }).fill("Smith");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(state.characters[0]).toMatchObject({ name: "Ivo", age: 40, job: "Smith" });
  await expect(
    page.getByRole("list", { name: "Characters", exact: true }).getByRole("listitem", {
      name: "Ivo",
      exact: true,
    }),
  ).toContainText("Age 40 · Smith");
});

test("A member sees only their cards and Presets in the Library, and a group without Characters only Presets", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "member", role: "user", features: {} });
  await page.goto("/library#characters");
  await expect(page.getByText("No Characters", { exact: true })).toBeVisible();
  // The administration sections stay hidden.
  const select = page.getByRole("combobox", { name: "Library Section", exact: true });
  const nav = page.getByRole("navigation", { name: "Library Sections", exact: true });
  await expect(select.or(nav)).toBeVisible();
  if (await nav.isVisible())
    await expect(nav.getByRole("link")).toHaveText(["Presets", "Characters", "Outfits", "Scenes"]);
  else await expect(select).toHaveValue("Characters");
  await signIn(page, { id: "member", role: "user", features: { characters: false } });
  await page.goto("/library#presets");
  // A hash-only navigation keeps the previous account in memory; load the new group's grants.
  await page.reload();
  await expect(page.getByText("No Presets", { exact: true })).toBeVisible();
  await page.goto("/images?compose=1");
  await expect(
    (await openReferenceChoices(page)).getByText("Characters", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("Make Sheet follows the card's sheet until its views show on the card", async ({ page }) => {
  const state = await fixtures(page);
  state.characters.push(structuredClone(mara));
  await page.goto("/library#characters");
  const card = page
    .getByRole("list", { name: "Characters", exact: true })
    .getByRole("listitem", { name: "Mara", exact: true });
  await page.getByRole("button", { name: "Actions for Mara", exact: true }).click();
  await page.getByRole("menuitem", { name: "Make Sheet", exact: true }).click();
  await expect(card).toContainText("2 images · Making Sheet");
  expect(state.characters[0].sheet.jobId).toBe("sheet-job");
  // A sheet in the making can't be made again.
  await page.getByRole("button", { name: "Actions for Mara", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Make Sheet", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  state.characters[0].sheet = {
    ...state.characters[0].sheet,
    status: "done",
    panels: ["face", "front", "side", "back", "sheet"].map((role) => ({
      ...mara.references[0],
      id: `asset-${role}`,
      role,
    })),
  };
  await page.reload();
  await expect(card).toContainText("2 images · Sheet");
  const views = card.getByRole("group", { name: "Mara's Sheet", exact: true });
  for (const role of ["Face", "Front", "Side", "Back"])
    await expect(views.getByRole("img", { name: `Mara ${role}`, exact: true })).toBeVisible();
  // A view opens full size over the page, and Escape closes only it.
  await views.getByRole("button", { name: "Preview Mara Front", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  await expect(preview.getByRole("img", { name: "Mara Front", exact: true })).toBeVisible();
  await expect(preview.getByText("2 / 4", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(preview.getByRole("img", { name: "Mara Side", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  // Only the Library stays.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  // The editor shows the sheet too, and makes it again.
  await page.getByRole("button", { name: "Actions for Mara", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit Character", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Character", exact: true });
  const sheet = editor.getByRole("region", { name: "Sheet", exact: true });
  await expect(
    sheet.getByRole("group", { name: "Mara's Sheet", exact: true }).getByRole("img"),
  ).toHaveCount(4);
  await sheet.getByRole("button", { name: "Make Sheet Again", exact: true }).click();
  await expect(sheet.getByRole("status")).toHaveText("Making Sheet…");
});

test("Picking and removing outfits preserves handwritten text even when it matches a saved card", async ({
  page,
}) => {
  const state = await fixtures(page);
  const yellow = "a yellow raincoat";
  state.outfits.push(
    { id: "out-yellow", name: "Yellow", description: yellow, references: [] },
    { id: "out-red", name: "Red", description: "a red raincoat", references: [] },
  );
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const typed = `${outfitPart(yellow)} At a bus stop.`;
  await prompt.fill(typed);
  const pick = async (label: string) => {
    const references = await openReferenceChoices(page);
    await references.getByText("Outfits", { exact: true }).click();
    await references.getByRole("button", { name: label, exact: true }).click();
    await closeReferences(page);
  };
  await pick("Use outfit: Red");
  await expect(prompt).toHaveValue(`${outfitPart("a red raincoat")} ${typed}`);
  await pick("Remove outfit: Red");
  await expect(prompt).toHaveValue(typed);
  await pick("Use outfit: Yellow");
  await expect(prompt).toHaveValue(typed);
  await pick("Remove outfit: Yellow");
  await expect(prompt).toHaveValue(typed);
});

test("Outfits and scenes go into the prompt in order from the References sheet, and are made in the Library", async ({
  page,
}) => {
  const state = await fixtures(page);
  const raincoat = "a yellow raincoat and black rubber boots";
  const harbour = "a foggy harbour at dawn";
  state.outfits.push({ id: "outfit-1", name: "Raincoat", description: raincoat, references: [] });
  state.scenes.push({ id: "scene-1", name: "Harbour", description: harbour, references: [] });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Walking slowly.");
  const pick = async (tab: string, name: string) => {
    const references = await openReferenceChoices(page);
    await references.getByText(tab, { exact: true }).click();
    await references.getByRole("button", { name, exact: true }).click();
    await closeReferences(page);
  };
  // Picked scene first, the outfit still goes before it.
  await pick("Scenes", "Use scene: Harbour");
  await pick("Outfits", "Use outfit: Raincoat");
  await expect(prompt).toHaveValue(`${outfitPart(raincoat)} ${scenePart(harbour)} Walking slowly.`);
  await pick("Outfits", "Remove outfit: Raincoat");
  await expect(prompt).toHaveValue(`${scenePart(harbour)} Walking slowly.`);
  // Library › Outfits saves a new card.
  await page.goto("/library#outfits");
  await page.getByRole("button", { name: "New Outfit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New Outfit", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Gala");
  await editor
    .getByRole("textbox", { name: "Description", exact: true })
    .last()
    .fill("an emerald gown and gold heels");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(state.outfits.map((card) => [card.name, card.description])).toEqual([
    ["Raincoat", raincoat],
    ["Gala", "an emerald gown and gold heels"],
  ]);
});
