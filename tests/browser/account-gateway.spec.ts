import { expect, test, type Page } from "@playwright/test";
import { fixtures, section, signIn, stamp } from "./fixtures";

async function accountFixture(page: Page) {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  return state;
}

test("Administrators explicitly link, dismiss and unlink chat identities with saved readback", async ({
  page,
}) => {
  const state = await accountFixture(page);
  const gateway = {
    adminTools: false,
    links: [] as { identity: string; accountId: string }[],
    pending: ["chat-member", "chat-dismiss"].map((identity) => ({ identity, firstSeenAt: stamp })),
  };
  const actions: unknown[] = [];
  await page.route("**/api/accounts/admin", (route) =>
    route.fulfill({ json: { ...state.administration, gateway } }),
  );
  await page.route("**/api/accounts/gateway-links", (route) => {
    const body = route.request().postDataJSON();
    actions.push(body);
    gateway.links = gateway.links.filter((link) => link.identity !== body.identity);
    if (body.accountId) {
      gateway.links.push({ identity: body.identity, accountId: body.accountId });
      gateway.pending = gateway.pending.filter((item) => item.identity !== body.identity);
    }
    return route.fulfill({ json: { ok: true, gateway } });
  });
  await page.route("**/api/accounts/gateway-pending/dismiss", (route) => {
    const body = route.request().postDataJSON();
    gateway.pending = gateway.pending.filter((item) => item.identity !== body.identity);
    return route.fulfill({ json: { ok: true, gateway } });
  });
  await page.goto("/settings#users");
  await page.getByRole("button", { name: "Chat Gateway", exact: true }).click();
  await page.getByRole("combobox", { name: "Account for chat-member", exact: true }).click();
  await page.getByRole("option", { name: "member@example.test", exact: true }).click();
  await page.getByRole("button", { name: "Link chat-member", exact: true }).click();
  const linked = page.getByRole("row", { name: "chat-member", exact: true });
  await expect(linked).toContainText("member@example.test");
  await expect(linked).not.toContainText("Awaiting Link");
  const rowAction = async (identity: string, action: string) => {
    await page.getByRole("button", { name: `Actions for ${identity}`, exact: true }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  };
  await rowAction("chat-dismiss", "Dismiss");
  await expect(page.getByRole("row", { name: "chat-dismiss", exact: true })).toHaveCount(0);
  await section(page, "Settings", "Account");
  await section(page, "Settings", "Users");
  await expect(linked).toBeVisible();
  await rowAction("chat-member", "Unlink");
  await expect(page.getByText("No Chat Users Yet", { exact: true })).toBeVisible();
  expect(actions).toEqual([
    { identity: "chat-member", accountId: "member" },
    { identity: "chat-member" },
  ]);
});

test("Gateway admin access remains unchanged after a failed save and reflects a confirmed retry", async ({
  page,
}) => {
  const state = await accountFixture(page);
  const gateway = { links: [], pending: [], adminTools: false };
  let attempts = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/accounts/admin", (route) =>
    route.fulfill({ json: { ...state.administration, gateway } }),
  );
  await page.route("**/api/accounts/gateway-admin", async (route) => {
    attempts++;
    if (attempts === 1) {
      await pending;
      return route.fulfill({ status: 503, json: { error: "Gateway settings could not be saved" } });
    }
    gateway.adminTools = route.request().postDataJSON().on;
    return route.fulfill({ json: { ok: true, adminTools: gateway.adminTools } });
  });
  await page.goto("/settings#users");
  await page.getByRole("button", { name: "Chat Gateway", exact: true }).click();
  const control = page.getByRole("switch", { name: /^Chat Gateway Admin Tools/ });
  await control.click();
  await expect(control).toBeDisabled();
  await expect(control).not.toBeChecked();
  release();
  await expect(page.getByRole("alert")).toContainText("Gateway settings could not be saved");
  await expect(control).toBeEnabled();
  await expect(control).not.toBeChecked();
  await control.click();
  await expect(control).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Chat Gateway", exact: true }).click();
  await expect(control).toBeChecked();
  expect(attempts).toBe(2);
});

