import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Profile } from "../../frontend/src/types";
import {
  closeLoras,
  fixtures,
  image,
  profiles,
  promptOptions,
  promptTool,
  serveProfiles,
  stamp,
  viewerAction,
} from "./fixtures";

async function seed(
  page: Page,
  extra: Record<string, unknown> = {},
  routes?: (page: Page, state: Awaited<ReturnType<typeof fixtures>>) => Promise<unknown>,
) {
  const state = await fixtures(page);
  const settings = { profileId: "image:test", seed: 1234567, steps: 28, count: 2 };
  const item = {
    id: "hub",
    jobId: "job-hub",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "An amber bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings,
    ...extra,
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
  // Registered after the shared fixtures, these take precedence over them.
  await routes?.(page, state);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  return { state, viewer: page.getByRole("dialog", { name: "Generation", exact: true }) };
}

/** Edit › Run Again: queues the same settings with a new seed, without the composer. */
async function newSeed(page: Page) {
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Run Again", exact: true }).click();
}

/**
 * Types into the viewer's prompt field and sends it: Enter on desktop, the full-screen editor's
 * send arrow on phones.
 */
async function sendField(page: Page, name: string, text: string, send: string) {
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const field = viewer.getByRole("textbox", { name, exact: true });
  if (page.viewportSize()!.width >= 768) {
    await field.fill(text);
    return field.press("Enter");
  }
  await field.click();
  const editor = page.getByRole("dialog", { name, exact: true });
  await editor.getByRole("textbox", { name, exact: true }).fill(text);
  await editor.getByRole("button", { name: send, exact: true }).click();
}

test("The viewer's prompt field runs an edited prompt with the item's settings as a version", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(field).toHaveValue("An amber bird");
  await sendField(page, "Prompt", "An amber bird at dusk", "Generate");
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    sessionId: "session-hub",
    operation: "image",
    parentJobId: "job-hub",
    parentItemId: "hub",
    input: { prompt: "An amber bird at dusk", count: 2, steps: 28 },
  });
  await expect(
    viewer.getByRole("list", { name: "Versions", exact: true }).getByRole("listitem"),
  ).toHaveCount(2);
  // The bar stays in reach while phone details are open, without its prompt field.
  if (page.viewportSize()!.width < 768) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close Details", exact: true })).toBeVisible();
    await expect(field).toBeHidden();
    await expect(viewer.getByRole("button", { name: "Edit", exact: true })).toBeInViewport();
    await viewer.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit Image", exact: true }).click();
    await expect(viewer).toBeHidden();
  }
});

test("A video's prompt field runs its edited prompt again as a video", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/test-media/clip.mp4",
    prompt: "A rolling wave",
    model: "video.safetensors",
    settings: { profileId: "video:test" },
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A rolling wave",
  );
  const before = state.jobs.length;
  await sendField(page, "Prompt", "A rolling wave at night", "Generate");
  await expect.poll(() => state.jobs.length).toBe(before + 1);
  expect(state.jobs.at(-1)!.input.prompt).toBe("A rolling wave at night");
  expect(state.jobs.at(-1)!.input.kind ?? "video").toBe("video");
});

test("Ask turns a change in plain words into the chosen action's prompt in place, to run or undo", async ({
  page,
}, testInfo) => {
  const asked: any[] = [];
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route("**/api/suggestions", (route) => {
      const body = route.request().postDataJSON();
      if (body.surface !== "change") return route.fallback();
      asked.push(body);
      return route.fulfill({
        json: {
          suggestions: [
            {
              action: "edit",
              label: "Night Version",
              request: body.request,
              prompt: "An amber bird at night",
            },
          ],
        },
      });
    }),
  );
  // Phones ask from the full-screen editor, whose header carries the field's actions.
  const phone = Boolean(testInfo.project.use.isMobile);
  const surface = phone
    ? page.getByRole("dialog", { name: "Prompt", exact: true })
    : viewer.getByRole("group", { name: "Generation Actions", exact: true });
  if (phone) await viewer.getByRole("textbox", { name: "Prompt", exact: true }).click();
  const field = surface.getByRole("textbox", { name: "Prompt", exact: true });
  // The editor shows the tools as buttons; elsewhere they are in the prompt's ⋯.
  const askForChange = () =>
    phone
      ? surface.getByRole("button", { name: "Ask for a Change", exact: true }).click()
      : promptTool(surface, "Prompt", "Ask for a Change");
  await field.fill("make it night");
  await askForChange();
  // The proposal replaces the text in place under the chosen action; Undo restores the request.
  await expect(field).toHaveValue("An amber bird at night");
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveText("Edit");
  expect(asked).toEqual([
    {
      surface: "change",
      jobId: "job-hub",
      request: "make it night",
      actions: ["edit", "recreate", "animate", "upscale"],
    },
  ]);
  await surface.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("make it night");
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveCount(0);
  await askForChange();
  await expect(field).toHaveValue("An amber bird at night");
  expect(state.jobs).toHaveLength(1);
  await surface.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "refine",
    parentItemId: "hub",
    input: { prompt: "An amber bird at night", count: 1 },
  });
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveCount(0);
});

