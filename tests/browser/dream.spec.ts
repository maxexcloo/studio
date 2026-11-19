import { readFileSync } from "node:fs";

import { type Locator, type Page, expect, test } from "@playwright/test";

import { dreamItem, fixtures, section, serveDream, stamp } from "./fixtures";

/** Opens a route-backed Dream view from its menu. */
async function showView(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: "Dream View", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
/** Fills a text box in a dialog, through its full-screen editor on phones. */
async function fillBox(scope: Locator, name: string, value: string, phone: boolean) {
  const box = scope.getByRole("textbox", { name, exact: true });
  if (!phone) return box.fill(value);
  await box.click();
  const sheet = scope.page().getByRole("dialog", { name, exact: true });
  await sheet.getByRole("textbox", { name, exact: true }).fill(value);
  await sheet.getByRole("button", { name: `Close ${name}`, exact: true }).click();
}

/** Turns Use LoRAs on or off in a project form's LoRAs chip. */
async function useLoras(form: Locator, on: boolean) {
  await form.getByRole("button", { name: "LoRAs", exact: true }).click();
  const popup = form.page().getByRole("dialog", { name: "LoRAs", exact: true });
  const toggle = popup.getByRole("switch", { name: "Use LoRAs", exact: true });
  await toggle.dispatchEvent("click");
  await expect(toggle).toBeChecked({ checked: on });
  await popup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(popup).toBeHidden();
}

/**
 * Drags sideways across `target` by `dx`: a finger where Chromium can send touches (the bug this
 * guards was touch-only), the mouse elsewhere.
 */
async function drag(page: Page, target: Locator, dx: number, dy = 0) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const steps = 8;
  const chromium = page.context().browser()?.browserType().name() === "chromium";
  if (test.info().project.use.hasTouch && chromium) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, at?: number, down = y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: at === undefined ? [] : [{ x: at, y: down }],
      });
    await touch("touchStart", x);
    for (let step = 1; step <= steps; step++)
      await touch("touchMove", x + (dx * step) / steps, y + (dy * step) / steps);
    await touch("touchEnd");
    return;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + (dy || 4), { steps });
  await page.mouse.up();
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

  // Round buttons rate the card; Undo stands beside the view menu.
  const bar = page.getByRole("group", { name: "Dream Actions" });
  await expect
    .poll(() => bar.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)))
    .toEqual(["Dislike", "Like", "Accept"]);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
  await undo.click();
  await expect(current(page)).toContainText("Dream prompt one");
  await expect(undo).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
  // U undoes from the keyboard too.
  await page.keyboard.press("u");
  await expect(current(page)).toContainText("Dream prompt one");
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

  // The preview shows the card's full text and judges with the deck's own buttons.
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  await expect(preview).toContainText("Because you like five.");
  await expect(preview).toContainText("Dream prompt five");
  await expect
    .poll(() =>
      preview
        .getByRole("group", { name: "Dream Actions" })
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)),
    )
    .toEqual(["Dislike", "Like", "Accept"]);
  await preview.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  // Up likes: it accepts the result and rates it Liked.
  await expect
    .poll(() => verdicts(dream))
    .toEqual([
      "POST /api/dream/one/keep",
      "POST /api/dream/undo",
      "POST /api/dream/one/keep",
      "POST /api/dream/undo",
      "POST /api/dream/one/keep",
      "POST /api/dream/two/discard",
      "POST /api/gallery/favorite",
      "POST /api/dream/four/discard",
      "POST /api/dream/five/keep",
    ]);
  expect(dream.requests[1].body).toEqual({ ids: ["one"] });
  expect(dream.requests[6].body).toEqual({ ids: ["three"], rating: "liked" });
});

