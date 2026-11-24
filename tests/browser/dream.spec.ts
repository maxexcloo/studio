import { readFileSync } from "node:fs";

import { type Locator, type Page, expect, test } from "@playwright/test";

import { dreamItem, fixtures, section, serveDream, stamp } from "./fixtures";

/** Opens a route-backed Dream view from its menu. */
async function showView(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: "Dream View", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function showMedia(page: Page, name: "Images" | "Videos") {
  await page.getByRole("radio", { name: new RegExp(`^${name}\\b`) }).press("Space");
}
function comparison(
  id: string,
  question: string,
  ...items: [ReturnType<typeof dreamItem>, ReturnType<typeof dreamItem>]
) {
  return items.map((item, side) => ({
    ...item,
    dream: {
      ...item.dream,
      pair: { id, side, question, label: side ? "Later" : "Earlier" },
    },
  }));
}
/** Uses the shared Details panel on desktop and its sheet on phones. */
async function previewDetails(preview: Locator, phone: boolean) {
  const toggle = preview.getByRole("button", { name: "Generation Details", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return phone
    ? preview
        .page()
        .getByRole("dialog")
        .filter({
          has: preview.page().getByRole("button", { name: "Close Details", exact: true }),
        })
    : preview.getByRole("complementary", { name: "Generation Details", exact: true });
}
async function closeDetails(preview: Locator, panel: Locator, phone: boolean) {
  if (phone) await panel.getByRole("button", { name: "Close Details", exact: true }).press("Enter");
  else await preview.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(panel).toBeHidden();
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
  await expect(target).toBeVisible();
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

async function confirmPass(page: Page, reason?: string) {
  const dialog = page.getByRole("dialog", { name: "Why Pass?", exact: true });
  await expect(dialog.getByRole("radio", { name: "Not My Taste", exact: true })).toBeChecked();
  if (reason) await dialog.getByRole("radio", { name: reason, exact: true }).check();
  await dialog.getByRole("button", { name: "Pass", exact: true }).click();
}

test("The Dream deck judges results with keys, a drag and its buttons", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: [
      dreamItem("one", {
        width: 1600,
        height: 900,
        dream: { ...dreamItem("one").dream, why: "Exploring new ground · The harbour at dusk" },
      }),
      ...["two", "three", "four", "five"].map((id) => dreamItem(id)),
    ],
  });
  await page.goto("/images");
  await page.getByRole("link", { name: "Dream", exact: true }).click();
  await expect(page).toHaveURL(/\/dream$/);
  await expect(current(page).getByText("Exploring new ground", { exact: true })).toBeVisible();
  await expect(current(page).getByText("The harbour at dusk", { exact: true })).toBeVisible();
  await expect(current(page).getByText("Dream prompt one", { exact: true })).toHaveCount(0);
  await expect(
    current(page).getByRole("img", { name: "Dream prompt one", exact: true }),
  ).toBeVisible();

  // Undo stands before the card’s round verdict buttons.
  const bar = page.getByRole("group", { name: "Dream Actions" });
  await expect
    .poll(() => bar.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)))
    .toEqual(["Undo", "Pass", "Super Like", "Accept", "Suggestions"]);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeDisabled();
  // The square card after the wide one keeps the same box, so neither it nor the buttons move.
  const boxes = async () => [await current(page).boundingBox(), await bar.boundingBox()];
  const steady = await boxes();
  await page.keyboard.press("ArrowRight");
  await expect(
    current(page).getByRole("img", { name: "Dream prompt two", exact: true }),
  ).toBeVisible();
  await expect.poll(boxes).toEqual(steady);
  await undo.click();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt one", exact: true }),
  ).toBeVisible();
  await expect(undo).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(
    current(page).getByRole("img", { name: "Dream prompt two", exact: true }),
  ).toBeVisible();
  // U undoes from the keyboard too.
  await page.keyboard.press("u");
  await expect(
    current(page).getByRole("img", { name: "Dream prompt one", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    current(page).getByRole("img", { name: "Dream prompt two", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(
    current(page).getByRole("img", { name: "Dream prompt three", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(
    current(page).getByRole("img", { name: "Dream prompt four", exact: true }),
  ).toBeVisible();

  // A full drag passes the card; a short one springs back.
  const box = (await current(page).boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 20, centre.y, { steps: 4 });
  await page.mouse.up();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt four", exact: true }),
  ).toBeVisible();
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - box.width / 2, centre.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt five", exact: true }),
  ).toBeVisible();

  // The preview shows the card's full text in Details and judges with the deck's buttons.
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const details = await previewDetails(preview, isMobile);
  await expect(details).toContainText("Because you like five.");
  await expect(details.getByText("Dream prompt five", { exact: true }).last()).toBeVisible();
  await closeDetails(preview, details, isMobile);
  await expect
    .poll(() =>
      preview
        .getByRole("group", { name: "Dream Actions" })
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)),
    )
    .toEqual(["Undo", "Pass", "Super Like", "Accept", "Suggestions"]);
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
      "POST /api/dream/pass",
      "POST /api/dream/three/super-like",
      "POST /api/dream/pass",
      "POST /api/dream/five/keep",
    ]);
  expect(dream.requests[1].body).toEqual({ ids: ["one"] });
  expect(dream.requests[6].body).toEqual({});
});

