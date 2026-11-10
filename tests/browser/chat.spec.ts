import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  fixtures,
  image,
  loadSaved,
  openTheme,
  profiles,
  signIn,
  stamp,
  expectNoChatOpen,
  touch,
} from "./fixtures";

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

/** Opens a listed chat's menu: its options button on desktop, or holding the row on phones. */
async function chatMenu(list: Locator, title: string, isMobile: boolean) {
  if (!isMobile)
    return list.getByRole("button", { name: `Chat Options for ${title}`, exact: true }).click();
  const row = list.getByRole("link", { name: new RegExp(title) });
  await expect(
    list.getByRole("button", { name: `Chat Options for ${title}`, exact: true }),
  ).toBeHidden();
  await touch(row, "touchstart");
  await expect(list.page().getByRole("menu")).toBeVisible();
  await touch(row, "touchend");
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

test("An MCP set's Chat card links to the set in the gallery, and a result links back to its turn", async ({
  page,
}) => {
  const state = await savedChat(page);
  const set = { id: "set-b", title: "Bird Variety", index: 0, source: "Chat" };
  const job = state.jobs.find((entry) => entry.id === "job-b");
  job.input.resultSet = set;
  for (const item of state.gallery) if (item.jobId === "job-b") item.resultSet = set;
  await page.goto("/chat/chat-a#job-job-b");
  const card = page.getByRole("article", { name: "Iteration 2", exact: true });
  await expect(card).toBeInViewport();
  await card.getByRole("link", { name: "Set: Bird Variety", exact: true }).click();
  await expect(page).toHaveURL(/\/images\?set=set-b$/);
  await expect(page.getByRole("button", { name: /^Open image: / })).toHaveCount(3);
  await page
    .getByRole("button", { name: /^Open image: / })
    .first()
    .click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  // Details names the Chat and the client that asked, linking to the turn that made it.
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  const back = page.getByRole("link", { name: "From Chat: Blue Bird Studies", exact: true });
  await expect(back.first()).toHaveAttribute("href", "/chat/chat-a#job-job-b");
});

test("Open All flips through one iteration's results, as does opening one of them", async ({
  page,
}, testInfo) => {
  await savedChat(page);
  await page.goto("/chat/chat-a");
  await expect(
    page
      .getByRole("article", { name: "Iteration 1", exact: true })
      .getByRole("button", { name: /^Open All/ }),
  ).toHaveCount(0);
  const edited = page.getByRole("article", { name: "Iteration 2", exact: true });
  await edited.getByRole("button", { name: "Open All in Iteration 2", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer.getByText("1 / 3", { exact: true })).toBeVisible();
  const { isMobile, browserName } = testInfo.project.use;
  const touch = isMobile && browserName !== "webkit" && (await page.context().newCDPSession(page));
  // Desktop uses Next, Chromium phones swipe and WebKit phones take the arrow key.
  async function flip() {
    if (touch) {
      const picture = viewer.getByRole("img", { name: "A watercolour bird", exact: true }).first();
      const box = (await picture.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - 150, y }],
      });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else if (isMobile) await page.keyboard.press("ArrowRight");
    else await viewer.getByRole("button", { name: "Next Generation", exact: true }).click();
  }
  await flip();
  await expect(viewer.getByText("2 / 3", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("3 / 3", { exact: true })).toBeVisible();
  // The iteration's last result is the end, not Iteration 1.
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("3 / 3", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await edited
    .getByRole("button", { name: /^Open image: / })
    .nth(1)
    .click();
  await expect(viewer.getByText("2 / 3", { exact: true })).toBeVisible();
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
  await chatMenu(list, "Blue Bird Studies", isMobile);
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

/** The saved chat and two more, listed with nothing open: the sidebar, or the phone Chat page. */
async function threeChats(page: Page, isMobile: boolean) {
  const state = await savedChat(page);
  for (const [id, title] of [
    ["chat-b", "Sunset Notes"],
    ["chat-c", "Harbour Plans"],
  ])
    state.sessions.push({
      id,
      title,
      titleSource: "user",
      inputs: {},
      createdAt: stamp,
      updatedAt: stamp,
    });
  state.messages.push({
    id: "sunset",
    sessionId: "chat-b",
    role: "user",
    content: "Golden hour over the water",
    status: "completed",
    createdAt: at(20),
  });
  await page.goto("/chat");
  const list = isMobile
    ? page.getByRole("region", { name: "Chats", exact: true })
    : page.getByRole("complementary", { name: "Chats", exact: true });
  const row = (title: string) => list.getByRole("link", { name: new RegExp(title) });
  await expect(row("Blue Bird Studies")).toBeVisible();
  return { state, list, row };
}

/** Shows the archived chats from the list's Filter popup, then closes it. */
async function showArchived(page: Page) {
  await page
    .getByRole("dialog", { name: "Filter Chats", exact: true })
    .getByRole("radiogroup", { name: "Show", exact: true })
    .getByText("Archived", { exact: true })
    .click();
  await page.keyboard.press("Escape");
}

test("Chats are searched by title and message, and archived out of the list until unarchived", async ({
  page,
  isMobile,
}) => {
  const { state, list, row } = await threeChats(page, isMobile);
  // Phones keep the search field open.
  if (!isMobile) await list.getByRole("button", { name: "Search Chats", exact: true }).click();
  const search = list.getByRole("textbox", { name: "Search Chats", exact: true });
  await search.fill("golden hour");
  await expect(row("Sunset Notes")).toBeVisible();
  await expect(row("Blue Bird Studies")).toBeHidden();
  await search.fill("harbour");
  await expect(row("Harbour Plans")).toBeVisible();
  await expect(row("Sunset Notes")).toBeHidden();
  await list.getByRole("button", { name: "Clear Search", exact: true }).click();
  await expect(row("Sunset Notes")).toBeVisible();
  if (!isMobile) await search.press("Escape");

  await chatMenu(list, "Blue Bird Studies", isMobile);
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(row("Blue Bird Studies")).toBeHidden();
  expect(state.sessions[0].archived).toBe(true);

  await list.getByRole("button", { name: "Filter Chats", exact: true }).click();
  await showArchived(page);
  await expect(row("Blue Bird Studies")).toBeVisible();
  await expect(row("Sunset Notes")).toBeHidden();
  // Right-click opens the same menu everywhere.
  await row("Blue Bird Studies").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unarchive", exact: true }).click();
  await expect(list.getByText("No Matches", { exact: true })).toBeVisible();
  expect(state.sessions[0].archived).toBeUndefined();
});

test("Several chats are selected to archive or delete in one request each", async ({
  page,
  isMobile,
}) => {
  const { state, list, row } = await threeChats(page, isMobile);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/sessions\/(archive|delete)$/.test(request.url())) requests.push(request.url());
  });
  const selection = list.getByRole("group", { name: "Chat Selection", exact: true });
  const action = (label: string) =>
    selection
      .getByRole("group", { name: "Selected Chat Actions", exact: true })
      .getByRole("button", { name: label, exact: true });
  await list.getByRole("button", { name: "Select Chats", exact: true }).click();
  await list.getByRole("checkbox", { name: /Blue Bird Studies/ }).click();
  await list.getByRole("checkbox", { name: /Sunset Notes/ }).click();
  await expect(selection.getByRole("status")).toHaveText("2 Selected");
  await action("Archive").click();
  await expect(selection).toBeHidden();
  await expect(row("Blue Bird Studies")).toBeHidden();
  await expect(row("Sunset Notes")).toBeHidden();
  expect(state.sessions.filter((session) => session.archived).map((session) => session.id)).toEqual(
    ["chat-a", "chat-b"],
  );

  // Delete from the keyboard, then Escape leaves the selection.
  await list.getByRole("button", { name: "Select Chats", exact: true }).click();
  await selection.getByRole("button", { name: "Select All", exact: true }).click();
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("dialog", { name: "Delete Chat", exact: true });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.sessions.map((session) => session.id)).toEqual(["chat-a", "chat-b"]);
  await expect(list.getByText("No Chats", { exact: true })).toBeVisible();

  // Among archived chats, a chat still generating is kept, and stays selected.
  state.jobs[1].status = "running";
  await list.getByRole("button", { name: "Filter Chats", exact: true }).click();
  await showArchived(page);
  await list.getByRole("button", { name: "Select Chats", exact: true }).click();
  await selection.getByRole("button", { name: "Select All", exact: true }).click();
  await action("Delete").click();
  // What could not be deleted stays selected, so the dialog then names one chat.
  const many = page.getByRole("dialog", { name: /^Delete Chats?$/ });
  await many.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(many.getByText(/1 chat couldn’t be deleted/)).toBeVisible();
  await many.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(many).toBeHidden();
  await expect(selection.getByRole("status")).toHaveText("1 Selected");
  await expect(list.getByRole("checkbox", { name: /Blue Bird Studies/ })).toBeChecked();
  expect(state.sessions.map((session) => session.id)).toEqual(["chat-a"]);
  await page.keyboard.press("Escape");
  await expect(selection).toBeHidden();
  expect(requests).toHaveLength(3);
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
  // The reply's tool trail names what it made and opens to what the tool answered.
  const step = page.getByRole("button", { name: /^New image/ });
  await step.click();
  await expect(
    page.getByText("Queued on Test Image. Chose Test Image, the default."),
  ).toBeVisible();
  const first = page.getByRole("article", { name: "Iteration 1", exact: true });
  await expect(first.getByText("A blue bird in soft daylight", { exact: true })).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Open image: A blue bird in soft daylight", exact: true }),
  ).toBeVisible();
  expect(state.chatRequests[1].generation.input.profileId).toBe("image:test");
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
  ).toHaveAccessibleDescription("Add a reference image.");
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
  await page.getByRole("button", { name: "Stop Waiting bird", exact: true }).click();
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
  const field = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(field).toBeVisible();
  // Collapsed, the message is one line, centred with Send on the same row, and nothing else.
  await expect(page.getByRole("button", { name: "Choose References", exact: true })).toHaveCount(0);
  const message = await field.boundingBox();
  const send = await page.getByRole("button", { name: "Send Message", exact: true }).boundingBox();
  expect(message!.height).toBeLessThanOrEqual(send!.height + 1);
  expect(
    Math.abs(message!.y + message!.height / 2 - (send!.y + send!.height / 2)),
  ).toBeLessThanOrEqual(2);
  // Focused, it expands with the text's tools and a chip rail; one model leaves no model chip.
  await field.focus();
  const inputs = page.getByRole("group", { name: "Chat Inputs", exact: true });
  await expect(
    inputs.getByRole("button", { name: "Choose References", exact: true }),
  ).toBeVisible();
  await expect(inputs.getByRole("combobox", { name: "Chat Model", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "More Message Actions", exact: true }),
  ).toBeVisible();
  await field.press("Escape");
  await expect(inputs).toHaveCount(0);
  // Without a sidebar, phones list the chats in place of the empty state, as does the header's
  // Chats drawer, each with an open search and New Chat.
  await expectNoChatOpen(page);
  if (testInfo.project.use.isMobile) {
    const list = page.getByRole("region", { name: "Chats", exact: true });
    await expect(list.getByRole("textbox", { name: "Search Chats", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "New Chat", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open Chats", exact: true }).click();
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
  expect(composer!.width).toBeLessThanOrEqual(820);
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
        settings: { automatic: false, parkIdleMinutes: 0 },
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
  await page.getByRole("textbox", { name: "Message", exact: true }).focus();
  const model = page.getByRole("combobox", { name: "Chat Model", exact: true });
  await expect(model).toHaveText("Studio Assistant");
  await model.click();
  await expect(page.getByRole("option", { name: /Large Model/ })).toContainText("Stopped");
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
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Hello");
  const model = page.getByRole("combobox", { name: "Chat Model", exact: true });
  await expect(model).toHaveAttribute("title", /Stopped/);
  await expect(page.getByRole("button", { name: "Send Message", exact: true })).toBeDisabled();
  await model.click();
  const parked = page.getByRole("option", { name: /Large Model/ });
  await expect(parked).toContainText("Stopped");
  await expect(parked).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("option", { name: /Studio Assistant/ }).click();
  await expect(page.getByRole("button", { name: "Send Message", exact: true })).toBeEnabled();
});

test("New Chat lists the new chat first, selected, and focuses its message", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await page.goto("/chat");
  const list = testInfo.project.use.isMobile
    ? page.getByRole("region", { name: "Chats", exact: true })
    : page.getByRole("complementary", { name: "Chats", exact: true });
  await expect(list.getByRole("link", { name: "New Chat", exact: true })).toHaveCount(0);
  await list.getByRole("button", { name: "New Chat", exact: true }).click();
  const fresh = list.getByRole("link").first();
  await expect(fresh).toHaveAccessibleName("New Chat");
  await expect(fresh).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeFocused();
});
