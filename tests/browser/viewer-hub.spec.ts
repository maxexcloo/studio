import { type Locator, type Page, expect, test } from "@playwright/test";

import { mediaTitle } from "../../frontend/src/features/gallery/mediaLabels";
import type { Profile } from "../../frontend/src/types";
import { formatDateTime } from "../../frontend/src/ui/dates";
import {
  backToActionMenu,
  closeLoras,
  closeTextEditor,
  combinedImageProfile,
  expandAssistantMenu,
  fixtures,
  image,
  pressGenerate,
  profiles,
  promptMenu,
  serveProfiles,
  showViewerThumbnails,
  stamp,
  viewerAction,
  viewerChangeMenu,
} from "./fixtures";

async function seed(
  page: Page,
  extra: Record<string, unknown> = {},
  routes?: (page: Page, state: Awaited<ReturnType<typeof fixtures>>) => Promise<unknown>,
) {
  const state = await fixtures(page);
  const settings = {
    profileId: "image:test",
    profileName: "Image Quality",
    seed: 1234567,
    steps: 28,
    count: 2,
  };
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
  await page.getByRole("button", { name: `Open image: ${mediaTitle(item)}`, exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  return { state, viewer };
}

test("The viewer resolves an older result’s checkpoint to its profile name", async ({ page }) => {
  await page.clock.setFixedTime(new Date(stamp));
  const model = "krea2_turbo_int8_convrot";
  const { viewer } = await seed(page, { settings: { modelName: model } }, async (page) => {
    await serveProfiles(page, [
      {
        ...profiles[0],
        model: `checkpoints/${model}.safetensors`,
        label: "Krea 2 Turbo",
      },
    ]);
  });
  const header = viewer.getByRole("group", { name: "Viewer Header", exact: true });
  await expect(header.getByText("Amber Bird", { exact: true })).toBeVisible();
  await expect(header.getByText("Krea 2 Turbo", { exact: true })).toBeVisible();
  const timestamp = header.locator("time");
  await expect(timestamp).toHaveAttribute("datetime", stamp);
  await expect(timestamp).toHaveText(/^(?:[01]\d|2[0-3]):[0-5]\d, Today$/);
});

/** Recreate › Run Again: queues the same settings with a new seed, without the composer. */
async function newSeed(page: Page) {
  await viewerAction(page, "Recreate");
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
  const input = editor.getByRole("textbox", { name, exact: true });
  await input.tap();
  await expect(input).toBeFocused();
  await input.fill(text);
  await expect(input).toHaveValue(text);
  await editor.getByRole("button", { name: send, exact: true }).click();
}

test("The viewer's prompt field runs an edited prompt with the item's settings as a version", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(field).toHaveValue("An amber bird");
  // Its send stands beside it on every layout, waiting for a change.
  await expect(viewer.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
  await sendField(page, "Prompt", "An amber bird at dusk", "Generate");
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    sessionId: "session-hub",
    operation: "image",
    parentJobId: "job-hub",
    parentItemId: "hub",
    input: { prompt: "An amber bird at dusk", count: 2, steps: 28 },
  });
  // Desktop shows the run in the strip; a phone's editor returns to the gallery.
  if (page.viewportSize()!.width >= 768) {
    await showViewerThumbnails(viewer);
    await expect(
      viewer.getByRole("list", { name: "Versions", exact: true }).getByRole("listitem"),
    ).toHaveCount(2);
  } else {
    await expect(viewer).toBeHidden();
    await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    const closeDetails = page.getByRole("button", { name: "Close Details", exact: true });
    const edit = viewer.getByRole("button", { name: "Edit", exact: true });
    await expect(closeDetails).toBeVisible();
    await expect(field).toBeHidden();
    await expect(edit).toBeHidden();
    await closeDetails.click();
    await expect(edit).toBeInViewport();
    await edit.click();
    await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
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
  await page.goto("/videos");
  await page.getByRole("button", { name: "Open video: Rolling Wave", exact: true }).click();
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

test("Edit and Recreate share Custom and review each operation separately", async ({ page }) => {
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
              action: body.actions[0],
              label: "Night Version",
              request: body.request,
              prompt: "An amber bird at night",
            },
          ],
        },
      });
    }),
  );
  await viewerChangeMenu(page);
  await page.getByRole("menuitem", { name: "Review Prompt", exact: true }).click();
  await page.keyboard.press("Escape");
  const surface = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  const field = surface.getByRole("textbox", { name: "Prompt", exact: true });
  const editProfile = async (name: string) => {
    const profileMenu = page.getByRole("menuitem", { name: "Profile", exact: true });
    await profileMenu.click();
    const choice = page.getByRole("menuitemradio", { name, exact: true });
    await choice.click();
    await expect(choice).toBeHidden();
    await expect(profileMenu).toContainText(name);
  };
  // Edit and Recreate open the same dialog and keep its last request.
  const askForChange = async (mode: "Edit" | "Recreate", request?: string, profile?: string) => {
    await viewerChangeMenu(page, mode);
    if (profile) await editProfile(profile);
    await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
    const custom = page.getByRole("dialog", { name: "Custom Change", exact: true });
    if (request) await custom.getByRole("textbox", { name: "Change", exact: true }).fill(request);
    await custom.getByRole("button", { name: "Ask", exact: true }).click();
    await closeTextEditor(page, "Prompt");
  };
  await askForChange("Edit", "make it night", "Image Fast");
  // The proposal replaces the prompt in place under the chosen action and what it changed; Undo
  // restores the prompt.
  await expect(field).toHaveValue("An amber bird at night");
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveText("Edit");
  await expect(surface.getByText("+ at night")).toBeVisible();
  expect(asked).toEqual([
    {
      surface: "change",
      jobId: "job-hub",
      request: "make it night",
      actions: ["edit"],
      prompt: "An amber bird",
      itemId: "hub",
      profileId: "image:fast",
    },
  ]);
  await surface.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("An amber bird");
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveCount(0);
  await askForChange("Recreate");
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveText("Recreate");
  expect(asked.at(-1)).toMatchObject({ actions: ["recreate"], request: "make it night" });
  expect(asked.at(-1)).not.toHaveProperty("profileId");
  await surface.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await askForChange("Edit");
  await expect(field).toHaveValue("An amber bird at night");
  expect(state.jobs).toHaveLength(1);
  // A proposal keeps the Edit profile it was written for even if the next Edit is automatic.
  await viewerChangeMenu(page, "Edit");
  await editProfile("Automatic");
  const review = page.getByRole("menuitem", { name: "Review Prompt", exact: true });
  await page.keyboard.press("Escape");
  await expect(review).toBeHidden();
  await surface.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "refine",
    parentItemId: "hub",
    input: {
      prompt: "An amber bird at night",
      profileId: "image:fast",
      count: 1,
      referenceAssets: [{ assetId: "asset-hub", slot: "image" }],
    },
  });
  await expect(surface.getByLabel("Proposed Action", { exact: true })).toHaveCount(0);
});

/** Seeds the viewer with an assistant that answers every requested change with a hands fix. */
async function seedFix(page: Page, asked: any[]) {
  return seed(page, {}, async (page) => {
    const [source, video] = profiles;
    await serveProfiles(page, [{ ...source, mediaInputs: [] }, video, combinedImageProfile()]);
    await page.route("**/api/suggestions", (route) => {
      const body = route.request().postDataJSON();
      if (body.surface !== "change") return route.fallback();
      asked.push(body);
      return route.fulfill({
        json: {
          suggestions: [
            {
              action: "edit",
              label: "Fix Hands",
              request: body.request,
              prompt: "An amber bird with natural claws",
              profileBackend: "comfyui",
            },
          ],
        },
      });
    });
  });
}

test("Report's reasons fix the image as a new version and dislike the original", async ({
  page,
}) => {
  const asked: any[] = [];
  const { state } = await seedFix(page, asked);
  await viewerAction(page, "Report", "Hands");
  await expect
    .poll(() => asked.map((body) => body.request))
    .toEqual(["Fix what is wrong, keeping everything else: Hands"]);
  await expect.poll(() => state.jobs.length).toBe(2);
  await expect.poll(() => state.gallery.find((item) => item.id === "hub")?.rating).toBe("disliked");
});

