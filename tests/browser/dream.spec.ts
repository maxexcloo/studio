import { type Page, expect, test } from "@playwright/test";

import { dreamItem, fixtures, profiles, section, serveDream, stamp } from "./fixtures";

/** Opens a route-backed Dream view from its menu. */
async function showView(page: Page, name: string) {
  await page.getByRole("button", { name: "Dream View", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

const current = (page: Page) => page.getByRole("group", { name: "Current Dream", exact: true });
/** Clicks an action in full screen's Dream bar, whose Recreate ▾ holds More Like This and Variations. */
async function dreamAction(page: Page, name: string) {
  const actions = page.getByRole("group", { name: "Dream Actions" });
  if (!["More Like This", "Variations"].includes(name))
    return actions.getByRole("button", { name, exact: true }).click();
  await actions.getByRole("button", { name: "Recreate", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
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
  await expect(current(page)).toContainText("Because you like one.");
  await expect(current(page)).toContainText("Dream prompt one");

  const batch = page.getByRole("progressbar", { name: "Dream Batch", exact: true });
  await expect(batch).toHaveAttribute("aria-valuetext", "1 of 5");
  // The bar rates the card, with Undo before Superlike.
  const bar = page.getByRole("group", { name: "Dream Actions" });
  await expect(bar.getByRole("button")).toHaveText(["Like", "Dislike", "Undo", "Superlike"]);
  const undo = bar.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
  await expect(batch).toHaveAttribute("aria-valuetext", "2 of 5");
  // Undo brings the last card back before its verdict is sent.
  await undo.click();
  await expect(current(page)).toContainText("Dream prompt one");
  await expect(batch).toHaveAttribute("aria-valuetext", "1 of 5");
  await expect(undo).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
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

  // Superlike keeps and likes it, from the deck's bar or the viewer's.
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("group", { name: "Dream Actions" })
    .getByRole("button", { name: "Superlike", exact: true })
    .click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/one/keep",
    "POST /api/dream/two/discard",
    "POST /api/dream/three/variations",
    "POST /api/dream/four/discard",
  ]);
  // The last verdict waits for Undo until the deck is left.
  await showView(page, "History");
  await expect.poll(() => verdicts(dream).at(-1)).toBe("POST /api/gallery/favorite");
  expect(dream.requests.at(-1)?.body).toEqual({ ids: ["five"], rating: "liked" });
});

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
  await showView(page, "Overview");
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

  // Like, Dislike and Superlike judge in place.
  await beach.getByRole("button", { name: "Like Dream prompt wave", exact: true }).click();
  await expect(beach.getByRole("button", { name: "View Dream prompt wave" })).toHaveCount(0);
  await beach.getByRole("button", { name: "Dislike Dream prompt indoors", exact: true }).click();
  await page
    .getByRole("region", { name: "City" })
    .getByRole("button", { name: "Superlike Dream prompt street", exact: true })
    .click();

  // Full screen has every choice and moves on to the next result after a verdict.
  await beach.getByRole("button", { name: "View Dream prompt shore" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("button", { name: "Generation Details" })).toBeFocused();
  // In the item bar's order, every action named, the verdicts together at the end.
  if (!isMobile)
    await expect(
      viewer.getByRole("group", { name: "Dream Actions" }).getByRole("button"),
    ).toHaveText(["Animate", "Edit", "Recreate", "Like", "Dislike", "Superlike"]);
  await dreamAction(page, "More Like This");
  await expect(viewer.getByRole("img", { name: "Dream prompt loose" })).toBeVisible();
  await viewer
    .getByRole("group", { name: "Dream Actions" })
    .getByRole("button", { name: "Dislike", exact: true })
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
  await showView(page, "Overview");
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

test("Library offers Dream's suggested cards in their sections: Accept makes the card, Dismiss turns one down", async ({
  page,
}) => {
  const state = await fixtures(page);
  const liked = (id: string) => ({ ...dreamItem(id), dream: undefined, rating: "liked" });
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
  await expect(suggestions.getByRole("listitem")).toHaveCount(1);
  await expect(mara.getByText("In 2 liked results", { exact: true })).toBeVisible();
  await expect(mara.getByRole("group", { name: "Mara's Results" }).getByRole("button")).toHaveCount(
    2,
  );
  await section(page, "Library", "Scenes");
  const rooftop = suggestions.getByRole("listitem", { name: "Rooftop" });
  await rooftop.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(rooftop).toHaveCount(0);
  await section(page, "Library", "Characters");
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
  await serveDream(page, { calibration: [{ ...dreamItem("one"), dream: undefined }] });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/dream");
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
  await page.getByRole("button", { name: "Dream Settings", exact: true }).click();
  await expect(settings).toContainText("Dream is paused · 12 of 200 today");
  // Images per Day follows Images, as Videos per Day follows Videos.
  await settings.getByRole("switch", { name: /^Images/ }).dispatchEvent("click");
  await expect(images).toBeDisabled();
  await expect(settings).toContainText("Dream is paused · 1 of 4 videos");
  await expect.poll(() => dream.settings.images).toBe(false);
});

test("Dream settings an administrator forces stay locked for the account", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, {
    enabled: false,
    spicyAvailable: true,
    locked: ["enabled", "imageBackend"],
  });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await expect(page.getByText("Set by an administrator.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn On", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Dream Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Dream Settings" });
  await expect(settings.getByRole("switch", { name: "Dream", exact: true })).toBeDisabled();
  await expect(
    settings
      .getByRole("radiogroup", { name: "Dream Images Run On" })
      .getByRole("radio", { name: "Cloud", exact: true }),
  ).toBeDisabled();
  await expect(settings.getByRole("switch", { name: "Spicy", exact: true })).toBeEnabled();
});

test("While Dream is off, the deck compares gallery images in pairs", async ({ page }) => {
  await fixtures(page);
  const gallery = ["g1", "g2", "g3", "g4", "g5"].map((id) => ({
    ...dreamItem(id),
    dream: undefined,
  }));
  const dream = await serveDream(page, {
    enabled: false,
    unseen: [dreamItem("fox")],
    calibration: gallery,
  });
  await page.goto("/dream");
  await expect(page.getByRole("group", { name: "Which Image?" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Both", exact: true }).click();
  // The image left over makes no card, and Dream's own results wait until it is on.
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await showView(page, "History");
  await expect.poll(() => dream.requests.length).toBe(2);
  expect(dream.requests.map((request) => request.body)).toEqual([
    { liked: ["g1"], passed: ["g2"] },
    { liked: ["g3", "g4"] },
  ]);
});

test("Taste displays readable preferences and saves explicit edits separately", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        profiles: profiles.map((profile) =>
          profile.id === "image:test"
            ? { ...profile, aliases: ["custom:image-p-h3-image-fast"] }
            : profile,
        ),
      },
    }),
  );
  const dream = await serveDream(page, {
    taste: {
      likes: ["misty harbours", "foxes in snow", "lighthouses", "quiet streets", "old boats"],
      styles: ["film grain", "muted colour", "long exposure"],
      avoid: ["crowds"],
      note: "Quiet coastal scenes in soft, misty light.",
      models: ["custom:image-p-h3-image-fast", "gone"],
      loras: ["detail.safetensors"],
      loraScores: [{ name: "detail.safetensors", strength: 0.8, score: 2 }],
      shapes: ["0.67", "1.78"],
      tags: ["fox", "snow"],
      signals: 40,
    },
  });
  await page.goto("/dream");
  await showView(page, "Taste");
  const profile = page.getByRole("region", { name: "Taste Profile" });
  await expect(profile.getByText(/foxes in snow/)).toBeVisible();
  await expect(profile.getByText("Image Quality", { exact: true })).toBeVisible();
  await expect(profile.getByText("Detail Slider 0.8", { exact: true })).toBeVisible();
  await expect(profile.getByText("Portrait 2:3; Landscape 16:9", { exact: true })).toBeVisible();
  await expect(profile.getByText("fox; snow", { exact: true })).toBeVisible();
  await profile.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Taste", exact: true });
  await editor.getByRole("combobox", { name: "Likes", exact: true }).press("Backspace");
  const summary = editor.getByRole("textbox", { name: "Summary", exact: true });
  if (testInfo.project.use.isMobile) {
    await summary.click();
    const textEditor = page.getByRole("dialog", { name: "Summary", exact: true });
    await textEditor
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill("Quiet coastal scenes with lighthouses.");
    await page.keyboard.press("Escape");
    await expect(textEditor).toBeHidden();
    await expect(editor).toBeVisible();
  } else await summary.fill("Quiet coastal scenes with lighthouses.");
  await editor.getByRole("combobox", { name: "Dislikes", exact: true }).fill("clowns");
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  expect(dream.requests).not.toContainEqual(
    expect.objectContaining({ path: "/api/taste", method: "PUT" }),
  );
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => dream.requests.at(-1)?.body)
    .toEqual({
      preferences: {
        likes: ["misty harbours", "foxes in snow", "lighthouses", "quiet streets"],
        avoid: ["crowds", "clowns"],
        note: "Quiet coastal scenes with lighthouses.",
      },
    });
  await expect(editor).toBeHidden();
  await expect(profile.getByText("Summary · Your Edit", { exact: true })).toBeVisible();
  await expect(profile.getByText("crowds; clowns", { exact: true })).toBeVisible();
  await expect(
    profile.getByText("Quiet coastal scenes with lighthouses.", { exact: true }),
  ).toBeVisible();
  await profile.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.getByRole("button", { name: "Use Learnt Summary", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => dream.requests.at(-1)?.body).toEqual({ preferences: { note: null } });
  await expect(
    profile.getByText("Quiet coastal scenes in soft, misty light.", { exact: true }),
  ).toBeVisible();
  await profile.getByRole("button", { name: "Clear", exact: true }).scrollIntoViewIfNeeded();
  await profile.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Clear Taste Profile", exact: true }),
  ).toBeVisible();
});

