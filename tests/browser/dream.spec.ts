import { expect, test, type Page } from "@playwright/test";
import { dreamItem, fixtures, serveDream, stamp } from "./fixtures";

/** Clicks a secondary action in full screen's Dream bar, which phones keep under ⋯ More. */
async function dreamAction(page: Page, phone: boolean, name: string) {
  const actions = page.getByRole("group", { name: "Dream Actions" });
  if (!phone) return actions.getByRole("button", { name, exact: true }).click();
  await actions.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
const verdicts = (state: Awaited<ReturnType<typeof serveDream>>) =>
  state.requests.map((request) => `${request.method} ${request.path}`);

test("While You Were Away ranks each project's results, folds its misses and judges them", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const result = (id: string, projectId: string, score: number, miss = "", createdAt = stamp) =>
    dreamItem(id, {
      createdAt,
      dream: { ...dreamItem(id).dream, projectId },
      review: { score, miss, model: "vision", at: stamp },
    });
  const dream = await serveDream(page, {
    since: "2026-10-22T00:00:00.000Z",
    projects: [
      { id: "beach", name: "Beach", brief: { subjects: "the sea", styles: "", avoid: "" } },
      { id: "city", name: "City", brief: { subjects: "", styles: "", avoid: "" } },
    ],
    unseen: [
      result("wave", "beach", 9),
      result("shore", "beach", 7),
      result("indoors", "beach", 2, "Indoors; the brief asks for the sea."),
      result("street", "city", 8, "", "2026-10-20T00:00:00.000Z"),
      dreamItem("loose"),
    ],
  });
  await page.goto("/dream");
  await expect(page.getByRole("heading", { name: "While You Were Away" })).toBeVisible();
  await expect(page.getByText(/^4 new since /)).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /^(Beach|City|Other)$/ })).toHaveText([
    "Beach",
    "City",
    "Other",
  ]);
  const beach = page.getByRole("region", { name: "Beach" });
  const views = beach.getByRole("button", { name: /^View / });
  await expect(views).toHaveCount(2);
  await expect(views.first()).toHaveAccessibleName("View Dream prompt wave");
  await expect(beach.getByText("9/10")).toBeVisible();

  // Misses stay folded until asked for, with what they miss.
  const misses = beach.getByRole("button", { name: "Misses (1)" });
  await expect(misses).toHaveAttribute("aria-expanded", "false");
  await misses.click();
  await expect(beach.getByText("Indoors; the brief asks for the sea.")).toBeVisible();

  // Pass, Super Like and Like judge in place.
  await beach.getByRole("button", { name: "Like Dream prompt wave", exact: true }).click();
  await expect(beach.getByRole("button", { name: "View Dream prompt wave" })).toHaveCount(0);
  await beach.getByRole("button", { name: "Pass Dream prompt indoors", exact: true }).click();
  await page
    .getByRole("region", { name: "City" })
    .getByRole("button", { name: "Super Like Dream prompt street", exact: true })
    .click();

  // Full screen has every choice and moves on to the next result after a verdict.
  await beach.getByRole("button", { name: "View Dream prompt shore" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("button", { name: "Generation Details" })).toBeFocused();
  await dreamAction(page, isMobile, "More Like This");
  await expect(viewer.getByRole("img", { name: "Dream prompt loose" })).toBeVisible();
  await viewer
    .getByRole("group", { name: "Dream Actions" })
    .getByRole("button", { name: "Pass", exact: true })
    .click();
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/wave/keep",
    "POST /api/dream/indoors/discard",
    "POST /api/gallery/favorite",
    "POST /api/dream/shore/more",
    "POST /api/dream/loose/discard",
  ]);
});

test("While You Were Away shows a series as one set, in its order", async ({ page }) => {
  await fixtures(page);
  const shot = (id: string, index: number) =>
    dreamItem(id, {
      resultSet: { id: "night", title: "Mara · Diner, Midnight", index, source: "dream" },
    });
  await serveDream(page, { unseen: [shot("second", 1), dreamItem("loose"), shot("first", 0)] });
  await page.goto("/dream");
  const set = page.getByRole("group", { name: "Series: Mara · Diner, Midnight" });
  await expect(set.getByText("· Series of 2")).toBeVisible();
  const views = set.getByRole("button", { name: /^View / });
  await expect(views).toHaveCount(2);
  await expect(views.first()).toHaveAccessibleName("View Dream prompt first");
  await expect(views.last()).toHaveAccessibleName("View Dream prompt second");
  await expect(page.getByRole("button", { name: "View Dream prompt loose" })).toBeVisible();
  await expect(set.getByRole("button", { name: "View Dream prompt loose" })).toHaveCount(0);
  // Liking one judges only that result.
  await set.getByRole("button", { name: "Like Dream prompt first", exact: true }).click();
  await expect(views).toHaveCount(1);
});

