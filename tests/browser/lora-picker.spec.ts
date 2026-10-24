import { expect, test } from "@playwright/test";
import { closeLoras, create, fixtures } from "./fixtures";

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
