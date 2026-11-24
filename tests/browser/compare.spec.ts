import { type Page, expect, test } from "@playwright/test";

import {
  closeLoras,
  create,
  finishTyping,
  fixtures,
  image,
  openLoraChoices,
  openNav,
  profiles,
  section,
  selectionMenuItem,
  serveProfiles,
  stamp,
  viewerAction,
} from "./fixtures";

const compareChip = (page: Page) =>
  page
    .getByRole("group", { name: "Generation Inputs", exact: true })
    .getByRole("button", { name: /^Compare\b/ });
const openCompare = async (page: Page) => {
  await compareChip(page).click();
  return page.getByRole("dialog", { name: "Compare", exact: true });
};
// Choices apply as they are made; Done only closes the popup.
const axis = async (page: Page, name: string) => {
  const setup = await openCompare(page);
  await setup.getByRole("combobox", { name: "What to Vary", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  return setup;
};
const done = async (page: Page) => {
  const setup = page.getByRole("dialog", { name: "Compare", exact: true });
  await setup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(setup).toBeHidden();
};
const clearComparison = async (page: Page) => {
  const setup = await openCompare(page);
  await setup.getByRole("button", { name: "Clear", exact: true }).click();
  await done(page);
};
const expectVariantCount = (page: Page, count: number) =>
  expect(compareChip(page)).toHaveText(count ? `Compare · ${count}` : "Compare");
const submitCompare = (page: Page) =>
  page
    .getByRole("group", { name: "Generation Actions", exact: true })
    .getByRole("button", { name: "Generate Images", exact: true });
const runComparison = async (page: Page) => {
  await finishTyping(page);
  await submitCompare(page).click();
};
const prompt = (page: Page) => page.getByRole("textbox", { name: "Prompt", exact: true });

test("Every compared variant runs on the composer's settings, changing only the chosen axis", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await create(page);
  await prompt(page).fill("A copper fox");
  await openLoraChoices(page);
  await page
    .getByRole("list", { name: "LoRA Choices", exact: true })
    .getByRole("button", { name: "Detail Slider", exact: true })
    .click();
  await closeLoras(page);

  // Picking an axis applies at once; a model comparison waits for a second model.
  const models = await axis(page, "Model");
  await expectVariantCount(page, 1);
  await expect(submitCompare(page)).toHaveAttribute("aria-disabled", "true");
  await models.getByRole("checkbox", { name: "Image Fast", exact: true }).check();
  await done(page);
  await expectVariantCount(page, 2);
  // A change in the composer reaches every variant, and no control edits one alone.
  await prompt(page).fill("A silver fox");
  await expect(page.getByRole("radiogroup", { name: "Variant", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Variant", exact: true })).toHaveCount(0);

  // The draft keeps its comparison across a reload.
  await page.reload();
  await expectVariantCount(page, 2);
  if (testInfo.project.use.isMobile) {
    const controls = page.getByRole("group", { name: "Generation Actions", exact: true });
    await expect(
      controls.getByRole("radiogroup", { name: "Generation Output", exact: true }),
    ).toBeInViewport();
    await expect(controls.getByRole("button", { name: "Clear", exact: true })).toBeInViewport();
    await expect(submitCompare(page)).toBeInViewport();
    expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
  await runComparison(page);

  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const [run] = state.comparisons;
  expect(
    run.requests.map((variant: any) => [
      variant.label,
      variant.input.profileId,
      variant.input.prompt,
      variant.input.loras.map((lora: any) => lora.name),
      variant.input.count,
    ]),
  ).toEqual([
    ["Image Quality · 20 Steps", "image:test", "A silver fox", ["detail.safetensors"], 1],
    ["Image Fast · 4 Steps", "image:fast", "A silver fox", ["detail.safetensors"], 1],
  ]);
  expect(run.requests[0].input.seed).toBe(run.requests[1].input.seed);
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();

  // Picking the winner likes it without touching the composer; Use This takes one there.
  await page
    .getByRole("button", { name: "Pick Image Fast · 4 Steps as Winner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear Winner Image Fast · 4 Steps", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(run.vote).toBe(run.jobIds[1]);
  expect(state.gallery.find((item) => item.jobId === run.jobIds[1]).rating).toBe("liked");
  await page.getByRole("button", { name: "Use Image Fast · 4 Steps", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  await expect(prompt(page)).toHaveValue("A silver fox");
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    "Image Fast",
  );
  await expect(page.getByRole("button", { name: "Clear Seed 4242", exact: true })).toBeVisible();
  await expectVariantCount(page, 0);
});

test("Compare ▾ varies each line of the prompt, then seeds", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await prompt(page).fill("A copper fox\nA silver fox\nA golden fox");
  await axis(page, "Prompt");
  await done(page);
  await expectVariantCount(page, 3);
  await prompt(page).fill("A copper fox\nA silver fox");
  await expectVariantCount(page, 2);

  // Clear ends the comparison; another axis starts afresh.
  await clearComparison(page);
  await expectVariantCount(page, 0);
  await prompt(page).fill("A golden fox");
  const setup = await axis(page, "Seed");
  await setup.getByRole("textbox", { name: "Seeds", exact: true }).fill("3");
  await done(page);
  await expectVariantCount(page, 3);
  await runComparison(page);
  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const requests = state.comparisons[0].requests;
  expect(requests.map((variant: any) => variant.input.prompt)).toEqual(
    Array(3).fill("A golden fox"),
  );
  expect(new Set(requests.map((variant: any) => variant.input.seed)).size).toBe(3);
  expect(requests.every((variant: any) => /^Seed \d+$/.test(variant.label))).toBe(true);
});

test("Compare ▾ builds variants across a LoRA's strengths and across models", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await prompt(page).fill("A copper fox");
  await openLoraChoices(page);
  await page
    .getByRole("list", { name: "LoRA Choices", exact: true })
    .getByRole("button", { name: "Detail Slider", exact: true })
    .click();
  await closeLoras(page);

  const strengths = await axis(page, "LoRA Strength");
  await strengths.getByRole("combobox", { name: "LoRA", exact: true }).click();
  await page.getByRole("option", { name: "Detail Slider", exact: true }).click();
  // Only strengths within the LoRA's range are offered, starting from its default and neighbours.
  const values = strengths.getByRole("group", { name: "Strengths", exact: true });
  await expect(strengths.getByText("Supports -3 to 10.", { exact: true })).toBeVisible();
  const chip = (name: string) => values.getByRole("checkbox", { name, exact: true });
  for (const name of ["Without LoRA", "-2", "0.8", "2"]) await expect(chip(name)).toBeChecked();
  await values.getByText("-2", { exact: true }).click();
  await expect(chip("-2")).not.toBeChecked();
  await values.getByText("10", { exact: true }).click();
  await done(page);
  await expectVariantCount(page, 4);

  // Another axis replaces it, on the composer's own LoRA stack and seed.
  const models = await axis(page, "Model");
  await models.getByRole("checkbox", { name: "Image Fast", exact: true }).check();
  await done(page);
  await runComparison(page);
  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const requests = state.comparisons[0].requests;
  expect(
    requests.map((variant: any) => [
      variant.label,
      variant.input.profileId,
      variant.input.prompt,
      variant.input.loras.length,
    ]),
  ).toEqual([
    ["Image Quality · 20 Steps", "image:test", "A copper fox", 1],
    ["Image Fast · 4 Steps", "image:fast", "A copper fox", 1],
  ]);
  expect(requests[0].input.seed).toBe(requests[1].input.seed);
});

test("Compare searches a long model list, reaches its last choice and retains the exact selected profiles", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await serveProfiles(page, [
    profiles[0],
    ...Array.from({ length: 40 }, (_, index) => ({
      ...profiles[0],
      id: `image:candidate-${index}`,
      label: `Candidate ${String(index).padStart(2, "0")} · ${index === 39 ? "Quality" : "Fast"} · ComfyUI · 8 Steps · 4 References`,
    })),
  ]);
  await create(page);
  await prompt(page).fill("A copper fox");
  const setup = await axis(page, "Model");
  const search = setup.getByRole("textbox", { name: "Search Models", exact: true });
  if (testInfo.project.use.isMobile) await expect(search).not.toBeFocused();
  const scrollY = await page.evaluate(() => window.scrollY);
  const options = setup.getByRole("group", { name: "Models", exact: true });
  const last = options.getByRole("checkbox", { name: "Candidate 39 · Quality", exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await search.fill("Quality");
  await expect(options.getByRole("checkbox")).toHaveCount(1);
  await last.check();
  await done(page);
  await runComparison(page);
  await expect.poll(() => state.comparisons.length).toBe(1);
  expect(state.comparisons[0].requests.map((variant: any) => variant.input.profileId)).toEqual([
    "image:test",
    "image:candidate-39",
  ]);
});

test("Compare stages compatible LoRAs from an empty stack and only the model's native resolutions", async ({
  page,
}) => {
  const state = await fixtures(page);
  await serveProfiles(page, [
    {
      ...profiles[0],
      native: { "2k": "yes" },
      constraints: {
        width: { min: 512, max: 2048, step: 16 },
        height: { min: 512, max: 2048, step: 16 },
      },
    },
  ]);
  await create(page);
  await prompt(page).fill("A copper fox");
  const loras = await axis(page, "LoRA");
  await loras.getByRole("checkbox", { name: "Detail Slider", exact: true }).check();
  await loras.getByRole("checkbox", { name: "Soft Style", exact: true }).check();
  await done(page);
  await expectVariantCount(page, 3);
  // Resolution replaces the LoRA comparison, which left the composer's own stack empty.
  const resolutions = await axis(page, "Resolution");
  const sizes = resolutions.getByRole("group", { name: "Resolutions", exact: true });
  await expect(sizes.getByRole("checkbox")).toHaveCount(2);
  await sizes.getByRole("checkbox", { name: "1K", exact: true }).check();
  await sizes.getByRole("checkbox", { name: "2K", exact: true }).check();
  await done(page);
  await runComparison(page);
  await expect.poll(() => state.comparisons.length).toBe(1);
  const requests = state.comparisons[0].requests;
  expect(requests.map((variant: any) => [variant.input.width, variant.input.height])).toEqual([
    [1024, 1024],
    [2048, 2048],
  ]);
  expect(requests.every((variant: any) => variant.input.loras.length === 0)).toBe(true);
  expect(requests[0].input.seed).toBe(requests[1].input.seed);
});

test("Compare preserves provider resolution enum values without converting them to tiers", async ({
  page,
}) => {
  const state = await fixtures(page);
  await serveProfiles(page, [
    { ...profiles[0], options: { ...profiles[0].options, resolutions: ["1k", "2k"] } },
  ]);
  await create(page);
  await prompt(page).fill("A copper fox");
  const setup = await axis(page, "Resolution");
  const choices = setup.getByRole("group", { name: "Resolutions", exact: true });
  await expect(choices.getByRole("checkbox")).toHaveCount(2);
  await choices.getByRole("checkbox", { name: "1K", exact: true }).check();
  await choices.getByRole("checkbox", { name: "2K", exact: true }).check();
  await done(page);
  await runComparison(page);
  await expect.poll(() => state.comparisons.length).toBe(1);
  expect(state.comparisons[0].requests.map((variant: any) => variant.input.resolution)).toEqual([
    "1k",
    "2k",
  ]);
  expect(state.comparisons[0].requests.map((variant: any) => variant.label)).toEqual(["1K", "2K"]);
});

test("Test in the Library LoRA menu sweeps a LoRA's strength in the composer", async ({ page }) => {
  const state = await fixtures(page);
  await page.route("**/api/library/items", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            key: "loras/detail.safetensors",
            title: "Detail Slider",
            file: "detail.safetensors",
            folder: "loras",
            kind: "lora",
            installed: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/library/imports", (route) =>
    route.fulfill({
      json: {
        imports: [
          {
            id: "import-1",
            state: "ready",
            preset: { prompt: "A fox in fine detail", settings: {} },
            resources: [
              {
                name: "Detail",
                status: "installed",
                role: "lora",
                localName: "detail.safetensors",
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "LoRAs");
  await page.getByRole("button", { name: "Actions for Detail Slider", exact: true }).click();
  await page.getByRole("menuitem", { name: "Test", exact: true }).click();
  await expect(prompt(page)).toHaveValue("A fox in fine detail");
  await expectVariantCount(page, 4);
  await runComparison(page);
  await expect(page).toHaveURL(/\/compare\//);
  expect(
    state.comparisons[0].requests.map((variant: any) => [
      variant.label,
      variant.input.loras.map((lora: any) => [lora.name, lora.strength]),
    ]),
  ).toEqual([
    ["Detail Slider Off", []],
    ["Detail Slider -2", [["detail.safetensors", -2]]],
    ["Detail Slider 0.8", [["detail.safetensors", 0.8]]],
    ["Detail Slider 2", [["detail.safetensors", 2]]],
  ]);
});

test("Compare from a result keeps its seed, and Compare Again brings every variant back from the winner", async ({
  page,
}) => {
  const state = await fixtures(page);
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
    settings: { profileId: "image:test", seed: 1234567, steps: 28, cfg: 5 },
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: Amber Bird", exact: true })
    .click({ button: "right" });
  // Off the menu, so no submenu opens under the pointer and takes the next click as outside it.
  await page.mouse.move(0, 0);
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.getByRole("menuitem", { name: "Recreate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Compare in Composer", exact: true }).click();
  // It compares seeds from the result's own, on its exact settings.
  await expectVariantCount(page, 4);
  await expect(page.getByRole("button", { name: "Clear Seed 1234567", exact: true })).toBeVisible();
  const setup = await openCompare(page);
  await setup.getByRole("textbox", { name: "Seeds", exact: true }).fill("3");
  await done(page);
  await prompt(page).fill("A jade bird");
  await runComparison(page);

  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const [run] = state.comparisons;
  const seeds = run.requests.map((variant: any) => variant.input.seed);
  expect(seeds[0]).toBe("1234567");
  expect(new Set(seeds).size).toBe(3);
  expect(run.requests.map((variant: any) => variant.input.prompt)).toEqual(
    Array(3).fill("A jade bird"),
  );
  expect(state.jobs.every((job: any) => job.parentItemId === "source")).toBe(true);
  await page.getByRole("button", { name: `Open Seed ${seeds[1]}`, exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  if (!test.info().project.use.isMobile) {
    // The first Escape closes the docked Details, the next the viewer.
    await page.keyboard.press("Escape");
    await expect(viewer).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await page.keyboard.press("2");
  await expect(
    page.getByRole("button", { name: `Clear Winner Seed ${seeds[1]}`, exact: true }),
  ).toBeAttached();

  // Compare Again brings the variants back, the winner first; one can go, and a change reaches all.
  await page.getByRole("button", { name: "Compare Again", exact: true }).click();
  await expect(prompt(page)).toHaveValue("A jade bird");
  await expectVariantCount(page, 3);
  const overview = await openCompare(page);
  await overview.getByRole("button", { name: "Remove Variant C", exact: true }).click();
  await expect(overview.getByRole("listitem")).toHaveCount(2);
  await done(page);
  await prompt(page).fill("A jade bird in flight");
  await runComparison(page);
  await expect(page).toHaveURL(/\/compare\/compare-2$/);
  expect(
    state.comparisons[1].requests.map((variant: any) => [variant.input.seed, variant.input.prompt]),
  ).toEqual([
    [seeds[1], "A jade bird in flight"],
    [seeds[0], "A jade bird in flight"],
  ]);
  expect(state.jobs.slice(3).map((job: any) => [job.parentJobId, job.parentItemId])).toEqual([
    [run.jobIds[1], `${run.jobIds[1]}:0`],
    [run.jobIds[1], `${run.jobIds[1]}:0`],
  ]);

  // The run is a set in the gallery that links back to its comparison.
  await page.getByRole("link", { name: "Show in Gallery", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  // Its results keep the prompt's title; the variant's label is secondary.
  await page
    .getByRole("button", { name: "Open image: Jade Bird in Flight", exact: true })
    .first()
    .click();
  await expect(viewer.getByText(/^Seed \d+ · /).first()).toBeVisible();
  // The viewer's AI menu opens the comparison the image belongs to.
  await viewerAction(page, "Discover");
  await page.getByRole("menuitem", { name: "Open Comparison", exact: true }).click();
  await expect(page).toHaveURL(/\/compare\/compare-2$/);
});

test("Compare Selected sets chosen images side by side, number keys pick the winner and the gallery finds it", async ({
  page,
}) => {
  const state = await fixtures(page);
  const result = (id: string, jobId: string, prompt: string) => ({
    id,
    jobId,
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt,
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings: { profileId: "image:test", seed: 7 },
  });
  state.gallery.push(
    result("batch-0", "job-batch", "A tin owl"),
    result("batch-1", "job-batch", "A glass owl"),
    result("single", "job-single", "A felt owl"),
  );
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Felt Owl", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  const pick = (title: string) =>
    page.getByRole("button", { name: `Select image: ${title}`, exact: true }).click();
  await pick("Tin Owl");
  await pick("Glass Owl");
  await (await selectionMenuItem(page, "Recreate", "Compare")).click();

  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  expect(state.comparisons[0].itemIds).toEqual(["batch-0", "batch-1"]);
  await expect(page.getByText("A tin owl", { exact: true })).toBeVisible();
  await page.keyboard.press("2");
  await expect(
    page.getByRole("button", { name: "Clear Winner Variant B", exact: true }),
  ).toBeAttached();
  expect(state.comparisons[0].vote).toBe("job-batch");
  expect(state.comparisons[0].winnerItemId).toBe("batch-1");
  await page.keyboard.press("1");
  await expect(
    page.getByRole("button", { name: "Clear Winner Variant A", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(state.comparisons[0].winnerItemId).toBe("batch-0");
  await page.keyboard.press("1");
  await expect(
    page.getByRole("button", { name: "Pick Variant A as Winner", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(state.comparisons[0].winnerItemId).toBeNull();

  // The Comparisons view lists the new comparison, covered by its first variant.
  await page.getByRole("link", { name: "Back to Comparisons", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gallery View", exact: true })).toHaveText(
    "Comparisons",
  );
  await expect(
    page.getByRole("button", { name: "Open Comparison: Tin Owl", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open image: Felt Owl", exact: true })).toHaveCount(
    0,
  );
});

test("Recreate On runs each selected image again on another model beside its original", async ({
  page,
}) => {
  const state = await fixtures(page);
  for (const [id, prompt] of [
    ["tin", "A tin owl"],
    ["felt", "A felt owl"],
  ]) {
    const settings = {
      profileId: "retired-model",
      profileName: "Image Quality",
      seed: 7,
      count: 2,
    };
    const item = {
      id,
      jobId: `job-${id}`,
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      prompt,
      width: 832,
      height: 1216,
      createdAt: stamp,
      settings,
    };
    state.jobs.push({
      id: item.jobId,
      jobId: item.jobId,
      sessionId: "session-owls",
      status: "completed",
      operation: "image",
      input: { kind: "image", prompt, ...settings },
      items: [item],
      outputs: [item],
      createdAt: stamp,
      updatedAt: stamp,
    });
    state.gallery.push(item);
  }
  await page.goto("/images");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  for (const title of ["Tin Owl", "Felt Owl"])
    await page.getByRole("button", { name: `Select image: ${title}`, exact: true }).click();
  await (await selectionMenuItem(page, "Recreate", "Recreate On…")).click();
  const dialog = page.getByRole("dialog", { name: "Recreate On", exact: true });
  await expect(dialog.getByRole("button", { name: "Recreate", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: /^Image Fast/ }).click();
  await dialog.getByRole("button", { name: "Recreate", exact: true }).click();
  // Several comparisons wait in Comparisons, each the original beside its new run.
  await expect(page).toHaveURL(/\/images\/comparisons$/);
  expect(state.jobs.slice(2)).toMatchObject(
    ["tin", "felt"].map((id) => ({
      sessionId: "session-owls",
      parentItemId: id,
      input: {
        profileId: "image:fast",
        prompt: id === "tin" ? "A tin owl" : "A felt owl",
        seed: 7,
        count: 1,
      },
    })),
  );
  expect(state.comparisons.map(({ jobIds, itemIds, labels }) => [jobIds, itemIds, labels])).toEqual(
    ["tin", "felt"].map((id, index) => [
      [`job-${id}`, state.jobs[index + 2].id],
      [id, ""],
      ["Image Quality", "Image Fast"],
    ]),
  );
});

test("Variants of a result show their numbers, the axis they vary and propose a pick for the brief", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  const names = ["Blue Hour", "Golden Dusk", "Midday"];
  const items = names.map((name, index) => ({
    id: `variant-${index}:0`,
    jobId: `variant-${index}`,
    index: 0,
    number: 12 + index,
    status: "done",
    type: "image",
    url: image,
    thumbnailUrl: image,
    prompt: `A fox at ${name.toLowerCase()}`,
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings: { profileId: "image:test", seed: "7" },
  }));
  state.gallery.unshift(...items);
  const comparison = (winner?: (typeof items)[number], proposal?: object) => ({
    id: "fox-options",
    createdAt: stamp,
    seed: "7",
    axis: "lighting",
    vote: winner?.jobId ?? null,
    winnerItemId: winner?.id ?? null,
    variants: items.map((item, index) => ({
      jobId: item.jobId,
      label: `${"ABC"[index]} · ${names[index]}`,
      item,
    })),
    ...(proposal ? { proposal } : {}),
  });
  await page.route("**/api/comparisons/fox-options", (route) =>
    route.fulfill({ json: comparison() }),
  );
  await page.route("**/api/comparisons/fox-options/vote", (route) =>
    route.fulfill({
      json: comparison(items[1], {
        projectId: "foxes",
        name: "Foxes",
      }),
    }),
  );
  await page.goto("/compare/fox-options");
  await expect(page.getByRole("heading", { name: "Which Lighting?", exact: true })).toBeVisible();
  if (testInfo.project.use.isMobile) {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 740, height: 320 });
    const first = page.getByRole("button", { name: "Open A · Blue Hour", exact: true });
    const tileHeight = async () => (await first.boundingBox())?.height ?? 0;
    await expect.poll(tileHeight).toBeGreaterThan(100);
    await page.getByText("Side by Side", { exact: true }).click();
    await expect.poll(tileHeight).toBeGreaterThan(100);
    await page.getByText("Scroll", { exact: true }).click();
    await page.setViewportSize(viewport);
  }

  await page.getByText("Scroll", { exact: true }).click();
  const next = page.getByRole("button", { name: "Next Variant", exact: true });
  const track = page.getByRole("region", { name: "Comparison Variants", exact: true });
  await expect(track).toBeVisible();
  expect(
    await next.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) return false;
      const row = document.querySelector<HTMLElement>('[aria-label="Comparison Variants"]')!;
      button.click();
      return Math.round(row.scrollLeft) === row.clientWidth;
    }),
  ).toBe(true);
  await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();

  await page.getByText("Split", { exact: true }).click();
  await page.getByRole("combobox", { name: "Second Variant", exact: true }).click();
  await page.getByRole("option", { name: "C · Midday", exact: true }).click();
  const comparisonImage = page.getByRole("img", { name: "C · Midday", exact: true });
  await comparisonImage.scrollIntoViewIfNeeded();
  const slider = page.getByRole("slider", { name: "Comparison Position", exact: true });
  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  const handle = (await page.locator("[data-comparison-divider] > span").boundingBox())!;
  const picture = (await comparisonImage.boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    testInfo.project.use.isMobile ? x : picture.x + picture.width * 0.75,
    testInfo.project.use.isMobile ? picture.y + picture.height * 0.25 : y,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", "75");
  await page.getByText("Side by Side", { exact: true }).click();

  // Picking one proposes it for the chat's project brief in Dream's Inbox.
  await page.getByRole("button", { name: "Pick B · Golden Dusk as Winner", exact: true }).click();
  await expect(
    page.getByText("Proposed for Foxes's brief in Dream's Inbox", { exact: true }),
  ).toBeVisible();

  // Details carry no result number.
  await page.getByRole("button", { name: "Open B · Golden Dusk", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  if (testInfo.project.use.isMobile)
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(page.getByText("File Size", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "#13", exact: true })).toHaveCount(0);
});
