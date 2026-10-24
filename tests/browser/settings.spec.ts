import { expect, test } from "@playwright/test";
import { fixtures, image, section, stamp } from "./fixtures";

test("Settings follow the settled section order and run maintenance and worker refreshes", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: { mode: "multi-user", signedIn: true, account: { id: "admin", role: "administrator" } },
    }),
  );
  let cleared = 0,
    statusReads = 0;
  await page.route("**/api/gallery/errors/clear", (route) => {
    cleared++;
    return route.fulfill({ json: { ok: true, outputs: [] } });
  });
  await page.route("**/api/diagnostics", (route) =>
    route.fulfill({ json: { ok: true, text: "Studio 0.0.0" } }),
  );
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/services/status") statusReads++;
  });
  await page.goto("/settings");
  const order = [
    "Account",
    "Groups",
    "Models",
    "Profiles",
    "Studio",
    "Users",
    "Workers",
    "Maintenance",
    "About",
  ];
  if ((page.viewportSize()?.width || 1440) < 768) {
    await page.getByRole("combobox", { name: "Settings Section", exact: true }).click();
    await expect(page.getByRole("option")).toHaveText(order);
    await page.keyboard.press("Escape");
  } else
    await expect(
      page.getByRole("navigation", { name: "Settings Sections", exact: true }).getByRole("link"),
    ).toHaveText(order);
  await section(page, "Settings", "Maintenance");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("Failed items cleared", { exact: true })).toBeVisible();
  expect(cleared).toBe(1);
  await section(page, "Settings", "Workers");
  await expect(page.getByRole("combobox", { name: "Images Endpoint", exact: true })).toHaveValue(
    "Image Worker",
  );
  const before = statusReads;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => statusReads).toBeGreaterThan(before);
});

test("Tile Captions in Settings › Studio pin phone tile captions", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Desktop shows captions on hover.");
  const state = await fixtures(page);
  state.gallery.push({
    id: "captioned",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "A quiet harbour, dawn light",
    createdAt: stamp,
  });
  await page.goto("/images");
  const caption = page.getByText("A quiet harbour", { exact: true });
  await expect(
    page.getByRole("button", { name: "Open image: A quiet harbour", exact: true }),
  ).toBeVisible();
  await expect(caption).toHaveCount(0);
  await page.goto("/settings#studio");
  // The unlabelled track sits over the input; the row's accessible name is on the input.
  await page.getByRole("switch", { name: "Tile Captions", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(caption).toBeVisible();
});
