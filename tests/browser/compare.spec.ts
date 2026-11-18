import { type Page, expect, test } from "@playwright/test";

import {
  closeLoras,
  create,
  fixtures,
  image,
  openLoraChoices,
  openNav,
  pressGenerate,
  profiles,
  section,
  selectionMenuItem,
  serveProfiles,
  stamp,
  viewerAction,
} from "./fixtures";

const openCompare = async (page: Page) => {
  await page
    .getByRole("group", { name: "Generation Inputs", exact: true })
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Compare", exact: true });
};
const compareMenu = async (page: Page, item: string) => {
  const setup = await openCompare(page);
  await setup.getByRole("button", { name: item, exact: true }).click();
};
const axis = async (page: Page, name: string) => {
  const setup = await openCompare(page);
  await setup.getByRole("combobox", { name: "What to Vary", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  return setup;
};
const start = async (page: Page) => {
  const setup = page.getByRole("dialog", { name: "Compare", exact: true });
  await setup.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(setup).toBeHidden();
};
const variants = (page: Page) => page.getByRole("radiogroup", { name: "Variant", exact: true });
const prompt = (page: Page) => page.getByRole("textbox", { name: "Prompt", exact: true });

test("The composer compares variants that each change one thing, as one labelled set", async ({
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

  // Variant B copies A, then runs on another profile.
  await compareMenu(page, "Add Variant");
  await expect(variants(page).getByRole("radio", { name: "B", exact: true })).toBeChecked();
  await expect(prompt(page)).toHaveValue("A copper fox");
  await expect(page.getByRole("button", { name: "Compare 2", exact: true })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name: /^Image Fast\b/ }).click();
  await expect(page.getByText("Image Fast", { exact: true }).first()).toBeVisible();
  // Variant C duplicates B with another prompt; A keeps its own settings.
  await compareMenu(page, "Duplicate Variant B");
  await prompt(page).fill("A silver fox");
  await variants(page).getByText("A", { exact: true }).click();
  await expect(prompt(page)).toHaveValue("A copper fox");
  // Each variant's tooltip names what sets it apart.
  if (!testInfo.project.use.isMobile) {
    await variants(page).getByText("A", { exact: true }).hover();
    await expect(
      page.getByRole("tooltip", { name: "Image Quality · Prompt A", exact: true }),
    ).toBeVisible();
  }

  // The draft keeps its variants across a reload.
  await page.reload();
  await expect(variants(page).getByRole("radio")).toHaveCount(3);
  if (testInfo.project.use.isMobile) {
    const controls = page.getByRole("group", { name: "Generation Actions", exact: true });
    await expect(
      controls.getByRole("radiogroup", { name: "Generation Output", exact: true }),
    ).toBeInViewport();
    await expect(controls.getByRole("button", { name: "Clear", exact: true })).toBeInViewport();
    await expect(controls.getByRole("button", { name: "Compare 3", exact: true })).toBeInViewport();
    expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await expect(
      page
        .getByRole("group", { name: "Generation Inputs", exact: true })
        .getByRole("button", { name: "Compare", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Compare 3", exact: true }).click();

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
    ["Image Quality · Prompt A", "image:test", "A copper fox", ["detail.safetensors"], 1],
    ["Image Fast · Prompt A", "image:fast", "A copper fox", ["detail.safetensors"], 1],
    ["Image Fast · Prompt C", "image:fast", "A silver fox", ["detail.safetensors"], 1],
  ]);
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();

  // Picking the winner likes it without touching the composer; Use This takes one there.
  await page
    .getByRole("button", { name: "Pick Image Fast · Prompt A as Winner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear Winner Image Fast · Prompt A", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(run.vote).toBe(run.jobIds[1]);
  expect(state.gallery.find((item) => item.jobId === run.jobIds[1]).rating).toBe("liked");
  await page.getByRole("button", { name: "Use Image Fast · Prompt C", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  await expect(prompt(page)).toHaveValue("A silver fox");
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    "Image Fast",
  );
  await expect(page.getByRole("button", { name: "Clear Seed 4242", exact: true })).toBeVisible();
  await expect(variants(page)).toHaveCount(0);
});

test("Compare ▾ builds several variants at once from prompt lines and seeds", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await prompt(page).fill("A copper fox\nA silver fox\nA golden fox");
  await axis(page, "Prompt");
  await start(page);
  await expect(variants(page).getByRole("radio")).toHaveCount(3);
  await expect(prompt(page)).toHaveValue("A copper fox");

  // Duplicating copies the variant being edited, not A.
  await variants(page).getByText("B", { exact: true }).click();
  await compareMenu(page, "Duplicate Variant B");
  await expect(variants(page).getByRole("radio", { name: "D", exact: true })).toBeChecked();
  await expect(prompt(page)).toHaveValue("A silver fox");

  // Seeds start over from the variant being edited, each run with its own seed.
  const setup = await axis(page, "Seed");
  await setup.getByRole("textbox", { name: "Seeds", exact: true }).fill("3");
  await start(page);
  await expect(variants(page).getByRole("radio")).toHaveCount(3);
  await page.getByRole("button", { name: "Compare 3", exact: true }).click();
  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const requests = state.comparisons[0].requests;
  expect(requests.map((variant: any) => variant.input.prompt)).toEqual(
    Array(3).fill("A silver fox"),
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
  await start(page);
  await expect(variants(page).getByRole("radio")).toHaveCount(4);

  // Models start over from the variant being edited (A, without the LoRA), keeping its seed.
  const models = await axis(page, "Model");
  await expect(models.getByRole("button", { name: "Compare", exact: true })).toBeDisabled();
  const search = models.getByRole("combobox", { name: "Models", exact: true });
  await search.fill("Fast");
  await page.getByRole("option", { name: "Image Fast", exact: true }).click();
  await search.press("Escape");
  await expect(models).toBeVisible();
  await start(page);
  await pressGenerate(page, "Compare 2");
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
    ["Image Quality", "image:test", "A copper fox", 0],
    ["Image Fast", "image:fast", "A copper fox", 0],
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
  const search = setup.getByRole("combobox", { name: "Models", exact: true });
  if (testInfo.project.use.isMobile) await expect(search).not.toBeFocused();
  await search.click();
  const scrollY = await page.evaluate(() => window.scrollY);
  const last = page.getByRole("option", { name: "Candidate 39 · Quality", exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await search.fill("Quality");
  await expect(page.getByRole("option")).toHaveText(["Candidate 39 · Quality"]);
  await last.click();
  if (testInfo.project.use.isMobile) {
    await setup.getByRole("button", { name: "Compare", exact: true }).tap();
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(setup).toBeVisible();
    await expect(variants(page)).toHaveCount(0);
  } else await search.press("Escape");
  await expect(setup).toBeVisible();
  await start(page);
  await pressGenerate(page, "Compare 2");
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
  const choices = loras.getByRole("combobox", { name: "LoRAs", exact: true });
  await choices.fill("Detail");
  await page.getByRole("option", { name: "Detail Slider", exact: true }).click();
  await choices.fill("Soft");
  await page.getByRole("option", { name: "Soft Style", exact: true }).click();
  await choices.press("Escape");
  await start(page);
  await expect(variants(page).getByRole("radio")).toHaveCount(3);
  await variants(page).getByText("B", { exact: true }).click();
  const resolutions = await axis(page, "Resolution");
  const sizes = resolutions.getByRole("combobox", { name: "Resolutions", exact: true });
  await resolutions.locator(".mantine-MultiSelect-input").click();
  await expect(page.getByRole("option")).toHaveText(["1K", "2K"]);
  await page.getByRole("option", { name: "1K", exact: true }).click();
  await page.getByRole("option", { name: "2K", exact: true }).click();
  await sizes.press("Escape");
  await start(page);
  await pressGenerate(page, "Compare 2");
  await expect.poll(() => state.comparisons.length).toBe(1);
  const requests = state.comparisons[0].requests;
  expect(requests.map((variant: any) => [variant.input.width, variant.input.height])).toEqual([
    [1024, 1024],
    [2048, 2048],
  ]);
  expect(
    requests.every((variant: any) => variant.input.loras[0].name === "detail.safetensors"),
  ).toBe(true);
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
  const choices = setup.getByRole("combobox", { name: "Resolutions", exact: true });
  await setup.locator(".mantine-MultiSelect-input").click();
  await expect(page.getByRole("option")).toHaveText(["1K", "2K"]);
  await page.getByRole("option", { name: "1K", exact: true }).click();
  await page.getByRole("option", { name: "2K", exact: true }).click();
  await choices.press("Escape");
  await start(page);
  await pressGenerate(page, "Compare 2");
  await expect.poll(() => state.comparisons.length).toBe(1);
  expect(state.comparisons[0].requests.map((variant: any) => variant.input.resolution)).toEqual([
    "1k",
    "2k",
  ]);
  expect(state.comparisons[0].requests.map((variant: any) => variant.label)).toEqual(["1K", "2K"]);
});

test("Test LoRA in the Library sweeps a LoRA's strength in the composer", async ({ page }) => {
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
  await page.getByRole("menuitem", { name: "Test LoRA", exact: true }).click();
  await expect(prompt(page)).toHaveValue("A fox in fine detail");
  await expect(variants(page).getByRole("radio")).toHaveCount(4);
  await page.getByRole("button", { name: "Compare 4", exact: true }).click();
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
  // The tile menu lists comparing in a section of its own, not under Recreate.
  await page.getByRole("menuitem", { name: "Compare in Composer", exact: true }).click();
  await expect(variants(page).getByRole("radio", { name: "B", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Clear Seed 1234567", exact: true })).toBeVisible();
  await prompt(page).fill("A jade bird");
  await pressGenerate(page, "Compare 2");

  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const [run] = state.comparisons;
  expect(run.requests.map((variant: any) => [variant.input.seed, variant.input.prompt])).toEqual([
    [1234567, "An amber bird"],
    [1234567, "A jade bird"],
  ]);
  expect(state.jobs.every((job: any) => job.parentItemId === "source")).toBe(true);
  await page.getByRole("button", { name: "Open Prompt B", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("2");
  await expect(
    page.getByRole("button", { name: "Clear Winner Prompt B", exact: true }),
  ).toBeAttached();
  await page.getByRole("button", { name: "Compare Again", exact: true }).click();
  await expect(prompt(page)).toHaveValue("A jade bird");
  await variants(page).getByText("B", { exact: true }).click();
  await prompt(page).fill("A jade bird in flight");
  await pressGenerate(page, "Compare 2");
  await expect(page).toHaveURL(/\/compare\/compare-2$/);
  expect(state.comparisons[1].requests.map((variant: any) => variant.input.prompt)).toEqual([
    "A jade bird",
    "A jade bird in flight",
  ]);
  expect(state.jobs.slice(2).map((job: any) => [job.parentJobId, job.parentItemId])).toEqual([
    [run.jobIds[1], `${run.jobIds[1]}:0`],
    [run.jobIds[1], `${run.jobIds[1]}:0`],
  ]);

  // The run is a set in the gallery that links back to its comparison.
  await page.getByRole("link", { name: "Show in Gallery", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  await page.getByRole("button", { name: "Open image: Prompt B", exact: true }).click();
  await expect(page.getByTitle("Open Comparison", { exact: true })).toHaveAttribute(
    "href",
    "/compare/compare-2",
  );
  // AI ▾ also opens the comparison the image belongs to.
  await viewerAction(page, "AI");
  await expect(
    page.getByRole("menuitem", { name: "Compare in Composer", exact: true }),
  ).toBeVisible();
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
  await expect(page.getByText("Prompt: A tin owl", { exact: true })).toBeVisible();
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

  // The Comparisons filter keeps only compared results.
  await page.getByRole("link", { name: "Back to Images", exact: true }).click();
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("switch", { name: "Comparisons", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open image: Felt Owl", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Open image: Tin Owl", exact: true }),
  ).toBeVisible();
});

test("Variants of a result show their numbers, the axis they vary and propose a pick for the brief", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  const names = ["Blue Hour", "Golden Dusk"];
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
      label: `${"AB"[index]} · ${names[index]}`,
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
  await expect(page.getByText("Dimensions", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "#13", exact: true })).toHaveCount(0);
});
