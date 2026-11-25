import { type Page, expect, test } from "@playwright/test";

import {
  backToActionMenu,
  closeLoras,
  closePresets,
  create,
  expandAssistantMenu,
  finishTyping,
  fixtures,
  loadSaved,
  openLoraChoices,
  openPresets,
  pressGenerate,
  promptMenu,
  promptTool,
  saveCurrent,
  showLoraStack,
  stamp,
  withSettings,
} from "./fixtures";
// A single style is named Improve Prompt too.
async function assist(page: Page, action: string) {
  const menu = await promptMenu(page, "Prompt");
  if (action === "Improve Prompt") await expandAssistantMenu(menu, "Templates");
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
}

async function undoAssistance(page: Page, message: string) {
  const notification = page
    .getByRole("alert")
    .filter({ has: page.getByText(message, { exact: true }) });
  await notification.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notification).toBeHidden();
}

test("Saving and updating a preset never submits a generation, and the name shows when it is edited", async ({
  page,
}) => {
  const state = await fixtures(page);
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("A careful copper bird");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  const name = page.getByRole("combobox", { name: "Preset Name", exact: true });
  await expect(name).toHaveValue("");
  await expect(name).toHaveAttribute("placeholder", "Unsaved Preset");
  await saveCurrent(page, "Copper Study");
  await expect.poll(() => state.presets.length).toBe(1);
  expect(state.jobs).toHaveLength(0);
  const update = page.getByRole("option", { name: "Update Preset", exact: true });
  await closePresets(page);
  await prompt.fill("A copper bird with blue wings");
  await openPresets(page);
  await expect(name).toHaveValue("Copper Study");
  await name.click();
  await update.click();
  await expect.poll(() => state.presets[0].input.prompt).toBe("A copper bird with blue wings");
  await name.click();
  await expect(update).toHaveCount(0);
  await name.press("Escape");
  expect(state.presets).toHaveLength(1);
  expect(state.jobs).toHaveLength(0);
  await page.reload();
  // The draft survives the reload, so clear it to show the preset fills the prompt.
  await prompt.fill("");
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await loadSaved(page, "Copper Study");
  await expect(prompt).toHaveValue("A copper bird with blue wings");
  // Loading a preset closes the picker; reopening it names the loaded preset, unchanged.
  await expect(name).toBeHidden();
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await expect(name).toHaveValue("Copper Study");
  await name.click();
  await expect(update).toHaveCount(0);
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
    await finishTyping(page);
    await expect(page.getByRole("button", { name: "Generate Image", exact: true })).toBeDisabled();
    // The phone sheet's resting prompt says what it is doing. Its Stop returns with typing.
    const stop = page.getByRole("button", { name: "Stop Assistance", exact: true });
    if (!(await stop.isVisible())) {
      await expect(page.getByRole("status").filter({ hasText: "Improving Prompt…" })).toBeVisible();
      await prompt.click();
    }
    await expect(stop).toHaveAccessibleDescription("Improving Prompt…");
    await stop.click();
    await finishTyping(page);
    await expect(page.getByRole("button", { name: "Generate Image", exact: true })).toBeEnabled();
    await expect(prompt).toHaveValue("Keep my original bird");
    release();
    await pressGenerate(page);
    await expect.poll(() => state.jobs.length).toBe(1);
    expect(state.jobs[0].input.prompt).toBe("Keep my original bird");
  } finally {
    release();
  }
});

