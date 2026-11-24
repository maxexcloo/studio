import {
  dreamDefaults,
  dreamPairAnswers,
  dreamPassReasons,
  dreamSeriesLength,
  dreamSettingError,
} from "../../shared/dream.ts";
import { maxDismissReason } from "../../shared/inbox.ts";
import type { ChatNotes } from "./chat-notes.ts";
import { type RouteAccount, type RouteRun, directRoute } from "./direct-route.ts";
import type { DreamDigestReader } from "./dream-digest.ts";
import type { Dream, DreamSettings, PairAnswer } from "./dream.ts";
import type { InboxStore } from "./inbox.ts";
import { type Projects, projectPatch } from "./projects.ts";

/** Fewer cards than this waiting in the deck start Dream's next work at once. */
const restockBelow = 6;

/** The caller's own Dream: settings, the unseen pool, verdicts, discards, projects and the Inbox. */
export function registerDreamRoutes(
  app: object,
  {
    dream,
    projects,
    inbox,
    digest,
    notes,
    listed,
  }: {
    dream: Dream;
    projects: Projects;
    inbox: InboxStore;
    digest: DreamDigestReader;
    notes: ChatNotes;
    /** The results as lists carry them, numbered (domain/result-numbers.ts) and without what Details reads. */
    listed: <T extends object>(items: T[]) => T[];
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
  const show = (ownerId: string) => {
    const access = dream.access(ownerId);
    const record = dream.read(ownerId);
    const unseen = listed(dream.unseen(ownerId));
    const daily = dream.daily(ownerId, record);
    const { today, usage } = daily;
    return {
      settings: record.settings,
      unseen,
      since: record.visit?.since || null,
      today,
      ...(usage.images !== today.images || usage.videos !== today.videos ? { usage } : {}),
      uncensoredAvailable: Boolean(access?.uncensored),
      locked: dream.locked(),
      ...dream.status(ownerId, daily),
    };
  };
  /**
   * A Dream route, for an account with Dream only. Any successful POST that leaves the deck nearly
   * empty starts Dream's next work now rather than at its next tick.
   */
  const route = (method: string, path: string, run: RouteRun) =>
    directRoute(app, method, path, async (account, input) => {
      const ownerId = owner(account);
      if (!dream.access(ownerId)) return refused;
      const answer = await run(account, input);
      if (
        method === "POST" &&
        answer.status < 400 &&
        dream.unseenCount(ownerId).unseen < restockBelow
      )
        dream.wake();
      return answer;
    });
  route("GET", "/api/dream", (account) => ({ status: 200, payload: show(owner(account)) }));
  route("GET", "/api/dream/history", (account, { query }) => ({
    status: 200,
    payload: {
      items: dream
        .history(owner(account))
        .filter(
          (entry) =>
            !query?.media ||
            (entry.item.media === query.media &&
              (!entry.other || entry.other.media === query.media)),
        ),
    },
  }));
  route("GET", "/api/dream/week", async (account) => {
    const { top, ...rest } = await digest(owner(account));
    return { status: 200, payload: { ...rest, top: listed(top) } };
  });
  // The header's badge counts cards waiting for a verdict.
  route("GET", "/api/dream/count", (account) => ({
    status: 200,
    payload: dream.unseenCount(owner(account)),
  }));
  // Pickers show these beside every profile and LoRA, so an account without Dream has none.
  directRoute(app, "GET", "/api/dream/keep-rates", (account) => ({
    status: 200,
    payload: dream.access(owner(account))
      ? dream.keepRates(owner(account))
      : { profiles: {}, loras: {}, tags: {} },
  }));
  route("POST", "/api/dream/visit", (account) => ({
    status: 200,
    payload: { since: dream.visit(owner(account)) },
  }));
  route("PUT", "/api/dream/settings", async (account, { body = {} }) => {
    const patch: Partial<DreamSettings> = {};
    for (const key of Object.keys(dreamDefaults) as (keyof DreamSettings)[]) {
      if (body[key] === undefined) continue;
      const error = dreamSettingError(key, body[key]);
      if (error) return { status: 400, payload: { ok: false, error } };
      Object.assign(patch, { [key]: body[key] });
    }
    if (patch.uncensored && !dream.access(owner(account))?.uncensored)
      return {
        status: 403,
        payload: { ok: false, error: "Uncensored themes need Uncensored Models for this account." },
      };
    try {
      await dream.save(owner(account), patch);
    } catch (error) {
      return refuse(error);
    }
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
  route("POST", "/api/dream/reset-limit", (account, { body }) => {
    const kind = body?.kind;
    if (kind !== "image" && kind !== "video")
      return { status: 400, payload: { ok: false, error: "Choose Images or Videos." } };
    const ownerId = owner(account);
    return answer(() => {
      dream.resetLimit(ownerId, kind);
      return show(ownerId);
    });
  });
  const chatOf = (body: Record<string, unknown> | undefined) => {
    const chat = body?.chat;
    if (typeof chat !== "string" || !chat || chat.length > 300)
      throw Object.assign(new Error("Name the chat."), { status: 400 });
    return chat;
  };
  // Each project's stats and share of turns, with its newest results.
  route("GET", "/api/dream/projects", (account) => ({
    status: 200,
    payload: {
      projects: projects.list(owner(account)),
      stats: Object.fromEntries(
        Object.entries(dream.projectStats(owner(account))).map(([id, stats]) => [
          id,
          { ...stats, results: listed(stats.results) },
        ]),
      ),
    },
  }));
  route("GET", "/api/dream/projects/:projectId/results", (account, { params }) => ({
    status: 200,
    payload: { items: listed(dream.projectResults(owner(account), params.projectId, 60)) },
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
        query?.by === "chat" ? "chat" : "you",
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
  // Chat Notes: context a chat gave (MCP), under the project that chat is attached to.
  route("GET", "/api/dream/notes", (account) => ({
    status: 200,
    payload: { notes: notes.list(owner(account)) },
  }));
  route("POST", "/api/dream/notes", (account, { body }) =>
    answer(() => {
      const ownerId = owner(account);
      const { chat, text, results, card } = body || {};
      const project = typeof chat === "string" ? projects.chats(ownerId)[chat]?.projectId : "";
      return { notes: notes.add(ownerId, { text, results, card, project }) };
    }),
  );
  route("DELETE", "/api/dream/notes/:noteId", (account, { params }) => ({
    status: 200,
    payload: { notes: notes.remove(owner(account), params.noteId) },
  }));
  // Dream › Projects' Inbox: Accept (with the person's edits) applies a proposal, Undo takes it
  // back, and Dismiss or Clear snooze proposals with an optional reason.
  const shown = <T extends { proposals: { evidence: object[]; drafts?: object[] }[] }>(
    value: T,
  ) => ({
    ...value,
    proposals: value.proposals.map((proposal) => ({
      ...proposal,
      evidence: listed(proposal.evidence),
      ...(proposal.drafts ? { drafts: listed(proposal.drafts) } : {}),
    })),
  });
  const reason = (body: Record<string, unknown> | undefined) => {
    const value = body?.reason ?? "";
    if (typeof value !== "string" || value.length > maxDismissReason)
      throw Object.assign(new Error(`Say why in at most ${maxDismissReason} characters.`), {
        status: 400,
      });
    return value;
  };
  /** An Inbox route's answer, or its refusal. */
  const inboxAnswer = async (run: () => Promise<object> | object) => {
    try {
      return { status: 200, payload: shown((await run()) as Parameters<typeof shown>[0]) };
    } catch (error) {
      return refuse(error);
    }
  };
  route("GET", "/api/dream/inbox", (account) => inboxAnswer(() => inbox.read(owner(account))));
  route("POST", "/api/dream/inbox/clear", (account, { body }) =>
    inboxAnswer(() => inbox.clear(owner(account), reason(body))),
  );
  route("POST", "/api/dream/inbox/:proposalId/accept", (account, { params, body }) =>
    inboxAnswer(() =>
      inbox.accept(owner(account), account || undefined, params.proposalId, body?.change),
    ),
  );
  route("POST", "/api/dream/inbox/:proposalId/dismiss", (account, { params, body }) =>
    inboxAnswer(() => inbox.dismiss(owner(account), params.proposalId, reason(body))),
  );
  route("POST", "/api/dream/inbox/:proposalId/undo", (account, { params }) =>
    inboxAnswer(() => inbox.undo(owner(account), params.proposalId)),
  );
  route("GET", "/api/dream/discarded", (account, { query }) => {
    const all = dream
      .discarded(owner(account))
      .filter((item) => !query?.media || item.type === query.media);
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
  route("POST", "/api/dream/pass", (account, { body }) => {
    const { ids, reason } = body || {};
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 3 ||
      ids.some((id) => typeof id !== "string" || !id) ||
      new Set(ids).size !== ids.length ||
      !dreamPassReasons.includes(reason)
    )
      return { status: 400, payload: { ok: false, error: "Choose a Pass reason." } };
    return answer(() => {
      dream.pass(owner(account), ids, reason);
      return { ok: true };
    });
  });
  route("POST", "/api/dream/pairs/:pairId/answer", (account, { params, body }) => {
    const { answer, like } = body || {};
    if (!dreamPairAnswers.includes(answer as PairAnswer))
      return { status: 400, payload: { ok: false, error: "Choose a side, all sides or none." } };
    if (
      like !== undefined &&
      (typeof like !== "boolean" || (like && (answer === "both" || answer === "neither")))
    )
      return { status: 400, payload: { ok: false, error: "Choose one side to like." } };
    try {
      return {
        status: 200,
        payload: { items: dream.answer(owner(account), params.pairId, answer as PairAnswer, like) },
      };
    } catch (error) {
      return refuse(error);
    }
  });
  route("POST", "/api/dream/sets/:setId/answer", (account, { body, params }) => {
    const { ids, verdict, likedId, overrides } = body || {};
    if (
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.length > dreamSeriesLength ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length ||
      (verdict !== "keep" && verdict !== "discard" && verdict !== "like") ||
      (likedId !== undefined && (verdict !== "like" || typeof likedId !== "string" || !likedId)) ||
      (overrides !== undefined &&
        (!overrides ||
          typeof overrides !== "object" ||
          Array.isArray(overrides) ||
          Object.values(overrides).some((choice) => choice !== "like" && choice !== "discard")))
    )
      return { status: 400, payload: { ok: false, error: "Choose a verdict for the set." } };
    return answer(() => {
      dream.answerSet(owner(account), params.setId, ids, verdict, likedId, overrides);
      return { ok: true };
    });
  });
  route("POST", "/api/dream/undo", (account, { body }) => {
    const { ids, rating, setId } = body || {};
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > (setId ? dreamSeriesLength : 3) ||
      ids.some((id) => typeof id !== "string") ||
      (setId !== undefined && (typeof setId !== "string" || !setId || rating !== undefined)) ||
      (rating !== undefined &&
        (ids.length !== 1 || (rating !== "liked" && rating !== "disliked" && rating !== null)))
    )
      return { status: 400, payload: { ok: false, error: "Undo a result, comparison or set." } };
    try {
      dream.undo(owner(account), ids, { rating, setId });
      return { status: 200, payload: { ok: true } };
    } catch (error) {
      return refuse(error);
    }
  });
  route("POST", "/api/dream/:itemId/super-like", (account, { params }) =>
    answer(() => ({ item: dream.superLike(owner(account), params.itemId) })),
  );
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