test("Library › Characters offers Dream's suggested cards: Accept makes the card, Dismiss turns one down", async ({
  page,
}) => {
  const state = await fixtures(page);
  const liked = (id: string) => ({ ...dreamItem(id), dream: undefined, favorite: true });
  const dream = await serveDream(page, {
    characters: state.characters,
    suggestions: [
      {
        id: "mara",
        kind: "characters",
        name: "Mara",
        description: "red hair, freckles",
        items: [liked("one"), liked("two")],
      },
      {
        id: "rooftop",
        kind: "scenes",
        name: "Rooftop",
        description: "a city rooftop at night",
        items: [liked("three"), liked("four")],
      },
    ],
  });
  await page.goto("/library#characters");
  const suggestions = page.getByRole("list", { name: "Suggestions" });
  const mara = suggestions.getByRole("listitem", { name: "Mara" });
  await expect(mara.getByText("Character", { exact: true })).toBeVisible();
  await expect(mara.getByText("In 2 liked results", { exact: true })).toBeVisible();
  await expect(mara.getByRole("group", { name: "Mara's Results" }).getByRole("button")).toHaveCount(
    2,
  );
  const rooftop = suggestions.getByRole("listitem", { name: "Rooftop" });
  await rooftop.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(rooftop).toHaveCount(0);
  await mara.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(suggestions).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Characters" }).getByRole("listitem", { name: "Mara" }),
  ).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/suggestions/rooftop/dismiss",
    "POST /api/dream/suggestions/mara/accept",
  ]);
});

test("On a phone held sideways, a deck card's caption stands beside its media", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Only touch screens hold a phone sideways.");
  await fixtures(page);
  await serveDream(page, {
    enabled: false,
    calibration: [{ ...dreamItem("one"), dream: undefined }],
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Tune Your Taste", exact: true }).click();
  await expect(page.locator(":root")).toHaveAttribute("data-phone", "sideways");
  const current = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  const card = (await current.boundingBox())!;
  const caption = (await current.getByText("Dream prompt one").boundingBox())!;
  expect(caption.x).toBeGreaterThan(card.x + card.width / 2);
  const like = (await page.getByRole("button", { name: "Like", exact: true }).boundingBox())!;
  expect(like.y + like.height).toBeLessThanOrEqual(390);
});

test("Dream explains itself while off and saves its settings on the deck", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, { enabled: false, spicyAvailable: true });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn On", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Dream works when the queue is free · 12 of 40 today", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Dream Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Dream Settings" });
  const videos = settings.getByRole("switch", { name: /^Videos/ });
  // The row's accessible name is on the visually hidden input, which the phone drawer scrolls.
  await videos.dispatchEvent("click");
  await expect(videos).toBeChecked();
  await expect(settings).toContainText("12 of 40 today · 1 of 4 videos");
  const images = settings.getByRole("textbox", { name: "Images per Day" });
  await images.fill("200");
  await images.press("Enter");
  await expect(settings.getByRole("switch", { name: /^Spicy/ })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => request.body))
    .toEqual([{ enabled: true }, { videos: true }, { dailyImages: 200 }]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause Dream", exact: true }).click();
  await expect(page.getByText("Dream Is Paused", { exact: true })).toBeVisible();
  expect(dream.settings.paused).toBe(true);
});

test("The taste read-out fits the screen and adds what to avoid", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    taste: {
      likes: ["misty harbours", "foxes in snow", "lighthouses", "quiet streets", "old boats"],
      styles: ["film grain", "muted colour", "long exposure"],
      avoid: ["crowds"],
      note: "Quiet coastal scenes in soft, misty light.",
      profiles: {
        image: [
          { id: "image:test", score: 4 },
          { id: "gone", score: -1 },
        ],
        video: [],
      },
      loras: [{ name: "detail.safetensors", strength: 0.8, score: 2 }],
      signals: 40,
    },
  });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Taste", exact: true }).click();
  const profile = page.getByRole("region", { name: "Taste Profile" });
  await expect(profile.getByRole("list", { name: "Likes" })).toContainText("foxes in snow");
  // Only liked models and LoRAs show, by their names.
  await expect(profile.getByRole("list", { name: "Models" })).toHaveText("Image Quality");
  await expect(profile.getByRole("list", { name: "LoRAs" })).toContainText("Detail Slider 0.8");
  await profile.getByLabel("Always Avoid").fill("clowns");
  await page.keyboard.press("Enter");
  await expect.poll(() => dream.requests.at(-1)?.body).toEqual({ avoid: ["clowns"] });
  // Everything, Refresh and Clear included, fits without scrolling.
  await expect(profile.getByRole("button", { name: "Clear", exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight),
  ).toBe(true);
});

test("Dream says why it can't run", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, { reason: "The text model is offline." });
  await page.goto("/dream");
  await expect(page.getByRole("status", { name: "Dream Status" })).toContainText(
    "The text model is offline.",
  );
});

