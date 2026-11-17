import { directRoute } from "../domain/direct-route.ts";
import { accountMayUseLoras, loraAllowed } from "../model/catalogue.js";
import { defaultWorkerId } from "../workers.js";
import { loraInfos } from "./info.js";
import { applyLoraOps, loadLoraLibrary } from "./stacks.js";

/** An account's LoRA ratings, and what each installed LoRA was trained for. */
export function registerLoraRoutes(app, { installedLoras }) {
  directRoute(app, "GET", "/api/loras/library", (account) => {
    if (!accountMayUseLoras({ studioAccount: account }))
      return { status: 200, payload: { found: false, library: { ratings: {} } } };
    const library = loadLoraLibrary(account?.userId || "");
    return {
      status: 200,
      payload: { found: library !== null, library: library || { ratings: {} } },
    };
  });

  // Clients send edits, not whole copies, so two devices never overwrite each other.
  directRoute(app, "POST", "/api/loras/library/ops", (account, { body }) => {
    if (!accountMayUseLoras({ studioAccount: account }))
      return {
        status: 403,
        payload: { ok: false, error: "LoRAs are off for this account." },
      };
    try {
      return {
        status: 200,
        payload: { ok: true, library: applyLoraOps(body?.ops, account?.userId || "") },
      };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });

  // What each installed LoRA was trained for and its trigger words, from the files themselves.
  directRoute(app, "GET", "/api/loras/info", async (account) => {
    if (!accountMayUseLoras({ studioAccount: account }))
      return { status: 200, payload: { ok: true, loras: {} } };
    const names = installedLoras().filter(loraAllowed(account));
    return {
      status: 200,
      payload: { ok: true, loras: await loraInfos(defaultWorkerId(), names) },
    };
  });
}
