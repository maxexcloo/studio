import { expect, test } from "@playwright/test";
import { closeLoras, create, fixtures, pickerTab, profiles, serveProfiles } from "./fixtures";

test("LoRA favourites persist, filters and search narrow the choices, and Trigger Words reach the generation", async ({
  page,
  isMobile,
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
            triggers: ["inkbird"],
            strengthRange: { min: 0.4, max: 1.2, step: 0.05, default: 0.8 },
          },
          "soft-style.safetensors": { title: "Soft Style", families: ["test"], type: "style" },
        },
      },
    }),
  );
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  const controls = page.getByRole("region", { name: "LoRA Controls", exact: true });
  // Desktop closes like any popover; only the phone panel has its own Back and Use actions.
  await expect(controls.getByRole("button", { name: "Use LoRAs", exact: true })).toHaveCount(
    isMobile ? 1 : 0,
  );
  const star = controls.getByRole("button", { name: "Favourite Soft Style", exact: true });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => state.loraLibrary.favorites).toEqual(["soft-style.safetensors"]);
  await controls.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  const filters = controls.getByRole("radiogroup", { name: "LoRA Filter", exact: true });
  await filters.getByText("Favourites", { exact: true }).click();
  const choices = controls.getByRole("list", { name: "Compatible LoRAs", exact: true });
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toBeVisible();
  await expect(choices.getByRole("button", { name: "Detail Slider", exact: true })).toHaveCount(0);
  await filters.getByText("All", { exact: true }).click();
  await controls.getByRole("textbox", { name: "Search LoRAs", exact: true }).fill("inkbird");
  await expect(choices.getByRole("button", { name: "Soft Style", exact: true })).toHaveCount(0);
  const detail = choices.getByRole("button", { name: "Detail Slider", exact: true });
  await detail.click();
  await expect(detail).toHaveAttribute("aria-pressed", "true");
  await expect(controls.getByText("Suggested 0.4 to 1.2", { exact: true })).toBeVisible();
  const triggers = controls.getByRole("switch", {
    name: "Detail Slider Trigger Words",
    exact: true,
  });
  await expect(triggers).toBeChecked();
  await triggers.uncheck();
  await closeLoras(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A quiet bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.loras).toEqual([
    { name: "detail.safetensors", strength: 0.8, enabled: true, triggers: false },
  ]);
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
});

test("Escape inside the LoRA picker closes only its innermost layer", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The phone panel closes with Back or Use LoRAs");
  await fixtures(page);
  await create(page);
  const chip = page.getByRole("button", { name: "Choose LoRAs", exact: true });
  await chip.click();
  const controls = page.getByRole("region", { name: "LoRA Controls", exact: true });
  const choices = controls.getByRole("list", { name: "Compatible LoRAs", exact: true });
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
  await pickerTab(page, "LoRAs", "Stacks");
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
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "LoRA Filter", exact: true })
    .getByText("Style", { exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Detail Slider", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Soft Style Strength", exact: true }),
  ).toBeVisible();
  await closeLoras(page);
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name: "Other Quality", exact: true }).click();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  await expect(page.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Other Detail", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enable Other Detail", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("switch", { name: "Enable Soft Style", exact: true })).toBeChecked();
});

test("LoRA stack ordering is preserved in submitted inputs", async ({ page }, testInfo) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An ordered adapter study");
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Detail Slider", exact: true }).click();
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
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
