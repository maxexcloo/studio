import { type Page, expect, test } from "@playwright/test";

import {
  backToActionMenu,
  closeTextEditor,
  create,
  expandAssistantMenu,
  expandComposer,
  fixtures,
  image,
  promptMenu,
  stamp,
  undoProposal,
  viewerAction,
  viewerChangeButton,
  viewerChangeMenu,
} from "./fixtures";

const ideas = [
  { label: "Blue-Hour Lighthouse", prompt: "A lighthouse in rolling fog at blue hour" },
  { label: "Lantern Market", prompt: "A harbour market under paper lanterns" },
  { label: "Sleeping Fishing Boats", prompt: "Fishing boats asleep on a glassy bay" },
  { label: "Quiet Coast", prompt: "Clouds above a quiet coast" },
  { label: "Rocky Beach Sunrise", prompt: "Dawn on a rocky beach" },
  { label: "Boats Under Stars", prompt: "Boats under stars" },
];
const steps = [
  { label: "Warmer Light", request: "make the light warmer", prompt: "An amber bird, warm light" },
  { label: "Closer Crop", request: "crop closer", prompt: "A close crop of an amber bird" },
  { label: "Night Version", request: "set it at night", prompt: "An amber bird at night" },
  { label: "Rain", request: "add rain", prompt: "A bird in rain" },
  { label: "Fog", request: "add fog", prompt: "A bird in fog" },
  { label: "Amber Sky", request: "add an amber sky", prompt: "A bird under an amber sky" },
];

async function serveTemplates(page: Page) {
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
}

