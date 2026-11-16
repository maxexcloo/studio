import { ownerIdForRequest } from "../account-ownership.js";
import { optionsFor } from "../comfy/comfy.js";
import { directRoute } from "../domain/direct-route.ts";
import { accountMayUseLoras, loraAllowed } from "../model/catalogue.js";
import { requireLocal } from "../route-access.js";
import { defaultWorkerId } from "../workers.js";
import { loraInfos } from "./info.js";
import { applyLoraOps, clearLoraState, loadLoraLibrary } from "./stacks.js";

/** An account's LoRA ratings, and what each installed LoRA was trained for. */
export function registerLoraRoutes(app, { comfyDownMessage, latestComfyContext }) {
  app.delete("/api/loras", (req, res) => {
    if (!requireLocal(req, res)) return;
    clearLoraState(ownerIdForRequest(req));
    res.json({ ok: true });
  });

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

  // What each LoRA ComfyUI lists was trained for and its trigger words, from the files themselves.
  directRoute(app, "GET", "/api/loras/info", async (account) => {
    if (!accountMayUseLoras({ studioAccount: account }))
      return { status: 200, payload: { ok: true, loras: {} } };
    try {
      const { info } = await latestComfyContext(defaultWorkerId());
      const names = optionsFor(info, "LoraLoader", "lora_name").filter(loraAllowed(account));
      return {
        status: 200,
        payload: { ok: true, loras: await loraInfos(defaultWorkerId(), names) },
      };
    } catch (error) {
      return {
        status: 503,
        payload: {
          ok: false,
          loras: {},
          error: comfyDownMessage(defaultWorkerId(), error?.message),
        },
      };
    }
  });
}