test("Dream continues into paged library review and Undo restores each rating", async ({
  page,
}) => {
  await fixtures(page);
  const library = [
    dreamItem("library-old", { dream: undefined, settings: undefined }),
    dreamItem("library-video", { dream: undefined, type: "video" }),
    dreamItem("library-image", { dream: undefined }),
  ];
  const dream = await serveDream(page, { unseen: [dreamItem("last-dream")], library });
  await page.goto("/dream");
  await expect(current(page)).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  const image = page.getByRole("group", { name: "Current Gallery Image" });
  const video = page.getByRole("group", { name: "Current Gallery Video" });
  await expect(image).toContainText("library-old");
  await expect(image.getByRole("button", { name: "Suggest" })).toHaveCount(0);
  const view = page.getByRole("button", { name: "Dream View" });
  await view.click();
  await expect(
    page.getByRole("menuitem", { name: "Rate Your Library (3)", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(video).toContainText("library-video");
  await expect.poll(() => dream.reviewed.has("library-old")).toBe(true);
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(image).toContainText("library-image");
  await expect.poll(() => dream.library[1].rating).toBe("liked");
  await page.getByRole("button", { name: "Dislike", exact: true }).click();
  await expect(page.getByText("Library Review Complete")).toBeVisible();
  await expect.poll(() => dream.library[2].rating).toBe("disliked");

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await expect(image).toContainText("library-image");
  await expect.poll(() => dream.library[2].rating).toBeUndefined();
  await undo.click();
  await expect(video).toContainText("library-video");
  await expect.poll(() => dream.library[1].rating).toBeUndefined();
  await undo.click();
  await expect(image).toContainText("library-old");
  await expect.poll(() => dream.reviewed.has("library-old")).toBe(false);
});

test("Suggest can queue a library item variation at its source", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, { library: [dreamItem("harbour", { dream: undefined })] });
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        suggestions:
          body.surface === "viewer"
            ? [
                { label: "Closer Crop", request: "crop closer", prompt: "A tighter harbour view" },
                { label: "Earlier Light", request: "move to dawn", prompt: "A dawn harbour view" },
              ]
            : [{ action: "recreate", prompt: "A tighter harbour view", request: "crop closer" }],
      },
    });
  });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Suggest", exact: true }).click();
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/api\/sessions\/[^/]+\/generations$/.test(new URL(request.url()).pathname),
  );
  await page.getByRole("menuitem", { name: "Closer Crop", exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    parentItemId: "harbour",
    profileId: "image:test",
    prompt: "A tighter harbour view",
  });
});