test("Suggestions offers the image's next steps as changes, and picking one asks at once", async ({
  page,
}) => {
  const asked: any[] = [];
  const { viewer } = await seed(page, {}, (page) =>
    page.route("**/api/suggestions", (route) => {
      const body = route.request().postDataJSON();
      asked.push(body);
      if (body.surface === "viewer")
        return route.fulfill({
          json: {
            suggestions: [
              { label: "Night Version", request: "make it night", prompt: "A night bird" },
              { label: "Add Rain", request: "add rain", prompt: "A rainy bird" },
            ],
          },
        });
      return route.fulfill({
        json: {
          suggestions: [
            {
              action: "edit",
              label: "Rain",
              request: body.request,
              prompt: "An amber bird in rain",
            },
          ],
        },
      });
    }),
  );
  const options = await promptOptions(viewer, "Prompt", "Suggestions");
  await options.getByRole("menuitem", { name: "Add Rain", exact: true }).click();
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(field).toHaveValue("An amber bird in rain");
  await expect(viewer.getByLabel("Proposed Action", { exact: true })).toHaveText("Edit");
  expect(asked.filter((body) => body.surface === "change")).toEqual([
    {
      surface: "change",
      jobId: "job-hub",
      request: "add rain",
      actions: ["edit", "recreate", "animate", "upscale"],
    },
  ]);
  // Undo returns the request the suggestion filled in.
  await viewer.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("add rain");
});

test("Continue in Chat starts a new Chat about the item, attached as its reference", async ({
  page,
}) => {
  const { viewer } = await seed(page);
  const desktop = page.viewportSize()!.width >= 768;
  // Desktop's prompt ⋯ carries a change typed over the prompt into the Chat; phones list it under
  // the bar's More.
  if (desktop) {
    await viewer.getByRole("textbox", { name: "Prompt", exact: true }).fill("make it night");
    await promptTool(viewer, "Prompt", "Continue in Chat");
  } else await viewerAction(page, "Continue in Chat");
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    desktop ? "make it night" : "",
  );
  await page.getByRole("textbox", { name: "Message", exact: true }).focus();
  await expect(
    page
      .getByRole("button", { name: "Choose References", exact: true })
      .getByRole("img", { name: /^Reference 1/ }),
  ).toBeVisible();
});

test("Viewer runs queue into the strip and Edit › Edit Prompt opens the composer", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  await expect(viewer.getByRole("button", { name: "Compare", exact: true })).toHaveCount(0);
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Repeat Exactly", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    sessionId: "session-hub",
    parentJobId: "job-hub",
    parentItemId: "hub",
    input: { count: 1, seed: 1234567 },
  });
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await strip.getByRole("listitem", { name: "Show Version 2", exact: true }).click();
  await expect(strip.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "true");
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Edit Prompt", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
});

test("A regenerated result shows beside its source until All Versions collapses them", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({ parentJobId: "job-hub", parentItemId: "hub" });
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  const tiles = page.getByRole("button", { name: /^Open image: An amber bird/ });
  await expect(tiles).toHaveCount(2);
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("switch", { name: "All Versions", exact: true }).click();
  await expect(tiles).toHaveCount(1);
  await expect(tiles).toHaveAccessibleName("Open image: An amber bird, Version 1 of 2");
});

test("The strip holds the item's versions, not the other results of its run", async ({ page }) => {
  const { state, viewer } = await seed(page, {}, async (_page, state) => {
    const sibling = { ...state.gallery[0], id: "hub-2", prompt: "A grey heron" };
    state.jobs[0].items.push(sibling);
    state.gallery.push(sibling);
  });
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({ parentJobId: "job-hub", parentItemId: "hub" });
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await expect(strip.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
  await strip.getByRole("listitem", { name: "Show Version 2", exact: true }).click();
  await expect(strip.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "true");
});

test("A version keeps its strip once the runs have left the queue, and runs from it record it", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, {}, async (_page, state) => {
    // Neither run is listed any more (a deleted Chat, say): the version kept its source.
    state.jobs.length = 0;
    state.gallery.unshift({
      ...state.gallery[0],
      id: "hub-night",
      jobId: "job-night",
      prompt: "An amber bird at night",
      createdAt: "2026-10-23T00:01:00.000Z",
      parentItemId: "hub",
    });
  });
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await expect(strip.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
  await strip.getByRole("listitem", { name: "Show Version 2", exact: true }).click();
  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird at night",
  );
  await expect(strip.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "true");
  // Its source's Chat is gone, so a run from it starts a Chat and still records where it came from.
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0]).toMatchObject({ parentItemId: "hub-night", parentJobId: undefined });
});

test("Run Again and Edit Prompt draw a new seed; only Repeat Exactly keeps it", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  // Edit queues Run Again and Repeat Exactly at once; Edit Prompt loads the composer.
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({ seed: "", steps: 28 });
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Repeat Exactly", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2].input).toMatchObject({ seed: 1234567, steps: 28 });
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Edit Prompt", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
  await expect(page.getByRole("button", { name: /^Clear Seed/ })).toHaveCount(0);
});