test("Animate keeps a Dream image and stages it in the Videos composer", async ({
  page,
  isMobile,
}) => {
  const state = await fixtures(page);
  const dream = await serveDream(page, { unseen: [dreamItem("fox")] });
  await page.goto("/dream");
  await page.getByRole("button", { name: "View Dream prompt fox", exact: true }).click();
  await dreamAction(page, isMobile, "Animate");
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
  // Super Like's label shows in full, phones included.
  expect(
    await page
      .getByRole("button", { name: "Super Like", exact: true })
      .locator(".mantine-Button-label")
      .evaluate((label) => label.scrollWidth <= label.clientWidth),
  ).toBe(true);
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
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(
    dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`),
  ).toEqual([
    '/api/dream/pairs/one/answer {"answer":"a"}',
    '/api/dream/pairs/two/answer {"answer":"neither"}',
    '/api/dream/pairs/three/answer {"answer":"both"}',
  ]);
});

test("Discarded Dream results can be kept after all, or deleted all at once", async ({ page }) => {
  await fixtures(page);
  const discarded = (id: string) =>
    dreamItem(id, { dream: { prompt: "p", why: "", at: "", state: "discarded" } });
  const dream = await serveDream(page, {
    discarded: [discarded("gone"), discarded("other"), discarded("last")],
  });
  await page.goto("/dream");
  await page.getByText("Discarded", { exact: true }).click();
  await page.getByRole("button", { name: "Keep Dream prompt gone", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keep Dream prompt gone", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Delete All", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete All Discards", exact: true });
  await confirm.getByRole("button", { name: "Delete All", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("No Discards", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual(["POST /api/dream/gone/keep", "DELETE /api/dream/discarded"]);
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
    unseen: [side("sa", 0, "20 Steps"), side("sb", 1, "40 Steps")],
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

  // An answer returns to the deck.
  const answers = viewer.getByRole("group", { name: "Comparison Answers" });
  await answers.getByRole("button", { name: "Neither", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual(["POST /api/dream/pairs/steps/answer"]);
  expect(dream.requests[0].body).toEqual({ answer: "neither" });
});

test("The Dream tab counts the results waiting for a verdict, a comparison as one", async ({
  page,
}) => {
  await fixtures(page);
  const side = (id: string, index: 0 | 1) =>
    dreamItem(id, {
      dream: {
        ...dreamItem(id).dream,
        pair: { id: "steps", side: index, question: "Which Steps?", label: id },
      },
    });
  await serveDream(page, {
    unseen: [...["one", "two", "three"].map((id) => dreamItem(id)), side("sa", 0), side("sb", 1)],
  });
  await page.goto("/images");
  const tab = page
    .getByRole("navigation", { name: "Creative Modes" })
    .getByRole("link", { name: "Dream", exact: true });
  await expect(tab).toHaveAccessibleDescription("4 Unseen");
  await tab.click();
  await page.getByRole("button", { name: "Like Dream prompt one", exact: true }).click();
  await expect(tab).toHaveAccessibleDescription("3 Unseen");
});

test("Dream's projects are created, edited, undone and deleted in dialogs", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    projects: [
      {
        id: "project-coast",
        name: "Coast",
        brief: { subjects: "Seabirds", styles: "", avoid: "" },
        constraints: { profiles: [], loras: true, aspect: "", resolution: "" },
        previous: {
          name: "Coast",
          brief: { subjects: "Gulls", styles: "", avoid: "" },
          constraints: { profiles: [], loras: true, aspect: "", resolution: "" },
          by: "chat",
        },
      },
    ],
  });
  await page.goto("/dream");
  await page.getByText("Projects", { exact: true }).click();
  const coast = page.getByRole("region", { name: "Coast", exact: true });
  // A chat's change shows with Undo, which restores what it replaced.
  await expect(coast).toContainText("Changed by a chat");
  await coast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(coast).toContainText("Gulls");
  await expect(coast.getByRole("button", { name: "Undo", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New Project", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Harbour");
  if (isMobile) {
    await editor.getByRole("textbox", { name: "Avoid", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Avoid", exact: true });
    await sheet.getByRole("textbox", { name: "Avoid", exact: true }).fill("people");
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
  } else await editor.getByRole("textbox", { name: "Avoid", exact: true }).fill("people");
  await editor.getByRole("checkbox", { name: "Use LoRAs", exact: true }).uncheck();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  const harbour = page.getByRole("region", { name: "Harbour", exact: true });
  await expect(harbour).toContainText("people");
  await expect(harbour).toContainText("No LoRAs");
  expect(dream.requests.at(-1)).toMatchObject({
    method: "POST",
    path: "/api/dream/projects",
    body: { name: "Harbour", brief: { avoid: "people" }, constraints: { loras: false } },
  });

  await harbour.getByRole("button", { name: "Actions for Harbour", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit Project", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Project", exact: true });
  await edit.getByRole("checkbox", { name: "Use LoRAs", exact: true }).check();
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(harbour).not.toContainText("No LoRAs");
  await expect(harbour).toContainText("Changed");

  await harbour.getByRole("button", { name: "Actions for Harbour", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete Project", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Project", exact: true })
    .getByRole("button", { name: "Delete Project", exact: true })
    .click();
  await expect(harbour).toBeHidden();
  expect(dream.requests.at(-1)).toMatchObject({
    method: "DELETE",
    path: "/api/dream/projects/project-2",
  });
});
