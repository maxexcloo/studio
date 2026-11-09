import { expect, test, type Page } from "@playwright/test";
import { dreamItem, fixtures, serveDream } from "./fixtures";

const current = (page: Page) => page.getByRole("group", { name: "Current Dream", exact: true });
const verdicts = (state: Awaited<ReturnType<typeof serveDream>>) =>
  state.requests.map((request) => `${request.method} ${request.path}`);

test("The Dream deck judges results with keys, a drag and its buttons", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: ["one", "two", "three", "four", "five"].map((id) => dreamItem(id)),
  });
  await page.goto("/images");
  await page.getByRole("link", { name: "Dream", exact: true }).click();
  await expect(page).toHaveURL(/\/dream$/);
  await expect(current(page)).toContainText("Because you star one.");
  await expect(current(page)).toContainText("Dream prompt one");

  const batch = page.getByRole("progressbar", { name: "Dream Batch", exact: true });
  await expect(batch).toHaveAttribute("aria-valuetext", "1 of 5");
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
  await expect(batch).toHaveAttribute("aria-valuetext", "2 of 5");
  await page.keyboard.press("ArrowLeft");
  await expect(current(page)).toContainText("Dream prompt three");
  await page.keyboard.press("ArrowUp");
  await expect(current(page)).toContainText("Dream prompt four");

  // A drag past a third of the card's width discards it; a short one springs back.
  const box = (await current(page).boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 20, centre.y, { steps: 4 });
  await page.mouse.up();
  await expect(current(page)).toContainText("Dream prompt four");
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - box.width / 2, centre.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(current(page)).toContainText("Dream prompt five");

  // The deck's bar offers Pass and Like; Star and the rest are in the viewer.
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("group", { name: "Dream Actions" })
    .getByRole("button", { name: "Star", exact: true })
    .click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/one/keep",
    "POST /api/dream/two/discard",
    "POST /api/dream/three/variations",
    "POST /api/dream/four/discard",
    "POST /api/gallery/favorite",
  ]);
  expect(dream.requests.at(-1)?.body).toEqual({ ids: ["five"], favorite: true });
});

test("Dream explains itself while off and saves its settings on the deck", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, { enabled: false, spicyAvailable: true });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn On", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Dream Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Dream Settings" });
  const videos = settings.getByRole("switch", { name: /^Videos/ });
  // The row's accessible name is on the visually hidden input, which the phone drawer scrolls.
  await videos.dispatchEvent("click");
  await expect(videos).toBeChecked();
  const buffer = settings.getByRole("textbox", { name: "Unseen Buffer" });
  await buffer.fill("20");
  await buffer.press("Enter");
  await expect(settings.getByRole("switch", { name: /^Spicy/ })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => request.body))
    .toEqual([{ enabled: true }, { videos: true }, { buffer: 20 }]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause Dream", exact: true }).click();
  await expect(page.getByText("Dream Is Paused", { exact: true })).toBeVisible();
  expect(dream.settings.paused).toBe(true);
});

test("Dream says why it can't run", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, { reason: "The text model is offline." });
  await page.goto("/dream");
  await expect(page.getByRole("status", { name: "Dream Status" })).toContainText(
    "The text model is offline.",
  );
});

test("Animate keeps a Dream image and stages it in the Videos composer", async ({ page }) => {
  const state = await fixtures(page);
  const dream = await serveDream(page, { unseen: [dreamItem("fox")] });
  await page.goto("/dream");
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("group", { name: "Dream Actions" })
    .getByRole("button", { name: "Animate", exact: true })
    .click();
  await expect(page).toHaveURL(/\/video/);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Dream prompt fox",
  );
  expect(verdicts(dream)).toEqual(["POST /api/dream/fox/keep"]);
  expect(state.referenceRequests).toEqual([{ galleryItemId: "fox" }]);
});

test("Calibration judges gallery images, singly and as a pair, even while Dream is off", async ({
  page,
}) => {
  await fixtures(page);
  const gallery = ["g1", "g2", "g3", "g4"].map((id) => ({
    ...dreamItem(id),
    dream: undefined,
  }));
  const dream = await serveDream(page, { enabled: false, calibration: gallery });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Tune Your Taste", exact: true }).click();
  const card = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  await expect(card).toContainText("From Your Gallery");
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("Dream prompt g2");
  await page.getByRole("button", { name: "Pass", exact: true }).click();
  await expect(page.getByRole("group", { name: "Which Image?" })).toBeVisible();
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  expect(dream.requests.map((request) => request.body)).toEqual([
    { liked: ["g1"] },
    { passed: ["g2"] },
    { liked: ["g4"], passed: ["g3"] },
  ]);
});