test("Report can inspect the displayed image before sending a reviewed fix", async ({ page }) => {
  const asked: any[] = [];
  const { state } = await seedFix(page, asked);
  const inspected: unknown[] = [];
  await page.route("**/api/suggestions/inspect", (route) => {
    inspected.push(route.request().postDataJSON());
    return route.fulfill({ json: { status: "issue", issue: "six toes" } });
  });
  await viewerAction(page, "Report", "Other Issue…");
  const report = page.getByRole("dialog", { name: "Report Issue", exact: true });
  const fix = report.getByRole("button", { name: "Fix & Recreate", exact: true });
  await expect(fix).toBeDisabled();
  await report.getByText("Hands", { exact: true }).click();
  await expect(report.getByRole("checkbox", { name: "Hands", exact: true })).toBeChecked();
  await report.getByRole("button", { name: "Inspect Image", exact: true }).click();
  // The finding fills the details in place, with Undo.
  const details = report.getByRole("textbox", { name: "Details", exact: true });
  await expect(details).toHaveValue("six toes");
  await promptMenu(report, "Details");
  await expect(page.getByRole("menuitem", { name: "Undo", exact: true })).toBeVisible();
  // Escape closes only the menu, not the dialog beneath it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(report).toBeVisible();
  expect(inspected).toEqual([{ jobId: "job-hub", itemId: "hub", upscaled: false }]);
  expect(state.jobs).toHaveLength(1);
  expect(state.gallery.find((item) => item.id === "hub")?.rating).toBeUndefined();
  await expect(fix).toBeEnabled();
  let refuse = true;
  const refusal = "The worker cannot accept the replacement yet.";
  await page.route("**/api/sessions/*/generations", (route) =>
    refuse ? route.fulfill({ status: 409, json: { error: refusal } }) : route.fallback(),
  );
  await fix.click();
  await expect(report.getByText(refusal, { exact: true })).toBeVisible();
  expect(state.jobs).toHaveLength(1);
  expect(state.gallery.find((item) => item.id === "hub")?.rating).toBeUndefined();

  refuse = false;
  await fix.click();
  await expect(report).toBeHidden();
  expect(asked).toHaveLength(2);
  expect(asked.at(-1)).toEqual({
    surface: "change",
    jobId: "job-hub",
    request: "Fix what is wrong, keeping everything else: Hands: six toes",
    actions: ["edit", "recreate"],
    itemId: "hub",
    profileId: "custom:combined",
  });
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "refine",
    parentItemId: "hub",
    input: {
      profileId: "custom:combined",
      profileBackend: "comfyui",
      prompt: "An amber bird with natural claws",
    },
  });
  await expect.poll(() => state.gallery.find((item) => item.id === "hub")?.rating).toBe("disliked");
});