test("One key runs a viewer action: R runs again, P opens the composer", async ({
  page,
}, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones have no keyboard shortcuts.");
  const { state, viewer } = await seed(page);
  // The keys act through the bar's own actions, so wait for it.
  await expect(viewer.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await viewer.getByRole("img", { name: "An amber bird", exact: true }).focus();
  await page.keyboard.press("r");
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({ seed: "", steps: 28 });
  await page.keyboard.press("p");
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
});

/** A profile with a ComfyUI and a Radiance backend that runs on `backend`, defining `defined`. */
const combined = (backend: string, defined = ["comfyui", "radiance"]) => ({
  ...profiles[0],
  id: "custom:krea",
  label: "Krea 2 Turbo · Fast",
  model: "custom:krea",
  workflow: "custom:krea",
  backend,
  backendOptions: defined.map((id) => ({
    id,
    label: id === "comfyui" ? "ComfyUI" : "Radiance",
    ready: true,
  })),
});
const ranOn = (backend: string) => ({
  settings: { profileId: "custom:krea", profileBackend: backend, seed: 1234567, steps: 28 },
});

test("Repeat Exactly and Edit Prompt keep the backend a combined profile ran on", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, ranOn("radiance"), () =>
    serveProfiles(page, [combined("comfyui"), ...profiles.slice(1)]),
  );
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Repeat Exactly", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({
    profileId: "custom:krea",
    profileBackend: "radiance",
    seed: 1234567,
  });
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Edit Prompt", exact: true }).click();
  await expect(viewer).toBeHidden();
  // The Backend chip shows the backend this draft runs on, not the profile's current one. Focus,
  // not a tap: tapping the prompt on a phone switches to the typing layout, which hides the chips.
  await page.getByRole("textbox", { name: "Prompt", exact: true }).focus();
  await expect(page.getByRole("combobox", { name: "Backend", exact: true })).toContainText(
    "Radiance",
  );
});

test("A rerun whose backend the profile no longer has runs on its current one and says so", async ({
  page,
}) => {
  const { state } = await seed(page, ranOn("radiance"), () =>
    serveProfiles(page, [combined("comfyui", ["comfyui"]), ...profiles.slice(1)]),
  );
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Repeat Exactly", exact: true }).click();
  await expect(
    page.getByText("Krea 2 Turbo · Fast no longer runs on Radiance, so this run uses ComfyUI."),
  ).toBeVisible();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.profileBackend).toBeUndefined();
});

test("An Animate theme queues a video in one click; the queue item writes its motion prompt", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Spicy", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    parentJobId: "job-hub",
    input: {
      kind: "video",
      prompt: "",
      writing: { kind: "animate", theme: "living", source: "An amber bird" },
      referenceAssets: [{ assetId: "asset-hub", slot: "start" }],
    },
  });
});

test("Animate runs local Fast unless Quality is chosen, and keeps the choice as the account's", async ({
  page,
}) => {
  const asked: unknown[] = [];
  const { state, viewer } = await seed(page, {}, (page, fixture) =>
    page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) => {
      // The account's preference picks the model.
      const videos = fixture.preferences.preferences.videos;
      asked.push(videos);
      return route.fulfill({
        json: {
          profileId: "video:test",
          label: videos === "quality" ? "Motion Quality" : "Motion Fast",
          cloud: false,
          // Without Cloud Models there is no Cloud.
          offers: { cloud: false, fast: true, quality: true },
        },
      });
    }),
  );
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  // Cloud, Fast or Quality is one segmented control at the top of the menu, Fast until chosen.
  const choice = page.getByRole("radiogroup", { name: "Cloud, Fast or Quality", exact: true });
  await expect(choice.getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
  await expect(choice.getByRole("radio", { name: "Cloud", exact: true })).toHaveCount(0);
  await choice.getByText("Quality", { exact: true }).click();
  await expect(choice.getByRole("radio", { name: "Quality", exact: true })).toBeChecked();
  expect(state.preferences.preferences.videos).toBe("quality");
  await expect.poll(() => asked.at(-1)).toBe("quality");
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({ profileId: "video:test" });
});

test("Review Prompt First writes the motion prompt for editing, and Run queues exactly that prompt", async ({
  page,
}) => {
  const asked: unknown[] = [];
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route(/\/api\/assistant\/animate$/, (route) => {
      asked.push(route.request().postDataJSON());
      return route.fulfill({
        json: { ok: true, prompt: "The bird lifts off.", model: "local/text", thinking: "Wings." },
      });
    }),
  );
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  const review = page.getByRole("menuitem", { name: "Review Prompt First", exact: true });
  await expect(review).toHaveAttribute("aria-checked", "false");
  await review.click();
  await expect(review).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review Prompt", exact: true });
  const prompt = dialog.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("The bird lifts off.");
  await expect(dialog.getByText("Motion Quality", { exact: true })).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({
    profileId: "video:test",
    theme: "living",
    source: "An amber bird",
    extend: false,
    assetId: "asset-hub",
  });
  expect(state.jobs).toHaveLength(1);
  await prompt.fill("The bird lifts off slowly.");
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    input: {
      kind: "video",
      prompt: "The bird lifts off slowly.",
      writing: { kind: "animate", prompt: "The bird lifts off slowly.", model: "local/text" },
      referenceAssets: [{ assetId: "asset-hub", slot: "start" }],
    },
  });
  // The choice is remembered; Cancel queues nothing.
  await page.reload();
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(review).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitem", { name: "Cinematic Camera", exact: true }).click();
  await expect(prompt).toHaveValue("The bird lifts off.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.jobs).toHaveLength(2);
});

