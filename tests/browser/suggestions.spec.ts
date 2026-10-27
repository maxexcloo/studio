import { expect, test, type Page } from "@playwright/test";
import { create, fixtures, image, stamp } from "./fixtures";

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

test("An idea chip fills the empty, focused composer prompt", async ({ page }) => {
  await fixtures(page);
  const asked = await suggest(page);
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const group = page.getByRole("group", { name: "Prompt Ideas" });
  await expect(group).toHaveCount(0);
  expect(asked).toHaveLength(0);
  await prompt.click();
  await expect(group.getByRole("button")).toHaveCount(3);
  expect(asked).toEqual([{ surface: "composer", kind: "image" }]);
  await group.getByRole("button", { name: ideas[1] }).click();
  await expect(prompt).toHaveValue(ideas[1]);
  await expect(prompt).toBeFocused();
  await expect(group).toHaveCount(0);
  await prompt.fill("");
  await expect(group).toBeVisible();
  expect(asked).toHaveLength(1);
});

test("An idea chip fills the empty Chat message with a request to create it", async ({ page }) => {
  const state = await fixtures(page);
  state.sessions.push({
    id: "chat-a",
    title: "Ideas",
    inputs: {},
    createdAt: stamp,
    updatedAt: stamp,
  });
  await suggest(page);
  await page.goto("/chat/chat-a");
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.click();
  const group = page.getByRole("group", { name: "Prompt Ideas" });
  await group.getByRole("button", { name: ideas[0] }).click();
  await expect(message).toHaveValue(`Create an image: ${ideas[0]}`);
  await expect(group).toHaveCount(0);
  expect(state.chatRequests).toHaveLength(0);
});

test("Viewer next steps load in place, a step generates its change and More asks for others", async ({
  page,
}) => {
  const state = await openViewer(page);
  const asked: any[] = [];
  const others = [{ label: "Snowfall", request: "add snow", prompt: "An amber bird in snow" }];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/suggestions", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (!body.fresh) await held;
    return route.fulfill({ json: { suggestions: body.fresh ? others : steps } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const row = viewer.getByRole("group", { name: "Next Steps" });
  await expect(row).toHaveAttribute("aria-busy", "true");
  release();
  await expect(row).not.toHaveAttribute("aria-busy");
  const more = row.getByRole("button", { name: "More Next Steps", exact: true });
  await expect(row.getByRole("button")).toHaveText([...steps.map((step) => step.label), ""]);
  expect(asked).toContainEqual({ surface: "viewer", jobId: "job-hub", fresh: false });
  await row.getByRole("button", { name: "Warmer Light" }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    parentJobId: "job-hub",
    input: { prompt: "An amber bird, warm light" },
  });
  await expect(viewer.getByRole("textbox", { name: "Variation Prompt", exact: true })).toHaveValue(
    "An amber bird, warm light",
  );
  await more.click();
  await expect(row.getByRole("button", { name: "Snowfall" })).toBeVisible();
  expect(asked.at(-1)).toEqual({ surface: "viewer", jobId: "job-hub", fresh: true });
});

test("No ideas or next steps show when Studio has none", async ({ page }) => {
  await openViewer(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer.getByRole("textbox", { name: "Variation Prompt" })).toBeVisible();
  await expect(viewer.getByRole("group", { name: "Next Steps" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await create(page);
  await Promise.all([
    page.waitForResponse("**/api/suggestions"),
    page.getByRole("textbox", { name: "Prompt", exact: true }).click(),
  ]);
  await expect(page.getByRole("group", { name: "Prompt Ideas" })).toHaveCount(0);
});
