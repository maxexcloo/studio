import { expect, test, type Page } from "@playwright/test";
import {
  closeLoras,
  create,
  fixtures,
  image,
  openNav,
  openLoraChoices,
  section,
  selectionMenuItem,
  stamp,
  viewerAction,
} from "./fixtures";

const compareMenu = async (page: Page, item: string) => {
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
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

  // Starring keeps the winner without touching the composer; Use This takes one there.
  await page
    .getByRole("button", { name: "Star Image Fast · Prompt A as Winner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear Winner Image Fast · Prompt A", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(run.vote).toBe(run.jobIds[1]);
  expect(state.gallery.find((item) => item.jobId === run.jobIds[1]).favorite).toBe(true);
  await page.getByRole("button", { name: "Use Image Fast · Prompt C", exact: true }).click();
  await expect(page).toHaveURL(/\/images\?compose=1/);
  await expect(prompt(page)).toHaveValue("A silver fox");
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    "Image Fast",
  );
  await expect(page.getByRole("button", { name: "Clear Seed 4242", exact: true })).toBeVisible();
  await expect(variants(page)).toHaveCount(0);
});

/** Builds a comparison from Compare ▾'s `builder`, choosing `options` above its `run`. */
const build = async (page: Page, builder: string, options: string[], run: string) => {
  await compareMenu(page, builder);
  for (const option of options)
    await page.getByRole("menuitem", { name: option, exact: true }).click();
  await page.getByRole("menuitem", { name: run, exact: true }).click();
  // A press while the menu fades out only closes it.
  await expect(page.getByRole("menu")).toHaveCount(0);
};

test("Compare ▾ builds several variants at once from prompt lines and seeds", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await prompt(page).fill("A copper fox\nA silver fox\nA golden fox");
  await compareMenu(page, "Compare Prompts");
  await expect(variants(page).getByRole("radio")).toHaveCount(3);
  await expect(prompt(page)).toHaveValue("A copper fox");

  // Duplicating copies the variant being edited, not A.
  await variants(page).getByText("B", { exact: true }).click();
  await compareMenu(page, "Duplicate Variant B");
  await expect(variants(page).getByRole("radio", { name: "D", exact: true })).toBeChecked();
  await expect(prompt(page)).toHaveValue("A silver fox");

  // Seeds start over from the variant being edited, each run with its own seed.
  await compareMenu(page, "Compare Seeds");
  await page.getByRole("radiogroup", { name: "Seeds", exact: true }).getByText("3").click();
  await page.getByRole("menuitem", { name: "Compare 3 Seeds", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
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

  // The strengths are checked options above their run.
  await build(
    page,
    "Compare LoRA Strengths",
    ["Strength 0.6", "Strength 1.2"],
    "Compare 4 Strengths",
  );
  await expect(variants(page).getByRole("radio")).toHaveCount(4);

  // Models start over from the variant being edited (A, without the LoRA), keeping its seed.
  await build(page, "Compare Models", ["Image Fast"], "Compare 2 Models");
  await page.getByRole("button", { name: "Compare 2", exact: true }).click();
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
    ["Detail Slider 0.6", [["detail.safetensors", 0.6]]],
    ["Detail Slider 0.8", [["detail.safetensors", 0.8]]],
    ["Detail Slider 1", [["detail.safetensors", 1]]],
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
    .getByRole("button", { name: "Open image: An amber bird", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Compare", exact: true }).click();
  await expect(variants(page).getByRole("radio", { name: "B", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Clear Seed 1234567", exact: true })).toBeVisible();
  await prompt(page).fill("A jade bird");
  await page.getByRole("button", { name: "Compare 2", exact: true }).click();

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
  await page.getByRole("button", { name: "Compare 2", exact: true }).click();
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
  await expect(page).toHaveURL(/\/images\?set=compare-2/);
  await page.getByRole("button", { name: "Open image: Prompt B", exact: true }).click();
  await expect(page.getByTitle("Open Comparison", { exact: true })).toHaveAttribute(
    "href",
    "/compare/compare-2",
  );
  // Compare ▾ holds its usual Compare Models, then the comparison the image belongs to.
  await viewerAction(page, "Compare");
  await expect(page.getByRole("menuitem")).toHaveText(["Compare Models", "Open Comparison"]);
  await page.getByRole("menuitem", { name: "Open Comparison", exact: true }).click();
  await expect(page).toHaveURL(/\/compare\/compare-2$/);
});

test("Compare Selected sets chosen images side by side, number keys star the winner and the gallery finds it", async ({
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
    page.getByRole("button", { name: "Open image: A felt owl", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  const pick = (title: string) =>
    page.getByRole("button", { name: `Select image: ${title}`, exact: true }).click();
  await pick("A tin owl");
  await pick("A glass owl");
  await (await selectionMenuItem(page, "Compare")).click();

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
    page.getByRole("button", { name: "Star Variant A as Winner", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(state.comparisons[0].winnerItemId).toBeNull();

  // The Comparisons filter keeps only compared results.
  await page.getByRole("link", { name: "Back to Images", exact: true }).click();
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("switch", { name: "Comparisons", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: A felt owl", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open image: A tin owl", exact: true }),
  ).toBeVisible();
});

test("Variants of a result show their numbers, the axis they vary and Undo for the brief a pick changes", async ({
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
  const comparison = (winner?: (typeof items)[number], brief?: object) => ({
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
    ...(brief ? { brief } : {}),
  });
  const undone: string[] = [];
  await page.route("**/api/comparisons/fox-options", (route) =>
    route.fulfill({ json: comparison() }),
  );
  await page.route("**/api/comparisons/fox-options/vote", (route) =>
    route.fulfill({
      json: comparison(items[1], {
        projectId: "foxes",
        name: "Foxes",
        styles: "lighting: Golden Dusk",
      }),
    }),
  );
  await page.route("**/api/dream/projects/foxes/undo", (route) => {
    undone.push(route.request().method());
    return route.fulfill({ json: { project: { id: "foxes" } } });
  });
  await page.goto("/compare/fox-options");
  await expect(page.getByRole("heading", { name: "Which Lighting?", exact: true })).toBeVisible();

  // Picking one adds it to the chat's project brief, which Undo restores.
  await page.getByRole("button", { name: "Star B · Golden Dusk as Winner", exact: true }).click();
  await expect(page.getByText("Added to Foxes's brief", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => undone).toEqual(["POST"]);

  // The viewer names a result by the number chats use for it.
  await page.getByRole("button", { name: "Open B · Golden Dusk", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  if (testInfo.project.use.isMobile)
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(page.getByText(/^#13 · Image\b/)).toBeVisible();
});