test("A queue item streams its prompt's thinking; the result keeps it collapsed under the prompt", async ({
  page,
}, testInfo) => {
  const thinking = "The bird is perched, so a gentle take-off reads best.";
  const { state, viewer } = await seed(page, {
    writing: { kind: "animate", model: "local/text", thinking },
  });
  state.jobs.push({
    id: "job-writing",
    jobId: "job-writing",
    sessionId: "session-hub",
    status: "writing",
    operation: "animate",
    input: { kind: "video", prompt: "", writing: { kind: "animate", theme: "action" } },
    progress: { thinking: "Wings first, then", prompt: "The bird spreads its wings" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  if (testInfo.project.use.isMobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    details = page.getByRole("dialog", { name: "An amber bird", exact: true });
  }
  await expect(details.getByText("Written by local/text", { exact: true })).toBeVisible();
  const toggle = details.getByRole("button", { name: "Thinking", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(details.getByText(thinking, { exact: true })).toBeHidden();
  await toggle.click();
  await expect(details.getByText(thinking, { exact: true })).toBeVisible();
  // The queue item, as a fresh page loads it.
  await page.goto("/images");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
  await expect(queue.getByText("Writing Prompt", { exact: true })).toBeVisible();
  await expect(queue.getByText("Wings first, then", { exact: true })).toBeVisible();
  await expect(queue.getByText("The bird spreads its wings", { exact: true })).toBeVisible();
});

// Local video is stopped and the account is granted Grok: Animate goes there and says so first.
const grok: Profile = {
  id: "grok:video",
  label: "Grok Imagine Video",
  kind: "video",
  model: "grok:video",
  workflow: "grok:video",
  family: "grok",
  provider: "cliproxyapi",
  ready: true,
  defaults: { width: 1280, height: 720, duration: 6 },
  capabilities: { imageInput: true },
  mediaInputs: [{ id: "reference", label: "Reference Image" }],
};
async function offline(page: Page) {
  await serveProfiles(page, [...profiles, grok]);
  await page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        profileId: grok.id,
        label: grok.label,
        cloud: true,
        size: { width: 960, height: 960 },
        offers: { cloud: true, fast: true, quality: false },
      },
    }),
  );
}

test("Animate offers Cloud beside the local tiers when the account has both, and runs on the pick", async ({
  page,
}) => {
  const asked: string[] = [];
  const { state, viewer } = await seed(page, {}, async (page, fixture) => {
    await serveProfiles(page, [...profiles, grok]);
    await page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) => {
      const cloud = fixture.preferences.preferences.videos === "cloud";
      asked.push(cloud ? "cloud" : "local");
      return route.fulfill({
        json: {
          profileId: cloud ? grok.id : "video:test",
          label: cloud ? grok.label : "Motion Fast",
          cloud,
          // One local profile, Fast, so there is no Quality.
          offers: { cloud: true, fast: true, quality: false },
        },
      });
    });
  });
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  const choice = page.getByRole("radiogroup", { name: "Cloud, Fast or Quality", exact: true });
  // Fast where the account has local video, until another is chosen.
  await expect(choice.getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
  await expect(choice.getByRole("radio", { name: "Quality", exact: true })).toHaveCount(0);
  expect(asked[0]).toBe("local");
  await choice.getByText("Cloud", { exact: true }).click();
  await expect(choice.getByRole("radio", { name: "Cloud", exact: true })).toBeChecked();
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(asked.at(-1)).toBe("cloud");
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    input: { kind: "video", profileId: grok.id },
  });
});

test("With local video stopped, an Animate theme queues on Grok", async ({ page }) => {
  const { state, viewer } = await seed(page, {}, offline);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Cinematic Camera", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    input: {
      kind: "video",
      profileId: grok.id,
      writing: { kind: "animate", theme: "cinematic" },
      width: 960,
      height: 960,
      duration: 6,
      referenceAssets: [{ assetId: "asset-hub", slot: "reference" }],
    },
  });
});

test("A video's Extend theme continues it from its last frame, and its frame can be a reference or an image", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/test-media/clip.mp4",
    prompt: "A rolling wave",
    model: "video.safetensors",
    settings: { profileId: "video:test" },
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await viewer.getByRole("button", { name: "Extend", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Extend in Composer", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0]).toMatchObject({
    operation: "animate",
    input: {
      kind: "video",
      profileId: "video:test",
      writing: { kind: "animate", theme: "living", source: "A rolling wave" },
    },
  });
  // The frame showing is saved as an image, or becomes a reference in the composer.
  await viewer.getByRole("button", { name: "Extend", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save Frame as Image", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Saved to Uploads", exact: true })).toBeVisible();
  expect(state.referenceRequests.at(-1)).toEqual({ save: true, galleryItemId: "clip", frame: 0 });
  await page.getByRole("menuitem", { name: "Use Frame as Reference", exact: true }).click();
  await expect
    .poll(() => state.referenceRequests.at(-1))
    .toEqual({ galleryItemId: "clip", frame: 0 });
});

