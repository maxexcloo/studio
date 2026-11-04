import { expect, test, type Page } from "@playwright/test";
import { fixtures, section, signIn, stamp } from "./fixtures";

async function accountFixture(page: Page) {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  return state;
}

test("Administrators link, dismiss and unlink chat identities in Settings › Users with saved readback", async ({
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
  await page.getByRole("combobox", { name: "Account for chat-member", exact: true }).click();
  await page.getByRole("option", { name: "member@example.test", exact: true }).click();
  await page.getByRole("button", { name: "Link chat-member", exact: true }).click();
  // A linked identity leaves the awaiting list and marks its account's row.
  await expect(page.getByText("chat-member", { exact: true })).toHaveCount(0);
  const member = page.getByRole("row", { name: "member@example.test", exact: true });
  await expect(member.getByText("Chat Gateway", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss chat-dismiss", exact: true }).click();
  await expect(page.getByText("chat-dismiss", { exact: true })).toHaveCount(0);
  await section(page, "Settings", "Account");
  await section(page, "Settings", "Users");
  await member
    .getByRole("button", { name: "Actions for member@example.test", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Unlink chat-member", exact: true }).click();
  await expect(member.getByText("Chat Gateway", { exact: true })).toHaveCount(0);
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
  const control = page.getByRole("switch", { name: "Chat Gateway Admin Tools", exact: true });
  await control.click({ force: true });
  await expect(control).toBeDisabled();
  await expect(control).not.toBeChecked();
  release();
  await expect(page.getByRole("alert")).toContainText("Gateway settings could not be saved");
  await expect(control).toBeEnabled();
  await expect(control).not.toBeChecked();
  await control.click({ force: true });
  await expect(control).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
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
  await expect(page.getByText(status.endpoint, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create Token", exact: true }).click();
  const token = page.getByRole("textbox", { name: "New MCP Token", exact: true });
  await expect(token).toHaveValue("browser-fixture-token-1");
  await expect(page.getByText("Token Active", { exact: true })).toBeVisible();
  await section(page, "Settings", "Users");
  await section(page, "Settings", "Account");
  await expect(token).toHaveCount(0);
  await page.getByRole("button", { name: "Rotate Token", exact: true }).click();
  await expect(token).toHaveValue("browser-fixture-token-2");
  // Revoking sits in the Danger Zone and confirms first.
  await page
    .getByRole("region", { name: "Danger Zone", exact: true })
    .getByRole("button", { name: "Revoke Token", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Revoke Token", exact: true })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(page.getByText("No Token Issued", { exact: true })).toBeVisible();
  await expect(token).toHaveCount(0);
  await page.getByRole("button", { name: "Create Token", exact: true }).click();
  await expect.poll(() => issued).toBe(3);
  await section(page, "Settings", "Users");
  await section(page, "Settings", "Account");
  finishLateIssuance();
  await expect(page.getByRole("button", { name: "Rotate Token", exact: true })).toBeEnabled();
  await expect(token).toHaveCount(0);
  expect({ issued, revoked }).toEqual({ issued: 3, revoked: 1 });
});

test("Sign-in gate keeps account data behind authentication", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({ json: { mode: "multi-user", signedIn: false, oidc: { label: "Pocket ID" } } }),
  );
  await page.goto("/?password=1");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In With Pocket ID" })).toHaveAttribute(
    "href",
    "/api/accounts/oidc/start",
  );
  await expect(page.getByRole("link", { name: "Images", exact: true })).toHaveCount(0);
});

test("Signed out with single sign-on goes straight to it, and a failed return shows the form", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({ json: { mode: "multi-user", signedIn: false, oidc: { label: "Pocket ID" } } }),
  );
  let starts = 0;
  await page.route("**/api/accounts/oidc/start", (route) => {
    starts++;
    // The first attempt fails at the provider; the second returns without a session. WebKit can't
    // fulfil a redirect, so a page sends the browser back as the provider's redirect would.
    const back = starts === 1 ? "/?sign-in=failed" : "/";
    return route.fulfill({
      contentType: "text/html",
      body: `<script>location.replace(${JSON.stringify(back)})</script>`,
    });
  });
  await page.goto("/");
  await expect(page.getByText("Single sign-on did not complete. Try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Sign In With Pocket ID" }).click();
  await expect(page.getByText("Single sign-on did not sign you in.")).toBeVisible();
  await page.goto("/?sign-in=signed-out");
  await expect(page.getByText("Signed out.", { exact: true })).toBeVisible();
  expect(starts).toBe(2);
});

test("A group without Chat or Dream hides them and leaves their routes for Images", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "member", role: "user", features: { chat: false, dream: false } });
  await page.goto("/dream");
  await expect(page).toHaveURL(/\/images$/);
  const modes = page.getByRole("navigation", { name: "Creative Modes" });
  await expect(modes.getByRole("link", { name: "Images", exact: true })).toBeVisible();
  await expect(modes.getByRole("link", { name: "Chat", exact: true })).toHaveCount(0);
  await expect(modes.getByRole("link", { name: "Dream", exact: true })).toHaveCount(0);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/images$/);
});

