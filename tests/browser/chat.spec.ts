import { expect, test, type Page } from "@playwright/test";
import { fixtures, image, profiles, stamp } from "./fixtures";

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
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  return page.getByRole("dialog", { name: "Chats", exact: true });
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
    edited.getByText("Iteration 2 · Image · from iteration 1", { exact: true }),
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
  expect(warnings.filter((text) => /key/i.test(text))).toEqual([]);
});

test("Chats can be renamed and deleted with an opt-in results checklist", async ({
  page,
  isMobile,
}) => {
  const state = await savedChat(page);
  await page.goto("/chat/chat-a");
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
  if (isMobile) await page.keyboard.press("Escape");
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
