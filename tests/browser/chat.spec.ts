import { expect, test, type Page } from "@playwright/test";
import { fixtures, image, loadSaved, openTheme, profiles, signIn, stamp } from "./fixtures";

const at = (seconds: number) => new Date(Date.parse(stamp) + seconds * 1000).toISOString();

/** A chat with one image, then an edited iteration with three outputs. */
async function savedChat(page: Page) {
  const state = await fixtures(page);
  const input = (prompt: string, count = 1) => ({
    ...profiles[0].defaults,
    kind: "image",
    profileId: "image:test",
    prompt,
    count,
    seed: 7,
    loras: [],
    referenceAssets: [],
  });
  const result = (jobId: string, index: number, prompt: string) => {
    const item = {
      id: `${jobId}:${index}`,
      jobId,
      sessionId: "chat-a",
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      prompt,
      width: 1024,
      height: 1024,
      createdAt: at(5),
    };
    state.gallery.push(item);
    return item;
  };
  state.sessions.push({
    id: "chat-a",
    title: "Blue Bird Studies",
    titleSource: "generated",
    inputs: {},
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.messages.push(
    {
      id: "job-a",
      sessionId: "chat-a",
      role: "assistant",
      content: "I'll create a blue bird.",
      status: "completed",
      jobId: "job-a",
      createdAt: at(1),
    },
    {
      id: "edit",
      sessionId: "chat-a",
      role: "user",
      content: "Edit iteration 1",
      status: "completed",
      revision: { sourceJobId: "job-a", operation: "image", input: input("A watercolour bird", 3) },
      createdAt: at(10),
    },
    {
      id: "job-b",
      sessionId: "chat-a",
      role: "assistant",
      content: "Three watercolour variations.",
      status: "completed",
      jobId: "job-b",
      createdAt: at(11),
    },
  );
  state.jobs.push(
    {
      id: "job-a",
      sessionId: "chat-a",
      operation: "image",
      status: "completed",
      input: input("A blue bird"),
      items: [result("job-a", 0, "A blue bird")],
      outputs: [],
      createdAt: at(2),
      updatedAt: at(2),
    },
    {
      id: "job-b",
      sessionId: "chat-a",
      parentJobId: "job-a",
      operation: "image",
      status: "completed",
      input: input("A watercolour bird", 3),
      items: [0, 1, 2].map((index) => result("job-b", index, "A watercolour bird")),
      outputs: [],
      createdAt: at(12),
      updatedAt: at(12),
    },
  );
  return state;
}

/** The Chats list: the desktop sidebar, or the status Drawer on phones. */
async function chats(page: Page, isMobile: boolean) {
  if (!isMobile) return page.getByRole("complementary", { name: "Chats", exact: true });
  await page.getByRole("button", { name: "Open Chats", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
  // A press during the slide-in can release over another row, which focuses without clicking.
  await expect(drawer).toBeInViewport({ ratio: 1 });
  return drawer;
}

test("Chat cards show their request, settings and every output beneath the reply", async ({
  page,
}) => {
  await savedChat(page);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) warnings.push(message.text());
  });
  await page.goto("/chat/chat-a");
  const edited = page.getByRole("article", { name: "Iteration 2", exact: true });
  await expect(edited.getByRole("button", { name: /^Open image: / })).toHaveCount(3);
  await expect(
    edited.getByText("Iteration 2 · New image · from iteration 1", { exact: true }),
  ).toBeVisible();
  await expect(edited.getByRole("listitem").filter({ hasText: "3 Outputs" })).toBeVisible();
  // The edit request is one quiet line, not a second copy of the prompt.
  await expect(page.getByText("Edited iteration 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Edit iteration 1", { exact: true })).toBeHidden();
  await edited.getByRole("button", { name: "Edit Iteration 2", exact: true }).click();
  const prompt = edited.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("A watercolour bird");
  await edited.getByRole("button", { name: "Close Editor", exact: true }).click();
  await expect(prompt).toBeHidden();
  await expect(edited.getByText("A watercolour bird", { exact: true })).toBeVisible();
  // React's list-key warning; WebKit also warns about the viewport's unsupported argument "key".
  expect(warnings.filter((text) => /unique "key" prop/.test(text))).toEqual([]);
});

test("Chats can be renamed and deleted with an opt-in results checklist", async ({
  page,
  isMobile,
}) => {
  const state = await savedChat(page);
  await page.goto("/chat/chat-a");
  // The Chat settles its focus once loaded; open row menus after that.
  await expect(page.getByText("Three watercolour variations.")).toBeVisible();
  let list = await chats(page, isMobile);
  await list
    .getByRole("button", { name: "Chat Options for Blue Bird Studies", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const title = list.getByRole("textbox", { name: "Chat Title", exact: true });
  await title.fill("Watercolour Birds");
  await title.press("Enter");
  await expect(list.getByRole("link", { name: /Watercolour Birds/ })).toBeVisible();
  expect(state.sessions[0]).toMatchObject({ title: "Watercolour Birds", titleSource: "user" });
  if (isMobile) {
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
  }
  await expect(page.getByRole("heading", { name: "Watercolour Birds", exact: true })).toBeVisible();

  // A chat with work in progress refuses deletion and says why.
  state.jobs[1].status = "running";
  // The open chat's title carries the same menu (after the desktop sidebar's).
  await page
    .getByRole("button", { name: "Chat Options for Watercolour Birds", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Chat", exact: true });
  const results = dialog.getByRole("group", { name: "Results to Delete", exact: true });
  await expect(results.getByRole("checkbox")).toHaveCount(4);
  for (const box of await results.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await dialog.getByRole("button", { name: "Delete Chat", exact: true }).click();
  await expect(dialog.getByText(/generations in progress/)).toBeVisible();
  expect(state.sessions).toHaveLength(1);

  state.jobs[1].status = "completed";
  await dialog.getByRole("checkbox", { name: "Select All", exact: true }).check();
  await results.getByRole("checkbox").first().uncheck();
  await dialog.getByRole("button", { name: "Delete Chat & 3 Results", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/chat$/);
  expect(state.sessions).toHaveLength(0);
  expect(state.gallery.map((item) => item.id)).toEqual(["job-a:0"]);
  list = await chats(page, isMobile);
  await expect(list.getByText("No Chats", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Thinking", exact: true }).click();
  await expect(page.getByText("Light first, then subject.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lighting Direction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lighting reference" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(state.jobs).toHaveLength(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Create a blue bird");
  await page.getByRole("button", { name: "Send Message", exact: true }).click();
  await expect(page.getByText("New image", { exact: true })).toBeVisible();
  const first = page.getByRole("article", { name: "Iteration 1", exact: true });
  await expect(first.getByText("A blue bird in soft daylight", { exact: true })).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Open image: A blue bird in soft daylight", exact: true }),
  ).toBeVisible();
  expect(state.chatRequests[1].generation.input.profileId).toBe("image:test");
  expect(state.chatRequests[1].generation.input.backendId).toBe("worker-a");
  await first.getByRole("button", { name: "Edit Iteration 1", exact: true }).click();
  // The card shares the gallery's chip rail: a preset loads into this card only.
  state.presets.push({
    id: "dusk",
    title: "Dusk",
    input: { kind: "image", profileId: "image:test", prompt: "A blue bird at dusk" },
  });
  await first.getByRole("button", { name: "Presets", exact: true }).click();
  await loadSaved(page, "Preset", "Dusk");
  await expect(first.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A blue bird at dusk",
  );
  // The card's output switch picks a profile like the gallery and explains why Generate waits.
  const output = first.getByRole("radiogroup", { name: "Generation Output", exact: true });
  await output.locator("label").filter({ hasText: "Video" }).click();
  await expect(first.getByRole("combobox", { name: "Profile", exact: true })).toHaveText(
    "Motion Quality",
  );
  await expect(
    first.getByRole("button", { name: "Generate Video", exact: true }),
  ).toHaveAccessibleDescription("This workflow requires a reference image.");
  await output.locator("label").filter({ hasText: "Image" }).click();
  await first
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("A blue bird in watercolour");
  await first.getByRole("button", { name: "Generate Image", exact: true }).click();
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
  await page.getByRole("button", { name: "Cancel Waiting bird", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
});

test("Running work opens with its status and written prompt, then follows it to the result", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.sessions.push({
    id: "session-1",
    title: "Running Study",
    createdAt: stamp,
    updatedAt: stamp,
    inputs: {},
  });
  const job = {
    id: "job-run",
    jobId: "job-run",
    sessionId: "session-1",
    operation: "image",
    status: "running",
    reason: "",
    input: { prompt: "A heron wading at dawn", kind: "image", profileId: "image:test" },
    items: [] as Record<string, unknown>[],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  state.jobs.push(job);
  await page.goto("/chat/session-1");
  await page.getByRole("button", { name: /^Open image: /, exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(
    viewer.getByRole("status", { name: "Generation Status", exact: true }),
  ).toBeVisible();
  let details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  if (testInfo.project.use.isMobile) {
    await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
    details = page.getByRole("dialog", { name: /heron/i });
  }
  // The title stands in from the prompt's words until one is written; the prompt follows it.
  await expect(details.getByText("A heron wading at dawn", { exact: true }).last()).toBeVisible();
  if (testInfo.project.use.isMobile) await page.keyboard.press("Escape");
  Object.assign(job, {
    status: "completed",
    items: [
      {
        id: "/media/heron.png",
        jobId: "job-run",
        index: 0,
        type: "image",
        status: "done",
        url: image,
        thumbnailUrl: image,
        prompt: "A heron wading at dawn",
        width: 1024,
        height: 1024,
        createdAt: stamp,
      },
    ],
  });
  await expect(viewer.getByRole("status", { name: "Generation Status", exact: true })).toBeHidden();
  await expect(viewer.getByRole("img", { name: "A heron wading at dawn" })).toBeVisible();
});

test("Chat layout respects workspace width and keeps a structural sessions sidebar", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  if (!testInfo.project.use.isMobile) await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  // The model chip sits on the composer's rail beside References and names the model.
  const inputs = page.getByRole("group", { name: "Chat Inputs", exact: true });
  await expect(inputs.getByRole("combobox", { name: "Chat Model", exact: true })).toHaveText(
    "Studio Assistant",
  );
  await expect(inputs.getByRole("button", { name: "Choose References" })).toBeVisible();
  // Without a sidebar, the phone's empty state opens the Chats list, which offers New Chat.
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
  if (testInfo.project.use.isMobile) {
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
    await expect(drawer.getByRole("button", { name: "New Chat", exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "Close Chats", exact: true }).click();
    await expect(drawer).toBeHidden();
  } else {
    const sidebar = page.getByRole("complementary", { name: "Chats", exact: true });
    await expect(sidebar.getByRole("heading", { name: "Chats", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "New Chat", exact: true })).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: "Creative Modes" });
  expect(
    await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))),
  ).toEqual(["Chat", "Dream", "Images", "Videos"]);
  await openTheme(page);
  await page.getByText("Fixed Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  const fixed = await page.locator("[data-chat-workspace]").boundingBox();
  if (!testInfo.project.use.isMobile) {
    expect(fixed?.width).toBe(1600);
    const side = await page.getByRole("complementary", { name: "Chats" }).boundingBox();
    expect(side?.y).toBe(68);
    expect(side!.height + side!.y).toBe(1000);
  }
  await openTheme(page);
  await page.getByText("Full Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  const full = await page.locator("[data-chat-workspace]").boundingBox();
  if (!testInfo.project.use.isMobile) expect(full!.width).toBeGreaterThan(fixed!.width);
  const composer = await page.locator("[data-composer-dock]").boundingBox();
  expect(composer!.width).toBeLessThanOrEqual(780);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("An administrator's parked Chat model starts after confirming what it stops", async ({
  page,
}) => {
  await fixtures(page);
  const workload = (id: string, label: string, phase: string) => ({
    id,
    label,
    kind: id === "image" ? "image" : "text",
    pool: "gpu",
    gpus: 1,
    phase,
    replicas: phase === "running" ? 1 : 0,
    ready: phase === "running" ? 1 : 0,
    acceptedOperations: 0,
  });
  await page.route("**/api/chat/status", (route) =>
    route.fulfill({
      json: {
        available: true,
        models: [
          { id: "text:test", label: "Studio Assistant", workloads: ["text"] },
          { id: "text:large", label: "Large Model", workloads: ["text-large"] },
        ],
        defaultModelId: "text:test",
      },
    }),
  );
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      json: {
        automaticLifecycle: false,
        pools: [{ id: "gpu", capacity: 2, used: 2 }],
        history: [],
        workloads: [
          workload("image", "Image", "running"),
          workload("text", "Text", "running"),
          workload("text-large", "Large Text", "parked"),
        ],
      },
    }),
  );
  const previews: unknown[] = [];
  const applied: unknown[] = [];
  await page.route("**/api/runtime/preview", (route) => {
    previews.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        target: ["text", "text-large"],
        stop: ["image"],
        start: ["text-large"],
        keep: ["text"],
        signature: "fixture",
      },
    });
  });
  await page.route("**/api/runtime/apply", (route) => {
    applied.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: "next", status: "running" } });
  });
  await page.route("**/api/runtime/operations/next", (route) =>
    route.fulfill({ json: { id: "next", status: "completed", progress: "Done." } }),
  );
  await page.goto("/chat");
  const model = page.getByRole("combobox", { name: "Chat Model", exact: true });
  await expect(model).toHaveText("Studio Assistant");
  await model.click();
  await expect(page.getByRole("option", { name: /Large Model/ })).toContainText("Parked");
  await page.getByRole("option", { name: /Large Model/ }).click();
  const dialog = page.getByRole("dialog", { name: "Switch to Large Model" });
  await expect(dialog).toContainText("Stop: Image");
  await expect(dialog).toContainText("Start: Large Text");
  expect(applied).toEqual([]);
  await dialog.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(model).toHaveText("Large Model");
  expect(previews).toEqual([{ start: ["text-large"] }]);
  expect(applied).toEqual([{ workloads: ["text", "text-large"], signature: "fixture" }]);
});

test("Others see a parked Chat model as parked and cannot send to it", async ({ page }) => {
  await fixtures(page);
  await signIn(page, { id: "user", role: "user" });
  await page.route("**/api/chat/status", (route) =>
    route.fulfill({
      json: {
        available: true,
        models: [
          { id: "text:large", label: "Large Model", parked: true },
          { id: "text:test", label: "Studio Assistant" },
        ],
        defaultModelId: "text:large",
      },
    }),
  );
  await page.goto("/chat");
  const model = page.getByRole("combobox", { name: "Chat Model", exact: true });
  await expect(model).toHaveAttribute("title", /Parked/);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Hello");
  await expect(page.getByRole("button", { name: "Send Message", exact: true })).toBeDisabled();
  await model.click();
  const parked = page.getByRole("option", { name: /Large Model/ });
  await expect(parked).toContainText("Parked");
  await expect(parked).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("option", { name: /Studio Assistant/ }).click();
  await expect(page.getByRole("button", { name: "Send Message", exact: true })).toBeEnabled();
});