test("Dream navigation orders its views and History shows retained activity and available result links", async ({
  page,
}) => {
  await fixtures(page);
  await serveDream(page, {
    history: [
      {
        at: stamp,
        action: "Chose Both",
        question: "Which Steps?",
        answer: "both 20 Steps and 40 Steps",
        item: { id: "a", title: "Fox A", media: "image" },
        other: { title: "Unavailable Fox B", media: "image" },
      },
      {
        at: "2026-10-22T12:00:00.000Z",
        action: "Kept",
        item: { title: "Older Fox", media: "image" },
      },
    ],
  });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Dream View", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Deck",
    "Overview",
    "Projects",
    "Taste",
    "Discards",
    "History",
  ]);
  await page.getByRole("menuitem", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/dream\/history$/);
  const history = page.getByRole("table", { name: "Dream History" });
  await expect(history).toBeVisible();
  await expect(history.getByRole("link", { name: "Fox A", exact: true })).toHaveAttribute(
    "href",
    "/images?item=a",
  );
  await expect(history.getByText("Unavailable Fox B", { exact: true })).toBeVisible();
  await expect(history.getByText("both 20 Steps and 40 Steps", { exact: true })).toBeVisible();
  await page.reload();
  await expect(history).toBeVisible();
  await showView(page, "Deck");
  await expect(page).toHaveURL(/\/dream$/);
});