test("Edit offers the image's next steps as changes, and picking one asks at once", async ({
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
  await viewerChangeMenu(page);
  await page.getByRole("menuitem", { name: "Review Prompt", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add Rain", exact: true }).click();
  await closeTextEditor(page, "Prompt");
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(field).toHaveValue("An amber bird in rain");
  await expect(viewer.getByLabel("Proposed Action", { exact: true })).toHaveText("Edit");
  expect(asked.filter((body) => body.surface === "change")).toEqual([
    {
      surface: "change",
      jobId: "job-hub",
      request: "add rain",
      actions: ["edit"],
      prompt: "An amber bird",
      itemId: "hub",
      profileId: "image:test",
    },
  ]);
  // Undo restores the prompt before the suggestion.
  await viewer.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("An amber bird");
});

test("A delayed automatic change runs on its source without closing the next image", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { state, viewer } = await seed(page, {}, async (page, state) => {
    state.gallery.push({
      ...state.gallery[0],
      id: "neighbour",
      jobId: "job-neighbour",
      prompt: "An ivory fox",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await page.route("**/api/suggestions", async (route) => {
      const body = route.request().postDataJSON();
      if (body.surface === "viewer")
        return route.fulfill({
          json: { suggestions: [{ label: "Add Rain", request: "add rain" }] },
        });
      if (body.surface !== "change") return route.fallback();
      expect(body.itemId).toBe("hub");
      await held;
      await route.fulfill({
        json: {
          suggestions: [
            {
              action: "recreate",
              label: "Rain",
              request: body.request,
              prompt: "An amber bird in rain",
            },
          ],
        },
      });
    });
  });
  try {
    await viewerChangeMenu(page, "Recreate");
    const requested = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/suggestions") && request.postDataJSON()?.surface === "change",
    );
    await page.getByRole("menuitem", { name: "Add Rain", exact: true }).click();
    await requested;
    await page.keyboard.press("ArrowRight");
    const picture = viewer.getByRole("img", { name: "An ivory fox", exact: true });
    const prompt = viewer.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(picture).toBeVisible();
    await expect(prompt).toHaveValue("An ivory fox");
    await expect(viewer.getByRole("button", { name: "Recreate", exact: true })).not.toHaveAttribute(
      "data-loading",
    );
    release();
    await expect.poll(() => state.jobs.length).toBe(2);
    expect(state.jobs[1]).toMatchObject({
      operation: "image",
      parentItemId: "hub",
      input: { prompt: "An amber bird in rain", referenceAssets: [] },
    });
    await expect(picture).toBeVisible();
    await expect(prompt).toHaveValue("An ivory fox");
    await expect(viewer.getByRole("list", { name: "Versions", exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("The viewer's prompt rests on one line and shows the whole prompt while focused", async ({
  page,
}, testInfo) => {
  const prompt =
    "An amber bird on a mossy branch at dawn, mist over the valley below, soft rim light on its " +
    "feathers, dew on the leaves, a distant waterfall and pines fading into the haze";
  const { viewer } = await seed(page);
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await field.fill(prompt);
  await field.blur();
  const height = async () => (await field.boundingBox())!.height;
  const line = await field.evaluate((text) => parseFloat(getComputedStyle(text).lineHeight));
  // At rest: one whole line, ending in an ellipsis over the text.
  await expect.poll(height).toBeLessThan(line * 1.5);
  const summary = viewer.locator("[aria-hidden]", { hasText: prompt });
  await expect(summary).toBeVisible();
  expect(await summary.evaluate((line) => line.scrollWidth > line.clientWidth)).toBe(true);
  // Phones keep the dock to one line, including focus before the full-screen editor opens.
  if (testInfo.project.use.isMobile) {
    await field.focus();
    await expect.poll(height).toBeLessThan(line * 1.5);
    const ai = (await viewer.getByRole("button", { name: "AI", exact: true }).boundingBox())!;
    const send = (await viewer
      .getByRole("button", { name: "Generate", exact: true })
      .boundingBox())!;
    expect(Math.abs(ai.y + ai.height / 2 - send.y - send.height / 2)).toBeLessThan(4);
    await field.click();
    const editor = page.getByRole("dialog", { name: "Prompt", exact: true });
    await expect(editor).toBeVisible();
    const editorField = editor.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(editorField).toHaveValue(prompt);
    await editorField.focus();
    const keyboardTop = await page.evaluate(() => {
      const height = window.innerHeight - 300;
      Object.defineProperty(window.visualViewport, "height", { configurable: true, value: height });
      window.visualViewport!.dispatchEvent(new Event("resize"));
      return height;
    });
    const submit = editor.getByRole("button", { name: "Generate", exact: true });
    await expect
      .poll(async () => {
        const box = (await submit.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(keyboardTop);
    return;
  }
  await field.focus();
  await expect.poll(height).toBeGreaterThan(line * 1.5);
  await expect(summary).toHaveCount(0);
  // Another viewer control leaves the prompt, keeping its edit.
  await field.fill(`${prompt} in autumn`);
  await viewer.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Edit in Composer", exact: true })).toBeVisible();
  await expect.poll(height).toBeLessThan(line * 1.5);
  await expect(field).toHaveValue(`${prompt} in autumn`);
});

test("Custom Animation edits and submits in one dialog with its text tools", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    document.execCommand = (command: string) => {
      const field = document.activeElement as HTMLTextAreaElement;
      if (command !== "copy" || field?.tagName !== "TEXTAREA") return false;
      (window as any).copied = field.value;
      return true;
    };
  });
  const { state } = await seed(page);
  await viewerAction(page, "Animate");
  await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Animate", exact: true })).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "Custom Animation", exact: true });
  const phone = testInfo.project.use.isMobile;
  const field = dialog.getByRole("textbox", { name: "Instruction", exact: true });
  if (phone) {
    await field.click();
    await expect(field).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Instruction", exact: true })).toHaveCount(0);
    await expect(dialog.locator("[data-text-editor]")).toBeVisible();
    await expect(
      dialog.getByRole("group", { name: "Instruction Tools", exact: true }),
    ).toBeVisible();
  }
  await field.fill("The bird unfolds its wings.");
  const more = dialog.getByRole("button", { name: "AI Instruction Actions", exact: true });
  // Phones copy and clear above the keyboard; desktop leaves both to the browser.
  if (phone) {
    const edit = (name: string) => dialog.getByRole("button", { name, exact: true }).click();
    await edit("Copy");
    await expect
      .poll(() => page.evaluate(() => (window as any).copied))
      .toBe("The bird unfolds its wings.");
    await edit("Clear");
    await expect(field).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "Animate", exact: true })).toBeDisabled();
    await edit("Undo");
    await expect(field).toHaveValue("The bird unfolds its wings.");
  }
  await more.click();
  const tools = page.getByRole("menu", { name: "AI Instruction Actions", exact: true });
  await expect(tools.getByRole("menuitem", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Clear", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(tools).toBeHidden();
  await expect(dialog).toBeVisible();
  await more.click();
  // Dismissing the tools by a press on the field leaves the editor and its parent intact.
  await field.click();
  await expect(tools).toBeHidden();
  await expect(dialog).toBeVisible();
  if (phone) {
    await expect(field).toHaveValue("The bird unfolds its wings.");
  } else {
    await expect(dialog.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  }
  await dialog.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.writing).toMatchObject({
    kind: "animate",
    theme: "custom",
    instruction: "The bird unfolds its wings.",
  });
});

test("Viewer prompt offers Reset once edited, without a menu, and restores its original text", async ({
  page,
}, testInfo) => {
  const { viewer } = await seed(page, {}, async (page) => {
    await page.route("**/api/assistant", (route) =>
      route.fulfill({ json: { available: false, presets: [] } }),
    );
  });
  const summary = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  const phone = testInfo.project.use.isMobile;
  if (phone) await summary.click();
  const surface = phone ? page.getByRole("dialog", { name: "Prompt", exact: true }) : viewer;
  const field = surface.getByRole("textbox", { name: "Prompt", exact: true });
  const more = surface.getByRole("button", { name: "More Prompt Actions", exact: true });
  await expect(more).toHaveCount(0);
  const edit = (name: string) => surface.getByRole("button", { name, exact: true });
  await expect(edit("Reset")).toHaveCount(0);
  await field.fill("A bird at night");
  if (phone) await expect(surface.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await edit("Reset").click();
  await expect(field).toHaveValue("An amber bird");
  // Desktop edits keep the prompt focused, so the bar stays open.
  if (!phone) await expect(field).toBeFocused();
  await edit("Undo").click();
  await expect(field).toHaveValue("A bird at night");
});

test("The viewer prompt offers suggestions for review beside the field and in the phone editor", async ({
  page,
  isMobile,
}) => {
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route("**/api/suggestions", (route) => {
      const { surface } = route.request().postDataJSON();
      const suggestion = { label: "At Dusk", request: "Set the scene at dusk." };
      return route.fulfill({
        json: {
          suggestions: [
            surface === "change"
              ? { ...suggestion, action: "recreate", prompt: "An amber bird at dusk" }
              : suggestion,
          ],
        },
      });
    }),
  );
  const suggest = async (surface: typeof viewer) => {
    await surface.getByRole("button", { name: "AI", exact: true }).click();
    await page.getByRole("menuitem", { name: "At Dusk", exact: true }).click();
    await expect(surface.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
      "An amber bird at dusk",
    );
  };
  const prompt = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await suggest(viewer);
  expect(state.jobs).toHaveLength(1);
  await viewer.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(prompt).toHaveValue("An amber bird");
  let editor = viewer;
  if (isMobile) {
    await prompt.click();
    editor = page.getByRole("dialog", { name: "Prompt", exact: true });
    await expect(editor.getByRole("button", { name: "Close Prompt", exact: true })).toBeVisible();
  }
  await suggest(editor);
  await editor.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.prompt).toBe("An amber bird at dusk");
});

test("Viewer runs queue into the strip and Recreate › Recreate in Composer opens the composer", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, {}, async (_page, state) => {
    Object.assign(state.jobs[0].input, {
      chat: { conversationId: "source-chat" },
      resultSet: { id: "source-set", title: "Original Set", index: 0 },
    });
  });
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Run Again, Same Seed", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    sessionId: "session-hub",
    parentJobId: "job-hub",
    parentItemId: "hub",
    input: { count: 2, seed: 1234567 },
  });
  expect(state.jobs[1].input.chat).toBeUndefined();
  expect(state.jobs[1].input.resultSet).toBeUndefined();
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  // Newest first: the new version leads.
  await strip.getByRole("listitem").first().click();
  await expect(
    strip.getByRole("listitem", { name: "Show Version 2", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Recreate in Composer", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
});

test("Explore Three Directions stages an editable comparison from the viewed image", async ({
  page,
}) => {
  const directions = [
    { request: "scene", label: "On The Cliffs", prompt: "An amber bird on sea cliffs" },
    { request: "outfit", label: "Field Harness", prompt: "An amber bird in a field harness" },
    { request: "style", label: "Brush Study", prompt: "A brush study of an amber bird" },
  ];
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route("**/api/suggestions", (route) => {
      const request = route.request().postDataJSON();
      if (request.surface === "composer") return route.fallback();
      expect(request).toMatchObject({
        itemId: "hub",
        directions: directions.map(({ request }) => request),
      });
      return route.fulfill({
        json: {
          suggestions: directions.map((direction) => ({ ...direction, action: "recreate" })),
        },
      });
    }),
  );
  await viewerAction(page, "Discover", "Keep & Vary", "Explore Three Directions");
  const review = page.getByRole("dialog", { name: "Explore Three Directions", exact: true });
  await review.getByRole("button", { name: "Open Composer", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    directions[0].prompt,
  );
  expect(state.jobs).toHaveLength(1);
  await page
    .getByRole("group", { name: "Generation Actions", exact: true })
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  await expect.poll(() => state.jobs.length).toBe(4);
  for (const [index, direction] of directions.entries()) {
    expect(state.jobs[index + 1]).toMatchObject({
      parentJobId: "job-hub",
      parentItemId: "hub",
      input: { prompt: direction.prompt, seed: "1234567" },
    });
  }
});

test("A regenerated result has its own tile and remains linked in the viewer", async ({ page }) => {
  const { state, viewer } = await seed(page);
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({ parentJobId: "job-hub", parentItemId: "hub" });
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  const tiles = page.getByRole("button", { name: /^Open image: Amber Bird/ });
  await expect(tiles).toHaveCount(2);
  await page.locator('[data-media-id="hub"]').click();
  await showViewerThumbnails(viewer);
  await viewer.getByRole("listitem", { name: "Show Version 2", exact: true }).click();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(tiles.and(page.locator(':not([data-media-id="hub"])'))).toBeFocused();
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
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await expect(strip.getByRole("listitem").last()).toHaveAttribute("aria-current", "true");
  await strip.getByRole("listitem", { name: "Show Version 2", exact: true }).click();
  await expect(strip.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
});

test("A set and the shown result's versions have separate strips", async ({ page }) => {
  const set = { id: "set-birds", title: "Birds" };
  const { viewer } = await seed(page, { resultSet: { ...set, index: 0 } }, async (_page, state) => {
    state.jobs.length = 0;
    state.gallery.unshift(
      {
        ...state.gallery[0],
        id: "heron",
        prompt: "A grey heron",
        createdAt: "2026-10-23T00:01:00.000Z",
        resultSet: { ...set, index: 1 },
      },
      {
        ...state.gallery[0],
        id: "hub-night",
        prompt: "An amber bird at night",
        createdAt: "2026-10-23T00:02:00.000Z",
        resultSet: undefined,
        parentItemId: "hub",
      },
    );
  });
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Set: Birds", exact: true });
  const versions = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(versions.getByRole("listitem")).toHaveCount(2);
  expect(
    await strip.getByRole("listitem").evaluateAll((all) => all.map((entry) => entry.ariaLabel)),
  ).toEqual(["Show Grey Heron (1 of 2)", "Show Amber Bird (2 of 2)"]);
  await expect(strip.getByRole("listitem").last()).toHaveAttribute("aria-current", "true");
  // A version outside the set shows its versions alone.
  await versions.getByRole("listitem", { name: "Show Version 2", exact: true }).click();
  await expect(strip).toHaveCount(0);
  await expect(versions.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
});

test("Details shows the source, exact set, original chat and applied reference", async ({
  page,
}) => {
  const resultSet = { id: "heron-set", title: "Bird Studies", index: 0 };
  const conversationId = "baf8947b-9e24-45be-a8b0-90a9b4569bef";
  await seed(
    page,
    {
      chat: { conversationId, turnId: "turn-2" },
      parentItemId: "parent",
      resultSet,
      settings: {
        profileId: profiles[0].id,
        seed: 25,
        loras: [{ name: "Detail.safetensors", strength: 0.8 }],
        referenceAssets: [
          { slot: "identity", assetId: "my-ref", name: "Heron Upload", strength: 0.7 },
        ],
      },
    },
    async (page, state) => {
      await serveProfiles(page, [
        {
          ...profiles[0],
          mediaInputs: [
            {
              id: "identity",
              role: "identity",
              strength: { min: 0, max: 1, step: 0.1, default: 1 },
            },
          ],
        },
      ]);
      state.gallery.push({
        ...state.gallery[0],
        id: "parent",
        parentItemId: undefined,
        chat: { conversationId, turnId: "turn-1" },
        resultSet: { ...resultSet, id: "different-set" },
        settings: { seed: 0, loras: [{ name: "Detail.safetensors", strength: 0.4 }] },
        prompt: "A grey heron",
      });
    },
  );
  await page.getByRole("button", { name: "Generation Details", exact: true }).click();
  const source = page.getByRole("link", { name: "Grey Heron", exact: true });
  await expect(source).toHaveAttribute("href", "/images/parent");
  await expect(source.locator("img")).toHaveAttribute("src", image);
  await expect(page.getByText("Seed: 0 → 25", { exact: true })).toBeVisible();
  await expect(page.getByText("Detail: 0.4 → 0.8", { exact: true })).toBeVisible();
  await expect(page.getByText("Prompt changed", { exact: true })).toBeVisible();
  const chat = page.getByRole("link", { name: "Continue in Chat", exact: true });
  await expect(chat).toHaveAttribute("href", `https://chat.example.test/c/${conversationId}`);
  await expect(chat).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "Results From This Chat", exact: true }),
  ).toBeVisible();
  // References show their thumbnails alone, named by their role.
  await expect(page.getByRole("link", { name: "Open Identity", exact: true })).toBeVisible();
  await expect(page.getByText("Strength 0.7", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Bird Studies", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Set: Bird Studies Filter" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open image: Grey Heron", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  await page.getByRole("button", { name: "Generation Details", exact: true }).click();
  await page.getByRole("link", { name: "Results From This Turn", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove This Turn Filter", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open image: Grey Heron", exact: true }),
  ).toHaveCount(0);
});

test("A version keeps its strip once the runs have left the queue, and runs from it record it", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, {}, async (_page, state) => {
    // Neither run is listed any more (cleared from the queue, say): the version kept its source.
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
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await expect(strip.getByRole("listitem").last()).toHaveAttribute("aria-current", "true");
  await strip.getByRole("listitem", { name: "Show Version 2", exact: true }).click();

  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird at night",
  );
  await expect(strip.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
  // Its source's run is gone, so a run from it starts a session and still records where it came from.
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0]).toMatchObject({ parentItemId: "hub-night", parentJobId: undefined });
});

test("The strip shows iterations of iterations as a tree, newest first and the original last", async ({
  page,
}) => {
  const { viewer } = await seed(page, {}, async (_page, state) => {
    const version = (id: string, minute: number, parentItemId: string, prompt: string) => ({
      ...state.gallery[0],
      id,
      jobId: `job-${id}`,
      prompt,
      createdAt: `2026-10-23T00:0${minute}:00.000Z`,
      parentItemId,
    });
    // Two edits of the original, then two runs of the first edit.
    state.gallery.unshift(
      version("hub-snow-2", 4, "hub-snow", "An amber bird in deep snow"),
      version("hub-snow-1", 3, "hub-snow", "An amber bird in light snow"),
      version("hub-rain", 2, "hub", "An amber bird in rain"),
      version("hub-snow", 1, "hub", "An amber bird in snow"),
    );
  });
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Versions", exact: true });
  // Each branch stays together; a version away from its source names it.
  await expect(strip).toMatchAriaSnapshot(`
    - list "Versions":
      - listitem "Show Version 5, from Version 3"
      - listitem "Show Version 4"
      - listitem "Show Version 3, from Version 1"
      - listitem "Show Version 2"
      - listitem "Show Version 1"
  `);
  await expect(strip.getByRole("listitem").last()).toHaveAttribute("aria-current", "true");
  await strip
    .getByRole("listitem", { name: "Show Version 5, from Version 3", exact: true })
    .click();

  await expect(viewer.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird in deep snow",
  );
  await expect(strip.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
});

test("AI › More Like This Set asks for new variations of a result's set", async ({ page }) => {
  const asked: unknown[] = [];
  await seed(page, { resultSet: { id: "set-a", title: "Variety Test", index: 0 } }, (page) =>
    page.route("**/api/result-sets/more", (route) => {
      asked.push(route.request().postDataJSON());
      return route.fulfill({ json: { jobIds: ["new-1", "new-2"] } });
    }),
  );
  await viewerAction(page, "Discover", "More Like This Set");
  await expect.poll(() => asked).toEqual([{ itemId: "hub", scope: "set" }]);
});

test("AI › More Like This explicitly selects only the current image", async ({ page }) => {
  const asked: unknown[] = [];
  await seed(page, { resultSet: { id: "set-a", title: "Variety Test", index: 0 } }, (page) =>
    page.route("**/api/result-sets/more", (route) => {
      asked.push(route.request().postDataJSON());
      return route.fulfill({ json: { jobIds: ["new-1", "new-2"] } });
    }),
  );
  await viewerAction(page, "Discover");
  await expect(
    page.getByRole("menuitem", { name: "More Like This Set", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "More Like This", exact: true }).click();
  await expect.poll(() => asked).toEqual([{ itemId: "hub", scope: "image" }]);
});

test("More Like This Set is offered only for a result in a set", async ({ page }) => {
  await seed(page);
  await viewerAction(page, "Discover");
  await expect(page.getByRole("menuitem", { name: "More Like This", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "More Like This Set", exact: true })).toHaveCount(
    0,
  );
});

test("Recreate keeps an edited viewer prompt and changes the seed only when requested", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  const edited = "An amber bird over the harbour";
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  const phone = page.viewportSize()!.width < 768;
  if (phone) await field.click();
  const editor = phone ? page.getByRole("dialog", { name: "Prompt", exact: true }) : viewer;
  await editor.getByRole("textbox", { name: "Prompt", exact: true }).fill(edited);
  await closeTextEditor(page, "Prompt");
  await newSeed(page);
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "image",
    input: { prompt: edited, seed: "", steps: 28, referenceAssets: [] },
  });
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Run Again, Same Seed", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2].input).toMatchObject({ prompt: edited, seed: 1234567, steps: 28 });
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Recreate in Composer", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(edited);
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
    references: 0,
  })),
});
const ranOn = (backend: string) => ({
  settings: { profileId: "custom:krea", profileBackend: backend, seed: 1234567, steps: 28 },
});

