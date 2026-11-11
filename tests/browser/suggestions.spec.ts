import { expect, test, type Page } from "@playwright/test";
import { create, editorMenu, fixtures, image, promptMenu, stamp, viewerAction } from "./fixtures";

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

test("The viewer's AI menu loads Suggestions with Refresh Suggestions, then Custom… and Review First", async ({
  page,
}, testInfo) => {
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
  await viewerAction(page, "AI");
  const menu = page.getByRole("menu");
  const thinking = menu.getByRole("menuitem", { name: "Thinking of Changes" });
  await expect(thinking).toBeDisabled();
  release[0]();
  for (const label of [...steps.map((step) => step.label), "Refresh Suggestions", "Custom…"])
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  await expect(menu.getByText("Review First", { exact: true })).toBeVisible();
  expect(asked).toEqual([{ surface: "viewer", jobId: "job-hub", fresh: false }]);
  await menu.getByRole("menuitem", { name: "Refresh Suggestions", exact: true }).click();
  await expect(thinking).toBeVisible();
  release[1]();
  await expect(menu.getByRole("menuitem", { name: "Snowfall", exact: true })).toBeVisible();
  expect(asked.at(-1)).toEqual({ surface: "viewer", jobId: "job-hub", fresh: true });
  // With the prompt as it was, Custom… selects it for a change typed over it; phones open the
  // editor, which asks from a send beside Generate once a change is typed, with Reset beside them.
  await menu.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  if (phone) {
    const editor = page.getByRole("dialog", { name: "Prompt", exact: true });
    const ask = editor.getByRole("button", { name: "Ask for a Change", exact: true });
    const reset = editor.getByRole("button", { name: "Reset Prompt", exact: true });
    await expect(ask).toBeDisabled();
    await expect(reset).toBeDisabled();
    await editor.getByRole("textbox", { name: "Prompt", exact: true }).fill("make it night");
    await expect(ask).toBeEnabled();
    await reset.click();
    await expect(editor.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
      "An amber bird",
    );
    return;
  }
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  if (page.viewportSize()!.width >= 768) {
    await expect(field).toBeFocused();
    await page.keyboard.type("make it night");
    await expect(field).toHaveValue("make it night");
  }
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

test("No ideas or suggestions show when Studio has none", async ({ page }) => {
  await openViewer(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await viewerAction(page, "AI");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "No Suggestions", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await create(page);
  await Promise.all([
    page.waitForResponse("**/api/suggestions"),
    page.getByRole("textbox", { name: "Prompt", exact: true }).click(),
  ]);
  await expect(page.getByRole("combobox", { name: "Suggestions", exact: true })).toHaveCount(0);
});
