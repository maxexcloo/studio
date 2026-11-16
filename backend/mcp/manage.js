/**
 * MCP's tools for an account's own Studio, beside generation (mcp.js): its gallery, queue, Dream,
 * cards and taste. Each action calls the route the UI calls with the account's own credential,
 * so the route's owner scoping and group features (Dream, Characters, LoRAs) apply exactly as in
 * the app. Results are named by refs or job ids this MCP owner already holds (from generate,
 * search or queue list).
 */
import { z } from "zod";

import {
  cardKinds,
  characterTraits,
  maxCardDescription,
  maxCardName,
  maxCharacterImages,
} from "../../shared/characters.ts";
import { terminalStatuses } from "../../shared/queue.ts";
import { shapeName } from "../../shared/taste.ts";
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

/** The card named by `value`: its id, or its name in any case. */
export const findCard = (cards, value) => {
  const wanted = value.trim();
  return (
    cards.find((card) => card.id === wanted) ||
    cards.find((card) => card.name.toLowerCase() === wanted.toLowerCase())
  );
};

/**
 * Registers gallery, queue, dream, cards and taste. `tool` is mcp.js's helper, `media` its McpMedia,
 * `refs` the conversation's result scope, `chat` its conversation id ("" when the client sends
 * none), `resolve(value)` resolves a ref into its job id and `referenceAsset(value)` a result's
 * number or letter, or an asset id, into a reference asset id.
 */