test("Assistance Undo restores only its changes while keeping later edits and LoRAs", async ({
  page,
}, testInfo) => {
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
  let releaseNegative!: () => void;
  const negativeReply = new Promise<void>((resolve) => {
    releaseNegative = resolve;
  });
  await page.route("**/api/assistant/negative", async (route) => {
    await negativeReply;
    await route.fulfill({ json: { negative: "poor quality", source: "model" } });
  });
  const noMatch = "None of the available LoRAs fits this prompt.";
  const failure = "LoRA suggestions are temporarily unavailable.";
  let loraRequests = 0;
  let releaseLoras!: () => void;
  const loraReply = new Promise<void>((resolve) => {
    releaseLoras = resolve;
  });
  await page.route("**/api/assistant/loras", async (route) => {
    loraRequests++;
    if (loraRequests === 1) {
      await loraReply;
      return route.fulfill({ json: { loras: [], reason: noMatch } });
    }
    if (loraRequests === 2) return route.fulfill({ status: 503, json: { error: failure } });
    return route.fulfill({
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
    });
  });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("My original copper bird");
  // Set first: the Prompt improved notification covers the Settings chip on this composer.
  await withSettings(page, () =>
    page.getByRole("textbox", { name: "Seed", exact: true }).fill("33"),
  );
  await assist(page, "Improve Prompt");
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await undoAssistance(page, "Prompt improved");
  await expect(prompt).toHaveValue("My original copper bird");
  await expect(page.getByRole("button", { name: "Clear Seed 33", exact: true })).toBeVisible();
  await assist(page, "Improve Prompt");
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await prompt.fill("My later direction");
  await undoAssistance(page, "Prompt improved");
  await expect(prompt).toHaveValue("My later direction");
  const negative = page.getByRole("textbox", { name: "Negative Prompt", exact: true });
  await expect(negative).toBeVisible();
  const promptBox = (await prompt.boundingBox())!;
  const negativeBox = (await negative.boundingBox())!;
  expect(negativeBox.y).toBeGreaterThanOrEqual(promptBox.y + promptBox.height);
  expect(negativeBox.height).toBeLessThan(promptBox.height);
  if (testInfo.project.use.isMobile) {
    await prompt.click();
    await expect(negative).toBeHidden();
  }
  await finishTyping(page);
  const negativeMenu = await promptMenu(page, "Negative Prompt");
  await expect(
    negativeMenu.getByRole("menuitem", { name: "Loading…", exact: true }),
  ).toBeDisabled();
  releaseNegative();
  const suggestion = negativeMenu.getByRole("menuitem", { name: "poor quality", exact: true });
  await expect(suggestion).toBeVisible();
  await expect(negative).toHaveValue("");
  await suggestion.click();
  await expect(negative).toBeVisible();
  await expect(negative).toHaveValue("poor quality");
  await expect(prompt).toBeVisible();
  if (testInfo.project.use.isMobile) {
    await expect(prompt).not.toBeFocused();
    await expect(page.getByRole("button", { name: "Close Generate", exact: true })).toBeVisible();
  }
  await prompt.fill("My later direction in warm light");
  await undoAssistance(page, "Negative prompt written");
  await expect(negative).toHaveValue("");
  await expect(prompt).toHaveValue("My later direction in warm light");
  await finishTyping(page);
  await openLoraChoices(page);
  const suggest = page.getByRole("button", { name: "Suggest LoRAs", exact: true });
  const picker = page.locator("[data-chip-popup]").filter({ has: suggest });
  await suggest.click();
  try {
    await expect(suggest).toBeDisabled();
    await expect(picker.getByRole("status").filter({ hasText: "Finding LoRAs…" })).toBeVisible();
  } finally {
    releaseLoras();
  }
  await expect(picker.getByRole("status").filter({ hasText: noMatch })).toBeVisible();
  await suggest.click();
  await expect(picker.getByRole("alert").filter({ hasText: failure })).toBeVisible();
  await expect(page.getByText(failure, { exact: true })).toHaveCount(1);
  await showLoraStack(page);
  await expect(page.getByRole("alert").filter({ hasText: failure })).toBeVisible();
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "Add LoRAs", exact: true }).click();
  // A suggestion joins the stack at once; the backend adds trigger words when it runs.
  await suggest.click();
  await expect(prompt).toHaveValue("My later direction in warm light");
  await page.getByRole("button", { name: "Soft Style", exact: true }).click();
  await showLoraStack(page);
  await expect(
    page.getByRole("switch", { name: "Enable Detail Slider", exact: true }),
  ).toBeChecked();
  await closeLoras(page);
  await undoAssistance(page, "LoRA added");
  await expect(prompt).toHaveValue("My later direction in warm light");
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable Soft Style", exact: true })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Enable Detail Slider", exact: true })).toHaveCount(
    0,
  );
  await closeLoras(page);
  await pressGenerate(page);
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
  await loadSaved(page, "Another Working Draft");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeHidden();
  await expect(prompt).toHaveValue("A cinematic amber bird");
  await pressGenerate(page);
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input).toMatchObject({
    prompt: "A cinematic amber bird",
    negative: "preset negative",
    seed: "54",
  });
});

