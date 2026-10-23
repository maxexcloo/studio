import { expect, test } from "@playwright/test";
import { fixtures, image, stamp } from "./fixtures";
const results = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `browse-${index}`,
    type: "image",
    status: "done",
    prompt: `Browse Result ${index}`,
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
  }));

test("Gallery continues near the bottom and retains loaded results when the next page needs retry", async ({
  page,
}) => {
  await fixtures(page);
  const items = results(61);
  let failed = false;
  let recovered = false;
  await page.route("**/api/gallery?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor && !recovered) {
      failed = true;
      await route.fulfill({ status: 503, json: { error: "Fixture next page is offline" } });
    } else
      await route.fulfill({
        json: cursor
          ? { items: items.slice(60), nextCursor: "", hasMore: false }
          : { items: items.slice(0, 60), nextCursor: "next", hasMore: true },
      });
  });
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => failed).toBe(true);
  await expect(
    page.getByText("More results could not be loaded. Try again.", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".studio-media-tile").first()).toBeVisible();
  recovered = true;
  await page.getByRole("button", { name: "Load More", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 60", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Load More", exact: true })).toBeHidden();
});

test("Closing a navigated viewer reveals and focuses its current virtualised gallery tile", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/gallery?**", (route) =>
    route.fulfill({ json: { items: results(80), nextCursor: "", hasMore: false } }),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 25; index++)
    await dialog.getByRole("button", { name: "Next Generation", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Browse Result 25", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(dialog).toBeHidden();
  const current = page.getByRole("button", { name: "Open image: Browse Result 25", exact: true });
  await expect(current).toBeFocused();
  await expect(current).toBeInViewport();
});

test("Single-item viewer keyboard actions star and request deletion through the existing confirmation", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  await page.keyboard.press("f");
  await expect.poll(() => state.gallery[0].favorite).toBe(true);
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Delete Item", exact: true });
  await expect(confirm).toBeVisible();
  expect(state.gallery).toHaveLength(1);
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Delete");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect.poll(() => state.gallery.length).toBe(0);
});

test("Search shortcuts follow the active gallery or reference picker and leave prompt typing alone", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  const tile = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  await tile.focus();
  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(search).toBeFocused();
  await search.fill("Browse");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search Gallery", exact: true })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Browse");
  await page.keyboard.press("Escape");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await prompt.fill("Keep typing");
  await prompt.press("/");
  await expect(prompt).toHaveValue("Keep typing/");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  await picker.getByRole("button", { name: "Search Gallery", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+f");
  const referenceSearch = picker.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(referenceSearch).toBeFocused();
  await referenceSearch.fill("Result 0");
  await expect(
    picker.getByRole("button", { name: "Use reference: Browse Result 0", exact: true }),
  ).toBeVisible();
  await picker.getByRole("button", { name: "Use reference: Browse Result 0", exact: true }).click();
  await picker.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(prompt).toHaveValue("Keep typing/");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
});

test("Touch scrolling cancels hold selection and a held tile remains selected after release", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Touch gesture applies to phone projects");
  const state = await fixtures(page);
  state.gallery.push(...results(2));
  await page.goto("/images");
  const first = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  const second = page.getByRole("button", { name: "Open image: Browse Result 1", exact: true });
  async function touch(target: typeof first, type: string, y = 100) {
    await target.evaluate(
      (element, { type, y }) => {
        const contact = { identifier: 1, target: element, clientX: 100, clientY: y };
        const touches = type === "touchend" ? [] : [contact];
        const event = document.createEvent("TouchEvent");
        event.initEvent(type, true, true);
        Object.defineProperties(event, {
          touches: { value: touches },
          targetTouches: { value: touches },
          changedTouches: { value: [contact] },
        });
        element.dispatchEvent(event);
      },
      { type, y },
    );
  }
  await touch(first, "touchstart");
  await touch(first, "touchmove", 140);
  await touch(first, "touchend", 140);
  await touch(second, "touchstart");
  const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
  await expect(selection.getByRole("status")).toHaveText("1 Selected");
  const selected = page.getByRole("button", { name: "Select image: Browse Result 1", exact: true });
  await touch(selected, "touchend");
  await selected.dispatchEvent("click");
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Star Selected", exact: true }).click();
  await expect.poll(() => state.gallery[1].favorite).toBe(true);
  expect(state.gallery[0].favorite).not.toBe(true);
  await selection.getByRole("button", { name: "Done Selecting", exact: true }).click();
  await page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
});