test("Run Again, Same Seed and Recreate keep the backend a combined profile ran on", async ({
  page,
}) => {
  const { state, viewer } = await seed(page, ranOn("radiance"), () =>
    serveProfiles(page, [combined("comfyui"), ...profiles.slice(1)]),
  );
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Run Again, Same Seed", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({
    profileId: "custom:krea",
    profileBackend: "radiance",
    seed: 1234567,
  });
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Recreate in Composer", exact: true }).click();
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
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Run Again, Same Seed", exact: true }).click();
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
  await expect(page.getByRole("menuitem", { name: "Uncensored", exact: true })).toHaveCount(0);
  await expandAssistantMenu(page, "Templates");
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

test("An Animate run stays with the image it started on while the viewer moves between images", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  const bird = "An amber bird";
  const fox = "An ivory fox";
  for (const [id, prompt, createdAt] of [
    ["first", bird, stamp],
    ["second", fox, "2026-01-01T00:00:00.000Z"],
  ]) {
    const item = {
      id,
      jobId: `job-${id}`,
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      prompt,
      width: 1024,
      height: 1024,
      createdAt,
      settings: { profileId: "image:test" },
    };
    state.jobs.push({
      id: item.jobId,
      jobId: item.jobId,
      sessionId: `session-${id}`,
      status: "completed",
      operation: "image",
      input: { kind: "image", prompt, profileId: "image:test" },
      items: [item],
      outputs: [item],
      createdAt,
      updatedAt: createdAt,
    });
    state.gallery.push(item);
  }
  // The queue holds the animation's submission until released.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/sessions\/[^/]+\/generations$/, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: `Open image: ${mediaTitle({ prompt: bird })}`, exact: true })
    .click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const animate = viewer.getByRole("button", { name: "Animate", exact: true });
  // Desktop uses the arrows, Chromium phones swipe and WebKit phones take the arrow keys.
  const { isMobile, browserName } = testInfo.project.use;
  const touch = isMobile && browserName !== "webkit" && (await page.context().newCDPSession(page));
  /** Moves from one image to the other: the fox is next. */
  async function move(from: string, to: string) {
    const next = from === bird;
    const shown = viewer.getByRole("img", { name: to, exact: true });
    if (touch)
      // A swipe as the last image is still settling slides back, so it swipes again.
      await expect(async () => {
        const box = (await viewer.getByRole("img", { name: from, exact: true }).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const points = (dx: number) => [{ x: x + dx, y }];
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: points(0),
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: points(next ? -150 : 150),
        });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect(shown).toBeVisible({ timeout: 1000 });
      }).toPass();
    else if (isMobile) await page.keyboard.press(next ? "ArrowRight" : "ArrowLeft");
    else
      await viewer
        .getByRole("button", { name: `${next ? "Next" : "Previous"} Generation`, exact: true })
        .click();
    await expect(shown).toBeVisible();
  }
  await animate.click();
  await expandAssistantMenu(page, "Templates");
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect(animate).toHaveAttribute("data-loading");

  await move(bird, fox);
  await expect(animate).not.toHaveAttribute("data-loading");
  await expect(animate).toBeEnabled();

  await move(fox, bird);
  await expect(animate).toHaveAttribute("data-loading");

  // Released while the fox shows, the video still joins the bird's versions, not the fox's.
  await move(bird, fox);
  release();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2]).toMatchObject({
    operation: "animate",
    parentJobId: "job-first",
    parentItemId: "first",
    input: {
      kind: "video",
      writing: { kind: "animate", theme: "living", source: bird },
    },
  });
  const versions = viewer.getByRole("list", { name: "Versions", exact: true });
  await expect(versions).toHaveCount(0);
  await move(fox, bird);
  await expect(animate).not.toHaveAttribute("data-loading");
  await showViewerThumbnails(viewer);
  await expect(versions.getByRole("listitem")).toHaveCount(2);
});

