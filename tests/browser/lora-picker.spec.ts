import { expect, test } from "@playwright/test";
import {
  closeLoras,
  closePopup,
  create,
  fixtures,
  openLoraChoices,
  pickerTab,
  profiles,
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

test("LoRAs use catalogue family and type metadata", async ({ page }) => {
  await fixtures(page);
  await serveProfiles(page, [
    profiles[0],
    {
      ...profiles[0],
      id: "image:other",
      label: "Other Quality",
      family: "other",
      familyName: "Other Images",
      options: { loras: ["other-detail.safetensors"] },
    },
  ]);
  await page.route("**/api/loras/info", (route) =>
    route.fulfill({
      json: {
        loras: {
          "soft-style.safetensors": { title: "Soft Style", families: ["test"], type: "style" },
          "detail.safetensors": { title: "Detail Slider", families: ["test"], type: "slider" },
          "other-detail.safetensors": {
            title: "Other Detail",
            families: ["other"],
            type: "slider",
          },
        },
      },
    }),
  );
  await create(page);
  await openLoraChoices(page);
  await page.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "LoRA Filter", exact: true })
    .getByText("Style", { exact: true })
    .click();
  await closePopup(page, "Filters");
  await expect(page.getByRole("button", { name: "Detail Slider", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
  await showLoraStack(page);
  await expect(
    page.getByRole("textbox", { name: "Soft Style Strength", exact: true }),
  ).toBeVisible();
  await closeLoras(page);
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name: /^Other Quality\b/ }).click();
  await openLoraChoices(page);
  await page.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Any", exact: true })).toBeChecked();
  await closePopup(page, "Filters");
  await page.getByRole("button", { name: "Other Detail", exact: true }).click();
  await showLoraStack(page);
  await expect(
    page.getByRole("switch", { name: "Enable Other Detail", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("switch", { name: "Enable Soft Style", exact: true })).toBeChecked();
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

test("Recommended lists the family's LoRAs; All adds the rest, filtered by type", async ({
  page,
}) => {
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
  await pickerTab(page, "LoRAs", "All");
  await page.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  const types = page.getByRole("radiogroup", { name: "LoRA Filter", exact: true });
  await expect(types.getByText("Unclassified", { exact: true })).toHaveCount(0);
  await types.getByText("Style", { exact: true }).click();
  await closePopup(page, "Filters");
  await expect(choices.getByRole("button", { name: "Detail Slider", exact: true })).toHaveCount(0);
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toBeVisible();
  await pickerTab(page, "LoRAs", "Recommended");
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
  await expect(stack.getByText("Choose LoRAs or a saved stack.", { exact: true })).toBeVisible();
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
  await pickerTab(page, "LoRAs", "All");
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