test("Prompt assistance finishes before a generation is submitted", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("bird");
  await assist(page, "Improve Prompt");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A cinematic amber bird",
  );
  await page.getByRole("textbox", { name: "Prompt", exact: true }).press("Control+Enter");
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A cinematic amber bird");
});

test("Improve Prompt groups its styles in Templates and opens Custom… directly", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      json: {
        available: true,
        defaultPreset: "enhance",
        presets: [
          { id: "portrait", label: "Portrait", description: "A person in focus." },
          { id: "enhance", label: "Enhance" },
          { id: "candid", label: "Candid" },
          { id: "custom", label: "Custom" },
        ],
      },
    }),
  );
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A bird in snow");
  const menu = await promptMenu(page, "Prompt");
  const phone = await page.getByRole("group", { name: "Prompt Tools", exact: true }).isVisible();
  if (phone) {
    const tools = page.getByRole("group", { name: "Prompt Tools", exact: true });
    await expect(tools.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  }
  // Suggestions greys with its reason until it has options.
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Suggestions/,
    "Templates",
    /^Custom…/,
    "Refresh",
    "Write Negative",
  ]);
  await expandAssistantMenu(menu, "Templates");
  const templates = menu.getByRole("group", { name: "Templates", exact: true });
  await expect(templates.getByRole("menuitem")).toHaveText(["Candid", "Enhance", /^Portrait/]);
  await expect(
    templates.getByRole("menuitem", { name: "Portrait", exact: true }),
  ).toHaveAccessibleDescription("A person in focus.");
  await backToActionMenu(menu);
  await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Custom Improvement", exact: true });
  const request = dialog.getByRole("textbox", { name: "Change", exact: true });
  await expect(request).toBeVisible();
  if (phone) await expect(request).not.toBeFocused();
  await expect(dialog.getByRole("button", { name: "Improve", exact: true })).toBeDisabled();
  await dialog
    .getByRole("button", { name: phone ? "Close Custom Improvement" : "Cancel", exact: true })
    .click();
  await expect(dialog).toBeHidden();
});

test("Custom… rewrites the draft's prompt in place, for Generate to run or Undo to restore", async ({
  page,
}) => {
  const state = await fixtures(page);
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    if (body.surface !== "draft") return route.fallback();
    asked.push(body);
    if (body.request === undefined)
      return route.fulfill({
        json: {
          suggestions: [{ label: "Add Rain", request: "add rain", prompt: "A castle in rain" }],
        },
      });
    return route.fulfill({
      json: {
        suggestions: [
          {
            action: "recreate",
            label: "Night",
            request: body.request,
            prompt: "A castle at night",
          },
        ],
      },
    });
  });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("A castle at noon");
  await assist(page, "Custom…");
  const dialog = page.getByRole("dialog", { name: "Custom Improvement", exact: true });
  const request = dialog.getByRole("textbox", { name: "Change", exact: true });
  await request.fill("make it night");
  await request.press("Control+Enter");
  await expect(dialog).toBeHidden();
  await expect(prompt).toHaveValue("A castle at night");
  await expect(page.getByLabel("Proposed Action", { exact: true })).toHaveText("Generate");
  // Opening the AI menu asked for the draft's suggestions before Custom… sent its request.
  const suggestionsAsked = {
    surface: "draft",
    kind: "image",
    profileId: "image:test",
    prompt: "A castle at noon",
    fresh: false,
  };
  const night = {
    surface: "draft",
    kind: "image",
    profileId: "image:test",
    prompt: "A castle at noon",
    request: "make it night",
    actions: ["recreate"],
  };
  expect(asked).toEqual([suggestionsAsked, night]);
  // Undo restores the draft; Custom… keeps the request for the next time.
  await finishTyping(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(prompt).toHaveValue("A castle at noon");
  await expect(page.getByLabel("Proposed Action", { exact: true })).toBeHidden();
  await assist(page, "Custom…");
  await expect(request).toHaveValue("make it night");
  await request.press("Enter");
  await expect(prompt).toHaveValue("A castle at night");
  await pressGenerate(page);
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A castle at night");
});