test("A Dream comparison asks its question and answers with swipes, keys and buttons", async ({
  page,
}) => {
  await fixtures(page);
  const side = (id: string, pair: string, index: 0 | 1, label: string) =>
    dreamItem(id, {
      dream: {
        prompt: "Dream prompt fox",
        why: "",
        at: "",
        state: "unseen",
        pair: { id: pair, side: index, question: "Which Steps?", label },
      },
    });
  const dream = await serveDream(page, {
    unseen: [
      side("p1a", "one", 0, "20 Steps"),
      side("p1b", "one", 1, "40 Steps"),
      side("p2a", "two", 0, "20 Steps"),
      side("p2b", "two", 1, "40 Steps"),
      side("p3b", "three", 1, "Guidance 5"),
      side("p3a", "three", 0, "Guidance 3"),
      dreamItem("last"),
    ],
  });
  await page.goto("/dream");
  const pair = page.getByRole("group", { name: "Which Steps?", exact: true });
  await expect(pair).toContainText("A · 20 Steps");
  await expect(pair).toContainText("B · 40 Steps");

  // Tapping a side opens it in the viewer; closing it returns to the same comparison.
  await pair.locator("[data-side='1']").click();
  const viewer = page.getByRole("dialog");
  // Keys reach the viewer once its focus trap has taken focus.
  await expect(viewer.getByRole("button", { name: "Generation Details" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(pair).toContainText("A · 20 Steps");

  // A drag left answers A.
  const box = (await pair.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - box.width / 2, centre.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => dream.requests.length).toBe(1);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("group", { name: "Which Steps?" })).toContainText("Guidance 3");
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("group", { name: "Dream Actions" })
    .getByRole("button", { name: "More Like This", exact: true })
    .click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(
    dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`),
  ).toEqual([
    '/api/dream/pairs/one/answer {"answer":"a"}',
    '/api/dream/pairs/two/answer {"answer":"neither"}',
    '/api/dream/pairs/three/answer {"answer":"both"}',
    "/api/dream/last/more {}",
  ]);
});

test("Discarded Dream results stay listed and can be kept after all", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    discarded: [dreamItem("gone", { dream: { prompt: "p", why: "", at: "", state: "discarded" } })],
  });
  await page.goto("/dream");
  await page.getByText("Discarded", { exact: true }).click();
  await page.getByRole("button", { name: "Keep Dream prompt gone", exact: true }).click();
  await expect(page.getByText("No Discards", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual(["POST /api/dream/gone/keep"]);
});

test("Full screen switches between a comparison's sides and judges from its bar", async ({
  page,
}, info) => {
  await fixtures(page);
  const side = (id: string, index: 0 | 1, label: string) =>
    dreamItem(id, {
      prompt: `Side ${label}`,
      dream: {
        prompt: "Dream prompt fox",
        why: "",
        at: "",
        state: "unseen",
        pair: { id: "steps", side: index, question: "Which Steps?", label },
      },
    });
  const dream = await serveDream(page, {
    unseen: [side("sa", 0, "20 Steps"), side("sb", 1, "40 Steps"), dreamItem("solo")],
  });
  await page.goto("/dream");
  await page
    .getByRole("group", { name: "Which Steps?", exact: true })
    .locator("[data-side='0']")
    .click();
  const viewer = page.getByRole("dialog");
  const shown = viewer.getByRole("radiogroup", { name: "Shown Image" });
  await expect(viewer.getByRole("button", { name: "Generation Details" })).toBeFocused();
  await expect(shown.getByRole("radio", { name: "A · 20 Steps" })).toBeChecked();
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeVisible();
  // Arrow keys and the choice above the picture switch sides.
  await page.keyboard.press("ArrowRight");
  await expect(shown.getByRole("radio", { name: "B · 40 Steps" })).toBeChecked();
  await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeVisible();
  await shown.getByText("A · 20 Steps", { exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeVisible();
  if (info.project.name === "desktop") {
    await shown.locator("label").filter({ hasText: "Side by Side" }).click();
    await expect(viewer.getByRole("button", { name: /^Show . · \d+ Steps Alone$/ })).toHaveCount(2);
    await viewer.getByRole("button", { name: "Show B · 40 Steps Alone" }).click();
    await expect(shown.getByRole("radio", { name: "B · 40 Steps" })).toBeChecked();
  }

  // Answering moves full screen on to the next card; a verdict on the last card closes it.
  const answers = viewer.getByRole("group", { name: "Comparison Answers" });
  await answers.getByRole("button", { name: "Neither", exact: true }).click();
  const actions = viewer.getByRole("group", { name: "Dream Actions" });
  await expect(actions).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Dream prompt solo" })).toBeVisible();
  await expect(shown).toBeHidden();
  await actions.getByRole("button", { name: "Like", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/pairs/steps/answer",
    "POST /api/dream/solo/keep",
  ]);
  expect(dream.requests[0].body).toEqual({ answer: "neither" });
});