test("Review Prompt writes the motion prompt for editing, and Run queues exactly that prompt", async ({
  page,
  isMobile,
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
  const review = page.getByRole("menuitem", { name: "Review Prompt", exact: true });
  await expect(review).toHaveAttribute("aria-checked", "false");
  await review.click();
  await expect(review).toHaveAttribute("aria-checked", "true");
  await expandAssistantMenu(page, "Templates");
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
  // The viewer opens again from the URL.
  await page.reload();
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(review).toHaveAttribute("aria-checked", "true");
  await expandAssistantMenu(page, "Templates");
  await page.getByRole("menuitem", { name: "Cinematic Camera", exact: true }).click();
  await expect(prompt).toHaveValue("The bird lifts off.");
  await dialog
    .getByRole("button", { name: isMobile ? "Close Review Prompt" : "Cancel", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(state.jobs).toHaveLength(2);
});

test("A queue item streams its prompt's thinking; the result keeps it collapsed under the prompt", async ({
  page,
}, testInfo) => {
  const thinking = "The bird is perched, so a gentle take-off reads best.";
  const writing = { kind: "animate", model: "local/text" };
  // Gallery pages leave out the thinking; Details reads the item for it.
  const { state, viewer } = await seed(page, { writing }, (page, state) =>
    page.route("**/api/gallery/items/hub", (route) =>
      route.fulfill({
        json: {
          item: {
            ...state.gallery.find((item) => item.id === "hub"),
            writing: { ...writing, thinking },
          },
        },
      }),
    ),
  );
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
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  if (testInfo.project.use.isMobile)
    details = page.getByRole("dialog", { name: "Amber Bird", exact: true });
  await expect(details.getByText("Written by local/text", { exact: true })).toBeVisible();
  const toggle = details.getByRole("button", { name: "Thinking", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(details.getByText(thinking, { exact: true })).toBeHidden();
  await toggle.click();
  await expect(details.getByText(thinking, { exact: true })).toBeVisible();
  // The queue item, as a fresh page loads it.
  await page.goto("/images");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
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
        offers: { cloud: true, local: true },
      },
    }),
  );
}

test("Animate can pick a compatible profile over the saved default route", async ({ page }) => {
  const { state, viewer } = await seed(page, {}, async (page, fixture) => {
    fixture.preferences.preferences.videos = "cloud";
    await serveProfiles(page, [...profiles, grok]);
    await page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) => {
      const chosen = new URL(route.request().url()).searchParams.get("profileId");
      const cloud = chosen
        ? chosen === grok.id
        : fixture.preferences.preferences.videos === "cloud";
      return route.fulfill({
        json: {
          profileId: cloud ? grok.id : "video:test",
          label: cloud ? grok.label : "Motion Fast",
          cloud,
          offers: { cloud: true, local: true },
        },
      });
    });
  });
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  const profileMenu = page.getByRole("menuitem", { name: "Profile", exact: true });
  await profileMenu.click();
  await expect(page.getByRole("menuitemradio", { name: "Automatic", exact: true })).toBeChecked();
  const localProfile = page.getByRole("menuitemradio", { name: "Motion Quality", exact: true });
  await localProfile.click();
  await expect(localProfile).toBeHidden();
  await expect(profileMenu).toContainText("Motion Quality");
  await expandAssistantMenu(page, "Templates");
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    input: { kind: "video", profileId: "video:test" },
  });
});

