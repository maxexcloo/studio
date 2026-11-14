import { expect, test } from "@playwright/test";

import {
  closeLoras,
  create,
  fixtures,
  openLoraChoices,
  pickerTab,
  profiles,
  renamePreset,
  saveCurrent,
  serveProfiles,
  showLoraStack,
} from "./fixtures";

test("LoRA ratings persist and order the list, tabs and search narrow the choices, and Trigger Words reach the generation", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.route("**/api/loras/info", (route) =>
    route.fulfill({
      json: {
        loras: {
          "detail.safetensors": {
            title: "Detail Slider",
            families: ["test"],
            type: "slider",
            triggers: ["inkbird", "fine detail"],
            strengthRange: { min: 0.4, max: 1.2, step: 0.05, default: 0.8 },
          },
          "soft-style.safetensors": { title: "Soft Style", families: ["test"], type: "style" },
        },
      },
    }),
  );
  await create(page);
  await openLoraChoices(page);
  const controls = page.getByRole("dialog", { name: "LoRAs", exact: true });
  // Choices apply at once; the popup closes like any other.
  await expect(page.getByRole("button", { name: "Use LoRAs", exact: true })).toHaveCount(0);
  const up = page.getByRole("button", { name: "Thumbs Up Soft Style", exact: true });
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Thumbs Down Detail Slider", exact: true }).click();
  await expect
    .poll(() => state.loraLibrary.ratings)
    .toEqual({ "soft-style.safetensors": "up", "detail.safetensors": "down" });
  const choices = page.getByRole("list", { name: "LoRA Choices", exact: true });
  // Thumbs up lead and thumbs down trail, whatever the alphabet says.
  await expect
    .poll(() =>
      choices
        .getByRole("button", { name: /^(Soft Style|Detail Slider)$/ })
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    )
    .toEqual(["Soft Style", "Detail Slider"]);
  // Sorting by name sets the ratings aside.
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await page.getByRole("menuitem", { name: "Name A–Z", exact: true }).click();
  await expect
    .poll(() =>
      choices
        .getByRole("button", { name: /^(Soft Style|Detail Slider)$/ })
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    )
    .toEqual(["Detail Slider", "Soft Style"]);
  await pickerTab(page, "LoRAs", "Starred");
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toBeVisible();
  await expect(choices.getByRole("button", { name: "Detail Slider", exact: true })).toHaveCount(0);
  await pickerTab(page, "LoRAs", "All");
  await page.getByRole("textbox", { name: "Search LoRAs", exact: true }).fill("inkbird");
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toHaveCount(0);
  const detail = choices.getByRole("button", { name: "Detail Slider", exact: true });
  await detail.click();
  await expect(detail).toHaveAttribute("aria-pressed", "true");
  await showLoraStack(page);
  await expect(
    controls.getByText("Suggested 0.4 to 1.2, default 0.8", { exact: true }),
  ).toBeVisible();
  // Every trigger word starts on; tapping one switches it off.
  const triggers = controls.getByRole("group", {
    name: "Detail Slider Trigger Words",
    exact: true,
  });
  const inkbird = triggers.getByRole("checkbox", { name: "inkbird", exact: true });
  await expect(inkbird).toBeChecked();
  await triggers.getByText("inkbird", { exact: true }).click();
  await expect(inkbird).not.toBeChecked();
  await expect(triggers.getByRole("checkbox", { name: "fine detail", exact: true })).toBeChecked();
  await closeLoras(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A quiet bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.loras).toEqual([
    { name: "detail.safetensors", strength: 0.8, enabled: true, triggers: ["fine detail"] },
  ]);
  await create(page);
  await openLoraChoices(page);
  await expect(up).toHaveAttribute("aria-pressed", "true");
});