test("Prompt history reuses positive and negative prompts independently and persists likes", async ({
  page,
}) => {
  await fixtures(page);
  const histories = {
    positive: [{ text: "Earlier landscape", at: stamp, uses: 2, liked: false }],
    negative: [{ text: "Earlier exclusions", at: stamp, uses: 1, liked: false }],
  };
  await page.route("**/api/prompts**", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const body = request.method() === "POST" ? request.postDataJSON() : {};
    const kind = (body.kind ||
      url.searchParams.get("kind") ||
      "positive") as keyof typeof histories;
    if (url.pathname.endsWith("/pin")) {
      const entry = histories[kind].find((entry) => entry.text === body.text);
      if (entry) entry.liked = body.liked;
    }
    if (url.pathname.endsWith("/forget"))
      histories[kind] = histories[kind].filter((entry) => entry.text !== body.text);
    return route.fulfill({ json: { prompts: histories[kind], enabled: true } });
  });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const negative = page.getByRole("textbox", { name: "Negative Prompt", exact: true });
  await negative.fill("Keep these exclusions");
  await finishTyping(page);
  await page.getByRole("button", { name: "Recent", exact: true }).click();
  let panel = page.getByRole("dialog", { name: "Recent", exact: true });
  const like = panel.getByRole("button", { name: "Like Prompt", exact: true });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  const historySearch = panel.getByRole("textbox", { name: "Search Prompt History", exact: true });
  await historySearch.fill("landscape");
  await historySearch.press("ArrowDown");
  await historySearch.press("Enter");
  await expect(prompt).toHaveValue("Earlier landscape");
  await expect(negative).toHaveValue("Keep these exclusions");
  await promptTool(page, "Negative Prompt", "Recent");
  panel = page.getByRole("dialog", { name: "Recent", exact: true });
  await panel.getByRole("option", { name: "Use Prompt: Earlier exclusions", exact: true }).click();
  await expect(negative).toHaveValue("Earlier exclusions");
  await expect(prompt).toHaveValue("Earlier landscape");
  expect(histories.positive[0].liked).toBe(true);
});

test("Recent Prompts likes and switches at once, and a refused change is undone", async ({
  page,
}) => {
  await fixtures(page);
  let history = {
    prompts: [{ text: "Earlier landscape", at: stamp, uses: 2 }] as {
      text: string;
      at: string;
      uses: number;
      liked?: boolean;
    }[],
    enabled: true,
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/prompts**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/pin")) {
      await held;
      history.prompts[0].liked = true;
    }
    if (path.endsWith("/enabled")) {
      const { enabled } = route.request().postDataJSON();
      // Switching off saves; switching back on fails the way a dropped connection did.
      if (enabled) return route.fulfill({ status: 502, body: "Bad Gateway" });
      history = { prompts: history.prompts.filter((entry) => entry.liked), enabled };
    }
    return route.fulfill({ json: history });
  });
  await create(page);
  await finishTyping(page);
  await page.getByRole("button", { name: "Recent", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Recent", exact: true });
  // The like shows while the server is still answering.
  const like = panel.getByRole("button", { name: "Like Prompt", exact: true });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  release();
  const save = panel.getByRole("switch", { name: "Keep Recent Prompts", exact: true });
  await save.click();
  await expect(save).not.toBeChecked();
  await save.click();
  await expect(
    page.getByText("Studio is restarting. Try again in a moment.", { exact: true }),
  ).toBeVisible();
  await expect(save).not.toBeChecked();
  await expect(panel.getByRole("option", { name: "Use Prompt: Earlier landscape" })).toBeVisible();
});