test("Dream and Library keep separate Images and Videos, with paged review and Undo", async ({
  page,
}) => {
  await fixtures(page);
  const library = [
    dreamItem("library-old", {
      dream: undefined,
      settings: undefined,
      title: "Older Library Image",
    }),
    dreamItem("library-video", { dream: undefined, title: "Library Video", type: "video" }),
    dreamItem("library-image", { dream: undefined, title: "Library Image" }),
    dreamItem("library-third", { dream: undefined, title: "Third Library Image" }),
  ];
  const dream = await serveDream(page, {
    unseen: [dreamItem("last-image"), dreamItem("last-video", { type: "video" })],
    library,
  });
  await page.goto("/dream");
  await expect(current(page)).toBeVisible();
  await expect(current(page)).toContainText("last-image");
  await expect(page.getByRole("radio", { name: "Images (1)", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  const video = page.getByRole("group", { name: "Current Gallery Video" });
  const image = page.getByRole("group", { name: "Current Gallery Image" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect(image).toHaveCount(0);

  await showMedia(page, "Videos");
  await expect(current(page)).toContainText("last-video");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await showView(page, "Library");
  await expect(page).toHaveURL(/\/dream\/library$/);
  await expect(page.getByRole("radio", { name: "Videos (1)", exact: true })).toBeChecked();
  await expect(video.getByText("Library Video", { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "Super Like", exact: true }).click();
  await expect(page.getByText("Library Review Complete")).toBeVisible();
  await expect.poll(() => dream.library[1].rating).toBe("liked");

  await showMedia(page, "Images");
  await expect(page.getByRole("radio", { name: "Images (3)", exact: true })).toBeChecked();
  await expect(image.getByText("Older Library Image", { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();

  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(image.getByText("Library Image", { exact: true })).toBeVisible();
  await expect.poll(() => dream.reviewed.has("library-old")).toBe(true);
  await page.getByRole("button", { name: "Super Like", exact: true }).click();
  await expect(image.getByText("Third Library Image", { exact: true })).toBeVisible();
  await expect.poll(() => dream.library[2].rating).toBe("liked");
  await page.getByRole("button", { name: "Pass", exact: true }).press("Shift+F10");
  await confirmPass(page);
  await expect(page.getByText("Library Review Complete")).toBeVisible();
  await expect.poll(() => dream.library[3].rating).toBe("disliked");

  await undo.click();
  await expect(image.getByText("Third Library Image", { exact: true })).toBeVisible();
  await expect.poll(() => dream.library[3].rating).toBeUndefined();
  await undo.click();
  await expect(image.getByText("Library Image", { exact: true })).toBeVisible();
  await expect.poll(() => dream.library[2].rating).toBeUndefined();
  await undo.click();
  await expect(image.getByText("Older Library Image", { exact: true })).toBeVisible();
  await expect.poll(() => dream.reviewed.has("library-old")).toBe(false);
  await showMedia(page, "Videos");
  await undo.click();
  await expect(video.getByText("Library Video", { exact: true })).toBeVisible();
  await expect.poll(() => dream.library[1].rating).toBeUndefined();

  await showView(page, "Dream");
  await undo.click();
  await expect(current(page)).toContainText("last-video");
  await showMedia(page, "Images");
  await undo.click();
  await expect(current(page)).toContainText("last-image");
});

test("Suggest can queue a variation of a library import without a job or prompt", async ({
  page,
}) => {
  await fixtures(page);
  await serveDream(page, {
    library: [dreamItem("harbour", { dream: undefined, jobId: undefined, prompt: "" })],
  });
  const asked: any[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
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
  await page.goto("/dream/library");
  const actions = page.getByRole("group", { name: "Dream Actions" });
  await expect(actions.getByRole("button").first()).toHaveAccessibleName("Undo");
  const suggest = actions.getByRole("button").last();
  await expect(suggest).toHaveAccessibleName("Suggestions");
  await suggest.click();
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
  expect(asked.map(({ surface, jobId, itemId }) => ({ surface, jobId, itemId }))).toEqual([
    { surface: "viewer", jobId: undefined, itemId: "harbour" },
    { surface: "change", jobId: undefined, itemId: "harbour" },
  ]);
});

test("Dream video Suggestions can stage an extension from the current clip", async ({ page }) => {
  const state = await fixtures(page);
  const dream = await serveDream(page, {
    unseen: [
      dreamItem("dream-clip", {
        type: "video",
        url: "/test-media/clip.mp4",
        settings: {
          profileId: "video:test",
          referenceAssets: [{ assetId: "missing-start", slot: "reference" }],
        },
      }),
    ],
  });
  await page.goto("/dream");
  await showMedia(page, "Videos");
  await page.getByRole("button", { name: "Suggestions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Extend in Composer", exact: true }).click();
  await expect(page).toHaveURL(/\/videos$/);
  await expect
    .poll(() => state.referenceRequests.at(-1))
    .toEqual({ galleryItemId: "dream-clip", frame: "last" });
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  expect(state.jobs).toHaveLength(0);
  expect(dream.requests).toHaveLength(0);
});

test("Dream Library shows result details and preloads the next five Suggestions across pages", async ({
  page,
}) => {
  await fixtures(page);
  const library = Array.from({ length: 7 }, (_, index) =>
    dreamItem(`review-${index}`, {
      dream: undefined,
      title: `Library Result ${index}`,
      settings: { profileName: "Archipelago", steps: 16 },
    }),
  );
  await serveDream(page, { library });
  const asked: string[] = [];
  await page.route("**/api/suggestions", (route) => {
    const { itemId } = route.request().postDataJSON();
    asked.push(itemId);
    return route.fulfill({
      json: { suggestions: [{ label: "Closer Crop", request: "crop closer" }] },
    });
  });
  await page.goto("/dream/library");
  const card = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  await expect(card.getByText("Library Result 0", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Archipelago( · |$)/)).toBeVisible();
  await expect(card.locator("time")).toHaveAttribute("datetime", stamp);
  await expect.poll(() => asked).toEqual(library.slice(1, 6).map(({ id }) => id));

  await card.getByRole("button", { name: "View", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const header = preview.getByRole("group", { name: "Viewer Header", exact: true });
  await expect(header.getByText("Library Result 0", { exact: true })).toBeVisible();
  await expect(header.getByText(/^Archipelago( · |$)/)).toBeVisible();
  await expect(header.locator("time")).toHaveAttribute("datetime", stamp);
  await preview.getByRole("button", { name: "Accept", exact: true }).click();

  await expect(header.getByText("Library Result 1", { exact: true })).toBeVisible();
  await expect.poll(() => asked).toEqual(library.slice(1).map(({ id }) => id));
  await preview.getByRole("button", { name: "Suggestions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Closer Crop", exact: true })).toBeVisible();
  expect(asked).toEqual(library.slice(1).map(({ id }) => id));
});

test("Undo steps back through Pass, Super Like and Accept", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: ["one", "two", "three", "four"].map((id) => dreamItem(id)),
  });
  await page.goto("/dream");
  const bar = page.getByRole("group", { name: "Dream Actions" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  for (const [name, next] of [
    ["Pass", "two"],
    ["Super Like", "three"],
    ["Accept", "four"],
  ]) {
    await bar.getByRole("button", { name, exact: true }).click();
    await expect(current(page).getByRole("img", { name: `Dream prompt ${next}` })).toBeVisible();
  }
  // Each Undo brings back the card before, newest first, until nothing is left to undo.
  for (const back of ["three", "two", "one"]) {
    await undo.click();
    await expect(current(page).getByRole("img", { name: `Dream prompt ${back}` })).toBeVisible();
  }
  await expect(undo).toBeDisabled();
  const sent = () =>
    dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`);
  await expect
    .poll(sent)
    .toEqual([
      `/api/dream/pass {"ids":["one"],"reason":"skip"}`,
      "/api/dream/two/super-like {}",
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
      { id: "city", name: "City", brief, constraints },
      { id: "beach", name: "Beach", brief, constraints },
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
  await expect(
    page
      .getByRole("group", { name: "Dream Toolbar", exact: true })
      .getByRole("button", { name: "New Project", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /^(Beach|City)$/ }).first()).toHaveAccessibleName(
    "Beach",
  );
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
  await expect(beach.getByText(/ New$/)).toHaveCount(0);
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
  await serveDream(page, { library: [dreamItem("one", { dream: undefined })] });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/dream/library");
  await expect(page.locator(":root")).toHaveAttribute("data-phone", "sideways");
  const current = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  const card = (await current.boundingBox())!;
  const caption = (await current.getByText("Dream prompt one").boundingBox())!;
  expect(caption.x).toBeGreaterThan(card.x + card.width / 2);
  const like = (await page.getByRole("button", { name: "Super Like", exact: true }).boundingBox())!;
  expect(like.y + like.height).toBeLessThanOrEqual(390);
});

test("Dream explains itself while off and saves its settings in Settings", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, { enabled: false, uncensoredAvailable: true });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn On", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Dream works when the queue is free", { exact: true })).toBeVisible();
  await expect(page.getByText("12 of 40 today", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause Dream", exact: true }).click();
  await expect(page.getByText("Dream Is Paused", { exact: true })).toBeVisible();
  expect(dream.settings.paused).toBe(true);

  await page.goto("/settings#dream");
  const settings = page.getByRole("region", { name: "Settings: Dream", exact: true });
  const videos = settings.getByRole("switch", { name: "Videos", exact: true });
  const videoAmount = settings.getByRole("textbox", { name: "Daily Videos", exact: true });
  await expect(videoAmount).toBeDisabled();
  await videos.click({ force: true });
  await expect(videos).toBeChecked();
  await expect(videoAmount).toBeEnabled();
  const images = settings.getByRole("textbox", { name: "Daily Images", exact: true });
  await images.fill("200");
  await images.press("Enter");
  await expect.poll(() => dream.settings.dailyImages).toBe(200);
  await expect(settings.getByRole("switch", { name: "Uncensored", exact: true })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => request.body))
    .toEqual([{ enabled: true }, { paused: true }, { videos: true }, { dailyImages: 200 }]);
  await settings.getByRole("switch", { name: "Images", exact: true }).click({ force: true });
  await expect(images).toBeDisabled();
  await expect.poll(() => dream.settings.images).toBe(false);
});

test("Dream displays allocations and resets the exhausted kind from its toolbar", async ({
  page,
}) => {
  await fixtures(page);
  const dream = await serveDream(page);
  Object.assign(dream.settings, { dailyImages: 12, videos: true });
  await page.goto("/dream");
  const status = page.getByRole("button", { name: "Dream Allocation", exact: true });
  await status.click();
  const allocation = page.getByRole("dialog", { name: "Daily Dream Allocation", exact: true });
  await expect(allocation.getByRole("progressbar", { name: "Images Allocation" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(allocation.getByRole("progressbar", { name: "Videos Allocation" })).toHaveAttribute(
    "aria-valuenow",
    "25",
  );
  await allocation.getByRole("button", { name: "Reset Image Limit", exact: true }).click();
  await expect(status).toBeHidden();
  expect(dream.requests.at(-1)).toEqual({
    method: "POST",
    path: "/api/dream/reset-limit",
    body: { kind: "image" },
  });
});

test("Dream settings an administrator forces stay locked for the account", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, {
    enabled: false,
    uncensoredAvailable: true,
    locked: ["enabled", "imageBackend"],
  });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await expect(page.getByText("Set by an administrator.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn On", exact: true })).toHaveCount(0);
  await page.goto("/settings#dream");
  const settings = page.getByRole("region", { name: "Settings: Dream", exact: true });
  await expect(settings.getByRole("switch", { name: "Dream", exact: true })).toBeDisabled();
  await expect(settings.getByRole("switch", { name: "Uncensored", exact: true })).toBeEnabled();
  await section(page, "Settings", "Where Work Runs");
  await expect(
    page
      .getByRole("radiogroup", { name: "Dream Images", exact: true })
      .getByRole("radio", { name: "Cloud", exact: true }),
  ).toBeDisabled();
});

test("An empty disabled video deck counts no held results, then counts verdicts and Undo", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  if (isMobile) await page.setViewportSize({ width: 320, height: 720 });
  await serveDream(page, { enabled: false, unseen: [dreamItem("held-video", { type: "video" })] });
  let releaseKeep!: () => void;
  const keep = new Promise<void>((resolve) => (releaseKeep = resolve));
  await page.route("**/api/dream/held-video/keep", async (route) => {
    await keep;
    await route.fallback();
  });
  await page.goto("/dream");
  await showMedia(page, "Videos");
  const view = page.getByRole("button", { name: "Dream View", exact: true });
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await expect(view).toHaveAccessibleDescription("0 images and 0 videos waiting");
  await page.getByRole("button", { name: "Turn On", exact: true }).click();
  await expect(current(page)).toBeVisible();
  await expect(view).toHaveAccessibleDescription("0 images and 1 video waiting");
  const card = current(page);
  const actions = page.getByRole("group", { name: "Dream Actions" });
  if (isMobile) {
    const media = (await page.getByLabel("Dream Media", { exact: true }).boundingBox())!;
    const header = (await view.boundingBox())!;
    const preview = (await card.getByRole("button", { name: "View", exact: true }).boundingBox())!;
    const sound = (await card.getByRole("button", { name: "Mute", exact: true }).boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(media.y).toBeLessThan(header.y + header.height);
    expect(media.x).toBeGreaterThanOrEqual(header.x + header.width);
    expect(sound.x).toBeGreaterThanOrEqual(preview.x + preview.width);
    expect((await actions.boundingBox())!.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height);
  }
  await actions.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(view).toHaveAccessibleDescription("0 images and 0 videos waiting");
  releaseKeep();
  const undo = actions.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeInViewport();
  await undo.click();
  await expect(view).toHaveAccessibleDescription("0 images and 1 video waiting");
  await expect(current(page)).toBeVisible();
});

test("Library review stays available while Dream is off", async ({ page }) => {
  await fixtures(page);
  await serveDream(page, {
    enabled: false,
    unseen: [dreamItem("fox")],
    library: [dreamItem("library-image", { dream: undefined, title: "Library Image" })],
  });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await showView(page, "Library");
  const card = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  await expect(card.getByText("Library Image", { exact: true })).toBeVisible();
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
  const sameness = { recent: null, earlier: null, converging: false, examples: [] };
  await page.route("**/api/taste/reflection?*", (route) =>
    route.fulfill({
      json: {
        sameness: { made: sameness, liked: sameness },
        days: [19, 18, 17, 16].map((day) => ({
          day: `2026-11-${day}`,
          profileId: "image:test",
          profileName: "Image Quality",
          model: "test.safetensors",
          made: 10,
          liked: 2,
          disliked: 1,
        })),
      },
    }),
  );
  await page.goto("/dream");
  await showView(page, "Taste");
  const history = page.getByRole("region", { name: "History", exact: true });
  const historyRows = history.getByRole("table", { name: "History", exact: true }).getByRole("row");
  await expect(historyRows).toHaveCount(4);
  await history.getByRole("button", { name: "Show All", exact: true }).click();
  await expect(historyRows).toHaveCount(5);
  await history.getByRole("button", { name: "Show Less", exact: true }).click();
  await expect(historyRows).toHaveCount(4);
  const profile = page.getByRole("region", { name: "Taste Profile" });
  await expect(profile.getByText(/foxes in snow/)).toBeVisible();
  await expect(profile.getByText("Image Quality", { exact: true })).toBeVisible();
  await expect(profile.getByText("Detail Slider 0.8", { exact: true })).toBeVisible();
  await expect(profile.getByText("Portrait 2:3; Landscape 16:9", { exact: true })).toBeVisible();
  await expect(profile.getByText("fox; snow", { exact: true })).toBeVisible();
  const editTaste = page
    .getByRole("group", { name: "Dream Toolbar", exact: true })
    .getByRole("button", { name: "Edit", exact: true });
  await editTaste.click();
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
  await editTaste.click();
  await editor.getByRole("button", { name: "Use Learnt Summary", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => dream.requests.at(-1)?.body).toEqual({ preferences: { note: null } });
  await expect(
    profile.getByText("Quiet coastal scenes in soft, misty light.", { exact: true }),
  ).toBeVisible();
  const danger = page.getByRole("region", { name: "Danger Zone", exact: true });
  await danger.getByRole("button", { name: "Clear", exact: true }).scrollIntoViewIfNeeded();
  await danger.getByRole("button", { name: "Clear", exact: true }).click();
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
    "Dream",
    "Library",
    "Projects",
    "Taste",
    "Discards",
    "History",
    "This Week",
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
  await showView(page, "Dream");
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

test("Liking an expanded Dream Set rates the shown member and keeps the set", async ({ page }) => {
  await fixtures(page);
  const member = (id: string, index: number) =>
    dreamItem(id, {
      resultSet: { id: "night-out", index, title: "Night Out", source: "dream" },
    });
  const dream = await serveDream(page, {
    unseen: [
      member("last", 2),
      member("cover", 0),
      member("middle", 1),
      dreamItem("standalone", { createdAt: "2020-01-01T00:00:00.000Z" }),
    ],
  });
  await page.goto("/dream");
  const set = page.getByRole("group", { name: "Night Out", exact: true });
  await expect(set.getByRole("img", { name: "Dream prompt cover", exact: true })).toBeVisible();
  await set.getByRole("button", { name: "View Set (3)", exact: true }).click();
  const preview = page.getByRole("dialog");
  await expect(
    preview.getByRole("button", { name: "Change Image Zoom", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Digit0");
  await expect
    .poll(async () => {
      const controls = await preview
        .getByRole("group", { name: "Image Zoom", exact: true })
        .boundingBox();
      const picker = await preview.locator('[aria-label="Set Results"]').boundingBox();
      return !!controls && !!picker && controls.y + controls.height <= picker.y;
    })
    .toBe(true);
  const third = preview.getByRole("radio", { name: "3", exact: true });
  await third.press("Space");
  await preview.getByRole("button", { name: "Deny This Image", exact: true }).click();
  await preview.getByRole("button", { name: "Close Preview", exact: true }).click();
  await set.getByRole("button", { name: "View Set (3)", exact: true }).click();
  await third.press("Space");
  await expect(
    preview.getByRole("button", { name: "Deny This Image", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await preview.getByRole("radio", { name: "2", exact: true }).press("Space");
  await expect(preview.getByRole("region", { name: "Result 2", exact: true })).toBeVisible();
  const actions = preview.getByRole("group", { name: "Dream Actions", exact: true });
  await actions.getByRole("button", { name: "Super Like", exact: true }).click();
  await expect(
    preview.getByRole("img", { name: "Dream prompt standalone", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => dream.requests.at(-1)?.body)
    .toEqual({
      ids: ["cover", "middle", "last"],
      verdict: "like",
      likedId: "middle",
      overrides: { last: "discard" },
    });
  expect(dream.known.get("middle")?.rating).toBe("liked");
  expect(dream.known.get("cover")?.rating).toBeUndefined();
  expect(dream.known.get("last")?.rating).toBe("disliked");
  await actions.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(preview.getByRole("img", { name: "Dream prompt cover", exact: true })).toBeVisible();
  await expect
    .poll(() => dream.requests.at(-1)?.body)
    .toEqual({
      ids: ["cover", "middle", "last"],
      setId: "night-out",
    });
  await expect.poll(() => dream.known.get("middle")?.rating).toBeUndefined();
  await expect.poll(() => dream.known.get("last")?.rating).toBeUndefined();
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
    .toEqual(["Undo", "Pass", "A", "B", "Accept", "Suggestions"]);

  // A side opens in the preview; closing it returns to the same comparison.
  await pair.getByRole("button", { name: "View B · 40 Steps", exact: true }).click();
  const viewer = page.getByRole("dialog");
  const answers = viewer.getByRole("group", { name: "Dream Actions" });
  for (const name of ["Pass", "Super Like", "Accept", "Both", "Suggestions"])
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
  // Fullscreen accepts the shown side; Undo puts the pair back.
  await third.getByRole("button", { name: "View A · Guidance 3", exact: true }).click();
  expect(dream.requests.length).toBe(2);
  await viewer.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  // Undo remains available when the deck is empty.
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(
    page.getByRole("group", { name: "Dream Actions" }).getByRole("button", { name: "Undo" }),
  ).toBeEnabled();
  await undo.click();
  await expect(third).toContainText("Guidance 3");
  await third.getByRole("button", { name: "View A · Guidance 3", exact: true }).click();
  await viewer.getByRole("button", { name: "Both", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => `${request.path} ${JSON.stringify(request.body)}`))
    .toEqual([
      '/api/dream/pairs/one/answer {"answer":"a"}',
      '/api/dream/pass {"ids":["p2a","p2b"],"reason":"skip"}',
      '/api/dream/pairs/three/answer {"answer":"a"}',
      '/api/dream/undo {"ids":["p3a","p3b"]}',
      '/api/dream/pairs/three/answer {"answer":"both"}',
    ]);
});

test("A three-way comparison fits a small phone and can accept the selected side", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: [2, 0, 1].map((side) => {
      const item = dreamItem(`side-${side}`);
      return {
        ...item,
        dream: {
          ...item.dream,
          pair: {
            id: "three",
            size: 3,
            side,
            question: "Which Style?",
            label: ["Plain", "Soft", "Bold"][side],
          },
        },
      };
    }),
  });
  await page.goto("/dream");
  const card = page.getByRole("group", { name: "Which Style?", exact: true });
  const actions = page.getByRole("group", { name: "Comparison Answers" });
  const buttons = ["Undo", "Pass", "A", "B", "C", "Accept", "Suggestions"];
  await expect
    .poll(() =>
      actions.getByRole("button").evaluateAll((nodes) => nodes.map((node) => node.ariaLabel)),
    )
    .toEqual(buttons);
  await drag(page, card, -140);
  await page.keyboard.press("ArrowRight");
  expect(dream.requests).toEqual([]);
  await card.getByRole("button", { name: "View C · Bold", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const previewActions = preview.getByRole("group", { name: "Dream Actions" });
  for (const name of ["Undo", "Pass", "Super Like", "Accept", "All", "Suggestions"])
    await expect(previewActions.getByRole("button", { name, exact: true })).toBeInViewport({
      ratio: 1,
    });
  const results = preview.getByRole("radiogroup", { name: "Comparison Results" });
  await expect(results.getByText("C · Bold", { exact: true })).toBeVisible();
  await expect(results.getByRole("radio", { name: "C · Bold", exact: true })).toBeChecked();
  await results.getByText("A · Plain", { exact: true }).click();
  await expect(results.getByRole("radio", { name: "A · Plain", exact: true })).toBeChecked();
  await previewActions.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(preview).toBeHidden();
  await expect.poll(() => dream.requests[0]?.body).toEqual({ answer: "a" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card).toBeVisible();
  await expect.poll(() => dream.requests[1]?.body).toEqual({ ids: ["side-0", "side-1", "side-2"] });
  await actions.getByRole("button", { name: "C", exact: true }).click();
  await expect.poll(() => dream.requests[2]?.body).toEqual({ answer: "c" });
});

test("Comparison suggestions use the side shown in fullscreen", async ({ page }) => {
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
  await page.route("**/api/suggestions", (route) =>
    route.fulfill({
      json: {
        suggestions: [{ label: "Closer Crop", request: "crop closer", prompt: "A closer crop" }],
      },
    }),
  );
  await page.goto("/dream");
  await page.getByRole("button", { name: "View A · Quiet", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const bright = preview.getByRole("radio", { name: "B · Bright", exact: true });
  await bright.press("Space");
  await expect(bright).toBeChecked();
  const request = page.waitForRequest(
    (req) => req.url().endsWith("/api/suggestions") && req.method() === "POST",
  );
  await preview.getByRole("button", { name: "Suggestions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Custom…", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit Comparison", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Closer Crop", exact: true })).toBeVisible();
  expect((await request).postDataJSON()).toMatchObject({
    surface: "viewer",
    jobId: "job-Bright",
    itemId: "Bright",
  });
  expect(dream.requests).toEqual([]);
});

test("This Week shows the best kept results, what worked, what was passed and what comes next", async ({
  page,
}) => {
  await fixtures(page);
  const kept = (id: string) =>
    dreamItem(id, { dream: { prompt: "p", why: "", at: stamp, state: "kept" } });
  await serveDream(page, {
    week: {
      kept: 2,
      passed: 3,
      top: [kept("best"), kept("next")],
      best: {
        models: [{ name: "Flux 2", kept: 2, passed: 1 }],
        loras: [],
        themes: [{ name: "forest", kept: 2, passed: 0 }],
      },
      passedThemes: [{ name: "city", kept: 0, passed: 2 }],
      reasons: [
        { reason: "taste", count: 2 },
        { reason: "glitch", count: 1 },
      ],
      next: {
        models: ["Flux 2"],
        loras: [],
        themes: ["forest"],
        projects: ["Moss"],
        explore: 0.95,
      },
    },
  });
  await page.goto("/dream");
  await showView(page, "This Week");
  await expect(page).toHaveURL(/\/dream\/week$/);
  await expect(page.getByText("2 results kept and 3 passed in the last seven days.")).toBeVisible();
  // The deck's Images and Videos stay with the deck.
  await expect(page.getByRole("radio", { name: /^Images/ })).toHaveCount(0);
  const best = page.getByRole("table", { name: "Worked Best" });
  await expect(best.getByText("Flux 2", { exact: true })).toBeVisible();
  await expect(best.getByText("67% (2 of 3)", { exact: true })).toBeVisible();
  await expect(page.getByText("Not My Taste (2), Glitch (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Themes: city (2)", { exact: true })).toBeVisible();
  await expect(page.getByText("Projects: Moss", { exact: true })).toBeVisible();
  await expect(page.getByText("Explores 95% of new ideas", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View Dream prompt best", exact: true }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("img", { name: "Dream prompt best" })).toBeVisible();
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Discards", exact: true }),
  ).toBeAttached();
  // The deck's counts and Pause stay with the deck.
  await expect(page.getByRole("radio", { name: "Images", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Pause Dream", exact: true })).toHaveCount(0);
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
  if (!test.info().project.use.isMobile) {
    // The first Escape closes the docked Details, the next the viewer.
    await page.keyboard.press("Escape");
    await expect(viewer).toBeVisible();
  }
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

test("The preview swipes between comparison sides and Super Likes the shown image", async ({
  page,
  isMobile,
  browserName,
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
  await expect(viewer.getByRole("region", { name: "A · 20 Steps", exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeInViewport();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("region", { name: "B · 40 Steps", exact: true })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeInViewport();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "Side 20 Steps" })).toBeInViewport();

  if (isMobile && browserName === "chromium") {
    await drag(page, viewer.getByRole("img", { name: "Side 20 Steps" }), -160);
    await expect(viewer.getByRole("region", { name: "B · 40 Steps", exact: true })).toBeVisible();
    await expect(viewer.getByRole("img", { name: "Side 40 Steps" })).toBeInViewport();
    await drag(page, viewer.getByRole("img", { name: "Side 40 Steps" }), 0, 160);
    await expect(viewer).toBeHidden();
    const reopen = page.getByRole("button", { name: "View B · 40 Steps", exact: true });
    await expect(reopen).toBeFocused();
    await reopen.click();
  } else {
    await page.keyboard.press("ArrowRight");
  }
  expect(dream.requests).toEqual([]);

  const answers = viewer.getByRole("group", { name: "Dream Actions" });
  await expect
    .poll(() =>
      answers.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.ariaLabel)),
    )
    .toEqual(["Undo", "Pass", "Super Like", "Accept", "Both", "Suggestions"]);
  await answers.getByRole("button", { name: "Super Like", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  await expect.poll(() => dream.requests.length).toBe(1);
  expect(verdicts(dream)).toEqual(["POST /api/dream/pairs/steps/answer"]);
  expect(dream.requests[0].body).toEqual({ answer: "b", like: true });
  await expect.poll(() => dream.known.get("sb")?.rating).toBe("liked");
});

test("Preview uses viewer gestures and its buttons judge and undo", async ({
  page,
  isMobile,
  browserName,
}) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: ["one", "two", "three"].map((id) => dreamItem(id)),
  });
  await page.goto("/dream");
  await current(page).getByRole("button", { name: "View", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const card = preview.getByRole("group", { name: "Current Dream", exact: true });
  await expect(card.getByRole("img", { name: "Dream prompt one", exact: true })).toBeVisible();
  if (isMobile && browserName === "chromium") {
    await drag(page, card.getByRole("img", { name: "Dream prompt one" }), 160);
    await expect(card.getByRole("img", { name: "Dream prompt one" })).toBeInViewport();
    await drag(page, card.getByRole("img", { name: "Dream prompt one" }), 0, -160);
    const details = page.getByRole("dialog").filter({
      has: page.getByRole("button", { name: "Close Details", exact: true }),
    });
    await expect(details).toContainText("Dream prompt one");
    await closeDetails(preview, details, isMobile);
    await drag(page, card.getByRole("img", { name: "Dream prompt one" }), 0, 160);
    await expect(preview).toBeHidden();
    await current(page).getByRole("button", { name: "View", exact: true }).click();
  }
  expect(dream.requests).toEqual([]);
  await preview.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(card.getByRole("img", { name: "Dream prompt two", exact: true })).toBeVisible();
  await preview
    .getByRole("group", { name: "Dream Actions", exact: true })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(card.getByRole("img", { name: "Dream prompt one", exact: true })).toBeVisible();
  const details = await previewDetails(preview, isMobile);
  await expect(details).toContainText("Dream prompt one");
  await closeDetails(preview, details, isMobile);
  const pass = (await preview.getByRole("button", { name: "Pass", exact: true }).boundingBox())!;
  await page.mouse.move(pass.x + pass.width / 2, pass.y + pass.height / 2);
  await page.mouse.down();
  try {
    await expect(page.getByRole("dialog", { name: "Why Pass?", exact: true })).toBeVisible();
  } finally {
    await page.mouse.up();
  }
  await confirmPass(page, "Glitch");
  await expect(card.getByRole("img", { name: "Dream prompt two", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt two", exact: true }),
  ).toBeVisible();
  await expect(current(page).getByRole("button", { name: "View", exact: true })).toBeFocused();
  await expect
    .poll(() => verdicts(dream))
    .toEqual(["POST /api/dream/one/keep", "POST /api/dream/undo", "POST /api/dream/pass"]);
  expect(dream.requests[2].body).toEqual({ ids: ["one"], reason: "glitch" });
});

test("Dream fullscreen closes from the letterbox and taps cycle its chrome, text and media alone", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  const image =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200"><rect width="1200" height="200" fill="#335"/></svg>',
    );
  const dream = await serveDream(page, {
    unseen: [dreamItem("wide", { url: image, thumbnailUrl: image, width: 1200, height: 200 })],
  });
  await page.goto("/dream");
  const open = current(page).getByRole("button", { name: "View", exact: true });
  await open.click();
  const preview = page.getByRole("dialog", { name: "Preview", exact: true });
  const card = preview.getByRole("group", { name: "Current Dream", exact: true });
  const picture = card
    .getByRole("button", { name: "Change Image Zoom", exact: true })
    .getByRole("img", { name: "Dream prompt wide", exact: true });
  await expect(picture).toBeVisible();
  const stage = (await card.boundingBox())!;
  const media = (await picture.boundingBox())!;
  const x = stage.x + stage.width / 2;
  expect(stage.y + stage.height).toBeGreaterThan(media.y + media.height);
  const y = (stage.y + stage.height + media.y + media.height) / 2;
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(preview).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  const header = preview.getByRole("group", { name: "Viewer Header", exact: true });
  const actions = preview.getByRole("group", { name: "Dream Actions", exact: true });
  const why = preview.getByText("Because you like wide.", { exact: true });
  await expect(why).toBeHidden();
  const tap = () => (isMobile ? picture.tap() : picture.click());
  await expect(header).toBeVisible();
  await tap();
  await expect(why).toBeVisible();
  await expect(header).toBeVisible();
  await expect(actions).toBeVisible();
  await tap();
  await expect(why).toBeHidden();
  await expect(header).toBeHidden();
  await expect(actions).toBeHidden();
  await page.keyboard.press("c");
  await expect(header).toBeVisible();
  await expect(actions).toBeVisible();
  // Hiding the chrome from one of its own controls keeps the shortcut working.
  await header.getByRole("button", { name: "Close Preview", exact: true }).focus();
  await page.keyboard.press("c");
  await expect(why).toBeVisible();
  await page.keyboard.press("c");
  await expect(header).toBeHidden();
  await page.keyboard.press("c");
  await expect(header).toBeVisible();
  expect(verdicts(dream)).toEqual([]);
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
  await expect(
    current(page).getByRole("img", { name: "Dream prompt one", exact: true }),
  ).toBeVisible();
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
  await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  const avoid = editor.getByRole("textbox", { name: "Avoid", exact: true });
  const done = editor.getByRole("button", { name: "Done", exact: true });
  const create = editor.getByRole("button", { name: "Create", exact: true });
  if (isMobile) await name.click();
  await name.fill("Harbour");
  if (isMobile) {
    await done.click();
    await expect(create).toBeInViewport();
    await avoid.tap();
  }
  await avoid.fill("people");
  if (isMobile) {
    await expect(avoid).toBeFocused();
    await expect(create).toBeHidden();
    await done.tap();
    await expect(create).toBeInViewport();
  }
  await expect(avoid).toHaveValue("people");
  await useLoras(editor, false);
  await create.click();
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
  await expect(edit.getByRole("textbox", { name: "Avoid", exact: true })).toHaveValue("people");
  await useLoras(edit, true);
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(harbour).not.toContainText("No LoRAs");

  const enabled = harbour.getByRole("switch", { name: "Enable Harbour", exact: true });
  await expect(enabled).toBeChecked();
  await enabled.click({ force: true });
  await expect(enabled).not.toBeChecked();
  await expect(harbour).toContainText("Disabled");
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

test("New Project suggests an empty brief field and Undo restores it", async ({
  page,
  isMobile,
}) => {
  await fixtures(page);
  await serveDream(page);
  const requests: unknown[] = [];
  await page.route("**/api/assistant/project-brief", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { text: "Soft morning light by the harbour." } });
  });
  await page.goto("/dream/projects");
  await expect(page.getByText("No Projects", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New Project", exact: true });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  if (isMobile) await name.click();
  await name.fill("Harbour Study");
  if (isMobile) await editor.getByRole("button", { name: "Done", exact: true }).click();
  // A single AI option runs at once; the menu returns with Undo while the proposal stands.
  await editor.getByRole("button", { name: "Suggest Styles", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("Suggested");
  await expect(editor.getByRole("textbox", { name: "Styles", exact: true })).toHaveValue(
    "Soft morning light by the harbour.",
  );
  expect(requests).toEqual([
    {
      name: "Harbour Study",
      field: "styles",
      brief: { subjects: "", styles: "", avoid: "" },
    },
  ]);
  await editor.getByRole("button", { name: "AI Styles Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveCount(0);
});

test("The Inbox accepts, edits then accepts, declines with or without a reason and clears Dream's proposals", async ({
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
      proposal("shoes", "rule", "Add Another Rule", { rule: "flat shoes" }),
    ],
  });
  await page.goto("/dream/projects");
  await expect(page.getByRole("region", { name: "Inbox (5)", exact: true })).toBeVisible();

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

  // Decline acts at once; holding it, or its context menu, asks for a reason that teaches Dream.
  await page
    .getByRole("article", { name: "Pause Coast", exact: true })
    .getByRole("button", { name: "Decline", exact: true })
    .press("Shift+F10");
  const decline = page.getByRole("dialog", { name: "Decline", exact: true });
  await fillBox(decline, "Reason", "Coast is new", isMobile);
  await decline.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(decline).toBeHidden();
  expect(dream.requests.at(-1)).toEqual({
    method: "POST",
    path: "/api/dream/inbox/pause/dismiss",
    body: { reason: "Coast is new" },
  });
  const mara = page.getByRole("article", { name: "Mara", exact: true });
  await mara.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(mara).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Decline", exact: true })).toHaveCount(0);
  expect(dream.requests.at(-1)).toEqual({
    method: "POST",
    path: "/api/dream/inbox/mara/dismiss",
    body: {},
  });

  // Clearing the Inbox still asks first.
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

test("Dream autoplays silently when sound is blocked and lets the viewer choose a comparison side", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let playRequested = false;
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element;
        if (target.closest("button")?.getAttribute("aria-label") === "Unmute") playRequested = true;
      },
      true,
    );
    HTMLMediaElement.prototype.play = function () {
      if (!playRequested && !this.muted)
        return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
      this.dataset.playing = "true";
      return Promise.resolve();
    };
  });
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
  await serveDream(page, {
    unseen: [
      ...comparison("video", "Which Video?", video("video-a"), video("video-b")),
      ...comparison("next", "Which Video?", video("next-a"), video("next-b")),
    ],
  });
  await page.goto("/dream");
  await showMedia(page, "Videos");
  const pair = page.getByRole("group", { name: "Which Video?", exact: true });
  const playerA = pair.locator("video").first();
  const playerB = pair.locator("video").last();
  await expect(pair.locator("video")).toHaveCount(2);
  await expect(page.locator("video")).toHaveCount(2);
  await expect(playerA).toHaveJSProperty("muted", true);
  await expect(playerB).toHaveJSProperty("muted", true);
  await expect(playerA).toHaveAttribute("data-playing", "true");
  await expect(playerB).toHaveAttribute("data-playing", "true");
  await expect(pair.getByRole("button", { name: "Play", exact: true })).toBeHidden();
  await pair.getByRole("button", { name: "Unmute", exact: true }).click();
  await expect(playerA).toHaveJSProperty("muted", false);

  await pair.getByRole("radio", { name: "Audio B", exact: true }).press("Space");
  await expect(playerA).toHaveJSProperty("muted", true);
  await expect(playerB).toHaveJSProperty("muted", false);
  await pair.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(playerB).toHaveJSProperty("muted", true);

  await pair.getByRole("button", { name: "View B · Later", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Preview" });
  await expect(page.locator("video")).toHaveCount(1);
  const player = viewer.locator("video");
  await expect(player).toHaveAttribute("aria-label", "Dream prompt video-b");
  await expect(player).toHaveJSProperty("muted", true);
  const unmute = viewer.getByRole("button", { name: "Unmute", exact: true });
  const stage = (await player.boundingBox())!;
  const corner = (await unmute.boundingBox())!;
  expect(corner.x + corner.width).toBeGreaterThan(stage.x + stage.width * 0.75);
  expect(corner.y + corner.height).toBeGreaterThan(stage.y + stage.height * 0.75);
  await unmute.click();
  await expect(player).toHaveJSProperty("muted", false);
});

test("Dream keeps Images and Videos separate through deck, preview, history and discards", async ({
  page,
  isMobile,
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
      title: id === "video-a" ? "River at Dawn" : "River at Dusk",
      settings: {
        profileName: id === "video-a" ? "Video Profile A" : "Video Profile B",
        duration: 3,
      },
    });
  const dream = await serveDream(page, {
    unseen: [
      ...comparison("image-pair", "Which Image?", dreamItem("image-a"), dreamItem("image-b")),
      ...comparison("video-pair", "Which Video?", video("video-a"), video("video-b")),
    ],
    discarded: [dreamItem("discard-image"), video("discard-video")],
    history: [
      { at: stamp, action: "Kept", item: { title: "Image History", media: "image" } },
      { at: stamp, action: "Kept", item: { title: "Video History", media: "video" } },
    ],
  });
  await page.goto("/dream");
  await expect(page.getByRole("group", { name: "Which Image?", exact: true })).toBeVisible();
  await showMedia(page, "Videos");
  await expect(page.getByRole("radio", { name: "Videos (1)", exact: true })).toBeChecked();
  const pair = page.getByRole("group", { name: "Which Video?", exact: true });
  await pair.getByRole("button", { name: "View A · Earlier", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Preview", exact: true });
  await expect(viewer).toBeVisible();
  const player = viewer.locator("video");
  const close = viewer.getByRole("button", { name: "Close Preview", exact: true });
  await expect(player).toHaveCount(1);
  await expect(player).toHaveAttribute("aria-label", "Dream prompt video-a");
  await expect(player).toHaveAttribute("src", /#video-a$/);
  await expect(player).toHaveJSProperty("videoWidth", 32);
  await expect(player).toHaveJSProperty("paused", false);
  const details = await previewDetails(viewer, isMobile);
  await expect(details).toContainText("Dream prompt video-a");
  await expect(details).toContainText("Video Profile A");
  if (isMobile) {
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
    await expect(viewer).toBeVisible();
  }
  await close.press("ArrowRight");
  await expect(player).toHaveAttribute("aria-label", "Dream prompt video-b");
  await expect(player).toHaveAttribute("src", /#video-b$/);
  await expect(player).toHaveJSProperty("videoWidth", 32);
  await expect(player).toHaveJSProperty("paused", false);
  const nextDetails = await previewDetails(viewer, isMobile);
  await expect(nextDetails).toContainText("Dream prompt video-b");
  await expect(nextDetails).toContainText("Video Profile B");
  await expect(nextDetails).not.toContainText("Dream prompt video-a");
  await closeDetails(viewer, nextDetails, isMobile);
  expect(dream.requests).toEqual([]);
  await close.click();
  await expect(pair.getByRole("button", { name: "View B · Later", exact: true })).toBeFocused();
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
  await showView(page, "Dream");
  await expect(pair).toBeVisible();
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await showView(page, "History");
  await expect
    .poll(() => dream.requests)
    .toEqual([
      {
        method: "POST",
        path: "/api/dream/pairs/video-pair/answer",
        body: { answer: "b" },
      },
    ]);
});

test("new Dream generations follow the active comparison and survive Undo", async ({ page }) => {
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
  await expect(
    current(page).getByRole("img", { name: "Dream prompt latest", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(original).toBeVisible();
  await expect
    .poll(() =>
      dream.requests
        .map((request) => request.path)
        .filter((path) => path.includes("/answer") || path.endsWith("/undo")),
    )
    .toEqual(["/api/dream/pairs/original/answer", "/api/dream/undo"]);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt latest", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("group", { name: "Which arrived?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt middle", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    current(page).getByRole("img", { name: "Dream prompt old", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Dream Is Paused", { exact: true })).toBeVisible();
});