test("With local video stopped, an Animate theme queues on Grok", async ({ page }) => {
  const { state, viewer } = await seed(page, {}, offline);

  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expandAssistantMenu(page, "Templates");
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

test("A video's Animate template continues it from its last frame, and Edit makes its frame a reference or an image", async ({
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
    settings: {
      profileId: "video:test",
      referenceAssets: [{ assetId: "missing-start", slot: "reference" }],
    },
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await page.route("**/api/reference-assets/missing-start", (route) =>
    route.fulfill({ status: 404, json: { error: "That reference image is gone." } }),
  );
  await page.goto("/videos");
  await page.getByRole("button", { name: "Open video: Rolling Wave", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await viewer.getByRole("button", { name: "Recreate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Run Again", exact: true }).click();
  await expect(
    page.getByText(/The original reference for this video is unavailable/),
  ).toBeVisible();
  expect(state.jobs).toHaveLength(0);
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Extend in Composer", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.referenceRequests.at(-1)).toEqual({ galleryItemId: "clip", frame: "last" });
  expect(state.jobs[0]).toMatchObject({
    operation: "animate",
    input: {
      kind: "video",
      profileId: "video:test",
      writing: { kind: "animate", theme: "living", source: "A rolling wave" },
    },
  });
  // The frame showing is saved as an image, or becomes a reference in the composer.
  await viewer.getByRole("button", { name: "Edit", exact: true }).click();
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
  await expect(page).toHaveURL(/\/videos$/);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    grok.label,
  );
  expect(state.jobs).toHaveLength(1);
});

test("With neither local video nor Grok, Animate's options are disabled", async ({ page }) => {
  const reason = "Local video isn't running and cloud video isn't available to this account.";
  const { state, viewer } = await seed(page, {}, (page) =>
    page.route(/\/api\/animate\/profile(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 409, json: { ok: false, error: reason } }),
    ),
  );

  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expandAssistantMenu(page, "Templates");
  await expect(page.getByRole("menuitem", { name: "Living Photo", exact: true })).toBeDisabled();
  await backToActionMenu(page);
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
  await viewerAction(page, "Share", "Copy Prompt");
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe("An amber bird");
  await viewerAction(page, "Share", "Copy Details");
  await expect
    .poll(() => page.evaluate(() => (window as any).copied))
    .toBe(
      [
        "An amber bird",
        "Negative Prompt: blurry",
        `Created: ${formatDateTime(stamp)}`,
        "Profile: Image Quality",
        "CFG: 4",
        "Dimensions: 1024 × 1024",
        "Mode: Generate",
        "Sampler: euler",
        "Seed: 1234567",
        "Steps: 28",
        "VAE: ae",
      ].join("\n"),
    );
});

test("A touch that travels over a menu never chooses an item; a tap does", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Touch handling");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = (command: string) => {
      const selected = document.activeElement as HTMLTextAreaElement;
      if (command !== "copy" || selected?.tagName !== "TEXTAREA") return false;
      (window as any).copied = selected.value;
      return true;
    };
  });
  await seed(page);
  await viewerAction(page, "Share");
  const menu = page.getByRole("menu");
  const copy = menu.getByRole("menuitem", { name: "Copy Prompt", exact: true });
  // The events Safari sends for a swipe that could not scroll: a click still follows.
  await copy.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const pointer = (type: string, dy: number) =>
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: box.x + box.width / 2,
          clientY: box.y + box.height / 2 + dy,
        }),
      );
    pointer("pointerdown", 0);
    pointer("pointermove", -40);
    pointer("pointerup", -40);
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => (window as any).copied)).toBeUndefined();
  await copy.tap();
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe("An amber bird");
});

test("Near-misses beside the viewer's controls keep it open; the empty stage closes it", async ({
  page,
}) => {
  const { viewer } = await seed(page);
  const image = viewer.getByRole("button", { name: "Change Image Zoom", exact: true });
  await expect(image).toBeVisible();
  const actions = (await viewer
    .getByRole("group", { name: "Generation Actions", exact: true })
    .boundingBox())!;
  await page.mouse.click(actions.x + actions.width / 2, actions.y - 10);
  await expect(image).toBeVisible();
  const stage = (await viewer.locator("[data-zoom-mode]").boundingBox())!;
  const picture = (await image.boundingBox())!;
  // The square image leaves empty stage above or beside it.
  const blank =
    picture.x - stage.x > 80
      ? { x: stage.x + 20, y: stage.y + stage.height / 3 }
      : { x: stage.x + stage.width / 2, y: stage.y + 20 };
  await page.mouse.click(blank.x, blank.y);
  await expect(viewer).toBeHidden();
});

test("An opened video plays with sound and reveals its controls on pointer movement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as any).played = { muted: this.muted };
      return Promise.resolve();
    };
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
  await page.goto("/videos");
  await page.getByRole("button", { name: "Open video: Rolling Wave", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).played)).toEqual({ muted: false });
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
  await page.goto("/videos");
  await page.getByRole("button", { name: "Open video: Rolling Wave", exact: true }).click();
  const video = page.getByRole("dialog", { name: "Generation", exact: true }).locator("video");
  await expect(video).toHaveAttribute("poster", image);
  await expect(video).toHaveAttribute("controls");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(video).toHaveJSProperty("muted", false);
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
    prompt: "A rolling wave",
    width: 1280,
    height: 720,
    createdAt: stamp,
  });
  let posterAttempts = 0;
  await page.route("**/comfy/thumb?filename=clip.mp4&**", (route) =>
    ++posterAttempts === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({
          contentType: "image/svg+xml",
          body: decodeURIComponent(image.slice("data:image/svg+xml,".length)),
        }),
  );
  await page.goto("/videos");
  const tile = page.getByRole("button", { name: "Open video: Rolling Wave", exact: true });
  await expect(tile.locator("img")).toHaveJSProperty("naturalWidth", 1024);
  await tile.hover();
  await expect
    .poll(() => page.evaluate(() => (window as any).played))
    .toContain("/comfy/video-preview?filename=clip.mp4");
  // Opened, it plays the copy iOS Safari plays, and also downloads as a GIF.
  await page.getByRole("button", { name: "Open video: Rolling Wave", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Generation", exact: true }).locator("video"),
  ).toHaveAttribute(
    "src",
    "/comfy/video-preview?filename=clip.mp4&subfolder=&type=studio&format=play",
  );
  await viewerAction(page, "Share");
  await expect(page.getByRole("menuitem", { name: "Download Video", exact: true })).toHaveAttribute(
    "href",
    "/comfy/view?filename=clip.mp4&subfolder=&type=studio",
  );
  const gif = page.getByRole("menuitem", { name: "Download GIF", exact: true });
  await expect(gif).toHaveAttribute(
    "href",
    "/comfy/video-preview?filename=clip.mp4&subfolder=&type=studio&format=gif",
  );
  await expect(gif).toHaveAttribute("download", /\.gif$/);
  await expect(page.getByRole("menuitem", { name: /Back & Forth/ })).toHaveCount(0);
});