test("With local video stopped, Animate in Composer pre-selects Grok", async ({ page }) => {
  const { state, viewer } = await seed(page, {}, offline);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Animate in Composer", exact: true }).click();
  await expect(page).toHaveURL(/\/video\?compose=1/);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    grok.label,
  );
  expect(state.jobs).toHaveLength(1);
});

test("With neither local video nor Grok, Animate's options are disabled", async ({ page }) => {
  const reason =
    "Local video isn't running and this account has no Grok access (Cloud Models), so nothing can animate this image right now.";
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 409, json: { ok: false, error: reason } }),
    ),
  );
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Living Photo", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Animate in Composer", exact: true }),
  ).toBeDisabled();
  expect(state.jobs).toHaveLength(1);
});

test("Copy ▾ lists Details then Prompt, and each copies its text", async ({ page }) => {
  await page.addInitScript(() => {
    // Copying happens within the tap, as iOS Safari needs: the copy command, not the clipboard API.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = (command: string) => {
      const selected = document.activeElement as HTMLTextAreaElement;
      if (command !== "copy" || selected?.tagName !== "TEXTAREA") return false;
      (window as any).copied = selected.value;
      return true;
    };
  });
  await seed(page, {
    negative: "blurry",
    settings: {
      profileId: "image:test",
      seed: 1234567,
      steps: 28,
      cfg: 4,
      sampler: "euler",
      vae: "models/vae/ae.safetensors",
    },
  });
  await viewerAction(page, "Copy");
  // Its options sort alphabetically.
  await expect(page.getByRole("menuitem", { name: /^(Prompt|Details)$/ })).toHaveText([
    "Details",
    "Prompt",
  ]);
  await page.getByRole("menuitem", { name: "Prompt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe("An amber bird");
  await viewerAction(page, "Copy");
  await page.getByRole("menuitem", { name: "Details", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copied))
    .toBe(
      [
        "An amber bird",
        "Negative Prompt: blurry",
        "Profile: Image Quality",
        "CFG: 4",
        "Mode: Generate",
        "Sampler: euler",
        "Seed: 1234567",
        "Steps: 28",
        "VAE: ae",
        "Dimensions: 1024 × 1024",
      ].join("\n"),
    );
});

test("Near-misses beside the viewer's controls keep it open; the empty stage closes it", async ({
  page,
}) => {
  const { viewer } = await seed(page);
  const actions = (await viewer
    .getByRole("group", { name: "Generation Actions", exact: true })
    .boundingBox())!;
  await page.mouse.click(actions.x + actions.width / 2, actions.y - 10);
  await expect(viewer).toBeVisible();
  const stage = (await viewer.locator("[data-zoom-mode]").boundingBox())!;
  const picture = (await viewer
    .getByRole("button", { name: "Change Image Zoom", exact: true })
    .boundingBox())!;
  // The square image leaves empty stage above or beside it.
  const blank =
    picture.x - stage.x > 80
      ? { x: stage.x + 20, y: stage.y + stage.height / 3 }
      : { x: stage.x + stage.width / 2, y: stage.y + 20 };
  await page.mouse.click(blank.x, blank.y);
  await expect(viewer).toBeHidden();
});

test("An opened video plays, muted when the browser refuses sound", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as any).played = { muted: this.muted };
      return this.muted
        ? Promise.resolve()
        : Promise.reject(new DOMException("Sound needs a gesture", "NotAllowedError"));
    };
  });
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/test-media/clip.mp4",
    prompt: "A rolling wave",
    width: 1280,
    height: 720,
    createdAt: stamp,
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).played)).toEqual({ muted: true });
  // Its controls stay hidden until a pointer moves over it.
  const video = page.getByRole("dialog", { name: "Generation", exact: true }).locator("video");
  await expect(video).not.toHaveAttribute("controls");
  await video.hover();
  await expect(video).toHaveAttribute("controls");
});

test("An opened video the browser won't play shows its still and its controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException("Autoplay is off", "NotAllowedError"));
  });
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/test-media/clip.mp4",
    thumbnailUrl: image,
    prompt: "A rolling wave",
    width: 1280,
    height: 720,
    createdAt: stamp,
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  const video = page.getByRole("dialog", { name: "Generation", exact: true }).locator("video");
  await expect(video).toHaveAttribute("poster", image);
  await expect(video).toHaveAttribute("controls");
});