export function registerManageTools({
  tool,
  server,
  media,
  owner,
  refs,
  chat,
  resolve,
  resolveOutput,
  referenceAsset,
}) {
  const api = (method, route, body, signal) =>
    media.request(method, route, body, owner, { signal });
  /** A ref or job id this owner holds, as its job id. */
  const owned = async (value) => {
    const id = await resolve(value);
    media.own(owner, id);
    return id;
  };
  /** The account's jobs, as the route listed them, join this conversation's refs. */
  const handles = (ids) => {
    media.adopt(owner, refs, { jobs: ids.filter(Boolean) });
    return Object.fromEntries(ids.filter(Boolean).map((id) => [id, media.refOf(id)]));
  };

  tool(
    server,
    "gallery",
    "manage gallery",
    'Change the user\'s gallery when asked: like, dislike (hides) or clear_rating results the user picks, delete them with their files (only on request), or clear_failed. results: refs from generate or search, a letter picking one output ("#12b", "set 3 B"), else output_index, else all.',
    {
      action: z.enum(["like", "dislike", "clear_rating", "delete", "clear_failed"]),
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
      // A ref with an output letter ("#12b") names that output alone, else output_index, else all.
      // A whole set's ref ("set 3") names each of its images; "set 3 2c" one of them.
      const picks = (
        await Promise.all(
          results.map(async (value) => {
            const found = media.setOutputs(owner, refs, value) || [
              await resolveOutput(value, signal),
            ];
            for (const { jobId } of found) media.own(owner, jobId);
            return found.map(({ jobId, index, output }) => ({
              jobId,
              index: output ? index : output_index,
            }));
          }),
        )
      ).flat();
      const ids = [...new Set(picks.map((pick) => pick.jobId))];
      const urls = [];
      for (const id of ids) {
        const { items = [] } = await api(
          "GET",
          `/api/gallery/jobs/${encodeURIComponent(id)}`,
          undefined,
          signal,
        );
        const wanted = picks.filter((pick) => pick.jobId === id).map((pick) => pick.index);
        for (const item of items)
          if (
            item.url &&
            (wanted.includes(undefined) || wanted.includes(item.index ?? 0)) &&
            !urls.includes(item.url)
          )
            urls.push(item.url);
      }
      if (!urls.length) throw new Error("None of these results has that output in the gallery.");
      const changed = ids.map((id) => media.refOf(id) || id);
      if (action === "delete") {
        const { removed = [] } = await api("POST", "/api/gallery/delete", { ids: urls }, signal);
        return mcpJson({ deleted: removed.length, results: changed });
      }
      await api(
        "POST",
        "/api/gallery/favorite",
        { ids: urls, rating: { like: "liked", dislike: "disliked" }[action] ?? null },
        signal,
      );
      return mcpJson({
        [{ like: "liked", dislike: "disliked" }[action] ?? "cleared"]: urls.length,
        results: changed,
      });
    },
    { destructiveHint: true },
  );

  tool(
    server,
    "queue",
    "manage queue",
    "The user's queue, when asked. list: unfinished and failed jobs with refs. pause holds new work, resume, cancel_all (this chat's work; scope \"account\" only if the user asks for all), clear_failed. retry or clear one failed job_id; move a waiting job_id to position (0 is next).",
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
      scope: z.enum(["chat", "account"]).optional(),
    },
    async ({ action, job_id, position, scope }, signal) => {
      const single = ["retry", "clear", "move"].includes(action);
      if (single !== Boolean(job_id))
        throw new Error(
          single ? `Pass job_id: the job to ${action}.` : `${action} takes no job_id.`,
        );
      if ((action === "move") !== (position !== undefined))
        throw new Error(action === "move" ? "Pass position: 0 is next." : "position is for move.");
      if (scope && action !== "cancel_all") throw new Error("scope is for cancel_all.");
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
      if (action === "cancel_all") {
        const account = scope === "account";
        if (!account && !chat)
          throw new Error(
            'This chat sends no conversation id, so its own work can\'t be told apart. Pass scope "account" only if the user wants all their unfinished work stopped.',
          );
        const answer = await api(
          "POST",
          "/api/queue/cancel-all",
          account ? {} : { conversationId: chat },
          signal,
        );
        return mcpJson({
          scope: account ? "account" : "chat",
          cancelled: (answer.outcomes || []).filter(
            (outcome) =>
              !outcome.error && (outcome.job?.status === "cancelled" || outcome.cancelRequested),
          ).length,
          ...(answer.outcomes?.some((outcome) => outcome.error)
            ? { note: "Some jobs could not confirm their cancel; check queue list." }
            : {}),
        });
      }
      if (!single) {
        const route = action === "clear_failed" ? "clear-failed" : action;
        const answer = await api("POST", `/api/queue/${route}`, {}, signal);
        return mcpJson({ [action]: true, ...answer });
      }
      const id = await owned(job_id);
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
    media.noteNumbers(items);
    const named = handles([...new Set(items.map((item) => item.jobId))]);
    return items.slice(0, maxListed).map((item) => dreamItem(item, named));
  };
  tool(
    server,
    "dream",
    "dream",
    "The user's Dream (background images from their taste), when asked. status: settings, today's counts, unseen items. keep, discard, more (keep and steer to it) or variations (count new seeds) take item_id; answer takes pair_id and answer. settings sets enabled, paused, images, videos, spicy, dailyImages, dailyVideos, except those an administrator locked. discarded lists discards.",
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
        ...(dream.locked?.length ? { locked: dream.locked } : {}),
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

  /** A card's images that still exist, as the route lists them. */
  const imageIds = (card) => (card.references || []).map((asset) => asset.id);
  const story = (card) =>
    Object.fromEntries(
      ["age", ...characterTraits].filter((key) => card[key]).map((key) => [key, card[key]]),
    );
  const shownCard = (card) => ({
    id: card.id,
    name: card.name,
    ...(card.description ? { description: card.description } : {}),
    ...story(card),
    image_ids: imageIds(card),
    ...(card.portrait ? { portrait: card.portrait.status } : {}),
  });
  tool(
    server,
    "cards",
    "manage cards",
    "The user's character, outfit and scene cards, when asked. list (one with id); create, or update by id or name: name, description, image_ids (reference_asset_ids or result numbers; a character 1–4, clearest first, an outfit or scene 0–1). describe writes one from the first image; rate scores each 1–5 as a reference.",
    {
      action: z.enum(["list", "create", "update", "describe", "rate"]),
      kind: z.enum(Object.keys(cardKinds)),
      id: z.string().trim().min(1).max(200).optional(),
      name: z.string().trim().min(1).max(maxCardName).optional(),
      description: z.string().trim().max(maxCardDescription).optional(),
      image_ids: z.array(z.string().trim().min(1).max(200)).max(maxCharacterImages).optional(),
    },
    async ({ action, kind, id, name, description, image_ids: named }, signal) => {
      const noun = cardKinds[kind].name;
      const list = async () => (await api("GET", `/api/${kind}`, undefined, signal))[kind] || [];
      if (action === "list") {
        if (!id) return mcpJson({ [kind]: (await list()).map(shownCard) });
        const card = findCard(await list(), id);
        if (!card) throw new Error(`No ${noun} "${id}". Call cards list to see them.`);
        return mcpJson({ [noun]: shownCard(card) });
      }
      const image_ids =
        named && (await Promise.all(named.map((value) => referenceAsset(value, signal))));
      if (action === "describe" || action === "rate") {
        if (!image_ids?.length) throw new Error(`Pass image_ids to ${action}.`);
        if (action === "describe") {
          const { description: written } = await api(
            "POST",
            "/api/assistant/cards/describe",
            { kind, assetId: image_ids[0] },
            signal,
          );
          return mcpJson({ description: written });
        }
        const { ratings = [] } = await api(
          "POST",
          "/api/assistant/cards/rate",
          { kind, assetIds: image_ids },
          signal,
        );
        return mcpJson({
          ratings: ratings.map((item, index) => ({ image_id: image_ids[index], ...item })),
        });
      }
      let current = null;
      if (action === "update") {
        if (!id) throw new Error(`Pass id: the ${noun}'s id or name from list.`);
        current = findCard(await list(), id);
        if (!current) throw new Error(`No ${noun} "${id}". Call cards list to see them.`);
      }
      const saved = await api(
        current ? "PUT" : "POST",
        current ? `/api/${kind}/${encodeURIComponent(current.id)}` : `/api/${kind}`,
        {
          name: name ?? current?.name,
          description: description ?? current?.description ?? "",
          ...(current ? story(current) : {}),
          referenceIds: image_ids ?? (current ? imageIds(current) : []),
        },
        signal,
      );
      return mcpJson({ [noun]: shownCard(saved[noun]) });
    },
  );

  tool(
    server,
    "taste",
    "taste & lora ratings",
    "The user's learnt taste, when asked: read, refresh or reset. rate_lora sets a LoRA (name from models) like, dislike or none.",
    {
      action: z.enum(["read", "refresh", "reset", "rate_lora"]).default("read"),
      lora: z.string().trim().min(1).max(400).optional(),
      rating: z.enum(["like", "dislike", "none"]).optional(),
    },
    async ({ action, lora, rating }, signal) => {
      if (action === "rate_lora") {
        if (!lora || !rating) throw new Error("Pass lora (its name from models) and rating.");
        const { library = {} } = await api(
          "POST",
          "/api/loras/library/ops",
          {
            ops: [
              {
                op: "rating",
                name: lora,
                rating: { like: "liked", dislike: "disliked" }[rating] ?? null,
              },
            ],
          },
          signal,
        );
        return mcpJson({ lora, rating: library.ratings?.[lora] || "none" });
      }
      const answer =
        action === "read"
          ? await api("GET", "/api/taste", undefined, signal)
          : action === "refresh"
            ? await api("POST", "/api/taste/refresh", {}, signal)
            : await api("DELETE", "/api/taste", undefined, signal);
      return mcpJson({
        summary: answer.summary || "",
        likes: answer.likes,
        dislikes: answer.avoid,
        styles: answer.styles,
        models: answer.models,
        loras: answer.loras,
        shapes: answer.shapes?.map(shapeName),
        tags: answer.tags,
        user_set: Object.keys(answer.preferences || {}),
        updated_at: answer.updatedAt,
        signals: answer.signals,
      });
    },
  );
}