test("Escape inside the LoRA picker closes only its innermost layer", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Phones close the popup with its Close action");
  await fixtures(page);
  await create(page);
  const chip = page.getByRole("button", { name: "Choose LoRAs", exact: true });
  await chip.click();
  const controls = page.getByRole("dialog", { name: "LoRAs", exact: true });
  const choices = controls.getByRole("list", { name: "LoRA Choices", exact: true });
  for (const name of ["Detail Slider", "Soft Style"])
    await choices.getByRole("button", { name, exact: true }).click();
  // A keyboard drag cancels on Escape.
  const handle = controls.getByRole("button", { name: "Drag Soft Style", exact: true });
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await expect(controls).toBeVisible();
  // An open sort menu closes first.
  const sort = controls.getByRole("button", { name: "Sort", exact: true });
  await sort.click();
  await expect(sort).toHaveAttribute("aria-expanded", "true");
  await expect(controls.getByRole("menuitem", { name: "Name A–Z" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sort).toHaveAttribute("aria-expanded", "false");
  await expect(controls).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(controls).toBeHidden();
  await expect(chip).toBeFocused();
});

test("The LoRA list starts on the profile's family and filters by family", async ({ page }) => {
  await fixtures(page);
  await serveProfiles(page, [
    {
      ...profiles[0],
      options: {
        ...profiles[0].options,
        loras: ["detail.safetensors", "soft-style.safetensors", "other-detail.safetensors"],
      },
    },
  ]);
  await page.route("**/api/loras/info", (route) =>
    route.fulfill({
      json: {
        loras: {
          "soft-style.safetensors": { title: "Soft Style", families: ["test"], type: "style" },
          "detail.safetensors": { title: "Detail Slider", families: ["test"], type: "slider" },
          "other-detail.safetensors": { title: "Other Detail", families: ["other"] },
        },
      },
    }),
  );
  await create(page);
  await openLoraChoices(page);
  const choices = page.getByRole("list", { name: "LoRA Choices", exact: true });
  await expect(page.getByRole("button", { name: "Filter LoRAs", exact: true })).toHaveCount(0);
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toBeVisible();
  await expect(choices.getByRole("button", { name: "Other Detail", exact: true })).toHaveCount(0);
  const family = page.getByRole("combobox", { name: "Family", exact: true });
  await family.click();
  await page.getByRole("option", { name: "All Families", exact: true }).click();
  await expect(choices.getByRole("button", { name: "Other Detail", exact: true })).toBeVisible();
  await family.click();
  await page.getByRole("option", { name: "Other", exact: true }).click();
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toHaveCount(0);
  await choices.getByRole("button", { name: "Other Detail", exact: true }).click();
  await showLoraStack(page);
  await expect(
    page.getByRole("switch", { name: "Enable Other Detail", exact: true }),
  ).toBeChecked();
  // A LoRA for another family is flagged in the stack.
  await expect(
    page.getByText("This profile can't use this LoRA. Disable or remove it.", { exact: true }),
  ).toBeVisible();
});

test("LoRA stack ordering is preserved in submitted inputs", async ({ page }, testInfo) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An ordered adapter study");
  await openLoraChoices(page);
  await page.getByRole("button", { name: "Detail Slider", exact: true }).click();
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
  await showLoraStack(page);
  await expect(page.getByRole("button", { name: "Drag Soft Style", exact: true })).toBeEnabled();
  const earlier = page.getByRole("button", { name: "Move Soft Style Earlier", exact: true });
  await earlier.focus();
  await earlier.press("Enter");
  // Focus stays on the moved LoRA, on the move that is still possible.
  await expect(
    page.getByRole("button", { name: "Move Soft Style Later", exact: true }),
  ).toBeFocused();
  if (!testInfo.project.use.isMobile) {
    const drag = page.getByRole("button", { name: "Drag Detail Slider", exact: true });
    await drag.focus();
    await drag.press("Space");
    await drag.press("ArrowUp");
    await drag.press("Space");
  }
  await closeLoras(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.loras.map((lora: { name: string }) => lora.name)).toEqual(
    testInfo.project.use.isMobile
      ? ["soft-style.safetensors", "detail.safetensors"]
      : ["detail.safetensors", "soft-style.safetensors"],
  );
});

test("LoRAs without a family show under All Families", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/loras/info", (route) =>
    route.fulfill({
      json: {
        loras: {
          "detail.safetensors": {
            title: "Detail Slider",
            families: ["test"],
            strengthRange: { min: 0.2, max: 0.8, step: 0.05 },
          },
          "soft-style.safetensors": { title: "Soft Style", type: "style" },
        },
      },
    }),
  );
  await create(page);
  await openLoraChoices(page);
  const choices = page.getByRole("list", { name: "LoRA Choices", exact: true });
  await expect(choices.getByRole("button", { name: "Detail Slider", exact: true })).toBeVisible();
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Family", exact: true }).click();
  await page.getByRole("option", { name: "All Families", exact: true }).click();
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toBeVisible();
  // Clicking a row adds its LoRA and shows it chosen; the thumbs beside it rate without toggling.
  const row = choices.getByRole("button", { name: "Detail Slider", exact: true });
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await choices.getByRole("button", { name: "Thumbs Up Detail Slider", exact: true }).click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  // Without a published default, a new LoRA starts at 1 kept within its range.
  await showLoraStack(page);
  await expect(
    page.getByRole("textbox", { name: "Detail Slider Strength", exact: true }),
  ).toHaveValue("0.8");
});