test("A video tile plays its preview while a mouse is over it", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones have no hover.");
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      (window as any).played = this.currentSrc || this.src;
      return Promise.resolve();
    };
  });
  const state = await fixtures(page);
  state.gallery.push({
    id: "clip",
    jobId: "job-clip",
    type: "video",
    status: "done",
    url: "/comfy/view?filename=clip.mp4&subfolder=&type=studio",
    thumbnailUrl: image,
    prompt: "A rolling wave",
    width: 1280,
    height: 720,
    createdAt: stamp,
  });
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).hover();
  await expect
    .poll(() => page.evaluate(() => (window as any).played))
    .toContain("/comfy/video-preview?filename=clip.mp4");
  // Opened, it plays the copy iOS Safari plays, and also downloads as a GIF.
  await page.getByRole("button", { name: "Open video: A rolling wave", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Generation", exact: true }).locator("video"),
  ).toHaveAttribute(
    "src",
    "/comfy/video-preview?filename=clip.mp4&subfolder=&type=studio&format=play",
  );
  await viewerAction(page, "Download");
  await expect(page.getByRole("menuitem", { name: "Video", exact: true })).toHaveAttribute(
    "href",
    "/comfy/view?filename=clip.mp4&subfolder=&type=studio",
  );
  const gif = page.getByRole("menuitem", { name: "GIF", exact: true });
  await expect(gif).toHaveAttribute(
    "href",
    "/comfy/video-preview?filename=clip.mp4&subfolder=&type=studio&format=gif",
  );
  await expect(gif).toHaveAttribute("download", /\.gif$/);
  await expect(page.getByRole("menuitem", { name: "Back & Forth", exact: true })).toHaveAttribute(
    "href",
    "/comfy/video-preview?filename=clip.mp4&subfolder=&type=studio&format=loop",
  );
});

test("Details fold only a long caption, keep its tags in sight and copy the prompts", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = (command: string) => {
      const selected = document.activeElement as HTMLTextAreaElement;
      if (command !== "copy" || selected?.tagName !== "TEXTAREA") return false;
      (window as any).copied = selected.value;
      return true;
    };
  });
  const negative = Array.from({ length: 12 }, (_, line) => `Unwanted detail ${line + 1}`).join(
    "\n",
  );
  const caption = Array.from({ length: 12 }, (_, line) => `Caption line ${line + 1}`).join("\n");
  const { viewer } = await seed(page, {
    negative,
    caption: {
      text: caption,
      tags: ["branch", "bird"],
      model: "vision-model",
      at: stamp,
      version: 2,
    },
  });
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  if (testInfo.project.use.isMobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    details = page.getByRole("dialog", { name: "An amber bird", exact: true });
  }
  // A long caption folds until Expand and folds again on Collapse; its tags stay in sight.
  const tags = details.getByLabel("Caption Tags", { exact: true });
  await expect(tags.getByRole("link")).toHaveText(["bird", "branch"]);
  await expect(tags).toBeVisible();
  const expand = details.getByRole("button", { name: "Expand Caption", exact: true });
  await expand.click();
  await details.getByRole("button", { name: "Collapse Caption", exact: true }).click();
  await expect(expand).toBeVisible();
  // Every other section shows in full, however long.
  await expect(details.getByRole("button", { name: /^Expand / })).toHaveCount(1);
  // Only the prompts have Copy.
  const copied = () => page.evaluate(() => (window as any).copied);
  await expect(details.getByRole("button", { name: /^Copy / })).toHaveCount(2);
  await details.getByRole("button", { name: "Copy Prompt", exact: true }).click();
  await expect.poll(copied).toBe("An amber bird");
  await details.getByRole("button", { name: "Copy Negative Prompt", exact: true }).click();
  await expect.poll(copied).toBe(negative);
  // A tag searches the gallery for it and closes the viewer.
  await tags.getByRole("link", { name: "Search branch", exact: true }).click();
  await expect(viewer).toBeHidden();
  if (!testInfo.project.use.isMobile)
    await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
      "branch",
    );
});

test("Desktop details stay where the viewer left them", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones show details in a sheet.");
  const { viewer } = await seed(page);
  const details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await expect(details.getByText("1234567", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(details).toBeHidden();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "Generation Details", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(details).toBeHidden();
});

test("Phone swipes reveal details and close the viewer", async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  const { viewer } = await seed(page);
  const picture = viewer.getByRole("img", { name: "An amber bird", exact: true });
  await expect(picture).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  async function swipe(dy: number) {
    const box = (await picture.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + dy }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  // A drag too short to navigate follows the finger, then settles back.
  const start = (await picture.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x - 40, y }],
  });
  await expect.poll(async () => Math.round((await picture.boundingBox())!.x - start.x)).toBe(-40);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Math.round((await picture.boundingBox())!.x - start.x)).toBe(0);
  await swipe(-120);
  const sheet = page.getByRole("dialog", { name: "An amber bird", exact: true });
  await expect(sheet.getByText("1234567", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
  await expect(sheet).toBeHidden();
  await swipe(120);
  await expect(viewer).toBeHidden();
});

