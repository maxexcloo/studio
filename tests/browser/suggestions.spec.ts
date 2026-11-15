import { type Page, expect, test } from "@playwright/test";

import {
  closeTextEditor,
  create,
  editorMenu,
  fixtures,
  image,
  promptMenu,
  stamp,
  viewerAction,
  viewerPromptMenu,
} from "./fixtures";

const ideas = [
  "A lighthouse in rolling fog at blue hour",
  "A harbour market under paper lanterns",
  "Fishing boats asleep on a glassy bay",
  "Clouds above a quiet coast",
  "Dawn on a rocky beach",
  "Boats under stars",
];
const steps = [
  { label: "Warmer Light", request: "make the light warmer", prompt: "An amber bird, warm light" },
  { label: "Closer Crop", request: "crop closer", prompt: "A close crop of an amber bird" },
  { label: "Night Version", request: "set it at night", prompt: "An amber bird at night" },
  { label: "Rain", request: "add rain", prompt: "A bird in rain" },
  { label: "Fog", request: "add fog", prompt: "A bird in fog" },
  { label: "Amber Sky", request: "add an amber sky", prompt: "A bird under an amber sky" },
];
/** Answers `/api/suggestions` like Studio does for an account with a taste profile. */
async function suggest(page: Page) {
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    return route.fulfill({
      json: { suggestions: body.surface === "viewer" ? steps : ideas },
    });
  });
  return asked;
}
async function openViewer(page: Page) {
  const state = await fixtures(page);
  const settings = { profileId: "image:test", seed: 1234567, steps: 28, count: 2 };
  const item = {
    id: "hub",
    jobId: "job-hub",
    sessionId: "session-hub",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "An amber bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings,
  };
  state.jobs.push({
    id: "job-hub",
    jobId: "job-hub",
    sessionId: "session-hub",
    status: "completed",
    operation: "image",
    input: { kind: "image", prompt: item.prompt, ...settings },
    items: [item],
    outputs: [item],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.gallery.push(item);
  return state;
}

test("Suggestions lists ideas for the empty composer prompt from its chip row", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  const asked = await suggest(page);
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const chip = page
    .getByRole("group", { name: "Generation Inputs", exact: true })
    .getByRole("combobox", { name: "Suggestions", exact: true });
  await expect(chip).toHaveCount(0);
  expect(asked).toHaveLength(0);
  await prompt.click();
  // The phone sheet gives typing the whole screen; its chip row returns as the keyboard drops.
  if (testInfo.project.use.isMobile) await prompt.blur();
  await chip.click();
  await expect(page.getByRole("option")).toHaveText([...ideas].sort((a, b) => a.localeCompare(b)));
  expect(asked).toEqual([{ surface: "composer", kind: "image" }]);
  await page.getByRole("option", { name: ideas[1] }).click();
  await expect(prompt).toHaveValue(ideas[1]);
  // Phones keep the keyboard down until the text is tapped.
  if (!testInfo.project.use.isMobile) await expect(prompt).toBeFocused();
  await expect(chip).toHaveCount(0);
  await prompt.fill("");
  await expect(chip).toBeVisible();
  expect(asked).toHaveLength(1);
});

test("The viewer prompt offers Review Prompt, styles, Suggestions with Refresh…, then Custom…", async ({
  page,
}, testInfo) => {
  await openViewer(page);
  const asked: any[] = [];
  const others = [{ label: "Snowfall", request: "add snow", prompt: "An amber bird in snow" }];
  // The first answer and the refreshed one each wait to be released, so loading shows.
  const release: (() => void)[] = [];
  const held = [0, 1].map(() => new Promise<void>((resolve) => release.push(resolve)));
  await page.route("**/api/suggestions", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    await held[body.fresh ? 1 : 0];
    return route.fulfill({ json: { suggestions: body.fresh ? others : steps } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await viewerAction(page, "Edit");
  const mediaMenu = page.getByRole("menu");
  await expect(
    mediaMenu.getByRole("menuitem", { name: "Use as Character", exact: true }),
  ).toBeVisible();
  await expect(mediaMenu.getByRole("menuitem", { name: "Review Prompt", exact: true })).toHaveCount(
    0,
  );
  await expect(mediaMenu.getByRole("menuitem", { name: "Custom…", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const menu = await viewerPromptMenu(page);
  const thinking = menu.getByRole("menuitem", { name: "Loading…", exact: true });
  await expect(thinking).toBeDisabled();
  release[0]();
  await expect(menu.getByRole("menuitem")).toHaveText([
    ...(testInfo.project.use.isMobile ? ["Copy"] : []),
    "Review Prompt",
    "Improve",
    ...steps.map((step) => step.label).sort((a, b) => a.localeCompare(b)),
    "Refresh…",
    "Custom…",
  ]);
  expect(asked).toEqual([{ surface: "viewer", jobId: "job-hub", fresh: false }]);
  await menu.getByRole("menuitem", { name: "Refresh…", exact: true }).click();
  await expect(thinking).toBeVisible();
  release[1]();
  await expect(menu.getByRole("menuitem", { name: "Snowfall", exact: true })).toBeVisible();
  expect(asked.at(-1)).toEqual({ surface: "viewer", jobId: "job-hub", fresh: true });
  // Custom… asks for the change in a box of its own, leaving the prompt as it was.
  await menu.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const custom = page.getByRole("dialog", { name: "Custom Change", exact: true });
  const change = custom.getByRole("textbox", { name: "Change", exact: true });
  const send = custom.getByRole("button", { name: "Ask", exact: true });
  await expect(send).toBeDisabled();
  await change.fill("make it night");
  await expect(send).toBeEnabled();
  await custom.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(custom).toHaveCount(0);
  await closeTextEditor(page, "Prompt");
  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
  expect(asked.filter((body) => body.surface === "change")).toEqual([]);
});

test("Custom Animation suggests what could happen from the image, filling the instruction", async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.use.isMobile;
  await openViewer(page);
  const asked: any[] = [];
  const motion = [
    { label: "Wings Unfold", request: "The bird spreads its wings and takes off." },
    { label: "Slow Push In", request: "The camera slowly pushes in on the bird." },
  ].map((idea) => ({ ...idea, prompt: idea.request }));
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    if (body.surface !== "animate") return route.fallback();
    asked.push(body);
    return route.fulfill({ json: { suggestions: motion } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  await viewerAction(page, "Animate");
  await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Custom Animation", exact: true });
  const menu = phone
    ? await editorMenu(dialog, "Instruction", "Suggestions")
    : await promptMenu(dialog, "Instruction");
  await menu.getByRole("menuitem", { name: "Wings Unfold", exact: true }).click();
  expect(asked).toEqual([{ surface: "animate", jobId: "job-hub", fresh: false }]);
  await expect(page.getByRole("textbox", { name: "Instruction", exact: true }).last()).toHaveValue(
    "The bird spreads its wings and takes off.",
  );
});

test("The prompt offers Library's fixed changes with the image's suggestions", async ({
  page,
}, testInfo) => {
  await openViewer(page);
  const asked: any[] = [];
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      json: {
        available: true,
        presets: [],
        themes: [],
        changes: [
          {
            id: "softer",
            label: "Softer Shadows",
            description: "Gentler contrast.",
            instruction: "soften the shadows",
          },
        ],
      },
    }),
  );
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    return route.fulfill({ json: { suggestions: body.surface === "viewer" ? steps : [] } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const menu = await viewerPromptMenu(page);
  await expect(menu.getByText("Templates", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    ...(testInfo.project.use.isMobile ? ["Copy"] : []),
    "Review Prompt",
    ...steps.map((step) => step.label).sort((a, b) => a.localeCompare(b)),
    "Refresh…",
    "Softer Shadows",
    "Custom…",
  ]);
  await menu.getByRole("menuitem", { name: "Softer Shadows", exact: true }).click();
  await expect
    .poll(() => asked.find((body) => body.surface === "change")?.request)
    .toBe("soften the shadows");
});

test("Animate offers motions written for the image, then its templates and Custom…", async ({
  page,
}) => {
  const state = await openViewer(page);
  const motion = [
    { label: "Wings Unfold", request: "The bird spreads its wings and takes off." },
    { label: "Slow Push In", request: "The camera moves closer." },
    { label: "Head Turn", request: "The bird turns its head." },
    { label: "Clouds Drift", request: "Clouds pass behind the bird." },
    { label: "Bird Sings", request: "The bird sings." },
    { label: "Feathers Rustle", request: "A breeze ruffles the feathers." },
  ];
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    if (body.surface !== "animate") return route.fallback();
    asked.push(body);
    return route.fulfill({
      json: { suggestions: motion.map((m) => ({ ...m, prompt: m.request })) },
    });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  // Motions are asked for only once the menu opens.
  await expect(page.getByRole("button", { name: "Animate", exact: true })).toBeVisible();
  expect(asked).toEqual([]);
  await viewerAction(page, "Animate");
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Templates", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Review Prompt",
    ...motion.map((idea) => idea.label).sort((a, b) => a.localeCompare(b)),
    "Refresh…",
    "Action",
    "Cinematic Camera",
    "Dialogue",
    "Living Photo",
    "Custom…",
    "Animate in Composer",
  ]);
  await menu.getByRole("menuitem", { name: "Wings Unfold", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.writing).toMatchObject({
    kind: "animate",
    theme: "custom",
    instruction: "The bird spreads its wings and takes off.",
  });
});

test("No ideas or suggestions show when Studio has none", async ({ page }) => {
  await openViewer(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const menu = await viewerPromptMenu(page);
  await expect(menu.getByRole("menuitem", { name: "No Suggestions", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await closeTextEditor(page, "Prompt");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await create(page);
  await Promise.all([
    page.waitForResponse("**/api/suggestions"),
    page.getByRole("textbox", { name: "Prompt", exact: true }).click(),
  ]);
  await expect(page.getByRole("combobox", { name: "Suggestions", exact: true })).toHaveCount(0);
});
