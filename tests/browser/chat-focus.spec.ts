import { expect, test, type Page } from "@playwright/test";
import { create, fixtures, image, openNav, profiles, section, stamp } from "./fixtures";

test("Video inspiration opened from Chat fills its own gallery draft", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/presets", (route) =>
    route.fulfill({
      json: {
        presets: [
          {
            id: "video-inspiration",
            name: "Moving Landscape",
            type: "video",
            prompt: "A drifting aerial landscape",
            negative: "",
            settings: {},
          },
        ],
      },
    }),
  );
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep this image composition");
  await page.keyboard.press("Escape");
  await openNav(page, "Chat");
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Keep this discussion draft");
  await openNav(page, "Library");
  await section(page, "Library", "Inspiration");
  await page.getByRole("button", { name: "Use Prompt", exact: true }).click();
  await expect(page).toHaveURL(/\/video\?compose=1$/);
  await expect(prompt).toHaveValue("A drifting aerial landscape");
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toHaveValue(
    "Motion Quality",
  );
  await page.keyboard.press("Escape");
  await openNav(page, "Images");
  await expect(prompt).toHaveValue("Keep this image composition");
  await openNav(page, "Chat");
  await expect(message).toHaveValue("Keep this discussion draft");
});

test("Switching creative modes preserves unsent gallery inputs and the Chat message", async ({
  page,
}) => {
  await fixtures(page);
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("An unsent panoramic landscape");
  const size = page.getByRole("button", { name: "Image Size", exact: true });
  await size.click();
  await page.getByText("Custom", { exact: true }).click();
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("1280");
  await page.getByRole("textbox", { name: "Height", exact: true }).fill("768");
  await size.click();
  await page.keyboard.press("Escape");
  await openNav(page, "Chat");
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Let’s discuss a different composition");
  await openNav(page, "Images");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("An unsent panoramic landscape");
  await prompt.click();
  await expect(size).toHaveText("1280 × 768");
  await page.keyboard.press("Escape");
  await openNav(page, "Videos");
  const videoPrompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await videoPrompt.fill("An unsent moving landscape");
  await page.keyboard.press("Escape");
  await openNav(page, "Chat");
  await expect(message).toHaveValue("Let’s discuss a different composition");
  await openNav(page, "Videos");
  await expect(videoPrompt).toHaveValue("An unsent moving landscape");
  await openNav(page, "Images");
  await expect(prompt).toHaveValue("An unsent panoramic landscape");
});

async function savedChat(page: Page, count: number) {
  const state = await fixtures(page);
  const sessionId = "session-focus";
  for (let index = 0; index < count; index++) {
    const createdAt = new Date(Date.parse(stamp) + index * 1000).toISOString();
    const input = {
      ...profiles[0].defaults,
      kind: "image",
      profileId: profiles[0].id,
      prompt: `Archived image ${index + 1}`,
      negative: "",
      seed: "",
      count: 1,
      denoise: 0.65,
      loras: [],
      referenceAssets: [],
    };
    const item = {
      id: `saved-${index}:0`,
      jobId: `saved-${index}`,
      type: "image",
      status: "done",
      prompt: input.prompt,
      url: image,
      thumbnailUrl: image,
      width: 1024,
      height: 1024,
      createdAt,
    };
    state.jobs.push({
      id: item.jobId,
      sessionId,
      input,
      operation: "image",
      status: "completed",
      items: [item],
      outputs: [item],
      createdAt,
      updatedAt: createdAt,
    });
  }
  state.sessions.push({
    id: sessionId,
    title: "Saved Focus Session",
    inputs: state.jobs[0].input,
    createdAt: stamp,
    updatedAt: stamp,
  });
  await page.goto(`/chat/${sessionId}`);
  return state;
}

test("A message typed while the previous request is being accepted remains in the composer", async ({
  page,
}) => {
  const state = await savedChat(page, 1);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let accepted = false;
  await page.route("**/api/sessions/session-focus/chat", async (route) => {
    if (route.request().method() === "POST") {
      accepted = true;
      await pending;
    }
    await route.fallback();
  });
  try {
    await expect(page.getByRole("article", { name: "Iteration 1", exact: true })).toBeVisible();
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Discuss the lighting first");
    await page.getByRole("button", { name: "Send Message", exact: true }).click();
    await expect.poll(() => accepted).toBe(true);
    await message.fill("A second thought about the background");
    release();
    await expect(page.getByRole("button", { name: "Stop Response", exact: true })).toBeHidden();
    await expect(message).toHaveValue("A second thought about the background");
    expect(state.chatRequests).toHaveLength(1);
    expect(state.chatRequests[0].content).toBe("Discuss the lighting first");
  } finally {
    release();
  }
});

