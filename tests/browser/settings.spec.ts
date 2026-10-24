import { expect, test } from "@playwright/test";
import { fixtures, section } from "./fixtures";

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