test("Details keep the caption, run notes and source ahead of LoRAs and prompts", async ({
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
  const notes = "A softer palette for the second version.";
  const runCaption = "Second palette study.";
  const { viewer } = await seed(
    page,
    {
      title: "my favourite bird",
      number: 866,
      parentItemId: "lineage-source",
      resultSet: {
        id: "set-bird",
        title: "Bird Studies",
        caption: runCaption,
        context: { notes },
        index: 0,
      },
      settings: {
        profileId: "image:test",
        profileName: "Retired Image · ComfyUI · Quality",
        loras: [{ name: "linen.safetensors", strength: 0.5 }],
      },
      negative,
      caption: {
        text: caption,
        tags: ["branch", "bird"],
        model: "vision-model",
        at: stamp,
        version: 2,
      },
    },
    async (_page, state) => {
      state.gallery.push({
        id: "lineage-source",
        type: "image",
        status: "done",
        number: 865,
        title: "Original Bird",
        prompt: "A brown bird",
        url: image,
        thumbnailUrl: image,
        createdAt: stamp,
      });
    },
  );
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  if (testInfo.project.use.isMobile)
    details = page.getByRole("dialog", { name: "my favourite bird", exact: true });
  await expect(details.getByText("my favourite bird", { exact: true })).toBeVisible();
  // The title carries its time beside it, as the viewer header does; Output carries no result
  // number.
  await expect(details.getByText(/^\d{2}:\d{2}, 23 Oct(?: 2026)?$/)).toBeVisible();
  await expect(details.getByRole("cell", { name: "#866", exact: true })).toHaveCount(0);
  // A long caption folds with Expand on its last line and folds again on Collapse; its tags stay
  // in sight.
  const tags = details.getByLabel("Caption Tags", { exact: true });
  await expect(tags.getByRole("link")).toHaveText(["bird", "branch"]);
  await expect(tags).toBeVisible();
  await expect(
    details.getByRole("heading", {
      name: /^(Caption|Lineage|Model|LoRAs|Prompt|Negative Prompt)$/,
    }),
  ).toHaveText(["Caption", "Lineage", "Model", "LoRAs", "Prompt", "Negative Prompt"]);
  await expect(details.getByText(notes, { exact: true })).toBeVisible();
  await expect(details.getByText(runCaption, { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: "Original Bird", exact: true })).toHaveAttribute(
    "href",
    "/images/865",
  );
  const expand = details.getByRole("button", { name: "Expand Caption", exact: true });
  await expand.click();
  await details.getByRole("button", { name: "Collapse Caption", exact: true }).click();
  await expect(expand).toBeVisible();
  // Every other section shows in full, however long.
  await expect(details.getByRole("button", { name: /^Expand / })).toHaveCount(1);
  // Run notes and prompts can be copied without changing the text.
  const copied = () => page.evaluate(() => (window as any).copied);
  await details.getByRole("button", { name: "Copy Notes", exact: true }).click();
  await expect.poll(copied).toBe(`${notes}\n\n${runCaption}`);
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

test("The gallery viewer opens without desktop Details", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones show details in a sheet.");
  const { viewer } = await seed(page);
  const details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await expect(details).toBeHidden();
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(details.getByText("1234567", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "Generation Details", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(details).toBeHidden();
});

test("Escape leaves the prompt, then closes Details, then the viewer", async ({
  page,
}, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones edit and show Details in sheets.");
  const { viewer } = await seed(page);
  const details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(details).toBeVisible();
  const field = viewer.getByRole("textbox", { name: "Prompt", exact: true });
  await field.fill("An amber bird at dusk");
  await page.keyboard.press("Escape");
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue("An amber bird at dusk");
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

test("Phone Details hides the viewer actions and swipes closed", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "Phones show Details in a sheet.");
  const { viewer } = await seed(page);
  const actions = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  await expect(actions).toBeVisible();
  const details = viewer.getByRole("button", { name: "Generation Details", exact: true });
  const picture = viewer.getByRole("img", { name: "An amber bird", exact: true });
  await expect(picture).toHaveJSProperty("complete", true);
  await details.click({ trial: true });
  const position = await picture.boundingBox();
  expect(position).not.toBeNull();
  await details.click();
  const sheet = page.getByRole("dialog", { name: "Amber Bird", exact: true });
  await expect(sheet.getByText("1234567", { exact: true })).toBeVisible();
  await expect(actions).toBeHidden();
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect.poll(() => picture.boundingBox()).toEqual(position);

  if (testInfo.project.use.browserName === "chromium") {
    const header = (await sheet.getByRole("heading", { name: "Amber Bird" }).boundingBox())!;
    const x = header.x + header.width / 2;
    const y = header.y + header.height / 2;
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const offset of [40, 80, 125])
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + offset }],
      });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
  }
  await expect(sheet).toBeHidden();
  await expect(actions).toBeVisible();
  await expect.poll(() => picture.boundingBox()).toEqual(position);
});

test("A phone swipe up opens Details directly", async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  const { viewer } = await seed(page, {}, async (_page, state) => {
    state.gallery.unshift({
      ...state.gallery[0],
      id: "hub-night",
      jobId: "job-night",
      prompt: "An amber bird at night",
      createdAt: "2026-12-01T00:00:00.000Z",
      parentItemId: "hub",
    });
  });
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
  // A drag past the last image moves against resistance, then settles back.
  const start = (await picture.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x - 40, y }],
  });
  await expect.poll(async () => (await picture.boundingBox())!.x - start.x).toBeLessThan(-1);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Math.round((await picture.boundingBox())!.x - start.x)).toBe(0);
  const actions = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  const thumbnails = viewer.getByRole("list", { name: "Versions", exact: true });
  const sheet = page.getByRole("dialog", { name: "Amber Bird", exact: true });
  await expect(actions).toBeVisible();
  await expect(thumbnails).toBeHidden();
  await swipe(-120);
  await expect(sheet.getByText("1234567", { exact: true })).toBeVisible();
  await expect(actions).toBeHidden();
  await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(thumbnails).toBeHidden();
  await swipe(120);
  await expect(viewer).toBeHidden();
});