test("Undo steps back through Dislike, Like and Accept, taking back each", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: ["one", "two", "three", "four"].map((id) => dreamItem(id)),
  });
  await page.goto("/dream");
  const bar = page.getByRole("group", { name: "Dream Actions" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  for (const [name, next] of [
    ["Dislike", "two"],
    ["Like", "three"],
    ["Accept", "four"],
  ]) {
    await bar.getByRole("button", { name, exact: true }).click();
    await expect(current(page)).toContainText(`Dream prompt ${next}`);
  }
  // Each Undo brings back the card before, newest first, until nothing is left to undo.
  for (const back of ["three", "two", "one"]) {
    await undo.click();
    await expect(current(page)).toContainText(`Dream prompt ${back}`);
  }
  await expect(undo).toBeDisabled();
  const sent = () =>
    dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`);
  await expect
    .poll(sent)
    .toEqual([
      "/api/dream/one/discard {}",
      `/api/gallery/favorite {"ids":["two"],"rating":"liked"}`,
      "/api/dream/three/keep {}",
      `/api/dream/undo {"ids":["three"]}`,
      `/api/dream/undo {"ids":["two"],"rating":null}`,
      `/api/dream/undo {"ids":["one"]}`,
    ]);
});

test("Projects show what is new in each since the last visit, and the viewer judges it", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const constraints = { profiles: [], loras: true, aspect: "", resolution: "" };
  const brief = { subjects: "", styles: "", avoid: "" };
  const result = (id: string, projectId: string, createdAt: string) =>
    dreamItem(id, { createdAt, dream: { ...dreamItem(id).dream, projectId } });
  const dream = await serveDream(page, {
    since: "2026-10-22T00:00:00.000Z",
    projects: [
      { id: "beach", name: "Beach", brief, constraints },
      { id: "city", name: "City", brief, constraints },
    ],
    unseen: [
      result("shore", "beach", "2026-10-23T00:00:00.000Z"),
      result("wave", "beach", "2026-10-24T00:00:00.000Z"),
      result("street", "city", "2026-10-20T00:00:00.000Z"),
      dreamItem("loose"),
    ],
  });
  await page.goto("/dream");
  // The view menu always shows what waits, both kinds.
  await expect(
    page.getByRole("button", { name: "Dream View", exact: true }),
  ).toHaveAccessibleDescription("4 images and 0 videos waiting");
  await showView(page, "Projects");
  await expect(page.getByText(/^2 new since /)).toBeVisible();
  const beach = page.getByRole("region", { name: "Beach", exact: true });
  await expect(beach.getByText("2 New", { exact: true })).toBeVisible();
  // Newest first.
  const views = beach.getByRole("button", { name: /^View / });
  await expect(views.first()).toHaveAccessibleName("View Dream prompt wave");
  const city = page.getByRole("region", { name: "City", exact: true });
  await expect(city.getByRole("button", { name: "View Dream prompt street" })).toBeVisible();
  await expect(city.getByText(/ New$/)).toHaveCount(0);

  // The viewer has every choice and moves on to the next result after a verdict.
  await views.first().click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("button", { name: "Generation Details" })).toBeFocused();
  if (!isMobile)
    await expect(
      viewer.getByRole("group", { name: "Dream Actions" }).getByRole("button"),
    ).toHaveText(["Animate", "Edit", "Recreate", "Dislike", "Like", "Accept"]);
  await dreamAction(page, "Accept");
  await expect(viewer.getByRole("img", { name: "Dream prompt shore" })).toBeVisible();
  await dreamAction(page, "Dislike");
  await expect(viewer.getByRole("img", { name: "Dream prompt street" })).toBeVisible();
  await dreamAction(page, "Like");
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing new since your last visit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^View Dream prompt/ })).toHaveCount(0);
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/wave/keep",
    "POST /api/dream/shore/discard",
    "POST /api/gallery/favorite",
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

test("Dream explains itself while off and saves its settings in Settings", async ({ page }) => {
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
  await page.getByRole("button", { name: "Pause Dream", exact: true }).click();
  await expect(page.getByText("Dream Is Paused", { exact: true })).toBeVisible();
  expect(dream.settings.paused).toBe(true);

  await page.goto("/settings");
  await section(page, "Settings", "Dream");
  const settings = page.getByRole("region", { name: "Settings: Dream", exact: true });
  await expect(settings).toContainText("Dream is paused · 12 of 40 today");
  const videos = settings.getByRole("switch", { name: "Videos", exact: true });
  await videos.click({ force: true });
  await expect(videos).toBeChecked();
  await expect(settings).toContainText("12 of 40 today · 1 of 4 videos");
  const images = settings.getByRole("textbox", { name: "Images per Day" });
  await images.fill("200");
  await images.press("Enter");
  await expect(settings.getByRole("switch", { name: "Spicy", exact: true })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => request.body))
    .toEqual([{ enabled: true }, { paused: true }, { videos: true }, { dailyImages: 200 }]);
  await expect(settings).toContainText("Dream is paused · 12 of 200 today");
  // Images per Day follows Images, as Videos per Day follows Videos.
  await settings.getByRole("switch", { name: "Images", exact: true }).click({ force: true });
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
  await page.goto("/settings#dream");
  const settings = page.getByRole("region", { name: "Settings: Dream", exact: true });
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
  await expect.poll(() => dream.requests.length).toBe(1);
  await page.getByRole("button", { name: "Both", exact: true }).click();
  // The image left over makes no card, and Dream's own results wait until it is on.
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
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
  const dream = await serveDream(page, {
    taste: {
      likes: ["misty harbours", "foxes in snow", "lighthouses", "quiet streets", "old boats"],
      styles: ["film grain", "muted colour", "long exposure"],
      avoid: ["crowds"],
      note: "Quiet coastal scenes in soft, misty light.",
      models: ["image:test", "gone"],
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
    "Images",
    "Videos",
    "Rate Your Library (0)",
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
    "/images/a",
  );
  await expect(history.getByText("Unavailable Fox B", { exact: true })).toBeVisible();
  await expect(history.getByText("both 20 Steps and 40 Steps", { exact: true })).toBeVisible();
  await page.reload();
  await expect(history).toBeVisible();
  await showView(page, "Images");
  await expect(page).toHaveURL(/\/dream$/);
});

test("Dream says why it can't run in Settings › Dream, not over the deck", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, { reason: "The text model is offline.", unseen: [dreamItem("fox")] });
  await page.goto("/dream");
  await expect(current(page)).toBeVisible();
  await expect(page.getByText("The text model is offline.")).toHaveCount(0);
  await page.goto("/settings#dream");
  await expect(
    page
      .getByRole("region", { name: "Settings: Dream", exact: true })
      .getByRole("status", { name: "Dream Status" }),
  ).toContainText("The text model is offline.");
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
  await page.getByRole("dialog").getByRole("button", { name: "This Image", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  // Dislike applies its rating in the same calibration request.
  await expect
    .poll(() => dream.requests)
    .toEqual(
      [
        { liked: ["g1"] },
        { passed: ["g2"], rating: "disliked" },
        { liked: ["g3"] },
        { liked: ["g5"], passed: ["g4"] },
      ].map((body) => ({ method: "POST", path: "/api/dream/calibration", body })),
    );
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
  await expect
    .poll(() =>
      page
        .getByRole("group", { name: "Comparison Answers" })
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)),
    )
    .toEqual(["Neither", "This Image", "Like", "Both"]);

  // A side opens in the preview; closing it returns to the same comparison.
  await pair.getByRole("button", { name: "View B · 40 Steps", exact: true }).click();
  const viewer = page.getByRole("dialog");
  const answers = viewer.getByRole("group", { name: "Comparison Answers" });
  for (const name of ["Neither", "This Image", "Like", "Both"])
    await expect(answers.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  await expect(viewer.getByRole("button", { name: "Close Preview" })).toBeFocused();
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
  await expect.poll(() => dream.requests.length).toBe(2);
  const third = page.getByRole("group", { name: "Which Steps?", exact: true });
  await expect(third).toContainText("Guidance 3");
  // The preview chooses only after This Image picks the side shown, then Undo puts it back.
  await third.getByRole("button", { name: "View A · Guidance 3", exact: true }).click();
  expect(dream.requests.length).toBe(2);
  await viewer.getByRole("button", { name: "This Image", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  // Undo stands in the toolbar, beside the view menu.
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo.locator("xpath=../..")).toHaveClass(/toolbar/);
  await undo.click();
  await expect(third).toContainText("Guidance 3");
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`))
    .toEqual([
      '/api/dream/pairs/one/answer {"answer":"a"}',
      '/api/dream/pairs/two/answer {"answer":"neither"}',
      '/api/dream/pairs/three/answer {"answer":"a"}',
      '/api/dream/undo {"ids":["p3a","p3b"]}',
      '/api/dream/pairs/three/answer {"answer":"both"}',
    ]);
});

