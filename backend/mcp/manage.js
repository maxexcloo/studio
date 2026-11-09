/**
 * MCP's tools for an account's own Studio, beside generation (mcp.js): its gallery, queue, Dream
 * and taste. Each action calls the route the UI calls with the account's own credential, so the
 * route's owner scoping and group features (Dream, LoRAs) apply exactly as in the app. Results are
 * named by refs or job ids this MCP owner already holds (from generate, search or queue list).
 */
import { z } from "zod";
import { terminalStatuses } from "../../shared/queue.ts";
import { maxAvoid, maxAvoids } from "../../shared/taste.ts";
import { mcpJson } from "./media.js";

const maxResults = 50;
const maxListed = 25;
const result = z.string().trim().min(1).max(200);
const short = (value, max = 120) => {
  const flat = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Registers gallery, queue, dream and taste. `tool` is mcp.js's helper, `media` its McpMedia,
 * `refs` the conversation's result scope and `resolve(value)` turns a ref into its job id.
 */
export function registerManageTools({ tool, server, media, owner, refs, resolve }) {
  const api = (method, route, body, signal) =>
    media.request(method, route, body, owner, { signal });
  /** A ref or job id this owner holds, as its job id. */
  const owned = (value) => {
    const id = resolve(value);
    media.own(owner, id);
    return id;
  };
  /** The account's jobs, as the route listed them, join this conversation's refs. */
  const handles = (ids) => {
    media.adopt(owner, refs, { jobs: ids.filter(Boolean) });
    return Object.fromEntries(ids.filter(Boolean).map((id) => [id, media.refOf(owner, refs, id)]));
  };

  tool(
    server,
    "gallery",
    "manage gallery",
    "Change the user's gallery when asked: star or unstar results, delete them with their files (only on request), or clear_failed. results: refs from generate or search; output_index picks one output, else all.",
    {
      action: z.enum(["star", "unstar", "delete", "clear_failed"]),
      results: z.array(result).min(1).max(maxResults).optional(),
      output_index: z.number().int().min(0).max(999).optional(),
    },
    async ({ action, results, output_index }, signal) => {
      if (action === "clear_failed") {
        if (results) throw new Error("clear_failed takes no results.");
        const { cleared = 0 } = await api("POST", "/api/gallery/errors/clear", {}, signal);
        return mcpJson({ cleared });
      }
      if (!results) throw new Error(`Pass results: the refs or job_ids to ${action}.`);
      const ids = [...new Set(results.map(owned))];
      const urls = [];
      for (const id of ids) {
        const { items = [] } = await api(
          "GET",
          `/api/gallery/jobs/${encodeURIComponent(id)}`,
          undefined,
          signal,
        );
        for (const item of items)
          if (item.url && (output_index === undefined || (item.index ?? 0) === output_index))
            urls.push(item.url);
      }
      if (!urls.length) throw new Error("None of these results has that output in the gallery.");
      const changed = ids.map((id) => media.refOf(owner, refs, id) || id);
      if (action === "delete") {
        const { removed = [] } = await api("POST", "/api/gallery/delete", { ids: urls }, signal);
        return mcpJson({ deleted: removed.length, results: changed });
      }
      await api(
        "POST",
        "/api/gallery/favorite",
        { ids: urls, favorite: action === "star" },
        signal,
      );
      return mcpJson({
        [action === "star" ? "starred" : "unstarred"]: urls.length,
        results: changed,
      });
    },
    { destructiveHint: true },
  );

  tool(
    server,
    "queue",
    "manage queue",
    "The user's queue, when asked. list: unfinished and failed jobs with refs. pause holds new work (running work finishes), resume, cancel_all, clear_failed. retry or clear one failed job_id; move a waiting job_id to position (0 is next).",
    {
      action: z.enum([
        "list",
        "pause",
        "resume",
        "cancel_all",
        "clear_failed",
        "retry",
        "clear",
        "move",
      ]),
      job_id: result.optional(),
      position: z.number().int().min(0).max(999).optional(),
    },
    async ({ action, job_id, position }, signal) => {
      const single = ["retry", "clear", "move"].includes(action);
      if (single !== Boolean(job_id))
        throw new Error(
          single ? `Pass job_id: the job to ${action}.` : `${action} takes no job_id.`,
        );
      if ((action === "move") !== (position !== undefined))
        throw new Error(action === "move" ? "Pass position: 0 is next." : "position is for move.");
      if (action === "list") {
        const { jobs = [], paused = {} } = await api("GET", "/api/queue", undefined, signal);
        const listed = jobs.filter(
          (job) => !terminalStatuses.has(job.status) || job.status === "failed",
        );
        const named = handles(listed.map((job) => job.id));
        return mcpJson({
          paused: Boolean(paused.mine),
          ...(paused.all ? { paused_by_administrator: true } : {}),
          total: listed.length,
          jobs: listed.slice(0, maxListed).map((job) => ({
            ...(named[job.id] ? { ref: named[job.id] } : {}),
            job_id: job.id,
            status: job.status,
            ...(job.reason ? { reason: short(job.reason, 200) } : {}),
            kind: job.input?.kind || "image",
            ...(job.input?.prompt ? { prompt: short(job.input.prompt) } : {}),
            created_at: job.createdAt,
          })),
        });
      }
      if (!single) {
        const route = { cancel_all: "cancel-all", clear_failed: "clear-failed" }[action] || action;
        const answer = await api("POST", `/api/queue/${route}`, {}, signal);
        if (action === "cancel_all")
          return mcpJson({
            cancelled: (answer.outcomes || []).filter((outcome) => outcome.cancelRequested).length,
            ...(answer.outcomes?.some((outcome) => outcome.error)
              ? { note: "Some jobs could not confirm their cancel; check queue list." }
              : {}),
          });
        return mcpJson({ [action]: true, ...answer });
      }
      const id = owned(job_id);
      const route = `/api/queue/${encodeURIComponent(id)}/${action}`;
      const answer = await api("POST", route, action === "move" ? { to: position } : {}, signal);
      if (action !== "retry") return mcpJson({ job_id: id, [action]: true });
      const retried = answer.job?.id || id;
      const ref = handles([retried])[retried];
      return mcpJson({
        job_id: retried,
        ...(ref ? { ref } : {}),
        link: media.pageUrl(owner, retried),
        status: answer.job?.status || "queued",
      });
    },
    { destructiveHint: true },
  );

  const dreamItem = (item, named) => ({
    item_id: item.id,
    ...(named[item.jobId] ? { ref: named[item.jobId] } : {}),
    type: item.type,
    ...(item.prompt || item.dream?.prompt
      ? { prompt: short(item.prompt || item.dream.prompt) }
      : {}),
    ...(item.dream?.pair
      ? { pair_id: item.dream.pair.id, side: item.dream.pair.side, label: item.dream.pair.label }
      : {}),
    ...(item.jobId ? { link: media.url(owner, item.jobId, item.index || 0) } : {}),
  });
  const dreamItems = (items) => {
    const named = handles([...new Set(items.map((item) => item.jobId))]);
    return items.slice(0, maxListed).map((item) => dreamItem(item, named));
  };
  tool(
    server,
    "dream",
    "dream",
    "The user's Dream (background images from their taste; needs the Dream feature), when asked. status: settings, today's counts, unseen items. keep, discard, more (keep and steer toward it) or variations (count new seeds) take an item_id; answer takes a pair_id and answer. settings sets any of enabled, paused, videos, spicy, buffer, dailyImages, dailyVideos. discarded lists discards.",
    {
      action: z.enum([
        "status",
        "keep",
        "discard",
        "more",
        "variations",
        "answer",
        "settings",
        "discarded",
      ]),
      item_id: z.string().trim().min(1).max(400).optional(),
      pair_id: z.string().trim().min(1).max(200).optional(),
      answer: z.enum(["a", "b", "both", "neither"]).optional(),
      count: z.number().int().min(1).max(8).default(4),
      // Dream's settings route checks each name and range.
      settings: z.record(z.string(), z.union([z.boolean(), z.number()])).optional(),
    },
    async ({ action, item_id, pair_id, answer, count, settings }, signal) => {
      const show = (dream) => ({
        status: dream.status,
        ...(dream.reason ? { reason: dream.reason } : {}),
        settings: dream.settings,
        today: dream.today,
        spicy_available: Boolean(dream.spicyAvailable),
        unseen: (dream.unseen || []).length,
        items: dreamItems(dream.unseen || []),
      });
      if (action === "status")
        return mcpJson(show(await api("GET", "/api/dream", undefined, signal)));
      if (action === "discarded") {
        const { items = [] } = await api("GET", "/api/dream/discarded?limit=25", undefined, signal);
        return mcpJson({ items: dreamItems(items) });
      }
      if (action === "settings") {
        if (!settings || !Object.keys(settings).length)
          throw new Error("Pass settings: the Dream settings to change.");
        return mcpJson(show(await api("PUT", "/api/dream/settings", settings, signal)));
      }
      if (action === "answer") {
        if (!pair_id || !answer)
          throw new Error("Pass pair_id and answer (a, b, both or neither).");
        const { items = [] } = await api(
          "POST",
          `/api/dream/pairs/${encodeURIComponent(pair_id)}/answer`,
          { answer },
          signal,
        );
        return mcpJson({
          kept: items.filter((item) => item.dream?.state === "kept").map((item) => item.id),
        });
      }
      if (!item_id) throw new Error(`Pass item_id from dream status to ${action}.`);
      const route = `/api/dream/${encodeURIComponent(item_id)}/${action}`;
      const done = await api("POST", route, action === "variations" ? { count } : {}, signal);
      if (action !== "variations")
        return mcpJson({ item_id, [action === "more" ? "kept" : action]: true });
      const ref = handles([done.jobId])[done.jobId];
      return mcpJson({
        item_id,
        kept: true,
        job_id: done.jobId,
        ...(ref ? { ref } : {}),
        link: media.pageUrl(owner, done.jobId),
      });
    },
  );

  tool(
    server,
    "taste",
    "taste & lora ratings",
    "The user's taste profile, when asked: read, save (avoid replaces what they asked Studio to avoid), refresh (summarise stars, Dream and comparisons now) or reset. rate_lora sets a LoRA (name from models) up, down or none; needs the LoRAs feature.",
    {
      action: z.enum(["read", "save", "refresh", "reset", "rate_lora"]).default("read"),
      avoid: z.array(z.string().trim().min(1).max(maxAvoid)).max(maxAvoids).optional(),
      lora: z.string().trim().min(1).max(400).optional(),
      rating: z.enum(["up", "down", "none"]).optional(),
    },
    async ({ action, avoid, lora, rating }, signal) => {
      if (action === "rate_lora") {
        if (!lora || !rating) throw new Error("Pass lora (its name from models) and rating.");
        const { library = {} } = await api(
          "POST",
          "/api/loras/library/ops",
          { ops: [{ op: "rating", name: lora, rating: rating === "none" ? null : rating }] },
          signal,
        );
        return mcpJson({ lora, rating: library.ratings?.[lora] || "none" });
      }
      if (action === "save" && avoid === undefined)
        throw new Error("Pass avoid: everything the user asks Studio to avoid.");
      const answer =
        action === "read"
          ? await api("GET", "/api/taste", undefined, signal)
          : action === "save"
            ? await api("PUT", "/api/taste", { avoid }, signal)
            : action === "refresh"
              ? await api("POST", "/api/taste/refresh", {}, signal)
              : await api("DELETE", "/api/taste", undefined, signal);
      return mcpJson({
        summary: answer.summary || "",
        likes: answer.likes,
        styles: answer.styles,
        avoid: answer.avoid,
        added_avoid: answer.addedAvoid,
        updated_at: answer.updatedAt,
        signals: answer.signals,
      });
    },
  );
}