test("Editing a scrolled older iteration reveals its prompt and keeps focus through later replies", async ({
  page,
}) => {
  const state = await savedChat(page, 9);
  const latest = page.getByRole("article", { name: "Iteration 9", exact: true });
  await expect(latest).toBeInViewport();
  const first = page.getByRole("article", { name: "Iteration 1", exact: true });
  const edit = first.getByRole("button", { name: "Edit & Rerun", exact: true });
  await edit.scrollIntoViewIfNeeded();
  await edit.click();
  const prompt = first.getByRole("textbox", { name: "Variation Prompt", exact: true });
  await expect(prompt).toBeFocused();
  await expect(prompt).toBeInViewport({ ratio: 1 });
  await prompt.fill("A revised older composition\nWith softer light\nAnd a warmer background");
  state.messages.push({
    id: "later-reply",
    sessionId: "session-focus",
    role: "assistant",
    content: "A later reply arrived while the earlier composition was being edited.",
    status: "completed",
    createdAt: new Date(Date.parse(stamp) + 10000).toISOString(),
  });
  // The real history poll appends content and resizes the feed while the older editor is active.
  await expect(page.getByText(state.messages[0].content, { exact: true })).toBeAttached();
  await expect(prompt).toBeFocused();
  await expect(prompt).toBeInViewport({ ratio: 1 });
  await expect(prompt).toHaveValue(
    "A revised older composition\nWith softer light\nAnd a warmer background",
  );
});

for (const modifier of ["Control", "Meta"]) {
  test(`${modifier}+Enter submits a variation once while an earlier submission is pending`, async ({
    page,
  }) => {
    const state = await savedChat(page, 1);
    const first = page.getByRole("article", { name: "Iteration 1", exact: true });
    await first.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
    const prompt = first.getByRole("textbox", { name: "Variation Prompt", exact: true });
    await expect(prompt).toBeFocused();
    await prompt.fill(`One ${modifier} variation`);
    await expect(
      first.getByRole("button", { name: "Generate Variation", exact: true }),
    ).toBeEnabled();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: unknown[] = [];
    await page.route("**/api/sessions/session-focus/chat", async (route) => {
      if (route.request().method() === "POST") {
        requests.push(route.request().postDataJSON());
        await pending;
      }
      await route.fallback();
    });
    try {
      await prompt.press(`${modifier}+Enter`);
      await expect.poll(() => requests.length).toBe(1);
      await expect(
        first.getByRole("button", { name: "Generate Variation", exact: true }),
      ).toBeDisabled();
      await prompt.press(`${modifier}+Enter`);
      expect(requests).toHaveLength(1);
    } finally {
      release();
    }
    await expect.poll(() => state.chatRequests.length).toBe(1);
    await expect(page.getByRole("article", { name: "Iteration 2", exact: true })).toBeVisible();
    expect(state.jobs).toHaveLength(2);
    expect(state.chatRequests[0].revision).toMatchObject({
      sourceJobId: "saved-0",
      input: { prompt: `One ${modifier} variation` },
    });
  });
}

test("Desktop nested pickers retain gallery controls until keyboard focus leaves them", async ({
  page,
}, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phone controls use a focus-trapped Drawer.");
  await fixtures(page);
  await create(page);
  const controls = page.getByRole("region", { name: "Generation Controls", exact: true });
  const profile = page.getByRole("combobox", { name: "Profile", exact: true });
  await profile.click();
  await page.getByRole("option", { name: "Image Fast", exact: true }).click();
  await expect(profile).toHaveValue("Image Fast");
  await expect(controls).toBeVisible();
  const size = page.getByRole("button", { name: "Image Size", exact: true });
  await size.click();
  await page.getByText("Custom", { exact: true }).click();
  const width = page.getByRole("textbox", { name: "Width", exact: true });
  await width.fill("1280");
  await expect(width).toBeFocused();
  await expect(controls).toBeVisible();
  await width.press("Escape");
  await expect(size).toBeFocused();
  await expect(controls).toBeVisible();
  await profile.focus();
  await profile.press("Shift+Tab");
  await expect(controls).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
  expect(
    await page.locator(":focus").evaluate((element) => !element.closest(".studio-composer-dock")),
  ).toBe(true);
});