test("Administrators save and verify per-user cloud and uncensored access through assigned groups", async ({
  page,
}) => {
  const state = await accountFixture(page);
  await page.goto("/settings");
  await section(page, "Settings", "Groups");
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  await page.getByRole("textbox", { name: "Group Name", exact: true }).fill("Member Cloud");
  await page.getByRole("textbox", { name: "Group ID", exact: true }).fill("member-cloud");
  await page.getByRole("checkbox", { name: "Cloud Models", exact: true }).check();
  await page.getByRole("checkbox", { name: "Uncensored Models", exact: true }).check();
  await page.getByRole("checkbox", { name: "LoRAs", exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
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
  await expect(
    member.getByRole("combobox", { name: "Access Group for member@example.test", exact: true }),
  ).toHaveValue("Member Cloud");
  // The toolbar spells its actions out.
  await expect(page.getByText("New User", { exact: true })).toBeVisible();
  await member
    .getByRole("button", { name: "Actions for member@example.test", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Disable Account", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Disable Account", exact: true })
    .getByRole("button", { name: "Disable", exact: true })
    .click();
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
  await expect(own.getByText("admin@example.test", { exact: true })).toBeVisible();
  await own.getByRole("button", { name: "Change", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Email & Password", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
    "admin@example.test",
  );
  await expect(
    dialog.getByRole("textbox", { name: "Current Password", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save Email & Password", exact: true }),
  ).toBeDisabled();
});

test("Administrators change roles, reset passwords and delete accounts and empty groups", async ({
  page,
}) => {
  const state = await accountFixture(page);
  Object.assign(state.administration.accounts[1], { passwordSignIn: true });
  state.administration.accessProfiles.push({
    id: "empty",
    name: "Empty",
    allModels: false,
    generationProfiles: [],
    features: { cloudModels: false, loras: false, uncensoredModels: false },
  });
  const patches: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/accounts/users/"))
      patches.push(request.postDataJSON());
  });
  await page.goto("/settings#users");
  const member = page.getByRole("row", { name: "member@example.test", exact: true });
  const menu = (item: string) =>
    member
      .getByRole("button", { name: "Actions for member@example.test", exact: true })
      .click()
      .then(() => page.getByRole("menuitem", { name: item, exact: true }).click());
  // Administrators can't change or delete their own account here.
  await expect(
    page
      .getByRole("row", { name: "admin@example.test", exact: true })
      .getByRole("button", { name: "Actions for admin@example.test", exact: true }),
  ).toHaveCount(0);

  await menu("Make Administrator");
  await page
    .getByRole("dialog", { name: "Make Administrator", exact: true })
    .getByRole("button", { name: "Make Administrator", exact: true })
    .click();
  await expect(member.getByText("Administrator", { exact: true })).toBeVisible();

  await menu("Reset Password");
  const reset = page.getByRole("dialog", { name: "Reset Password", exact: true });
  await reset.getByLabel("New Password").fill("a new member password");
  await reset.getByRole("button", { name: "Reset Password", exact: true }).click();
  await expect(reset).toBeHidden();

  await menu("Delete Account");
  const confirm = page.getByRole("dialog", { name: "Delete Account", exact: true });
  await expect(confirm).toContainText("stay on disk");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(member).toHaveCount(0);
  expect(patches).toEqual([{ role: "administrator" }, { password: "a new member password" }]);

  // Only a group nobody belongs to that isn't the default can go.
  await section(page, "Settings", "Groups");
  const actions = (name: string) =>
    page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
  await actions("Users");
  await expect(page.getByRole("menuitem", { name: "Delete Group", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await actions("Empty");
  await page
    .getByRole("menu", { name: "Actions for Empty" })
    .getByRole("menuitem", { name: "Delete Group", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete Group", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("row", { name: "Empty", exact: true })).toHaveCount(0);
  expect(state.administration.accessProfiles.map((group) => group.id)).toEqual(["users"]);
});

test("A member turns the Cloud and Uncensored Models its group grants off for itself", async ({
  page,
}) => {
  const state = await fixtures(page);
  await signIn(page, {
    id: "member",
    role: "user",
    features: { cloudModels: true, uncensoredModels: true },
  });
  state.preferences.grants = {
    cloudModels: true,
    loras: false,
    spicyPrompts: false,
    uncensoredModels: false,
  };
  await page.goto("/settings#preferences");
  const models = page.getByRole("region", { name: "Models", exact: true });
  // Only what the group grants can be turned off.
  await expect(models.getByRole("switch")).toHaveCount(1);
  const cloud = models.getByRole("switch", { name: "Cloud Models", exact: true });
  await expect(cloud).toBeChecked();
  await cloud.click({ force: true });
  await expect(cloud).not.toBeChecked();
  await expect.poll(() => state.preferences.preferences.cloudModels).toBe(false);
  await page.reload();
  await expect(cloud).not.toBeChecked();
});

test("Account menu names the account by its email and opens the account workspace", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "user" });
  await page.goto("/");
  if (testInfo.project.use.isMobile) {
    await page.getByRole("button", { name: "More Options", exact: true }).click();
    // Appearance, Library, Settings, then the account last.
    await expect(page.getByRole("menuitem")).toContainText([
      "Appearance",
      "Settings",
      "Account",
      "Sign Out",
    ]);
  } else {
    // Appearance, Library, Settings, Account: each named on hover.
    await page.getByRole("button", { name: "Appearance", exact: true }).hover();
    await expect(page.getByRole("tooltip", { name: "Appearance", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Account", exact: true }).hover();
    await expect(page.getByRole("tooltip", { name: "Account", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Account", exact: true }).click();
  }
  await expect(page.getByText("admin@example.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign Out", exact: true })).toBeEnabled();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/settings#account$/);
});
