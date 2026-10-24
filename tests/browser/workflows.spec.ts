import { expect, test } from "@playwright/test";
import {
  create,
  fixtures,
  image,
  openNav,
  openTheme,
  profiles,
  section,
  stamp,
  viewerAction,
  withExpertSettings,
} from "./fixtures";

test("Image → Refine → Animate retains one session and can reopen saved work", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  await page.goto("/chat/session-1");
  await expect(page.getByRole("button", { name: "Open image: An amber bird" })).toBeVisible();
  await page
    .getByRole("article", { name: "Iteration 1", exact: true })
    .getByRole("button", { name: "Refine", exact: true })
    .click();
  const variationPrompt = page.getByRole("textbox", { name: "Variation Prompt", exact: true });
  await expect(variationPrompt).toBeVisible();
  await variationPrompt.fill("An amber bird with silver wings");
  await page.getByRole("button", { name: "Generate Variation", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  await page
    .getByRole("article", { name: "Iteration 2", exact: true })
    .getByRole("button", { name: "Animate", exact: true })
    .click();
  await variationPrompt.fill("The bird spreads its wings");
  await page.getByRole("button", { name: "Generate Variation", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs.map((j) => j.operation)).toEqual(["image", "refine", "animate"]);
  expect(state.jobs[1].parentJobId).toBe("job-1");
  expect(state.jobs[2].parentJobId).toBe("job-2");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open video: The bird spreads its wings" }),
  ).toBeVisible();
  await openNav(page, "Images");
  await expect(
    page.getByRole("button", { name: "Open image: An amber bird", exact: true }),
  ).toBeVisible();
});

test("References, masking, expert controls and runtime presets remain editable", async ({
  page,
}) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Upload Reference", exact: true }).click();
  await (
    await upload
  ).setFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Paint Mask", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Paint the Area to Refine" })).toBeVisible();
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.getByRole("button", { name: "Use Mask", exact: true }).click();
  await page.getByRole("button", { name: "Edit Mask", exact: true }).click();
  const canvas = page.locator("canvas");
  const painted = () =>
    canvas.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) total++;
      return total;
    });
  await expect.poll(painted).toBeGreaterThan(0);
  const beforeErase = await painted();
  await page.getByText("Erase", { exact: true }).click();
  await canvas.click({ position: { x: 40, y: 40 } });
  await expect.poll(painted).toBeLessThan(beforeErase);
  const erased = await painted();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(painted).toBe(beforeErase);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(painted).toBe(erased);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Use Mask", exact: true }).click();

  await withExpertSettings(page, async () => {
    await page.getByRole("textbox", { name: "Seed", exact: true }).fill("42");
    await page.getByRole("checkbox", { name: "Allow Fallback to Another Worker" }).check();
  });
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("Bird Study");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect.poll(() => state.presets.length).toBe(1);
  expect(state.presets[0].input.seed).toBe("42");
  expect(state.presets[0].input.inpaint.mask).toMatch(/^data:image\/png/);
  expect(state.presets[0].input.inpaint.feather).toBe(0.4);
  expect(state.presets[0].input.allowFallback).toBe(true);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An updated amber bird");
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("Updated Bird Study");
  await page.getByRole("button", { name: "Update Preset", exact: true }).click();
  await expect.poll(() => state.presets[0].title).toBe("Updated Bird Study");
  expect(state.presets[0].input.prompt).toBe("An updated amber bird");
  expect(state.presets).toHaveLength(1);
});