test("A double tap zooms in at the tapped point and back to Fit; a click still cycles", async ({
  page,
}, testInfo) => {
  const { viewer } = await seed(page);
  const picture = viewer.getByRole("img", { name: "An amber bird", exact: true });
  const zoom = viewer.locator("[data-zoom-mode]");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeGreaterThan(0);
  const box = (await picture.boundingBox())!;
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.3;
  if (!testInfo.project.use.isMobile) {
    // A mouse double-click is two clicks, each cycling the zoom.
    await picture.dblclick();
    await expect(zoom).toHaveAttribute("data-zoom-mode", "Actual Size");
    return;
  }
  const webkit = testInfo.project.use.browserName === "webkit";
  const touch = webkit ? undefined : await page.context().newCDPSession(page);
  // Chromium taps like a finger: held briefly and wobbling a few pixels.
  async function tap() {
    if (!touch) return page.touchscreen.tap(x, y);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 7, y }],
    });
    await page.waitForTimeout(150);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  const fitScale = Number(await zoom.getAttribute("data-zoom-scale"));
  // A single tap leaves the zoom and the viewer as they are.
  await tap();
  await page.waitForTimeout(400);
  await expect(zoom).toHaveAttribute("data-zoom-mode", "Fit");
  await expect(viewer).toBeVisible();
  await tap();
  await page.waitForTimeout(100);
  await tap();
  await expect(zoom).toHaveAttribute("data-zoom-mode", "Custom");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeCloseTo(fitScale * 2.5);
  // The tapped point stays under the finger.
  const zoomed = (await picture.boundingBox())!;
  expect((x - zoomed.x) / zoomed.width).toBeCloseTo(0.3, 1);
  expect((y - zoomed.y) / zoomed.height).toBeCloseTo(0.3, 1);
  await page.waitForTimeout(400);
  await tap();
  await page.waitForTimeout(100);
  await tap();
  await expect(zoom).toHaveAttribute("data-zoom-mode", "Fit");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeCloseTo(fitScale);
  await expect(viewer).toBeVisible();
});