test("Phones open the stack first and add LoRAs from a list that scrolls under its search", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Desktop shows the choices beside the stack");
  const files = Array.from({ length: 30 }, (_, index) => `extra-${index}.safetensors`);
  await fixtures(page);
  await serveProfiles(page, [
    {
      ...profiles[0],
      options: { ...profiles[0].options, loras: ["detail.safetensors", ...files] },
    },
  ]);
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  const stack = page.getByRole("dialog", { name: "LoRAs", exact: true });
  await expect(stack.getByText("Choose LoRAs or a preset.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "LoRA Choices", exact: true })).toHaveCount(0);
  // The footer's actions share one row without overlapping.
  const [add, clear, apply] = await Promise.all(
    ["Add LoRAs", "Clear LoRAs", "Apply"].map((name) =>
      stack.getByRole("button", { name, exact: true }).boundingBox(),
    ),
  );
  expect(add!.x + add!.width).toBeLessThanOrEqual(clear!.x);
  expect(apply!.y).toBeCloseTo(add!.y, 0);
  await stack.getByRole("button", { name: "Add LoRAs", exact: true }).click();
  const adding = page.getByRole("dialog", { name: "Add LoRAs", exact: true });
  // The search waits for a tap, so the keyboard stays down.
  const search = adding.getByRole("textbox", { name: "Search LoRAs", exact: true });
  await expect(search).toBeVisible();
  await expect(search).not.toBeFocused();
  // The extra LoRAs list no family, so they show under All Families.
  await adding.getByRole("combobox", { name: "Family", exact: true }).click();
  await page.getByRole("option", { name: "All Families", exact: true }).click();
  // The list scrolls inside itself, keeping the search and the footer in sight.
  await adding.getByRole("button", { name: "extra-9", exact: true }).scrollIntoViewIfNeeded();
  await expect(search).toBeInViewport();
  await expect(adding.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await adding.getByRole("button", { name: "Detail Slider", exact: true }).click();
  await showLoraStack(page);
  // The stack keeps its controls under the sheet's Add LoRAs.
  await expect(
    stack.getByRole("switch", { name: "Enable Detail Slider", exact: true }),
  ).toBeChecked();
  await expect(
    stack.getByRole("textbox", { name: "Detail Slider Strength", exact: true }),
  ).toBeVisible();
  await closeLoras(page);
});

test("The stack's preset field saves, loads and renames LoRA presets, marks edits and keeps names unique", async ({
  page,
}) => {
  const state = await fixtures(page);
  const portrait = [{ name: "detail.safetensors", strength: 0.8, enabled: true }];
  const lorasOnly = { input: { loras: portrait }, parts: ["loras"], family: "test" };
  state.presets.push(
    { id: "portrait", title: "Portrait", savedAt: "2026-11-01T00:00:00.000Z", ...lorasOnly },
    { id: "twin-a", title: "Twin", savedAt: "2026-11-02T00:00:00.000Z", ...lorasOnly },
    { id: "twin-b", title: "Twin", savedAt: "2026-11-03T00:00:00.000Z", ...lorasOnly },
  );
  await create(page);
  await openLoraChoices(page);
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
  await showLoraStack(page);
  const name = page.getByRole("combobox", { name: "Preset Name", exact: true });
  await expect(name).toHaveValue("");
  await expect(name).toHaveAttribute("placeholder", "Unsaved Preset");
  // Names stay unique: a name in use offers that preset rather than saving another.
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect(name).toBeFocused();
  await name.fill("portrait");
  await expect(page.getByRole("option", { name: /^Save as New Preset/ })).toHaveCount(0);
  await expect(page.getByText("A preset has this name", { exact: true })).toBeVisible();
  await name.press("Escape");
  await saveCurrent(page, "Soft Look");
  await expect.poll(() => state.presets.length).toBe(4);
  expect(state.presets[3]).toMatchObject({
    title: "Soft Look",
    parts: ["loras"],
    family: "test",
    input: { loras: [{ name: "soft-style.safetensors", enabled: true }] },
  });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Preset", exact: true })).toBeDisabled();
  await renamePreset(page, "Soft Look Two");
  await expect.poll(() => state.presets[3].title).toBe("Soft Look Two");
  // Older duplicates show when each was saved.
  await name.click();
  await expect(page.getByRole("option", { name: "Twin", exact: true })).toHaveCount(2);
  await page.getByRole("option", { name: "Portrait", exact: true }).click();
  // The stack matched a saved preset, so loading another asks nothing.
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toHaveCount(0);
  await expect(name).toHaveValue("Portrait");
  const detail = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(detail).toBeChecked();
  await expect(page.getByRole("switch", { name: "Enable Soft Style", exact: true })).toHaveCount(0);
  await detail.uncheck();
  await expect(page.getByText("Edited", { exact: true })).toBeVisible();
  await name.click();
  await page.getByRole("option", { name: "Soft Look Two", exact: true }).click();
  await expect(
    page.getByText("Replace the current LoRAs with “Soft Look Two”?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(name).toHaveValue("Soft Look Two");
  await expect(page.getByText("Edited", { exact: true })).toBeHidden();
  expect(state.presets[0].input.loras).toEqual(portrait);
  expect(state.jobs).toHaveLength(0);
});