test("A comparison can Like the shown side in the deck and preview, then Undo", async ({
  page,
}) => {
  await fixtures(page);
  const side = (id: string, index: 0 | 1) => {
    const item = dreamItem(id);
    return {
      ...item,
      dream: {
        ...item.dream,
        pair: { id: "pair", side: index, question: "Which Image?", label: id },
      },
    };
  };
  const dream = await serveDream(page, { unseen: [side("Quiet", 0), side("Bright", 1)] });
  await page.goto("/dream");
  const comparison = page.getByRole("group", { name: "Which Image?", exact: true });
  await comparison.getByRole("button", { name: "Select B · Bright", exact: true }).click();
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect.poll(() => dream.requests[0]?.body).toEqual({ answer: "b", like: true });
  await expect.poll(() => dream.known.get("Bright")?.rating).toBe("liked");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await expect(comparison).toBeVisible();
  await expect.poll(() => dream.known.get("Bright")?.rating).toBeUndefined();

  await comparison.getByRole("button", { name: "View A · Quiet", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  await preview.getByRole("button", { name: "Like", exact: true }).click();
  await expect.poll(() => dream.requests[2]?.body).toEqual({ answer: "a", like: true });
  await expect(preview).toBeHidden();
  await undo.click();
  await expect(comparison).toBeVisible();
  await comparison.getByRole("button", { name: "View A · Quiet", exact: true }).click();
  await drag(page, preview.getByRole("img", { name: "Dream prompt Quiet", exact: true }), 0, -160);
  await expect.poll(() => dream.requests[4]?.body).toEqual({ answer: "a", like: true });
});

test("Discarded Dream results can be viewed and accepted after all, or deleted all at once", async ({
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
  await page.getByRole("button", { name: "Accept Dream prompt gone", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Accept Dream prompt gone", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "View Dream prompt other", exact: true }).click();
  const viewer = page.getByRole("dialog");
  await viewer
    .getByRole("group", { name: "Discard Actions" })
    .getByRole("button", { name: "Accept", exact: true })
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

test("The preview swipes between a comparison's sides and answers with the deck's buttons", async ({
  page,
}) => {
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
  await expect(viewer.getByRole("button", { name: "Close Preview" })).toBeFocused();
  // The top names the shown side, and arrow keys switch sides as swipes do.
  await expect(viewer.getByText("A · 20 Steps", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeInViewport();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("B · 40 Steps", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeInViewport();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeInViewport();

  // A sideways swipe over the picture moves to the other side without answering.
  await drag(page, viewer.getByRole("img", { name: "Side 20 Steps" }), -200);
  await expect(viewer.getByText("B · 40 Steps", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeInViewport();
  expect(dream.requests).toEqual([]);

  // This Image picks the side shown; with the deck empty the preview closes.
  const answers = viewer.getByRole("group", { name: "Comparison Answers" });
  await expect
    .poll(() =>
      answers.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)),
    )
    .toEqual(["Neither", "This Image", "Like", "Both"]);
  await answers.getByRole("button", { name: "This Image", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect.poll(() => dream.requests.length).toBe(1);
  expect(verdicts(dream)).toEqual(["POST /api/dream/pairs/steps/answer"]);
  expect(dream.requests[0].body).toEqual({ answer: "b" });
});

test("The preview judges the top card with swipes and its buttons, and Undo steps back", async ({
  page,
}) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: ["one", "two", "three"].map((id) => dreamItem(id)),
  });
  await page.goto("/dream");
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const card = preview.getByRole("group", { name: "Current Dream", exact: true });
  await expect(card).toContainText("Dream prompt one");
  // A swipe right accepts and the next card comes forward, the preview staying open.
  await drag(
    page,
    card.getByRole("img", { name: "Dream prompt one" }),
    page.viewportSize()!.width * 0.45,
  );
  await expect(card).toContainText("Dream prompt two");
  await preview.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card).toContainText("Dream prompt one");
  // Tapping the text shows it all.
  await card.getByRole("button", { name: "Show More", exact: true }).click();
  await expect(card.getByRole("button", { name: "Show Less", exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Dislike", exact: true }).click();
  await expect(card).toContainText("Dream prompt two");
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(current(page)).toContainText("Dream prompt two");
  await expect(current(page).getByRole("button", { name: "View", exact: true })).toBeFocused();
  await expect
    .poll(() => verdicts(dream))
    .toEqual(["POST /api/dream/one/keep", "POST /api/dream/undo", "POST /api/dream/one/discard"]);
});

test("A comparison keeps its layout while its pictures load", async ({ page }) => {
  await fixtures(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/slow-side-\w+\.svg$/, async (route) => {
    await held;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#335"/></svg>',
    });
  });
  const side = (id: string, index: 0 | 1) =>
    dreamItem(id, {
      url: `/slow-side-${id}.svg`,
      thumbnailUrl: `/slow-side-${id}.svg`,
      width: 832,
      height: 1216,
      dream: {
        ...dreamItem(id).dream,
        pair: { id: "steps", side: index, question: "Which Steps?", label: id },
      },
    });
  await serveDream(page, { unseen: [side("sa", 0), side("sb", 1)] });
  await page.goto("/dream");
  const pair = page.getByRole("group", { name: "Which Steps?", exact: true });
  const grid = pair.locator("[data-side]").first().locator("..");
  await expect(grid).toBeVisible();
  const before = await grid.getAttribute("data-stacked");
  // Every change to the layout attribute from here on is recorded.
  await grid.evaluate((node) => {
    (window as any).relaid = 0;
    new MutationObserver(() => (window as any).relaid++).observe(node, {
      attributeFilter: ["data-stacked"],
    });
  });
  release();
  await expect
    .poll(() =>
      pair
        .locator("img[alt]:not([alt=''])")
        .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth)),
    )
    .toEqual([832, 832]);
  expect(await grid.getAttribute("data-stacked")).toBe(before);
  expect(await page.evaluate(() => (window as any).relaid)).toBe(0);
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
  await page.keyboard.press("ArrowRight");
  await expect(tab).toHaveAccessibleDescription("3 Unseen");
});

test("Dream's projects show how they fare, open in detail with Undo, and are created, edited, paused and deleted", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const constraints = { profiles: [], loras: true, aspect: "", resolution: "" };
  const dream = await serveDream(page, {
    projects: [
      {
        id: "project-coast",
        name: "Coast",
        brief: { subjects: "Seabirds", styles: "", avoid: "" },
        constraints,
        previous: {
          name: "Coast",
          brief: { subjects: "Gulls", styles: "", avoid: "" },
          constraints,
          change: "change-1",
        },
        changes: [{ id: "change-1", at: stamp, by: "chat", why: "", fields: ["subjects"] }],
      },
    ],
    stats: {
      "project-coast": {
        kept: 3,
        liked: 1,
        missed: 2,
        discarded: 4,
        review: 6.5,
        share: 0.6,
        results: [dreamItem("gull")],
      },
    },
  });
  await page.goto("/dream");
  await showView(page, "Projects");
  const coast = page.getByRole("region", { name: "Coast", exact: true });
  await expect(coast).toContainText("Kept 3");
  await expect(coast).toContainText("Review 6.5");
  await expect(coast.getByRole("progressbar", { name: "60% of turns" })).toBeVisible();

  // The detail view lists a chat's change with Undo, which restores what it replaced.
  await coast.getByRole("button", { name: "Open Coast", exact: true }).click();
  await expect(page).toHaveURL(/\/dream\/projects\/project-coast$/);
  const detail = page.getByRole("dialog", { name: "Coast", exact: true });
  const changes = detail.getByRole("list", { name: "Changes", exact: true });
  await expect(changes).toContainText("Chat · Subjects");
  await changes.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(detail).toContainText("Gulls");
  await expect(changes).toContainText("Undone");
  await expect(changes.getByRole("button", { name: "Undo", exact: true })).toBeHidden();
  await detail.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(/\/dream\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dream$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/dream\/projects$/);
  await expect(detail).toBeHidden();

  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New Project", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Harbour");
  await fillBox(editor, "Avoid", "people", isMobile);
  await useLoras(editor, false);
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor).toBeHidden();
  const harbour = page.getByRole("region", { name: "Harbour", exact: true });
  await expect(harbour).toContainText("No LoRAs");
  expect(dream.requests.at(-1)).toMatchObject({
    method: "POST",
    path: "/api/dream/projects",
    body: { name: "Harbour", brief: { avoid: "people" }, constraints: { loras: false } },
  });

  await harbour.getByRole("button", { name: "Actions for Harbour", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Project", exact: true });
  await useLoras(edit, true);
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(harbour).not.toContainText("No LoRAs");

  await harbour.getByRole("button", { name: "Actions for Harbour", exact: true }).click();
  await page.getByRole("menuitem", { name: "Pause", exact: true }).click();
  await expect(harbour).toContainText("Paused");
  expect(dream.requests.at(-1)).toMatchObject({
    method: "PUT",
    path: "/api/dream/projects/project-2",
    body: { paused: true },
  });

  await harbour.getByRole("button", { name: "Actions for Harbour", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Project", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(harbour).toBeHidden();
  expect(dream.requests.at(-1)).toMatchObject({
    method: "DELETE",
    path: "/api/dream/projects/project-2",
  });
});

test("The Inbox accepts, edits then accepts, dismisses with a reason and clears Dream's proposals", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const constraints = { profiles: [], loras: true, aspect: "", resolution: "" };
  const proposal = (id: string, kind: string, title: string, change: object, extra = {}) => ({
    id,
    kind,
    title,
    why: `Why ${title}.`,
    at: stamp,
    change,
    evidence: [],
    ...extra,
  });
  const dream = await serveDream(page, {
    projects: [
      {
        id: "coast",
        name: "Coast",
        brief: { subjects: "gulls", styles: "film grain, cold light", avoid: "" },
        constraints,
      },
    ],
    proposals: [
      proposal("waist", "rule", "Add a Rule", { rule: "always a clearly narrow waist" }),
      proposal(
        "light",
        "brief",
        "Warmer Light for Coast",
        { brief: { styles: "film grain, warm dusk light" } },
        { projectId: "coast", evidence: [dreamItem("dusk")] },
      ),
      proposal("pause", "pacing", "Pause Coast", { paused: true }, { projectId: "coast" }),
      proposal("mara", "card", "Mara", {
        card: { kind: "characters", name: "Mara", description: "red hair" },
      }),
    ],
  });
  await page.goto("/dream/projects");
  await expect(page.getByRole("region", { name: "Inbox (4)", exact: true })).toBeVisible();

  // A rule goes to Taste › Rules, with Undo.
  const rule = page.getByRole("article", { name: "Add a Rule", exact: true });
  await rule.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(rule).toBeHidden();
  await expect(page.getByText("Accepted Add a Rule", { exact: true })).toBeVisible();

  // A brief edit shows its words changed, and Edit changes them before accepting.
  const light = page.getByRole("article", { name: "Warmer Light for Coast", exact: true });
  await expect(light.getByText("cold", { exact: true })).toBeVisible();
  await expect(light.getByText("warm dusk", { exact: true })).toBeVisible();
  await expect(light.getByRole("button", { name: /^Preview / })).toHaveCount(1);
  await expect(
    page.getByRole("article", { name: "Pause Coast" }).getByRole("button", { name: "Edit" }),
  ).toBeHidden();
  await light.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Warmer Light for Coast", exact: true });
  await fillBox(editor, "Styles", "film grain, dusk", isMobile);
  await editor.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(dream.requests.at(-1)).toEqual({
    method: "POST",
    path: "/api/dream/inbox/light/accept",
    body: { change: { brief: { styles: "film grain, dusk" } } },
  });
  await expect(page.getByRole("region", { name: "Coast", exact: true })).toContainText(
    "film grain, dusk",
  );

  // Dismiss takes an optional reason that teaches Dream.
  await page
    .getByRole("article", { name: "Pause Coast", exact: true })
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  const dismiss = page.getByRole("dialog", { name: "Dismiss", exact: true });
  await fillBox(dismiss, "Reason", "Coast is new", isMobile);
  await dismiss.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(dismiss).toBeHidden();
  expect(dream.requests.at(-1)).toEqual({
    method: "POST",
    path: "/api/dream/inbox/pause/dismiss",
    body: { reason: "Coast is new" },
  });

  await page
    .getByRole("region", { name: "Inbox (1)", exact: true })
    .getByRole("button", { name: "Clear Inbox", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Clear Inbox", exact: true })
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect(page.getByRole("region", { name: /^Inbox/ })).toBeHidden();
  expect(dream.requests.at(-1)).toEqual({
    method: "POST",
    path: "/api/dream/inbox/clear",
    body: {},
  });
});

test("Projects shows and accepts new card proposals while the Inbox stays open", async ({
  page,
}) => {
  await page.clock.install();
  await fixtures(page);
  const dream = await serveDream(page);
  await page.goto("/dream/projects");
  await expect(page.getByText("No Projects", { exact: true })).toBeVisible();

  const cards = [
    { kind: "characters", name: "Mara", description: "Red hair and freckles" },
    { kind: "outfits", name: "Green Cloak", description: "A long wool cloak" },
    { kind: "scenes", name: "Harbour", description: "A harbour at dusk" },
  ];
  dream.proposals = cards.map((card) => ({
    id: card.kind,
    kind: "card",
    title: card.name,
    why: "In two images you liked",
    at: stamp,
    change: { card },
    evidence: [dreamItem("first"), dreamItem("second")],
  }));
  await page.clock.fastForward("02:00");
  const inbox = page.getByRole("region", { name: "Inbox (3)", exact: true });
  await expect(inbox).toBeVisible();

  for (const card of cards) {
    const proposal = page.getByRole("article", { name: card.name, exact: true });
    await expect(proposal).toContainText(card.description);
    await expect(proposal.getByRole("button", { name: /^Preview / })).toHaveCount(2);
    await proposal.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(proposal).toBeHidden();
    expect(dream.requests.at(-1)).toEqual({
      method: "POST",
      path: `/api/dream/inbox/${card.kind}/accept`,
      body: {},
    });
  }
  await expect(page.getByText("No Projects", { exact: true })).toBeVisible();
});

test("Dream keeps Images and Videos separate through deck, preview, history and discards", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  const format = testInfo.project.use.browserName === "webkit" ? "mp4" : "webm";
  const clip = readFileSync(new URL(`./media/dream-preview.${format}`, import.meta.url), "base64");
  const video = (id: string) =>
    dreamItem(id, {
      type: "video",
      url: `data:video/${format};base64,${clip}#${id}`,
      width: 32,
      height: 18,
    });
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
  // The view menu picks the deck's media.
  await showView(page, "Videos");
  await expect(page.getByRole("button", { name: "Dream View", exact: true })).toContainText(
    "Videos",
  );
  const pair = page.getByRole("group", { name: "Which Video?", exact: true });
  await expect(pair).toBeVisible();
  await pair.getByRole("button", { name: "View A", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Preview", exact: true });
  await expect(viewer).toBeVisible();
  const player = viewer.locator("video");
  const close = viewer.getByRole("button", { name: "Close Preview", exact: true });
  await expect(player).toHaveCount(1);
  await expect(player).toHaveAttribute("aria-label", "Dream prompt video-a");
  await expect(player).toHaveAttribute("src", /#video-a$/);
  await expect(player).toHaveJSProperty("videoWidth", 32);
  await expect(player).toHaveJSProperty("paused", false);
  await close.press("ArrowRight");
  await expect(player).toHaveAttribute("aria-label", "Dream prompt video-b");
  await expect(player).toHaveAttribute("src", /#video-b$/);
  await expect(player).toHaveJSProperty("videoWidth", 32);
  await expect(player).toHaveJSProperty("paused", false);
  expect(dream.requests).toEqual([]);
  await close.click();
  await expect(pair.getByRole("button", { name: "View B", exact: true })).toBeFocused();
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
  await showView(page, "Videos");
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
  await page.getByRole("button", { name: "This Image", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt latest");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(original).toBeVisible();
  await expect
    .poll(() =>
      dream.requests
        .map((request) => request.path)
        .filter((path) => path.includes("/answer") || path.endsWith("/undo")),
    )
    .toEqual(["/api/dream/pairs/original/answer", "/api/dream/undo"]);
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt latest");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("group", { name: "Which arrived?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt middle");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(current(page)).toContainText("Dream prompt old");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Current Gallery Image", exact: true }),
  ).toBeVisible();
});