test("Work still generating and videos take the same swipes as a picture", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  const state = await fixtures(page);
  state.gallery.push(
    {
      id: "live",
      jobId: "live-job",
      type: "video",
      status: "pending",
      prompt: "A live study",
      createdAt: stamp,
    },
    {
      id: "clip",
      type: "video",
      status: "done",
      url: "/test-media/clip.mp4",
      prompt: "A rolling wave",
      width: 1280,
      height: 720,
      createdAt: stamp,
    },
    {
      id: "clip-2",
      type: "video",
      status: "done",
      url: "/test-media/clip-2.mp4",
      prompt: "A breaking wave",
      width: 1280,
      height: 720,
      createdAt: stamp,
    },
  );
  await page.goto("/video");
  await page.getByRole("button", { name: "Open video: A live study", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const status = viewer.getByRole("status", { name: "Generation Status", exact: true });
  await expect(status).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  async function swipeLeft(target: Locator) {
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - 150, y }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await swipeLeft(status);
  const video = viewer.locator("video");
  await expect(video).toHaveAttribute("src", "/test-media/clip.mp4");
  await swipeLeft(video);
  await expect(video).toHaveAttribute("src", "/test-media/clip-2.mp4");
});

test("Fullscreen viewer preserves media interaction and closes on the surrounding blurred stage", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  // Native sharing would replace the row's Download on WebKit phones.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined }),
  );
  state.gallery.push({
    id: "viewer",
    jobId: "job-viewer",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Viewer Study",
    width: 1024,
    height: 1024,
    settings: { profileId: "image:test" },
  });
  state.gallery.push({
    ...state.gallery[0],
    id: "viewer-next",
    jobId: "job-viewer-next",
    prompt: "Next Viewer Study",
  });
  await page.goto("/images");
  const firstTile = page.getByRole("button", { name: "Open image: Viewer Study", exact: true });
  await firstTile.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Open image: Next Viewer Study", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(firstTile).toBeFocused();
  await firstTile.click();
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds?.width).toBe(viewport.width);
  expect(bounds?.height).toBe(viewport.height);
  const phone = viewport.width < 768;
  if (phone) {
    // Phones keep the bar to one row, with the rest under More and Delete last.
    const bar = dialog.getByRole("group", { name: "Generation Actions", exact: true });
    const row = ["Animate", "Edit", "Upscale", "Star", "More"].map((name) =>
      bar.getByRole("button", { name, exact: true }),
    );
    const tops = await Promise.all(row.map(async (control) => (await control.boundingBox())!.y));
    expect(new Set(tops).size).toBe(1);
    await row[4].click();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Find Similar",
      "Continue in Chat",
      "Copy",
      "Download",
      "Delete",
    ]);
  }
  const download = (phone ? page : dialog).getByRole(phone ? "menuitem" : "link", {
    name: "Download",
    exact: true,
  });
  await expect(download).toHaveAttribute("href", image);
  await expect(download).toHaveAttribute("download", "studio-viewer.png");
  if (phone) await page.keyboard.press("Escape");
  // Phones swipe instead of showing the arrows.
  const next = dialog.getByRole("button", { name: "Next Generation", exact: true });
  if (phone) await expect(next).toHaveCount(0);
  else await next.click();
  if (phone) await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
  // Navigation stops at the ends instead of wrapping round.
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
  if (!phone) await expect(next).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("img", { name: "Viewer Study", exact: true })).toBeVisible();
  if (testInfo.project.use.browserName !== "webkit") {
    const picture = await dialog
      .getByRole("img", { name: "Viewer Study", exact: true })
      .boundingBox();
    const touch = await page.context().newCDPSession(page);
    const y = picture!.y + picture!.height / 2;
    const start = picture!.x + picture!.width * 0.8;
    const end = picture!.x + picture!.width * 0.2;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: start, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: end, y }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("img", { name: "Viewer Study", exact: true })).toBeVisible();
  }
  const zoom = dialog.locator("[data-zoom-mode]");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeGreaterThan(0);
  const fitScale = Number(await zoom.getAttribute("data-zoom-scale"));
  await page.keyboard.press("Equal");
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeGreaterThan(fitScale);
  await page.keyboard.press("Digit0");
  await expect(zoom).toHaveAttribute("data-zoom-mode", "Fit");
  await dialog.getByRole("img", { name: "Viewer Study", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom: Fill", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Fill", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Zoom: Fit", exact: true })).toBeVisible();
  // Desktop details are open beside the image; phones open them as a sheet.
  if (testInfo.project.use.isMobile) {
    await dialog.getByRole("button", { name: "Generation Details", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Viewer Study", exact: true });
    await expect(sheet.getByText("Prompt", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
    await expect(sheet).toBeHidden();
  } else
    await expect(
      dialog
        .getByRole("complementary", { name: "Generation Details", exact: true })
        .getByText("Prompt", { exact: true }),
    ).toBeVisible();
  await expect
    .poll(async () => {
      const picture = await dialog
        .getByRole("img", { name: "Viewer Study", exact: true })
        .boundingBox();
      const viewport = await zoom.boundingBox();
      return picture && viewport
        ? picture.width <= viewport.width + 1 && picture.height <= viewport.height + 1
        : false;
    })
    .toBe(true);
  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open image: Viewer Study", exact: true }),
  ).toBeFocused();
});

test("Legacy Prompt retains reference slots, disabled LoRAs and exact profile settings", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "legacy-item",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Legacy study",
    width: 1024,
    height: 1024,
    settings: {
      profileId: "image:test",
      model: "image.safetensors",
      referenceAssets: [{ assetId: "owned-asset", slot: "image" }],
      referenceRole: "reference",
      loras: [{ name: "detail.safetensors", enabled: false, strength: 0.8 }],
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open image: Legacy study", exact: true }).click();
  await viewerAction(page, "Edit");
  await page.getByRole("menuitem", { name: "Edit Prompt", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).press("Enter");
  await expect(page.getByRole("dialog", { name: "LoRAs", exact: true })).toBeVisible();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await closeLoras(page);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([{ assetId: "owned-asset", slot: "image" }]);
  expect(state.jobs[0].input.referenceRole).toBe("reference");
  expect(state.jobs[0].input.loras[0]).toEqual({
    name: "detail.safetensors",
    enabled: true,
    strength: 0.8,
  });
});

test("Viewer deletion retains failed media and waits for confirmed removal", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "delete-study",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Delete Study",
    width: 1024,
    height: 1024,
  });
  let attempts = 0;
  let release!: () => void;
  const removed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gallery/delete", async (route) => {
    if (++attempts === 1)
      return route.fulfill({ status: 503, json: { error: "Storage is temporarily unavailable." } });
    await removed;
    return route.fallback();
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Open image: Delete Study", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
    await viewerAction(page, "Delete");
    const confirmation = page.getByRole("dialog", { name: "Delete Item", exact: true });
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      confirmation.getByText("1 item couldn’t be deleted. Storage is temporarily unavailable."),
    ).toBeVisible();
    await expect(viewer).toBeVisible();
    expect(state.gallery).toHaveLength(1);
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    await expect(viewer).toBeVisible();
    release();
    await expect(viewer).toBeHidden();
    await expect(confirmation).toBeHidden();
    await expect(page.getByText("No Images", { exact: true })).toBeVisible();
    expect(state.gallery).toHaveLength(0);
  } finally {
    release();
  }
});

test("The viewer bar shows every action without scrolling on a tablet or narrow window", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "tablet-study",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Tablet Study",
    width: 1024,
    height: 1024,
  });
  // A tablet, or a narrow desktop window with Details open beside the media.
  const mobile = testInfo.project.use.isMobile;
  await page.setViewportSize(mobile ? { width: 1180, height: 820 } : { width: 1024, height: 768 });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Tablet Study", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const remove = viewer.getByRole("button", { name: "Delete", exact: true });
  await expect(remove).toBeVisible();
  if (!mobile)
    await expect(
      viewer.getByRole("complementary", { name: "Generation Details", exact: true }),
    ).toBeVisible();
  // The actions outgrow one row, so the bar wraps rather than scrolling Delete out of sight.
  const clipped = () =>
    remove.evaluate((button) => {
      const actions = button.closest('[role="group"] > *')!.getBoundingClientRect();
      const { left, right } = button.getBoundingClientRect();
      return left < actions.left || right > actions.right;
    });
  await expect.poll(clipped).toBe(false);
});
