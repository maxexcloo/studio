import { expect, test } from "@playwright/test";
import { create, fixtures, image, openTheme, promptTool, stamp } from "./fixtures";

test("A click outside an open popup only closes it", async ({ page }) => {
  await fixtures(page);
  await page.goto("/images");
  await openTheme(page);
  const theme = page.getByText("Colour Scheme", { exact: true });
  await expect(theme).toBeVisible();
  const chat = page
    .getByRole("navigation", { name: "Creative Modes" })
    .getByRole("link", { name: "Chat" });
  await chat.click();
  await expect(theme).toHaveCount(0);
  await expect(page).toHaveURL(/\/images$/);
  await chat.click();
  await expect(page).toHaveURL(/\/chat$/);
});

test("Popups anchored to the composer stay put while the gallery scrolls", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/gallery?**", (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 60 }, (_, index) => ({
          id: `scroll-${index}`,
          type: "image",
          status: "done",
          prompt: `Scroll Result ${index}`,
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
          createdAt: stamp,
        })),
        nextCursor: "",
        hasMore: false,
      },
    }),
  );
  await page.route("**/api/prompts**", (route) =>
    route.fulfill({
      json: { prompts: [{ text: "Earlier landscape", at: stamp, uses: 1 }], enabled: true },
    }),
  );
  await create(page);
  await promptTool(page, "Prompt", "Recent Prompts");
  const panel = page.getByRole("dialog", { name: "Recent Prompts", exact: true });
  await expect(panel.getByText("Earlier landscape")).toBeVisible();
  // Once its scale-in has finished; measured in one task, before any scroll handler could move it back.
  const moved = await panel.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    const before = element.getBoundingClientRect().top;
    window.scrollBy(0, 400);
    return element.getBoundingClientRect().top - before;
  });
  // A popup that followed the page would move by the whole scroll.
  expect(Math.abs(moved)).toBeLessThan(1);
});

test("A phone held sideways keeps the phone layout and an iPad in landscape doesn't", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Only touch screens hold a phone sideways.");
  await fixtures(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/images");
  const more = page.getByRole("button", { name: "More Options", exact: true });
  const settings = page.getByRole("link", { name: "Settings", exact: true });
  await expect(more).toBeVisible();
  await expect(settings).toHaveCount(0);
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(settings).toBeVisible();
  await expect(more).toHaveCount(0);
});

test("Work that finishes while Studio is hidden counts in the title and app badge until it returns", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.addInitScript(() => {
    const badges: (number | "clear")[] = [];
    Object.assign(window, { badges });
    Object.assign(navigator, {
      setAppBadge: async (count: number) => void badges.push(count),
      clearAppBadge: async () => void badges.push("clear"),
    });
    let hidden = false;
    Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
    Object.assign(window, {
      setHidden: (value: boolean) => {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    });
  });
  const job = (id: string, extra = {}) => ({
    id,
    sessionId: "chat-a",
    status: "running",
    operation: "image",
    input: { kind: "image", prompt: id },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  });
  state.jobs.push(job("mine"), job("dreamed", { dream: true }));
  await page.goto("/images");
  await expect(page).toHaveTitle("Studio");
  await page.evaluate(() => (window as any).setHidden(true));
  for (const entry of state.jobs) entry.status = "completed";
  await expect(page).toHaveTitle("(1) Studio");
  expect(await page.evaluate(() => (window as any).badges)).toEqual([1]);
  await page.evaluate(() => (window as any).setHidden(false));
  await expect(page).toHaveTitle("Studio");
  expect(await page.evaluate(() => (window as any).badges)).toEqual([1, "clear"]);
});
