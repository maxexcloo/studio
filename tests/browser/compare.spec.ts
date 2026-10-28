import { expect, test, type Locator } from "@playwright/test";
import { closeLoras, create, fixtures, image, profiles, serveProfiles, stamp } from "./fixtures";

const compareBy = (dialog: Locator, label: string) =>
  dialog
    .getByRole("radiogroup", { name: "Compare By", exact: true })
    .getByText(label, { exact: true })
    .click();

test("Compare from the composer queues one seeded variant per chosen local profile and starring the winner loads it", async ({
  page,
}) => {
  const state = await fixtures(page);
  // Another family that ignores negatives, and a cloud profile Compare leaves out.
  await serveProfiles(page, [
    ...profiles,
    {
      ...profiles[0],
      id: "image:other",
      label: "Other Image",
      family: "other",
      familyName: "Other Images",
      capabilities: { cfg: true, lora: true, negativePrompt: false },
    },
    { ...profiles[0], id: "grok-image", label: "Grok Image", family: "grok" },
  ]);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A copper fox");
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page
    .getByRole("list", { name: "LoRA Choices", exact: true })
    .getByRole("button", { name: "Detail Slider", exact: true })
    .click();
  await closeLoras(page);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A copper fox",
  );
  await dialog.getByRole("textbox", { name: "Negative Prompt", exact: true }).fill("blurry");
  const chosen = dialog.getByRole("combobox", { name: "Profiles", exact: true });
  await chosen.click();
  await expect(page.getByRole("option", { name: "Grok Image", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Other Image", exact: true }).click();
  await chosen.press("Escape");
  await expect(dialog).toContainText("LoRAs that don’t suit a profile’s family are left out");
  await dialog.getByRole("button", { name: "Compare 3 Variants", exact: true }).click();

  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const [run] = state.comparisons;
  expect(
    run.requests.map((variant: any) => [
      variant.label,
      variant.input.profileId,
      variant.input.negative,
      variant.input.loras.map((lora: any) => lora.name),
      variant.input.count,
    ]),
  ).toEqual([
    ["Image Quality", "image:test", "blurry", ["detail.safetensors"], 1],
    ["Image Fast", "image:fast", "blurry", ["detail.safetensors"], 1],
    ["Other Image", "image:other", "", [], 1],
  ]);
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();
  await expect(page.getByText("A copper fox", { exact: true })).toBeVisible();

  const star = page.getByRole("button", { name: "Star Image Fast as Winner", exact: true });
  await star.click();
  await expect(
    page.getByRole("button", { name: "Clear Winner Image Fast", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(run.vote).toBe(run.jobIds[1]);
  expect(state.gallery.find((item) => item.jobId === run.jobIds[1]).favorite).toBe(true);

  await page.getByRole("link", { name: "Open Composer", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    "Image Fast",
  );
  await expect(page.getByRole("button", { name: "Clear Seed 4242", exact: true })).toBeVisible();
});

test("Compare runs LoRAs on and off, side by side and as a strength sweep with one prompt and seed", async ({
  page,
}) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A copper fox");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare", exact: true });
  await compareBy(dialog, "LoRAs");
  const variants = dialog.getByRole("list", { name: "Variants", exact: true });
  await expect(variants.getByRole("listitem")).toHaveText([
    "A · Detail Slider Off",
    "B · Detail Slider 0.8",
  ]);
  const mode = dialog.getByRole("radiogroup", { name: "LoRA Comparison", exact: true });
  await mode.getByText("Different LoRAs", { exact: true }).click();
  await expect(variants.getByRole("listitem")).toHaveText([
    "A · Detail Slider 0.8",
    "B · Soft Style 1",
  ]);
  await mode.getByText("Strengths", { exact: true }).click();
  await expect(variants.getByRole("listitem")).toHaveText([
    "A · Detail Slider 0.4",
    "B · Detail Slider 0.7",
    "C · Detail Slider 1",
  ]);
  await dialog.getByRole("button", { name: "Compare 3 Variants", exact: true }).click();

  await expect(page).toHaveURL(/\/compare\//);
  const [run] = state.comparisons;
  expect(
    run.requests.map((variant: any) => [
      variant.input.prompt,
      variant.input.loras.map((lora: any) => [lora.name, lora.strength, lora.enabled]),
    ]),
  ).toEqual([
    ["A copper fox", [["detail.safetensors", 0.4, true]]],
    ["A copper fox", [["detail.safetensors", 0.7, true]]],
    ["A copper fox", [["detail.safetensors", 1, true]]],
  ]);
  for (const label of ["Detail Slider 0.4", "Detail Slider 0.7", "Detail Slider 1"])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
});

test("Compare from the tile menu keeps the result's seed, compares prompts with their negatives and opens variants in the viewer", async ({
  page,
}) => {
  const state = await fixtures(page);
  const settings = { profileId: "image:test", seed: 1234567, steps: 28, cfg: 5 };
  state.gallery.push({
    id: "source",
    jobId: "job-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "An amber bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings,
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: An amber bird", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Compare", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare", exact: true });
  await expect(dialog).toContainText("Every variant uses seed 1234567.");
  await compareBy(dialog, "Prompts");
  const second = dialog.getByRole("group", { name: "Variant B", exact: true });
  await second.getByRole("textbox", { name: "Prompt", exact: true }).fill("A jade bird");
  await second.getByRole("textbox", { name: "Negative Prompt", exact: true }).fill("feathers");
  await dialog.getByRole("button", { name: "Compare 2 Variants", exact: true }).click();

  await expect(page).toHaveURL(/\/compare\//);
  const [run] = state.comparisons;
  expect(
    run.requests.map((variant: any) => [
      variant.input.seed,
      variant.input.prompt,
      variant.input.negative,
    ]),
  ).toEqual([
    [1234567, "An amber bird", ""],
    [1234567, "A jade bird", "feathers"],
  ]);
  await expect(page.getByText("Seed 1234567", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open Prompt B", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
});
