import { directRoute, type RouteAccount, type RouteRun } from "./direct-route.ts";
import type { Dream, DreamSettings, PairAnswer } from "./dream.ts";
import { projectPatch, type Projects } from "./projects.ts";
import { digest } from "./review.ts";

// What Dream's settings route accepts: the ranges of its numbers and its on/off switches.
const limits = { dailyImages: [0, 500], dailyVideos: [0, 100] } as const;
const switches = ["enabled", "paused", "videos", "spicy"] as const;

/** The caller's own Dream: settings, the unseen pool, verdicts, discards and projects. */
export function registerDreamRoutes(
  app: object,
  {
    dream,
    projects,
    numbered = (items) => items,
  }: {
    dream: Dream;
    projects: Projects;
    /** The results with their numbers (domain/result-numbers.ts). */
    numbered?: <T extends object>(items: T[]) => T[];
  },
) {
  const owner = (account: RouteAccount) => account?.userId || "";
  const refused = {
    status: 403,
    payload: { ok: false, error: "Dream is off for this account." },
  };
  const refuse = (error: unknown) => {
    const { status = 500, message } = error as Error & { status?: number };
    return { status, payload: { ok: false, error: message } };
  };
  // Single results, and a comparison's side whose other failed, show in While You Were Away;
  // comparisons stay in the deck.
  const show = (ownerId: string) => {
    const access = dream.access(ownerId);
    const record = dream.read(ownerId);
    const unseen = numbered(dream.unseen(ownerId));
    return {
      settings: record.settings,
      unseen,
      digest: digest(
        unseen.filter(
          (item) =>
            !unseen.some(
              (other) =>
                other !== item && other.dream?.pair && other.dream.pair.id === item.dream?.pair?.id,
            ),
        ),
        projects.list(ownerId),
      ),
      since: record.visit?.since || null,
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
  // The header's badge: results waiting for a verdict, a comparison counting once, and whether
  // Dream is running, so the count can change.
  route("GET", "/api/dream/count", (account) => {
    const { enabled, paused } = dream.read(owner(account)).settings;
    const unseen = dream.unseen(owner(account));
    return {
      status: 200,
      payload: {
        unseen: new Set(unseen.map((item) => item.dream?.pair?.id ?? item.id)).size,
        active: enabled && !paused,
      },
    };
  });
  route("POST", "/api/dream/visit", (account) => ({
    status: 200,
    payload: { since: dream.visit(owner(account)) },
  }));
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
  /** A project route's answer, or its refusal. */
  const answer = (run: () => Record<string, unknown>) => {
    try {
      return { status: 200, payload: run() };
    } catch (error) {
      return refuse(error);
    }
  };
  const chatOf = (body: Record<string, unknown> | undefined) => {
    const chat = body?.chat;
    if (typeof chat !== "string" || !chat || chat.length > 300)
      throw Object.assign(new Error("Name the chat."), { status: 400 });
    return chat;
  };
  route("GET", "/api/dream/projects", (account) => ({
    status: 200,
    payload: { projects: projects.list(owner(account)) },
  }));
  route("POST", "/api/dream/projects", (account, { body }) =>
    answer(() => ({ project: projects.create(owner(account), projectPatch(body)) })),
  );
  // A chat's change (`?by=chat`) shows as one on the Dream page, beside its Undo.
  route("PUT", "/api/dream/projects/:projectId", (account, { params, query, body }) =>
    answer(() => ({
      project: projects.update(
        owner(account),
        params.projectId,
        projectPatch(body),
        query?.by === "chat" ? "chat" : "studio",
      ),
    })),
  );
  route("POST", "/api/dream/projects/:projectId/undo", (account, { params }) =>
    answer(() => ({ project: projects.undo(owner(account), params.projectId) })),
  );
  route("DELETE", "/api/dream/projects/:projectId", (account, { params }) =>
    answer(() => (projects.remove(owner(account), params.projectId), { ok: true })),
  );
  // MCP's: attach a chat to a project (null detaches), and read its project as it asks for work.
  route("POST", "/api/dream/projects/attach", (account, { body }) =>
    answer(() => {
      const projectId = body?.projectId;
      if (projectId !== null && typeof projectId !== "string")
        throw Object.assign(new Error("Choose a project, or null to detach."), { status: 400 });
      return { project: projects.attach(owner(account), chatOf(body), projectId) };
    }),
  );
  route("POST", "/api/dream/projects/activity", (account, { body }) =>
    answer(() => ({ project: projects.activity(owner(account), chatOf(body)) })),
  );
  // Library › Characters' suggested cards: Accept makes the card, Dismiss turns it down.
  route("GET", "/api/dream/suggestions", (account) => ({
    status: 200,
    payload: { suggestions: dream.suggestions(owner(account)) },
  }));
  route("POST", "/api/dream/suggestions/:suggestionId/accept", (account, { params }) =>
    answer(() => ({
      card: dream.accept(owner(account), account || undefined, params.suggestionId),
    })),
  );
  route("POST", "/api/dream/suggestions/:suggestionId/dismiss", (account, { params }) =>
    answer(() => (dream.dismiss(owner(account), params.suggestionId), { ok: true })),
  );
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
  route("DELETE", "/api/dream/discarded", (account) => ({
    status: 200,
    payload: { deleted: dream.deleteDiscards(owner(account)) },
  }));
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
