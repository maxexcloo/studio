import { expect, test, type Page } from "@playwright/test";
import { closeLoras, create, fixtures, withExpertSettings } from "./fixtures";
async function assist(page: Page, action: string) {
  await page.getByRole("button", { name: "Prompt Assistance", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function undoAssistance(page: Page, message: string) {
  const notification = page
    .getByRole("alert")
    .filter({ has: page.getByText(message, { exact: true }) });
  await notification.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notification).toBeHidden();
}

test("Enter saves and updates a preset without submitting a generation", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("A careful copper bird");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Preset Name", exact: true });
  await name.fill("Copper Study");
  await name.press("Enter");
  await expect.poll(() => state.presets.length).toBe(1);
  await expect(page.getByRole("button", { name: "Update Preset", exact: true })).toBeEnabled();
  expect(state.jobs).toHaveLength(0);
  await prompt.fill("A copper bird with blue wings");
  await name.fill("Copper Study Updated");
  await name.press("Enter");
  await expect.poll(() => state.presets[0].title).toBe("Copper Study Updated");
  expect(state.presets).toHaveLength(1);
  expect(state.jobs).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Copper Study Updated", exact: true }).click();
  await expect(prompt).toHaveValue("A copper bird with blue wings");
  // Loading a preset closes the popover; reopening it shows the loaded preset.
  await expect(name).toBeHidden();
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await expect(name).toHaveValue("Copper Study Updated");
});

test("Stopping held assistance retains the draft and unblocks generation", async ({ page }) => {
  const state = await fixtures(page);
  let started = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/assistant/rewrite", async (route) => {
    started = true;
    await held;
    await route.fulfill({ json: { prompt: "A late rewrite", source: "model" } });
  });
  try {
    await create(page);
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await prompt.fill("Keep my original bird");
    await assist(page, "Improve Prompt");
    await expect.poll(() => started).toBe(true);
    await expect(page.getByRole("button", { name: "Generate Image", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Stop Assistance", exact: true }).click();
    await expect(page.getByRole("button", { name: "Generate Image", exact: true })).toBeEnabled();
    await expect(prompt).toHaveValue("Keep my original bird");
    release();
    await page.getByRole("button", { name: "Generate Image", exact: true }).click();
    await expect.poll(() => state.jobs.length).toBe(1);
    expect(state.jobs[0].input.prompt).toBe("Keep my original bird");
  } finally {
    release();
  }
});

test("Assistance Undo restores only its changes while keeping later edits and LoRAs", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      json: {
        available: true,
        defaultPreset: "improve",
        presets: [{ id: "improve", label: "Improve" }],
        loras: true,
      },
    }),
  );
  await page.route("**/api/assistant/negative", (route) =>
    route.fulfill({ json: { negative: "poor quality", source: "model" } }),
  );
  await page.route("**/api/assistant/loras", (route) =>
    route.fulfill({
      json: {
        loras: [
          {
            name: "detail.safetensors",
            title: "Detail Slider",
            strength: 0.6,
            triggers: ["inkbird"],
            reason: "Adds fine feather detail",
          },
        ],
      },
    }),
  );
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("My original copper bird");
  await assist(page, "Improve Prompt");
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await withExpertSettings(page, () =>
    page.getByRole("textbox", { name: "Seed", exact: true }).fill("33"),
  );
  await undoAssistance(page, "Prompt improved");
  await expect(prompt).toHaveValue("My original copper bird");
  await expect(page.getByRole("button", { name: "Clear Seed 33", exact: true })).toBeVisible();
  await assist(page, "Improve Prompt");
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await prompt.fill("My later direction");
  await undoAssistance(page, "Prompt improved");
  await expect(prompt).toHaveValue("My later direction");
  await assist(page, "Write Negative");
  await withExpertSettings(page, () =>
    expect(page.getByRole("textbox", { name: "Negative Prompt", exact: true })).toHaveValue(
      "poor quality",
    ),
  );
  await prompt.fill("My later direction in warm light");
  await undoAssistance(page, "Negative prompt written");
  await expect(prompt).toHaveValue("My later direction in warm light");
  await assist(page, "Suggest LoRAs");
  await page.getByRole("button", { name: "Apply Detail Slider", exact: true }).click();
  // The backend adds trigger words when it runs; the prompt stays as written.
  await expect(
    page.getByRole("button", { name: "Apply Detail Slider", exact: true }),
  ).toBeDisabled();
  await expect(prompt).toHaveValue("My later direction in warm light");
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
  await closeLoras(page);
  await undoAssistance(page, "LoRA applied");
  await expect(prompt).toHaveValue("My later direction in warm light");
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable Soft Style", exact: true })).toBeChecked();
  await closeLoras(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input).toMatchObject({
    prompt: "My later direction in warm light",
    negative: "",
    seed: "33",
    loras: [{ name: "soft-style.safetensors", enabled: true }],
  });
});

test("Loading a new preset dismisses earlier draft Undo and keeps the preset inputs", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.presets.push({
    id: "next-draft",
    title: "Another Working Draft",
    input: {
      kind: "image",
      profileId: "image:test",
      prompt: "A cinematic amber bird",
      negative: "preset negative",
      seed: "54",
      loras: [],
      referenceAssets: [],
    },
  });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("The earlier working draft");
  await assist(page, "Improve Prompt");
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Another Working Draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeHidden();
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input).toMatchObject({
    prompt: "A cinematic amber bird",
    negative: "preset negative",
    seed: "54",
  });
});
