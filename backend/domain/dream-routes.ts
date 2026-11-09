import { directRoute, type RouteAccount, type RouteRun } from "./direct-route.ts";
import type { Dream, DreamSettings, PairAnswer } from "./dream.ts";

// What Dream's settings route accepts: the ranges of its numbers and its on/off switches.
const limits = { buffer: [1, 50], dailyImages: [0, 500], dailyVideos: [0, 100] } as const;
const switches = ["enabled", "paused", "videos", "spicy"] as const;

/** The caller's own Dream: settings, the unseen pool, verdicts and discards. */
export function registerDreamRoutes(app: object, { dream }: { dream: Dream }) {
  const owner = (account: RouteAccount) => account?.userId || "";
  const refused = {
    status: 403,
    payload: { ok: false, error: "Dream is unavailable for this account." },
  };
  const refuse = (error: unknown) => {
    const { status = 500, message } = error as Error & { status?: number };
    return { status, payload: { ok: false, error: message } };
  };
  const show = (ownerId: string) => {
    const access = dream.access(ownerId);
    return {
      settings: dream.read(ownerId).settings,
      unseen: dream.unseen(ownerId),
      today: dream.today(ownerId),
      spicyAvailable: Boolean(access?.uncensored),
      ...dream.status(ownerId),
    };
  };
  /** A Dream route, for an account with Dream only. */
  const route = (method: string, path: string, run: RouteRun) =>
    directRoute(app, method, path, (account, input) =>
      dream.access(owner(account)) ? run(account, input) : refused,
    );
  route("GET", "/api/dream", (account) => ({ status: 200, payload: show(owner(account)) }));
  route("PUT", "/api/dream/settings", async (account, { body = {} }) => {
    const patch: Partial<DreamSettings> = {};
    for (const key of switches) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean")
        return { status: 400, payload: { ok: false, error: `Set ${key} to true or false.` } };
      patch[key] = body[key];
    }
    for (const [key, [low, high]] of Object.entries(limits) as [
      keyof typeof limits,
      readonly [number, number],
    ][]) {
      if (body[key] === undefined) continue;
      if (
        !Number.isInteger(body[key]) ||
        (body[key] as number) < low ||
        (body[key] as number) > high
      )
        return {
          status: 400,
          payload: { ok: false, error: `Set ${key} to a whole number from ${low} to ${high}.` },
        };
      patch[key] = body[key] as number;
    }
    if (patch.spicy && !dream.access(owner(account))?.uncensored)
      return {
        status: 403,
        payload: { ok: false, error: "Spicy needs Uncensored Models for this account." },
      };
    await dream.save(owner(account), patch);
    return { status: 200, payload: show(owner(account)) };
  });
  route("GET", "/api/dream/calibration", (account, { query }) => {
    const limit = Math.max(
      1,
      Math.min(24, Number.parseInt(String(query?.limit || "12"), 10) || 12),
    );
    return { status: 200, payload: { items: dream.calibration(owner(account), limit) } };
  });
  route("POST", "/api/dream/calibration", (account, { body }) => {
    const { liked = [], passed = [] } = body || {};
    const ids = [liked, passed].flat();
    if (
      !Array.isArray(liked) ||
      !Array.isArray(passed) ||
      !ids.length ||
      ids.length > 2 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size < ids.length
    )
      return {
        status: 400,
        payload: { ok: false, error: "Like or pass one image, or answer a pair." },
      };
    try {
      dream.calibrate(owner(account), { liked, passed });
      return { status: 200, payload: { ok: true } };
    } catch (error) {
      return refuse(error);
    }
  });
  route("GET", "/api/dream/discarded", (account, { query }) => {
    const all = dream.discarded(owner(account));
    const start = Math.max(0, Number.parseInt(String(query?.cursor || "0"), 10) || 0);
    const limit = Math.max(
      1,
      Math.min(100, Number.parseInt(String(query?.limit || "40"), 10) || 40),
    );
    const items = all.slice(start, start + limit);
    return {
      status: 200,
      payload: { items, nextCursor: start + limit < all.length ? String(start + limit) : "" },
    };
  });
  route("POST", "/api/dream/pairs/:pairId/answer", (account, { params, body }) => {
    const answer = body?.answer;
    if (!["a", "b", "both", "neither"].includes(answer as string))
      return { status: 400, payload: { ok: false, error: "Answer A, B, Both or Neither." } };
    try {
      return {
        status: 200,
        payload: { items: dream.answer(owner(account), params.pairId, answer as PairAnswer) },
      };
    } catch (error) {
      return refuse(error);
    }
  });
  for (const verdict of ["keep", "discard", "more"] as const)
    route("POST", `/api/dream/:itemId/${verdict}`, (account, { params }) => {
      try {
        return { status: 200, payload: { item: dream[verdict](owner(account), params.itemId) } };
      } catch (error) {
        return refuse(error);
      }
    });
  route("POST", "/api/dream/:itemId/variations", async (account, { params, body }) => {
    const count = body?.count ?? 4;
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 8)
      return { status: 400, payload: { ok: false, error: "Choose 1–8 variations." } };
    try {
      const { item, result } = await dream.variations(
        owner(account),
        account || undefined,
        params.itemId,
        count as number,
      );
      return {
        status: result.status >= 400 ? result.status : 202,
        payload: { item, ...result.payload },
      };
    } catch (error) {
      return refuse(error);
    }
  });
}