test("Personal MCP credentials can be issued, rotated and revoked without retaining the shown token across sections", async ({
  page,
}) => {
  await accountFixture(page);
  const status = { endpoint: "https://studio.example.test/mcp", enabled: false, createdAt: "" };
  let issued = 0;
  let revoked = 0;
  let finishLateIssuance!: () => void;
  const lateIssuance = new Promise<void>((resolve) => {
    finishLateIssuance = resolve;
  });
  await page.route("**/api/accounts/mcp-token", async (route) => {
    if (route.request().method() === "POST") {
      issued++;
      status.enabled = true;
      status.createdAt = stamp;
      if (issued === 3) await lateIssuance;
      return route.fulfill({
        json: { ok: true, token: `browser-fixture-token-${issued}`, createdAt: stamp },
      });
    }
    return route.fulfill({ json: { ok: true, ...status } });
  });
  await page.route("**/api/accounts/mcp-token/revoke", (route) => {
    revoked++;
    status.enabled = false;
    status.createdAt = "";
    return route.fulfill({ json: { ok: true, enabled: false, createdAt: "" } });
  });
  await page.goto("/settings#account");
  await page.getByRole("button", { name: "Personal MCP Connection", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "MCP Endpoint", exact: true })).toHaveValue(
    status.endpoint,
  );
  await page.getByRole("button", { name: "Create Token", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New MCP Token", exact: true })).toHaveValue(
    "browser-fixture-token-1",
  );
  await expect(page.getByText("Token Active", { exact: true })).toBeVisible();
  await section(page, "Settings", "Users");
  await section(page, "Settings", "Account");
  await expect(page.getByRole("textbox", { name: "New MCP Token", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Rotate Token", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New MCP Token", exact: true })).toHaveValue(
    "browser-fixture-token-2",
  );
  await page.getByRole("button", { name: "Revoke Token", exact: true }).click();
  await expect(page.getByText("No Token Issued", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New MCP Token", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Create Token", exact: true }).click();
  await expect.poll(() => issued).toBe(3);
  await section(page, "Settings", "Users");
  await section(page, "Settings", "Account");
  finishLateIssuance();
  await expect(page.getByRole("button", { name: "Rotate Token", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "New MCP Token", exact: true })).toHaveCount(0);
  expect({ issued, revoked }).toEqual({ issued: 3, revoked: 1 });
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

test("Administrators save and verify per-user cloud and NSFW access through assigned groups", async ({
  page,
}) => {
  const state = await accountFixture(page);
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
  const member = page.getByRole("row", { name: "member@example.test", exact: true });
  await member
    .getByRole("combobox", { name: "Access Group for member@example.test", exact: true })
    .click();
  await page.getByRole("option", { name: "Member Cloud", exact: true }).click();
  await expect(member.getByText("Cloud Models On", { exact: true })).toBeVisible();
  await expect(member.getByText("NSFW Models On", { exact: true })).toBeVisible();
  await member
    .getByRole("button", { name: "Actions for member@example.test", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Disable Account", exact: true }).click();
  await expect(member.getByText("Disabled", { exact: true })).toBeVisible();
  expect(state.administration.accounts.find((account) => account.id === "member")?.disabled).toBe(
    true,
  );
});

test("Users change their email only behind password-protected controls", async ({ page }) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "user" });
  await page.goto("/settings");
  const own = page.getByRole("region", { name: "Your Account", exact: true });
  await own.getByRole("button", { name: "Email & Password", exact: true }).click();
  await expect(own.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
    "admin@example.test",
  );
  await expect(own.getByRole("textbox", { name: "Current Password", exact: true })).toBeVisible();
  await expect(
    own.getByRole("button", { name: "Save Email & Password", exact: true }),
  ).toBeDisabled();
});

test("Account menu names the account by its email and opens the account workspace", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "user" });
  await page.goto("/");
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "More Options", exact: true }).click();
  else await page.getByRole("button", { name: "Your Account", exact: true }).click();
  await expect(page.getByText("admin@example.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign Out", exact: true })).toBeEnabled();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/settings#account$/);
});