test("A double click or tap zooms while desktop keeps the viewer controls visible", async ({
  page,
}, testInfo) => {
  const { viewer } = await seed(page, {}, async (_page, state) => {
    if (!testInfo.project.use.isMobile)
      state.gallery.push({
        id: "other-bird",
        type: "image",
        status: "done",
        url: image,
        thumbnailUrl: image,
        prompt: "A blue bird",
        width: 1024,
        height: 1024,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
  });
  const picture = viewer.getByRole("img", { name: "An amber bird", exact: true });
  const zoom = viewer.locator("[data-zoom-mode]");
  await expect(picture).toBeVisible();
  await expect
    .poll(async () => Number(await zoom.getAttribute("data-zoom-scale")))
    .toBeGreaterThan(0);
  const box = (await picture.boundingBox())!;
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.3;
  if (!testInfo.project.use.isMobile) {
    const actions = viewer.getByRole("group", { name: "Generation Actions", exact: true });
    const strip = viewer.getByRole("list", { name: "Gallery Results", exact: true });
    const prompt = actions.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(strip).toBeVisible();
    await prompt.click();
    await expect(prompt).toBeFocused();
    await page.mouse.click(x, y);
    await expect(prompt).not.toBeFocused();
    await expect(strip.getByRole("listitem", { name: "Show Amber Bird" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(actions).toBeVisible();
    await picture.click();
    await expect(actions).toBeVisible();
    await expect(strip).toBeVisible();
    await expect(zoom).toHaveAttribute("data-zoom-mode", "Fit");
    await picture.dblclick();
    await expect(zoom).toHaveAttribute("data-zoom-mode", "Custom");
    await expect(actions).toBeVisible();
    await picture.dblclick();
    await expect(zoom).toHaveAttribute("data-zoom-mode", "Fit");
    await picture.click();
    await expect(actions.getByRole("button", { name: "Generate", exact: true })).toBeVisible();
    await expect(strip).toBeVisible();
    await strip.getByRole("listitem", { name: "Show Blue Bird" }).click();
    await expect(viewer.getByRole("img", { name: "A blue bird", exact: true })).toBeVisible();
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
  const actions = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  await expect(actions).toBeVisible();
  await tap();
  await page.waitForTimeout(100);
  await tap();
  await expect(zoom).toHaveAttribute("data-zoom-mode", "Custom");
  await expect(actions).toBeVisible();
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

test("The viewer cycles its header, bottom actions and thumbnails", async ({ page }, testInfo) => {
  const state = await fixtures(page);
  const tall =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="1024"><rect width="512" height="1024" fill="#303036"/></svg>',
    );
  for (const [index, [id, prompt, createdAt]] of [
    ["tap-first", "A quiet harbour", stamp],
    ["tap-second", "A windy cliff", "2026-01-01T00:00:00.000Z"],
  ].entries())
    state.gallery.push({
      id,
      type: "image",
      status: "done",
      url: index === 1 ? tall : image,
      thumbnailUrl: index === 1 ? tall : image,
      prompt,
      width: index === 1 ? 512 : 1024,
      height: 1024,
      createdAt,
      resultSet: { id: "tap-set", title: "Tap Set", index },
    });
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Quiet Harbour", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const picture = viewer.getByRole("img", { name: "A quiet harbour", exact: true });
  await expect(picture).toBeVisible();
  const close = viewer.getByRole("button", { name: "Close Generation", exact: true });
  const header = viewer.getByRole("group", { name: "Viewer Header", exact: true });
  const actions = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  const strip = viewer.getByRole("list", { name: "Set: Tap Set", exact: true });
  if (testInfo.project.use.isMobile) await expect(strip).toBeHidden();
  else await expect(strip).toBeVisible();
  await expect(close).toBeVisible();
  await expect(actions).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await picture.boundingBox();
      const top = await header.boundingBox();
      return !!bounds && !!top && bounds.y >= top.y + top.height - 1;
    })
    .toBe(true);

  if (!testInfo.project.use.isMobile) return;

  const webkit = testInfo.project.use.browserName === "webkit";
  const touch = webkit ? undefined : await page.context().newCDPSession(page);
  async function centre() {
    const box = (await picture.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  async function tap() {
    const { x, y } = await centre();
    if (!touch) return page.touchscreen.tap(x, y);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await tap();
  await expect(strip).toBeVisible();
  await expect(close).toBeVisible();
  await expect(actions).toBeVisible();
  await tap();
  await expect(strip).toBeHidden();
  await expect(close).toBeHidden();
  await expect(actions).toBeHidden();

  // A swipe while hidden moves to the next image and keeps the chrome hidden.
  const { x, y } = await centre();
  if (touch) {
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - 150, y }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else
    // WebKit takes only taps from Playwright, so the swipe is the pointer events a finger makes.
    await viewer.locator("[data-zoom-mode]").evaluate(
      (node, { x, y }) => {
        const pointer = (type: string, clientX: number) =>
          node.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 7,
              pointerType: "touch",
              isPrimary: true,
              clientX,
              clientY: y,
            }),
          );
        pointer("pointerdown", x);
        pointer("pointermove", x - 150);
        pointer("pointerup", x - 150);
      },
      { x, y },
    );
  await expect(viewer.getByRole("img", { name: "A windy cliff", exact: true })).toBeVisible();
  await expect(strip).toBeHidden();
  await expect(close).toBeHidden();

  const next = viewer.getByRole("img", { name: "A windy cliff", exact: true });
  const nextBounds = (await next.boundingBox())!;
  await page.touchscreen.tap(
    nextBounds.x + nextBounds.width / 2,
    nextBounds.y + nextBounds.height / 2,
  );
  await expect(close).toBeVisible();
  await expect(strip).toBeHidden();
  await expect(actions).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await next.boundingBox();
      const top = await header.boundingBox();
      const bottom = await actions.boundingBox();
      return (
        !!bounds &&
        !!top &&
        !!bottom &&
        bounds.y >= top.y + top.height - 1 &&
        bounds.y + bounds.height <= bottom.y + 1
      );
    })
    .toBe(true);

  await page.keyboard.press("ArrowUp");
  const details = page.getByRole("dialog", { name: "Windy Cliff", exact: true });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Close Details", exact: true }).click();
  await expect(details).toBeHidden();
  await expect(strip).toBeHidden();
  const shown = (await next.boundingBox())!;
  await page.touchscreen.tap(shown.x + shown.width / 2, shown.y + shown.height / 2);
  await expect(strip).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await next.boundingBox();
      const dock = await strip.boundingBox();
      return !!bounds && !!dock && bounds.y + bounds.height <= dock.y + 1;
    })
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

test("Work still generating and videos take the same swipes as a picture", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  await page.addInitScript(() => {
    const played: string[] = [];
    Object.assign(window, { played });
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const source = this.getAttribute("src");
      if (source === "/test-media/clip-2.mp4" && !this.muted)
        return Promise.reject(new DOMException("Audio needs a tap", "NotAllowedError"));
      if (source) played.push(source);
      return Promise.resolve();
    };
  });
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
      thumbnailUrl: image,
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
      thumbnailUrl: image,
      prompt: "A breaking wave",
      width: 1280,
      height: 720,
      createdAt: stamp,
    },
  );
  await page.goto("/videos");
  await page.getByRole("button", { name: "Open video: Live Study", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const status = viewer.getByRole("status", { name: "Generation Status", exact: true });
  await expect(status).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  async function swipeLeft(target: Locator) {
    await expect(target).toBeVisible();
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
  await expect
    .poll(() => page.evaluate(() => (window as any).played))
    .toEqual(["/test-media/clip.mp4", "/test-media/clip-2.mp4"]);
  await expect(video).toHaveJSProperty("muted", true);
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
    // Phone actions remain accessible as icons on one row.
    const bar = dialog.getByRole("group", { name: "Generation Actions", exact: true });
    const row = [
      "Animate",
      "Edit",
      "Recreate",
      "Upscale",
      "Discover",
      "Share",
      "Like",
      "Dislike",
      "Delete",
    ].map((name) => bar.getByRole("button", { name, exact: true }));
    await expect
      .poll(async () => {
        const boxes = await Promise.all(row.map((control) => control.boundingBox()));
        const bounds = boxes.filter((box) => box !== null);
        if (bounds.length !== row.length) return 0;
        const bottom = Math.min(...bounds.map(({ y, height }) => y + height));
        const top = Math.max(...bounds.map(({ y }) => y));
        return bottom - top;
      })
      .toBeGreaterThan(0);
    for (const name of ["Animate", "Edit"]) {
      await expect(bar.getByRole("button", { name, exact: true })).toHaveText("");
      await viewerAction(page, name);
      const menu = page.getByRole("menu", { name, exact: true });
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }
  }
  await viewerAction(page, "Share");
  const download = page.getByRole("menuitem", { name: "Download", exact: true });
  await expect(download).toHaveAttribute("href", image);
  await expect(download).toHaveAttribute("download", "studio-viewer.png");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
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
  await dialog.getByRole("button", { name: "Zoom: Fit", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom: Fill", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Fill", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom: Actual Size", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Zoom: Fit", exact: true })).toBeVisible();
  // Details opens beside the image on desktop and in a sheet on phones.
  await dialog.getByRole("button", { name: "Generation Details", exact: true }).click();
  if (testInfo.project.use.isMobile) {
    const sheet = page.getByRole("dialog", { name: "Viewer Study", exact: true });
    await expect(sheet.getByText("Prompt", { exact: true })).toBeVisible();
    // The sheet counts as visible before it slides up; a press then would miss Close as it moves.
    await expect(sheet).toBeInViewport({ ratio: 1 });
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
  await page.getByRole("button", { name: "Open image: Legacy Study", exact: true }).click();
  await viewerAction(page, "Recreate");
  await page.getByRole("menuitem", { name: "Recreate in Composer", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).press("Enter");
  await expect(page.getByRole("dialog", { name: "LoRAs", exact: true })).toBeVisible();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await closeLoras(page);
  await pressGenerate(page);
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
      confirmation.getByText("1 item couldn't be deleted. Storage is temporarily unavailable."),
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
  if (!mobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    await expect(
      viewer.getByRole("complementary", { name: "Generation Details", exact: true }),
    ).toBeVisible();
  }
  // The actions outgrow one row, so the bar wraps rather than scrolling Delete out of sight.
  const clipped = () =>
    remove.evaluate((button) => {
      const actions = button.closest('[role="group"] > *')!.getBoundingClientRect();
      const { left, right } = button.getBoundingClientRect();
      return left < actions.left || right > actions.right;
    });
  await expect.poll(clipped).toBe(false);
});

test("Face Check marks a result that shows someone else than its character, and Details says so and that it was redone", async ({
  page,
}, testInfo) => {
  const identity = {
    characterId: "chr-mara",
    score: 0.31,
    faces: 1,
    drifted: true,
    checkedAt: stamp,
  };
  const { viewer } = await seed(page, { identity, faceRedo: true }, async (_page, state) =>
    state.characters.push({
      id: "chr-mara",
      name: "Mara",
      description: "red-haired ranger",
      referenceIds: [],
      references: [],
      missing: 0,
    }),
  );
  await expect(
    page.getByRole("img", { name: "Face Check: Face Differs", exact: true }),
  ).toBeAttached();
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  if (testInfo.project.use.isMobile)
    details = page.getByRole("dialog", { name: "Amber Bird", exact: true });
  await expect(
    details.getByText("Looks like someone else, not Mara (face similarity 0.31).", { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByText("Redone automatically after the face drifted.", { exact: true }),
  ).toBeVisible();
});

test("The desktop viewer bar keeps its actions on one row in a narrow window", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.use.isMobile === true, "phones fit a compact bar");
  await page.setViewportSize({ width: 840, height: 1000 });
  const { viewer } = await seed(page);
  const middle = async (name: string) => {
    const box = (await viewer.getByRole("button", { name, exact: true }).boundingBox())!;
    return Math.round(box.y + box.height / 2);
  };
  await expect.poll(() => middle("Delete")).toBe(await middle("Animate"));
});

test("Phone viewer shows Report beside Delete and Similar under Discover", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Phone action grouping");
  const { viewer } = await seed(page);
  const bar = viewer.getByRole("group", { name: "Generation Actions", exact: true });
  await expect(bar.getByRole("button", { name: "Report", exact: true })).toBeVisible();
  await viewerAction(page, "Report", "Other Issue…");
  const report = page.getByRole("dialog", { name: "Report Issue", exact: true });
  await expect(report).toBeVisible();
  await report.getByRole("button", { name: "Cancel", exact: true }).click();
  await viewerAction(page, "Discover", "Similar");
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/images$/);
});
