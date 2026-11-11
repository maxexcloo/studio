import { expect, test, type Page } from "@playwright/test";
import { create, editorMenu, fixtures, image, promptMenu, stamp } from "./fixtures";

const ideas = [
  "A lighthouse in rolling fog at blue hour",
  "A harbour market under paper lanterns",
  "Fishing boats asleep on a glassy bay",
];
const steps = [
  { label: "Warmer Light", request: "make the light warmer", prompt: "An amber bird, warm light" },
  { label: "Closer Crop", request: "crop closer", prompt: "A close crop of an amber bird" },
  { label: "Night Version", request: "set it at night", prompt: "An amber bird at night" },
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
  state.sessions.push({
    id: "session-hub",
    title: "Hub",
    inputs: {},
    createdAt: stamp,
    updatedAt: stamp,
  });
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
  await expect(page.getByRole("option")).toHaveText(ideas);
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

test("Viewer Suggestions load in the ⋯ menu, Refresh Suggestions replaces them and Ask for a Change… hands over the field", async ({
  page,
}, testInfo) => {
  // Phones show the tools as buttons in the prompt's editor, Suggestions holding its own options.
  const phone = testInfo.project.use.isMobile;
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
  // One level deep: the suggested changes first, then the prompt's actions.
  const menu = phone
    ? await editorMenu(viewer, "Prompt", "Suggestions")
    : await promptMenu(viewer, "Prompt");
  const thinking = menu.getByRole("menuitem", { name: "Thinking of Changes" });
  await expect(thinking).toBeDisabled();
  release[0]();
  const actions = phone ? [] : ["Ask for a Change…", "Refresh Suggestions", "Clear Prompt"];
  await expect(menu.getByRole("menuitem")).toHaveText([
    ...steps.map((step) => step.label),
    ...actions,
  ]);
  expect(asked).toEqual([{ surface: "viewer", jobId: "job-hub", fresh: false }]);
  if (phone) {
    const editor = page.getByRole("dialog", { name: "Prompt", exact: true });
    // Escape closes only the menu; the editor stays.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await editor.getByRole("button", { name: "Refresh Suggestions", exact: true }).click();
    await editor.getByRole("button", { name: "Suggestions", exact: true }).click();
  } else await menu.getByRole("menuitem", { name: "Refresh Suggestions", exact: true }).click();
  await expect(thinking).toBeVisible();
  release[1]();
  await expect(menu.getByRole("menuitem")).toHaveText(["Snowfall", ...actions]);
  expect(asked.at(-1)).toEqual({ surface: "viewer", jobId: "job-hub", fresh: true });
  // With the prompt as it was, Ask for a Change… selects it for a change typed over it; phones
  // open the editor for it.
  if (phone) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Prompt", exact: true })
      .getByRole("button", { name: "Ask for a Change…", exact: true })
      .click();
  } else await menu.getByRole("menuitem", { name: "Ask for a Change…", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  if (page.viewportSize()!.width >= 768) {
    await expect(field).toBeFocused();
    await page.keyboard.type("make it night");
    await expect(field).toHaveValue("make it night");
  } else await expect(page.getByRole("dialog", { name: "Prompt", exact: true })).toBeVisible();
});

test("No ideas or suggestions show when Studio has none", async ({ page }, testInfo) => {
  const phone = testInfo.project.use.isMobile;
  await openViewer(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const menu = phone
    ? await editorMenu(viewer, "Prompt", "Suggestions")
    : await promptMenu(viewer, "Prompt");
  await expect(menu.getByRole("menuitem", { name: "No Suggestions", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  if (phone) {
    // Escape closes the editor first, then the viewer.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Prompt", exact: true })).toBeHidden();
  }
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await create(page);
  await Promise.all([
    page.waitForResponse("**/api/suggestions"),
    page.getByRole("textbox", { name: "Prompt", exact: true }).click(),
  ]);
  await expect(page.getByRole("combobox", { name: "Suggestions", exact: true })).toHaveCount(0);
});