test("Chat keeps discussion, requested generation inputs and variation results together", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/chat");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Let’s discuss soft daylight");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect(
    page.getByText("Let's shape the lighting before we generate.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/session-1$/);
  await expect(page.getByRole("heading", { name: "Lighting Direction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lighting reference" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(state.jobs).toHaveLength(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Create a blue bird");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  const first = page.getByRole("article", { name: "Iteration 1", exact: true });
  await expect(first.getByText("A blue bird in soft daylight", { exact: true })).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Open image: A blue bird in soft daylight", exact: true }),
  ).toBeVisible();
  expect(state.chatRequests[1].generation.input.profileId).toBe("image:test");
  expect(state.chatRequests[1].generation.input.backendId).toBe("worker-a");
  await first.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
  // The card's output switch picks a profile like the gallery and explains why Generate waits.
  const output = first.getByRole("radiogroup", { name: "Generation Output", exact: true });
  await output.locator("label").filter({ hasText: "Video" }).click();
  await expect(first.getByRole("combobox", { name: "Profile", exact: true })).toHaveText(
    "Motion Quality",
  );
  await expect(
    first.getByRole("button", { name: "Generate Variation", exact: true }),
  ).toHaveAccessibleDescription("This workflow requires a reference image.");
  await output.locator("label").filter({ hasText: "Image" }).click();
  await first
    .getByRole("textbox", { name: "Variation Prompt", exact: true })
    .fill("A blue bird in watercolour");
  await first.getByRole("button", { name: "Generate Variation", exact: true }).click();
  const variation = page.getByRole("article", { name: "Iteration 2", exact: true });
  await expect(
    variation.getByRole("button", { name: "Open image: A blue bird in watercolour", exact: true }),
  ).toBeVisible();
  await expect(first.getByText("A blue bird in soft daylight", { exact: true })).toBeVisible();
  expect(state.jobs[1].parentJobId).toBe(state.jobs[0].id);
  expect(state.chatRequests[2].revision.input.prompt).toBe("A blue bird in watercolour");
  expect(state.chatRequests[2].modelId).toBe("text:test");
  await page.reload();
  await expect(
    page.getByText("I’ll create a blue bird with your selected settings.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "Iteration 2", exact: true })).toBeVisible();
});

test("The compact composer expands on interaction and keeps picked or dragged references", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["Picked Study", "Dragged Study"].map((prompt, index) => ({
      id: `reference-${index}`,
      jobId: `source-${index}`,
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      prompt,
      settings: { profileId: "image:test" },
    })),
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Preserve the working direction");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Picked Study", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Preserve the working direction",
  );
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  expect(state.referenceRequests[0].galleryItemId).toBe("reference-0");
  if (testInfo.project.use.isMobile) await page.keyboard.press("Escape");
  else await page.getByRole("link", { name: "Images", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
  if (!testInfo.project.use.isMobile) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .getByRole("button", { name: "Open image: Dragged Study", exact: true })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    await page
      .locator("[data-composer-dock]")
      .dispatchEvent("dragover", { dataTransfer: transfer });
    await page.locator("[data-composer-dock]").dispatchEvent("drop", { dataTransfer: transfer });
    await expect.poll(() => state.referenceRequests.length).toBe(2);
    expect(state.referenceRequests[1].galleryItemId).toBe("reference-1");
  }
});

test("Header appearance preferences persist across reloads", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  await openTheme(page);
  const popup = await page.locator('.mantine-Popover-dropdown[role="dialog"]').boundingBox();
  expect(popup!.y).toBeGreaterThanOrEqual(68);
  await page.getByRole("button", { name: "Use Blue Colour", exact: true }).click();
  await page.getByRole("button", { name: "Use Warm Background", exact: true }).click();
  await page.getByText("Fast", { exact: true }).click();
  await page.getByText("Round", { exact: true }).click();
  await page.getByText("Dark", { exact: true }).click();
  await page.getByText("Fixed Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await openTheme(page);
  await expect(page.getByRole("button", { name: "Use Blue Colour", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Use Warm Background", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(23, 19, 15)");
  await expect(page.getByRole("radio", { name: "Round", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Fixed Width", exact: true })).toBeChecked();
});

test("Prompt assistance finishes before a generation is submitted", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("bird");
  await page.getByRole("button", { name: "Prompt Assistance", exact: true }).click();
  await page.getByRole("menuitem", { name: "Improve Prompt", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A cinematic amber bird",
  );
  await page.getByRole("textbox", { name: "Prompt", exact: true }).press("Control+Enter");
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A cinematic amber bird");
});

test("Library shows import grades and reuses compatible inspiration settings", async ({ page }) => {
  const state = await fixtures(page);
  await page.route("**/api/presets", (route) =>
    route.fulfill({
      json: {
        presets: [
          {
            id: "plain",
            name: "Amber Study",
            prompt: "Amber bird study",
            negative: "blur",
            settings: { steps: 24 },
            resources: [{ profileId: "image:test" }],
          },
          {
            id: "missing",
            name: "Missing Style Study",
            prompt: "A missing style study",
            negative: "",
            settings: { model: "foreign-model" },
            resources: [{ folder: "loras", status: "missing", weight: 0.8 }],
          },
        ],
      },
    }),
  );
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).click();
  await page.getByRole("option", { name: "Detail Slider", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Use LoRAs", exact: true }).click();
  const close = page.getByRole("button", { name: "Close Generation Controls", exact: true });
  if (await close.isVisible()) await close.click();
  else await page.getByRole("textbox", { name: "Prompt", exact: true }).press("Escape");
  await openNav(page, "Library");
  await expect(page.getByText("Watercolour Inspiration", { exact: true })).toBeVisible();
  await expect(page.getByText("Watercolour LoRA is missing", { exact: true })).toBeVisible();
  await section(page, "Library", "Inspiration");
  const missing = page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByText("Missing Style Study", { exact: true }) });
  await expect(missing.getByRole("button", { name: "Use Settings", exact: true })).toBeDisabled();
  await expect(missing.getByRole("button", { name: "Use Prompt", exact: true })).toBeEnabled();
  await page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByText("Amber Study", { exact: true }) })
    .getByRole("button", { name: "Use Settings", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Amber bird study",
  );
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.profileId).toBe("image:test");
  expect(state.jobs[0].input.loras).toEqual([]);
});

test("Sign-in gate keeps account data behind authentication", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({ json: { mode: "multi-user", signedIn: false, oidc: { label: "Pocket ID" } } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In With Pocket ID" })).toHaveAttribute(
    "href",
    "/api/accounts/oidc/start",
  );
  await expect(page.getByRole("link", { name: "Images", exact: true })).toHaveCount(0);
});

test("Offline views report the API error and support retry", async ({ page }) => {
  await fixtures(page);
  let fails = true;
  await page.route("**/api/gallery?**", (route) =>
    fails
      ? route.fulfill({ status: 503, json: { error: "The gallery is temporarily unavailable" } })
      : route.fulfill({ json: { items: [], hasMore: false } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("The gallery is temporarily unavailable");
  fails = false;
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(page.getByText("No Images", { exact: true })).toBeVisible();
});

test("Images and Videos tabs keep an expanding bottom composer while Chat keeps sessions beside the media", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const primary = page.getByRole("button", { name: "Generate Image", exact: true });
  await expect(primary).toBeEnabled();
  const visual = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const label = element.querySelector("svg")!;
    return {
      color: style.color,
      background: style.backgroundColor,
      clipped: label.getBoundingClientRect().width === 0,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(visual.color),
    b = luminance(visual.background);
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(visual.clipped).toBe(false);
  expect(visual.overflow).toBe(false);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect(page).toHaveURL("/images");
  await expect.poll(() => state.jobs.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Open image: An amber bird", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name: "Image Fast", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.profileId).toBe("image:fast");
  expect(state.jobs[1].input.backendId).toBe("worker-a");
  if (testInfo.project.use.isMobile)
    await expect(page.getByRole("dialog", { name: "Generation Controls" })).toBeHidden();
  await page.screenshot({
    path: `/tmp/studio-rewrite-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await expect(page).toHaveURL(/\/video$/);
  await expect(page.getByRole("heading", { name: "Videos", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate Video", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Chat", exact: true }).first().click();
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
  await expect(page.getByRole("link", { name: /An amber bird/ }).first()).toBeVisible();
});

test("Generation controls preserve the draft and return keyboard focus with reduced motion", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Keep this direction");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("Keep this direction");
  await prompt.fill("Keep this direction, in soft daylight");
  await prompt.press("Escape");
  if (testInfo.project.use.isMobile)
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  const controls = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(controls).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this direction, in soft daylight",
  );
  await controls.press("Enter");
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this direction, in soft daylight",
  );
});

test("LoRAs use catalogue family and type metadata", async ({ page }) => {
  await fixtures(page);
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        profiles: [
          profiles[0],
          {
            ...profiles[0],
            id: "image:other",
            label: "Other Quality",
            family: "other",
            familyName: "Other Images",
            options: { loras: ["other-detail.safetensors"] },
          },
        ],
      },
    }),
  );
  await page.route("**/api/loras/info", (route) =>
    route.fulfill({
      json: {
        loras: {
          "soft-style.safetensors": { title: "Soft Style", families: ["test"], type: "style" },
          "detail.safetensors": { title: "Detail Slider", families: ["test"], type: "slider" },
          "other-detail.safetensors": {
            title: "Other Detail",
            families: ["other"],
            type: "slider",
          },
        },
      },
    }),
  );
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRA Type", exact: true }).click();
  await page.getByRole("option", { name: "Style", exact: true }).click();
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).click();
  await page.getByRole("option", { name: "Soft Style", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Soft Style", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use LoRAs", exact: true }).click();
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name: "Other Quality", exact: true }).click();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "LoRA Type", exact: true })).toHaveValue("");
  await page.getByRole("combobox", { name: "LoRAs", exact: true }).click();
  await page.getByRole("option", { name: "Other Detail", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enable Other Detail", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("switch", { name: "Enable Soft Style", exact: true })).toBeChecked();
});

test("Waiting jobs show their reason and cancellation is scoped to the recorded job", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.sessions.push({
    id: "session-1",
    title: "Waiting Study",
    createdAt: stamp,
    updatedAt: stamp,
    inputs: {},
  });
  state.jobs.push({
    id: "job-wait",
    jobId: "job-wait",
    sessionId: "session-1",
    operation: "image",
    status: "waiting",
    reason: "Waiting for Media Worker to become available.",
    input: { prompt: "Waiting bird", kind: "image", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await page.goto("/chat/session-1");
  await expect(page.getByText("Waiting for Media Worker to become available.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
});

test("Administrator accounts retain worker visibility and attribution", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: {
        mode: "multi-user",
        signedIn: true,
        account: { id: "account-a", role: "administrator" },
      },
    }),
  );
  await page.goto("/settings");
  await expect(
    page.getByRole("region", { name: "Your Account" }).getByText("Administrator", { exact: true }),
  ).toBeVisible();
  await section(page, "Settings", "Workers");
  await expect(page.getByRole("heading", { name: "Workers", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Images Endpoint", exact: true })).toHaveValue(
    "Image Worker",
  );
  await section(page, "Settings", "About");
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Licence", exact: true })).toHaveAttribute(
    "href",
    /\/LICENSE$/,
  );
});

test("Upscale comparison uses one bounded slider and preserves the original result", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "original",
    jobId: "job-original",
    url: image,
    thumbnailUrl: image,
    type: "image",
    status: "done",
    prompt: "Comparison Study",
    width: 1024,
    height: 1024,
    settings: { profileId: "image:test" },
    upscale: { url: image, status: "done" },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open image: Comparison Study", exact: true }).click();
  await viewerAction(page, "Compare");
  const slider = page.getByRole("slider", { name: "Comparison Position", exact: true });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "51");
  await expect(page.getByRole("img", { name: "Original Result", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Upscaled Result", exact: true })).toBeVisible();
});

test("Administrators save and verify per-user cloud and NSFW access through assigned groups", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "administrator" } },
    }),
  );
  await page.goto("/settings");
  await section(page, "Settings", "Groups");
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  await page.getByRole("textbox", { name: "Group Name", exact: true }).fill("Member Cloud");
  await page.getByRole("textbox", { name: "Group ID", exact: true }).fill("member-cloud");
  await page.getByRole("checkbox", { name: "Cloud Models", exact: true }).check();
  await page.getByRole("checkbox", { name: "NSFW Models", exact: true }).check();
  await page.getByRole("checkbox", { name: "Image Generation", exact: true }).check();
  await page.getByRole("button", { name: "Save Access Group", exact: true }).click();
  await expect
    .poll(
      () =>
        state.administration.accessProfiles.find((group) => group.id === "member-cloud")?.features
          .cloudModels,
    )
    .toBe(true);
  await section(page, "Settings", "Users");
  const member = page.getByRole("row", { name: "Account Member", exact: true });
  await member.getByRole("combobox", { name: "Access Group for Member", exact: true }).click();
  await page.getByRole("option", { name: "Member Cloud", exact: true }).click();
  await expect(member.getByText("Cloud Models On", { exact: true })).toBeVisible();
  await expect(member.getByText("NSFW Models On", { exact: true })).toBeVisible();
  await member.getByRole("button", { name: "Actions for Member", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disable Account", exact: true }).click();
  await expect(member.getByText("Disabled", { exact: true })).toBeVisible();
  expect(state.administration.accounts.find((account) => account.id === "member")?.disabled).toBe(
    true,
  );
});

test("Users update their own display name and retain password-protected email controls", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "user" } },
    }),
  );
  await page.goto("/settings");
  const own = page.getByRole("region", { name: "Your Account", exact: true });
  await own.getByRole("textbox", { name: "Display Name", exact: true }).fill("Studio Maker");
  await own.getByRole("button", { name: "Save Display Name", exact: true }).click();
  await expect.poll(() => state.ownAccount.displayName).toBe("Studio Maker");
  await expect(own.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue(
    "Studio Maker",
  );
  await own.getByRole("button", { name: "Email & Password", exact: true }).click();
  await expect(own.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
    "admin@example.test",
  );
  await expect(own.getByRole("textbox", { name: "Current Password", exact: true })).toBeVisible();
  await expect(
    own.getByRole("button", { name: "Save Email & Password", exact: true }),
  ).toBeDisabled();
});

test("Account menu opens the account workspace and reflects the saved name", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "user" } },
    }),
  );
  await page.goto("/");
  async function account() {
    if (testInfo.project.use.isMobile)
      await page.getByRole("button", { name: "More Options", exact: true }).click();
    else await page.getByRole("button", { name: "Your Account", exact: true }).click();
  }
  await account();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/settings#account$/);
  await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Studio Artist");
  await page.getByRole("button", { name: "Save Display Name", exact: true }).click();
  await expect.poll(() => state.ownAccount.displayName).toBe("Studio Artist");
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await account();
  await expect(page.getByText("Studio Artist", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign Out", exact: true })).toBeEnabled();
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
  const download = dialog.getByRole("link", { name: "Download", exact: true });
  await expect(download).toHaveAttribute("href", image);
  await expect(download).toHaveAttribute("download", "studio-viewer.png");
  await dialog.getByRole("button", { name: "Next Generation", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Next Viewer Study", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
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
  } else await expect(dialog.getByText("Prompt", { exact: true })).toBeVisible();
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

test("Chat layout respects workspace width and keeps a structural sessions sidebar", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  if (!testInfo.project.use.isMobile) await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Creative Modes" });
  expect(
    await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))),
  ).toEqual(["Chat", "Images", "Videos"]);
  await openTheme(page);
  await page.getByText("Fixed Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  const fixed = await page.locator(".studio-chat-workspace").boundingBox();
  if (!testInfo.project.use.isMobile) {
    expect(fixed?.width).toBe(1600);
    const side = await page.locator(".studio-session-sidebar").boundingBox();
    expect(side?.y).toBe(68);
    expect(side!.height + side!.y).toBe(1000);
  }
  await openTheme(page);
  await page.getByText("Full Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  const full = await page.locator(".studio-chat-workspace").boundingBox();
  if (!testInfo.project.use.isMobile) expect(full!.width).toBeGreaterThan(fixed!.width);
  const composer = await page.locator("[data-composer-dock]").boundingBox();
  expect(composer!.width).toBeLessThanOrEqual(780);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("Gallery search preserves the query and status panel cancels only active work", async ({
  page,
}) => {
  const state = await fixtures(page);
  for (const [id, status] of [
    ["waiting-job", "waiting"],
    ["queued-job", "queued"],
    ["finished-job", "completed"],
  ])
    state.jobs.push({
      id,
      jobId: id,
      sessionId: "s",
      operation: "image",
      status,
      input: { prompt: id },
      items: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(search).toBeFocused();
  await search.fill("birds");
  await search.press("Escape");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await expect(search).toHaveValue("birds");
  await search.press("Escape");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.getByRole("button", { name: "Starred", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Generating");
  await status.click();
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
  await expect(queue.getByText("waiting-job", { exact: true })).toBeVisible();
  await expect(queue.getByText("queued-job", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "Cancel All", exact: true }).click();
  await expect
    .poll(() => state.jobs.map((job) => job.status))
    .toEqual(["cancelled", "cancelled", "completed"]);
  await expect(queue.getByText("Empty Queue", { exact: true })).toBeVisible();
});

test("LoRA stack ordering is preserved in submitted inputs", async ({ page }, testInfo) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An ordered adapter study");
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "LoRAs", exact: true });
  await picker.click();
  await page.getByRole("option", { name: "Detail Slider", exact: true }).click();
  await page.getByRole("option", { name: "Soft Style", exact: true }).click();
  await picker.press("Escape");
  const earlier = page.getByRole("button", { name: "Move Soft Style Earlier", exact: true });
  await earlier.focus();
  await earlier.press("Enter");
  if (!testInfo.project.use.isMobile) {
    const drag = page.getByRole("button", { name: "Drag Detail Slider", exact: true });
    await drag.focus();
    await drag.press("Space");
    await drag.press("ArrowUp");
    await drag.press("Space");
  }
  await page.getByRole("button", { name: "Use LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.loras.map((lora: { name: string }) => lora.name)).toEqual(
    testInfo.project.use.isMobile
      ? ["soft-style.safetensors", "detail.safetensors"]
      : ["detail.safetensors", "soft-style.safetensors"],
  );
});

test("Reference slots preserve optional End-only inputs and reuse one asset in two roles", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile = {
    ...profiles[0],
    id: "image:slots",
    mediaInputs: [
      { id: "start", label: "Start", required: false, max: 1 },
      { id: "end", label: "End", required: false, max: 1 },
    ],
  };
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { profiles: [profile] } }),
  );
  state.gallery.push({
    id: "slot-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Slot Source",
    width: 1024,
    height: 1024,
  });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("End-only study");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("combobox", { name: "Reference Slot", exact: true }).click();
  await page.getByRole("option", { name: "End · Optional · Up to 1", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Slot Source", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([
    { assetId: "asset-slot-source", slot: "end" },
  ]);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("combobox", { name: "Reference Slot", exact: true }).click();
  await page.getByRole("option", { name: "Start · Optional · Up to 1", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Slot Source", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.referenceAssets).toEqual([
    { assetId: "asset-slot-source", slot: "end" },
    { assetId: "asset-slot-source", slot: "start" },
  ]);
});

test("Gallery selection stars, downloads and deletes only selected finished records", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["First Study", "Second Study", "Pending Study"].map((prompt, index) => ({
      id: `selection-${index}`,
      jobId: `selection-job-${index}`,
      type: "image",
      status: index === 2 ? "running" : "done",
      url: image,
      thumbnailUrl: image,
      prompt,
      width: 1024,
      height: 1024,
      settings: { profileId: "image:test" },
    })),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "Select All Loaded", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("3 Selected");
  await expect(page.getByRole("link", { name: "Download Selected", exact: true })).toHaveAttribute(
    "href",
    /ids=selection-0%2Cselection-1/,
  );
  await page.getByRole("button", { name: "Star Selected", exact: true }).click();
  await expect.poll(() => state.gallery.filter((item) => item.favorite).length).toBe(2);
  await page.getByRole("button", { name: "Delete Selected", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Selected Items", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => state.gallery.map((item) => item.id)).toEqual(["selection-2"]);
  await page.getByRole("button", { name: "Done Selecting", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
});

test("Gallery facets submit repeated models together with LoRA, size and aspect filters", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Gallery", exact: true }).fill("bird");
  await page.getByRole("textbox", { name: "Search Gallery", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Filter By Models", exact: true }).click();
  await page.getByRole("checkbox", { name: "Studio Image", exact: true }).check();
  await page.getByRole("checkbox", { name: "Motion Quality", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By LoRAs", exact: true }).click();
  await page.getByRole("checkbox", { name: "Detail Slider", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By Size", exact: true }).click();
  await page.getByRole("checkbox", { name: "Up to 1K", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By Aspect Ratio", exact: true }).click();
  await page.getByRole("checkbox", { name: "1:1", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return {
        model: query.getAll("model"),
        lora: query.getAll("lora"),
        size: query.getAll("size"),
        aspect: query.getAll("aspect"),
        q: query.get("q"),
      };
    })
    .toEqual({
      model: ["image.safetensors", "video.safetensors"],
      lora: ["detail.safetensors"],
      size: ["up-to-1k"],
      aspect: ["1:1"],
      q: "bird",
    });
  await page.getByRole("button", { name: "Clear Filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear Filters", exact: true })).toBeHidden();
  // The cleared search is served fresh from cache or requested again, never with the old facets.
  await expect
    .poll(() =>
      state.galleryRequests.some((search) => {
        const query = new URLSearchParams(search);
        return query.get("q") === "bird" && !query.has("model") && !query.has("lora");
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close Filters", exact: true }).click();
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "bird",
  );
});

test("Legacy Recreate retains reference slots, disabled LoRAs and exact profile settings", async ({
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
  await viewerAction(page, "Recreate");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).press("Enter");
  await expect(page.getByRole("region", { name: "LoRA Controls", exact: true })).toBeVisible();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await page.getByRole("button", { name: "Use LoRAs", exact: true }).click();
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

test("Generation size presets and custom dimensions preserve profile constraints", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile = {
    ...profiles[0],
    aspectPresets: [
      { label: "Square", w: 1024, h: 1024 },
      { label: "Landscape", w: 1536, h: 1024 },
    ],
    constraints: {
      width: { min: 512, max: 2048, step: 64 },
      height: { min: 512, max: 2048, step: 64 },
    },
  };
  await page.route(/\/api\/models(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { profiles: [profile] } }),
  );
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A wide landscape");
  await page.getByRole("button", { name: "Aspect", exact: true }).click();
  await page.getByRole("button", { name: "Landscape 1536 × 1024", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Width", exact: true })).toHaveValue("1536");
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("1600");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.width).toBe(1600);
  expect(state.jobs[0].input.height).toBe(1024);
});

test("Retry pending state is shared while unrelated jobs remain cancellable", async ({ page }) => {
  const state = await fixtures(page);
  const input = {
    ...profiles[0].defaults,
    kind: "image",
    profileId: "image:test",
    prompt: "Retry Study",
    referenceAssets: [],
  };
  state.sessions.push({
    id: "retry-session",
    title: "Retry Session",
    inputs: input,
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push(
    ...["failed", "running"].map((status, index) => ({
      id: `retry-${index}`,
      sessionId: "retry-session",
      operation: "image",
      input,
      status,
      items: [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    })),
  );
  let calls = 0;
  let release!: () => void;
  const accepted = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/queue/retry-0/retry", async (route) => {
    calls++;
    await accepted;
    await route.fulfill({ json: { job: state.jobs[0] } });
  });
  try {
    await page.goto("/chat/retry-session");
    const retry = page
      .getByRole("article", { name: "Iteration 1", exact: true })
      .getByRole("button", { name: "Retry", exact: true });
    await retry.click();
    await expect.poll(() => calls).toBe(1);
    await expect(retry).toBeDisabled();
    // Gallery modes own the queue slideout; the pending retry stays shared across surfaces.
    await page.getByRole("link", { name: "Images", exact: true }).first().click();
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "Generations", exact: true });
    await expect(queue.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
    await queue.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => state.jobs[1].status).toBe("cancelled");
    expect(calls).toBe(1);
    await page.keyboard.press("Escape");
    await expect(queue).toBeHidden();
    await page.goBack();
    release();
    await expect(retry).toBeEnabled();
  } finally {
    release();
  }
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
  await page.route("**/api/gallery/delete-study", async (route) => {
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
      confirmation.getByText("1 item could not be deleted. You can try again."),
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

test("Status summarises service health and opens Workers over the current page", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/chat");
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Services Partly Available");
  await status.click();
  const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
  await expect(drawer.getByLabel("Videos: Offline", { exact: true })).toBeVisible();
  await drawer.getByRole("link", { name: "Workers", exact: true }).click();
  await expect(drawer).toBeHidden();
  const settings = page.getByRole("dialog", { name: /^Settings/ });
  const images = settings.getByRole("combobox", { name: "Images Endpoint", exact: true });
  await expect(images).toHaveValue("Image Worker");
  await images.click();
  await page.getByRole("option", { name: /Image Worker/ }).click();
  await expect(settings.getByText("Fixture GPU", { exact: false })).toBeVisible();
  await expect(settings.getByText("Automatic Control Off", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
});

test("Owned uploaded references can be reused without another upload", async ({ page }) => {
  const state = await fixtures(page);
  const requests: string[] = [];
  await page.route("**/api/reference-assets?*", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      json: {
        items: [
          {
            id: "past-upload",
            name: "Past Upload",
            source: "upload",
            type: "image",
            url: image,
            thumbnailUrl: image,
            width: 1024,
            height: 1024,
          },
        ],
        hasMore: false,
        nextCursor: "",
      },
    });
  });
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Reuse an earlier photograph");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByText("Uploads", { exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Reference 1", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([{ assetId: "past-upload", slot: "image" }]);
  expect(state.referenceRequests).toHaveLength(0);
  expect(new URL(requests[0]).searchParams.get("source")).toBe("upload");
});

test("Images and Videos retain independent prompts and expert settings", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Image draft");
  const negative = page.getByRole("textbox", { name: "Negative Prompt", exact: true });
  const seed = page.getByRole("textbox", { name: "Seed", exact: true });
  await withExpertSettings(page, async () => {
    await negative.fill("Image exclusions");
    await seed.fill("777");
  });
  if (testInfo.project.use.isMobile) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  }
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Video draft");
  await page.getByRole("link", { name: "Images", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Image draft",
  );
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await withExpertSettings(page, async () => {
    await expect(negative).toHaveValue("Image exclusions");
    await expect(seed).toHaveValue("777");
  });
  if (testInfo.project.use.isMobile) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  }
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Video draft",
  );
});

test("Prompt history reuses positive and negative prompts independently and persists pinning", async ({
  page,
}) => {
  await fixtures(page);
  const histories = {
    positive: [{ text: "Earlier landscape", at: stamp, uses: 2, pinned: false }],
    negative: [{ text: "Earlier exclusions", at: stamp, uses: 1, pinned: false }],
  };
  await page.route("**/api/prompts**", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const body = request.method() === "POST" ? request.postDataJSON() : {};
    const kind = (body.kind ||
      url.searchParams.get("kind") ||
      "positive") as keyof typeof histories;
    if (url.pathname.endsWith("/pin")) {
      const entry = histories[kind].find((entry) => entry.text === body.text);
      if (entry) entry.pinned = body.pinned;
    }
    if (url.pathname.endsWith("/forget"))
      histories[kind] = histories[kind].filter((entry) => entry.text !== body.text);
    return route.fulfill({ json: { prompts: histories[kind], enabled: true } });
  });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const negative = page.getByRole("textbox", { name: "Negative Prompt", exact: true });
  await withExpertSettings(page, () => negative.fill("Keep these exclusions"));
  await page.getByRole("button", { name: "Recent Prompts", exact: true }).click();
  let panel = page.getByRole("dialog", { name: "Recent Prompts", exact: true });
  await panel.getByRole("button", { name: "Pin Prompt", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Unpin Prompt", exact: true })).toBeVisible();
  const historySearch = panel.getByRole("textbox", { name: "Search Prompt History", exact: true });
  await historySearch.fill("landscape");
  await historySearch.press("ArrowDown");
  await historySearch.press("Enter");
  await expect(prompt).toHaveValue("Earlier landscape");
  await withExpertSettings(page, async () => {
    await expect(negative).toHaveValue("Keep these exclusions");
    await page.getByRole("button", { name: "Recent Negative Prompts", exact: true }).click();
    panel = page.getByRole("dialog", { name: "Recent Negative Prompts", exact: true });
    await panel
      .getByRole("option", { name: "Use Prompt: Earlier exclusions", exact: true })
      .click();
    // Picking a negative prompt keeps the Expert settings open around it.
    await expect(negative).toHaveValue("Earlier exclusions");
  });
  await expect(prompt).toHaveValue("Earlier landscape");
  expect(histories.positive[0].pinned).toBe(true);
});