test("Dream says why it can't run in its settings, not over the deck", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, { reason: "The text model is offline.", unseen: [dreamItem("fox")] });
  await page.goto("/dream");
  await expect(current(page)).toBeVisible();
  await expect(page.getByText("The text model is offline.")).toHaveCount(0);
  await page.getByRole("button", { name: "Dream Settings", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Dream Settings" })
      .getByRole("status", { name: "Dream Status" }),
  ).toContainText("The text model is offline.");
});

test("Animate keeps a Dream image and stages it in the Videos composer", async ({ page }) => {
  const state = await fixtures(page);
  const dream = await serveDream(page, { unseen: [dreamItem("fox")] });
  await page.goto("/dream");
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  await dreamAction(page, "Animate");
  await expect(page).toHaveURL(/\/video/);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Dream prompt fox",
  );
  expect(verdicts(dream)).toEqual(["POST /api/dream/fox/keep"]);
  expect(state.referenceRequests).toEqual([{ galleryItemId: "fox" }]);
});

test("Calibration judges gallery images, singly and as a pair", async ({ page }) => {
  await fixtures(page);
  const gallery = ["g1", "g2", "g3", "g4", "g5"].map((id) => ({
    ...dreamItem(id),
    dream: undefined,
  }));
  const dream = await serveDream(page, { calibration: gallery });
  await page.goto("/dream");
  const card = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  await expect(card).toContainText("From Your Gallery");
  await expect(
    page
      .getByRole("group", { name: "Dream Actions", exact: true })
      .getByRole("button", { name: "Dislike", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("Dream prompt g2");
  // Dislike rates the gallery image too, hiding it.
  await page.getByRole("button", { name: "Dislike", exact: true }).click();
  await expect(card).toContainText("Dream prompt g3");
  await page.keyboard.press("ArrowRight");
  // Every fourth card is a pair.
  // Tapping opens the preview; its explicit choice remains undoable.
  await page.getByRole("button", { name: "View B", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await showView(page, "History");
  // Calibration hears of a disliked image before the rating hides it.
  await expect.poll(() => dream.requests.length).toBe(5);
  expect(dream.requests.map((request) => request.body)).toEqual([
    { liked: ["g1"] },
    { passed: ["g2"] },
    { ids: ["g2"], rating: "disliked" },
    { liked: ["g3"] },
    { liked: ["g5"], passed: ["g4"] },
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
  await expect(
    page.getByRole("group", { name: "Comparison Answers" }).getByRole("button"),
  ).toHaveText(["A", "B", "Neither", "Undo", "Both"]);

  // A side opens in the viewer; closing it returns to the same comparison.
  await pair.getByRole("button", { name: "View B · 40 Steps", exact: true }).click();
  const viewer = page.getByRole("dialog");
  const answers = viewer.getByRole("group", { name: "Comparison Answers" });
  for (const name of ["A", "B", "Neither", "Both"]) {
    const answer = answers.getByRole("button", { name, exact: true });
    await expect(answer).toBeInViewport({ ratio: 1 });
    await expect(answer.locator(".mantine-Button-label")).toHaveText(name);
  }
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
  // Each answer waits for Undo until the next one.
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => dream.requests.length).toBe(1);
  const third = page.getByRole("group", { name: "Which Steps?", exact: true });
  await expect(third).toContainText("Guidance 3");
  // The preview chooses only after pressing A, then Undo puts the comparison back.
  await third.getByRole("button", { name: "View A · Guidance 3", exact: true }).click();
  expect(dream.requests.length).toBe(1);
  await viewer.getByRole("button", { name: "A", exact: true }).click();
  await expect.poll(() => dream.requests.length).toBe(2);
  // With the deck empty, Undo stands in the toolbar.
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo.locator("xpath=../..")).toHaveClass(/toolbar/);
  await undo.click();
  await expect(third).toContainText("Guidance 3");
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await showView(page, "History");
  await expect.poll(() => dream.requests.length).toBe(3);
  expect(
    dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`),
  ).toEqual([
    '/api/dream/pairs/one/answer {"answer":"a"}',
    '/api/dream/pairs/two/answer {"answer":"neither"}',
    '/api/dream/pairs/three/answer {"answer":"both"}',
  ]);
});

test("Discarded Dream results can be viewed and kept after all, or deleted all at once", async ({
  page,
}) => {
  await fixtures(page);
  const discarded = (id: string) =>
    dreamItem(id, { dream: { prompt: "p", why: "", at: "", state: "discarded" } });
  const dream = await serveDream(page, {
    discarded: [discarded("gone"), discarded("other"), discarded("last")],
  });
  await page.goto("/dream");
  await showView(page, "Discards");
  await page.getByRole("button", { name: "Keep Dream prompt gone", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keep Dream prompt gone", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "View Dream prompt other", exact: true }).click();
  const viewer = page.getByRole("dialog");
  await viewer
    .getByRole("group", { name: "Discard Actions" })
    .getByRole("button", { name: "Keep", exact: true })
    .click();
  await expect(viewer.getByRole("img", { name: "Dream prompt last" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await page.getByRole("button", { name: "Delete All", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete All Discards", exact: true });
  await confirm.getByRole("button", { name: "Delete All", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("No Discards", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/gone/keep",
    "POST /api/dream/other/keep",
    "DELETE /api/dream/discarded",
  ]);
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
    .getByRole("button", { name: "View A · 20 Steps", exact: true })
    .click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("button", { name: "Generation Details" })).toBeFocused();
  // The top bar names the shown side, and arrow keys switch sides as in any viewer.
  await expect(viewer.getByText("A · 20 Steps", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("B · 40 Steps", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeVisible();
  const answers = viewer.getByRole("group", { name: "Comparison Answers" });
  if (info.project.name === "desktop") {
    await answers.getByRole("button", { name: "Side by Side", exact: true }).click();
    await expect(viewer.getByRole("button", { name: /^Show . · \d+ Steps Alone$/ })).toHaveCount(2);
    await viewer.getByRole("button", { name: "Show B · 40 Steps Alone" }).click();
    await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeVisible();
  }

  // An answer returns to the deck.
  await answers.getByRole("button", { name: "Neither", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await showView(page, "History");
  await expect.poll(() => dream.requests.length).toBe(1);
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
  await expect(current(page)).toContainText("Dream prompt one");
  // A verdict counts once sent, when the next one leaves its Undo behind.
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
  await page.keyboard.press("ArrowRight");
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
  await showView(page, "Projects");
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
    await sheet.getByRole("button", { name: "Close Avoid", exact: true }).click();
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

test("Dream keeps Images and Videos separate through deck, preview, history and discards", async ({
  page,
}) => {
  await fixtures(page);
  const video = (id: string) => dreamItem(id, { type: "video" });
  const dream = await serveDream(page, {
    enabled: false,
    calibration: [dreamItem("image-a"), video("video-a"), dreamItem("image-b"), video("video-b")],
    discarded: [dreamItem("discard-image"), video("discard-video")],
    history: [
      { at: stamp, action: "Kept", item: { title: "Image History", media: "image" } },
      { at: stamp, action: "Kept", item: { title: "Video History", media: "video" } },
    ],
  });
  await page.goto("/dream");
  await expect(page.getByRole("group", { name: "Which Image?", exact: true })).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Dream Media", exact: true })
    .getByText("Videos", {
      exact: true,
    })
    .click();
  await expect(page.getByRole("radio", { name: "Videos", exact: true })).toBeChecked();
  const pair = page.getByRole("group", { name: "Which Video?", exact: true });
  await expect(pair).toBeVisible();
  await pair.getByRole("button", { name: "View A", exact: true }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  expect(dream.requests).toEqual([]);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(pair.getByRole("button", { name: "View A", exact: true })).toBeFocused();
  await showView(page, "History");
  await expect(page.getByText("Video History", { exact: true })).toBeVisible();
  await expect(page.getByText("Image History", { exact: true })).toBeHidden();
  await showView(page, "Discards");
  await expect(
    page.getByRole("button", { name: "View Dream prompt discard-video", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Dream prompt discard-image", exact: true }),
  ).toBeHidden();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Videos", exact: true })).toBeChecked();
  await showView(page, "Deck");
  await expect(pair).toBeVisible();
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await showView(page, "History");
  await expect
    .poll(() => dream.requests)
    .toEqual([
      {
        method: "POST",
        path: "/api/dream/calibration",
        body: { liked: ["video-b"], passed: ["video-a"] },
      },
    ]);
});

test("new Dream generations follow the active comparison, survive Undo and precede calibration", async ({
  page,
}) => {
  await fixtures(page);
  const dated = (id: string, day: number) =>
    dreamItem(id, {
      createdAt: `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    });
  const pair = (id: string, day: number) =>
    [0, 1].map((side) => {
      const item = dated(`${id}-${side}`, day);
      return {
        ...item,
        dream: { ...item.dream, pair: { id, side, question: `Which ${id}?`, label: String(side) } },
      };
    });
  const dream = await serveDream(page, {
    unseen: [dated("old", 1), dated("middle", 5), ...pair("original", 10)],
    calibration: [dreamItem("gallery-a"), dreamItem("gallery-b")],
  });
  await page.goto("/dream");
  const original = page.getByRole("group", { name: "Which original?", exact: true });
  await expect(original).toBeVisible();
  dream.unseen.push(dated("latest", 16), ...pair("arrived", 15));
  // A settings reply refreshes the unseen pool without waiting for the polling interval.
  const refreshed = page.waitForResponse(
    (response) => response.url().endsWith("/api/dream/settings") && response.ok(),
  );
  await page.getByRole("button", { name: "Pause Dream", exact: true }).click();
  await refreshed;
  await expect(original).toBeVisible();
  await page.getByRole("button", { name: "A", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt latest");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(original).toBeVisible();
  expect(dream.requests.filter((request) => request.path.includes("/answer"))).toEqual([]);
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt latest");
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(page.getByRole("group", { name: "Which arrived?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt middle");
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt old");
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Current Gallery Image", exact: true }),
  ).toBeVisible();
});