/** Answers `/api/suggestions` like Studio does for an account with a taste profile. */
async function suggest(page: Page) {
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    return route.fulfill({
      json: {
        suggestions:
          body.surface === "composer"
            ? ideas
            : body.request
              ? [{ ...steps[0], action: "recreate" }]
              : steps,
      },
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

test("The composer groups ideas and draft suggestions in its compact and expanded AI menus", async ({
  page,
}) => {
  const state = await fixtures(page);
  const asked = await suggest(page);
  await page.goto("/images");
  const dock = page.locator("[data-composer-dock]");
  const compactMenu = await promptMenu(dock, "Prompt");
  // An empty prompt has nothing to rewrite: its ideas sit in the menu itself, with no Templates.
  await expect(compactMenu.getByRole("menuitem", { name: "Templates", exact: true })).toHaveCount(0);
  await expect(
    compactMenu.getByRole("menuitem", { name: ideas[0].label, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(compactMenu).toBeHidden();
  await expandComposer(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(
    page
      .getByRole("group", { name: "Generation Inputs", exact: true })
      .getByRole("combobox", { name: "Suggestions", exact: true }),
  ).toHaveCount(0);
  await prompt.click();
  // The AI menu asks for its suggestions as it opens, and the answer serves both menus.
  expect(asked).toEqual([
    { surface: "composer", kind: "image", profileId: "image:test", fresh: false },
  ]);
  let menu = await promptMenu(page, "Prompt");
  const sorted = ideas.map((idea) => idea.label).sort((a, b) => a.localeCompare(b));
  await expect(menu.getByRole("menuitem").first()).toHaveText(sorted[0]);
  for (const idea of sorted)
    await expect(menu.getByRole("menuitem", { name: idea, exact: true })).toBeVisible();
  expect(asked).toEqual([
    { surface: "composer", kind: "image", profileId: "image:test", fresh: false },
  ]);
  await menu.getByRole("menuitem", { name: "Refresh", exact: true }).click();
  await expect.poll(() => asked.at(-1)?.fresh).toBe(true);
  await menu.getByRole("menuitem", { name: ideas[1].label, exact: true }).click();
  await expect(prompt).toHaveValue(ideas[1].prompt);
  await undoProposal(page, "Prompt");
  await expect(prompt).toHaveValue("");
  await prompt.fill("A fox");
  menu = await promptMenu(page, "Prompt");
  await expandAssistantMenu(menu, "Suggestions");
  const suggestions = menu.getByRole("group", { name: "Suggestions", exact: true });
  await expect(
    suggestions.getByRole("menuitem", { name: steps[0].label, exact: true }),
  ).toBeVisible();
  expect(asked.at(-1)).toEqual({
    surface: "draft",
    kind: "image",
    profileId: "image:test",
    prompt: "A fox",
    fresh: false,
  });
  await suggestions.getByRole("menuitem", { name: steps[0].label, exact: true }).click();
  await expect(prompt).toHaveValue(steps[0].prompt);
  await expect(page.getByLabel("Proposed Action", { exact: true })).toHaveText("Generate");
  expect(state.jobs).toHaveLength(0);
  await undoProposal(page, "Prompt");
  await expect(prompt).toHaveValue("A fox");
});

test("The viewer groups Suggestions and Templates without styles or item descriptions", async ({
  page,
}, testInfo) => {
  await openViewer(page);
  await serveTemplates(page);
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
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const menu = await viewerChangeMenu(page);
  await expect(menu.getByRole("menuitem", { name: "Use as Character", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Prompt", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Suggestions", exact: true })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Review Prompt", exact: true })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.keyboard.press("Escape");
  await expect(viewerChangeButton(page)).toBeFocused();
  await viewerChangeMenu(page);
  const refresh = menu.getByRole("menuitem", { name: "Refresh", exact: true });
  await expect(refresh).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Custom…", exact: true })).toBeVisible();
  await expandAssistantMenu(menu, "Suggestions");
  await expect(menu.getByRole("menuitem", { name: "Loading…", exact: true })).toBeDisabled();
  release[0]();
  await expect(menu.getByRole("menuitem", { name: steps[0].label, exact: true })).toBeVisible();
  await backToActionMenu(menu);
  await expect(menu.getByText("Templates", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem").last()).toHaveText("Edit in Composer");
  expect(asked).toEqual([
    { surface: "viewer", jobId: "job-hub", fresh: false, prompt: "An amber bird", itemId: "hub" },
  ]);
  await refresh.click();
  await expect(refresh).toBeDisabled();
  release[1]();
  await expandAssistantMenu(menu, "Suggestions");
  await expect(menu.getByRole("menuitem", { name: "Snowfall", exact: true })).toBeVisible();
  expect(asked.at(-1)).toEqual({
    surface: "viewer",
    jobId: "job-hub",
    fresh: true,
    prompt: "An amber bird",
    itemId: "hub",
  });
  // Custom… asks for the change in a box of its own, leaving the prompt as it was.
  await backToActionMenu(menu);
  await menu.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const custom = page.getByRole("dialog", { name: "Custom Change", exact: true });
  const change = custom.getByRole("textbox", { name: "Change", exact: true });
  const send = custom.getByRole("button", { name: "Run", exact: true });
  await expect(send).toBeDisabled();
  await change.fill("make it night");
  await expect(send).toBeEnabled();
  await custom
    .getByRole("button", {
      name: testInfo.project.use.isMobile ? "Close Custom Change" : "Cancel",
      exact: true,
    })
    .click();
  await expect(custom).toHaveCount(0);
  await closeTextEditor(page, "Prompt");
  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
  expect(asked.filter((body) => body.surface === "change")).toEqual([]);
  await viewerAction(page, "Discover");
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
    "Keep & Vary",
    "More Like This",
    "Similar",
  ]);
});

test("Custom Animation suggests what could happen from the image, filling the instruction", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  await viewerAction(page, "Animate");
  await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Animate", exact: true })).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "Custom Animation", exact: true });
  await dialog
    .locator('[data-position="right"]')
    .getByRole("button", { name: "AI Instruction Actions", exact: true })
    .click();
  const menu = page.getByRole("menu", { name: "AI Instruction Actions", exact: true });
  await menu.getByRole("menuitem", { name: "Wings Unfold", exact: true }).click();
  expect(asked).toEqual([{ surface: "animate", jobId: "job-hub", fresh: false, itemId: "hub" }]);
  await expect(page.getByRole("textbox", { name: "Instruction", exact: true }).last()).toHaveValue(
    "The bird spreads its wings and takes off.",
  );
});

test("The prompt offers Library's fixed changes with the image's suggestions", async ({ page }) => {
  await openViewer(page);
  await serveTemplates(page);
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    return route.fulfill({
      json: {
        suggestions:
          body.surface === "viewer"
            ? steps
            : [
                {
                  action: "recreate",
                  label: "Softer Shadows",
                  request: body.request,
                  prompt: "An amber bird with softer shadows",
                },
              ],
      },
    });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  const menu = await viewerChangeMenu(page, "Recreate");
  await expect(menu.getByText("Templates", { exact: true })).toBeVisible();
  await expect(menu.getByText("Gentler contrast.", { exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Review Prompt",
    "Suggestions",
    "Templates",
    "Custom…",
    "Refresh",
    "Run Again",
    "Run Again, Same Seed",
    "Compare in Composer",
    "Recreate in Composer",
  ]);
  await expandAssistantMenu(menu, "Templates");
  await menu.getByRole("menuitem", { name: "Softer Shadows", exact: true }).click();
  await expect
    .poll(() => asked.find((body) => body.surface === "change"))
    .toMatchObject({ request: "soften the shadows", actions: ["recreate"] });
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
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  // Motions are asked for only once the menu opens.
  await expect(viewer.getByRole("button", { name: "Animate", exact: true })).toBeVisible();
  expect(asked).toEqual([]);
  await viewerAction(page, "Animate");
  const menu = page.getByRole("menu").first();
  await expect(menu.getByText("Templates", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Custom…", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Refresh", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Living Photo", exact: true })).toBeHidden();
  await expandAssistantMenu(menu, "Templates");
  const templateRows = menu.getByRole("group", { name: "Templates", exact: true });
  await expect(templateRows.getByRole("menuitem")).toHaveText([
    "Action",
    "Cinematic Camera",
    "Dialogue",
    "Living Photo",
  ]);
  await expandAssistantMenu(menu, "Suggestions");
  await expect(templateRows).toBeHidden();
  const ideaRows = menu.getByRole("group", { name: "Suggestions", exact: true });
  await expect(ideaRows.getByRole("menuitem")).toHaveText(motion.map((idea) => idea.label).sort());
  await menu.getByRole("menuitem", { name: "Wings Unfold", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.writing).toMatchObject({
    kind: "animate",
    theme: "custom",
    instruction: "The bird spreads its wings and takes off.",
  });
});

test("Suggestions show why Studio has none, and no ideas show", async ({ page }) => {
  await openViewer(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const reason = "Like a few results so Studio learns your taste.";
  const menu = await viewerChangeMenu(page);
  await expect(menu.getByRole("menuitem", { name: reason, exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await closeTextEditor(page, "Prompt");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  const ideas = await promptMenu(page, "Prompt");
  await expect(ideas.getByRole("menuitem", { name: "Recent Prompts", exact: true })).toBeVisible();
  await expect(ideas.getByRole("menuitem", { name: reason, exact: true })).toBeDisabled();
});

test("Review stays off after editing and Reset, while an explicit opt-in preserves the current prompt for Undo", async ({
  page,
}, testInfo) => {
  const state = await openViewer(page);
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    return route.fulfill({
      json: {
        suggestions: body.surface === "change" ? [{ action: body.actions[0], ...steps[2] }] : steps,
      },
    });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const phone = testInfo.project.use.isMobile;
  const editPrompt = async (value: string) => {
    const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
    if (phone) await field.click();
    const surface = phone ? page.getByRole("dialog", { name: "Prompt", exact: true }) : viewer;
    const input = surface.getByRole("textbox", { name: "Prompt", exact: true });
    if (phone) await input.click();
    await input.fill(value);
    await expect(input).toHaveValue(value);
    return surface;
  };
  const edited = "An amber bird over a misty harbour";
  const surface = await editPrompt("An amber bird in bright sunlight");
  await surface.getByRole("button", { name: "Reset", exact: true }).click();
  await closeTextEditor(page, "Prompt");
  let menu = await viewerChangeMenu(page);
  const review = () => menu.getByRole("menuitem", { name: "Review Prompt", exact: true });
  await expect(review()).toHaveAttribute("aria-checked", "false");
  await review().click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await editPrompt(edited);
  await closeTextEditor(page, "Prompt");
  menu = await viewerChangeMenu(page);
  await expect(review()).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem", { name: "Suggestions", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Night Version", exact: true })).toBeVisible();
  await expect
    .poll(() => asked.filter((body) => body.surface === "viewer").at(-1))
    .toMatchObject({
      prompt: edited,
      itemId: "hub",
    });
  await menu.getByRole("menuitem", { name: "Night Version", exact: true }).click();
  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    steps[2].prompt,
  );
  expect(asked.find((body) => body.surface === "change")).toMatchObject({
    prompt: edited,
    itemId: "hub",
    request: steps[2].request,
  });
  expect(state.jobs).toHaveLength(1);
  await viewer.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(edited);
  menu = await viewerChangeMenu(page);
  await review().click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await viewerAction(page, "Animate");
  menu = page.getByRole("menu", { name: "Animate", exact: true });
  await expect(review()).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  menu = await viewerChangeMenu(page, "Recreate");
  await expect(review()).toHaveAttribute("aria-checked", "false");
  await expect(menu.getByRole("menuitem", { name: "Night Version", exact: true })).toBeEnabled();
  await expect(menu.getByRole("menuitem").nth(-2)).toHaveText("Compare in Composer");
  await expect(menu.getByRole("menuitem").last()).toHaveText("Recreate in Composer");
  await menu.getByRole("menuitem", { name: "Night Version", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(asked.filter((body) => body.surface === "change").at(-1)).toMatchObject({
    actions: ["recreate"],
    request: steps[2].request,
  });
  expect(state.jobs[1]).toMatchObject({
    operation: "image",
    input: { prompt: steps[2].prompt, referenceAssets: [], seed: 1234567 },
  });
  await expect(viewer.getByLabel("Proposed Action", { exact: true })).toHaveCount(0);
});
