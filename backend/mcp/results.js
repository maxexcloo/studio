// MCP's tools for finished and running work: status, results, search, handover, review, cancel and uploads.
import { z } from "zod";

import { maxJobsPerCall, maxSplitJobs } from "./controls.js";
import {
  comparisonContext,
  maxUploadBase64,
  maxUploadMegabytes,
  mcpJson,
  mcpOutputPath,
  readyIn,
  uploadLinkMinutes,
} from "./media.js";

// The status and result tools wait briefly at most: a chat waiting on a tool blocks its turn.
const wait = z.number().int().min(0).max(20).default(0);
// A YYYY-MM-DD date, without z.iso.date's long pattern in the schema every chat step resends.
const date = z.string().regex(/^\d{4}-\d\d-\d\d$/);
export const job = {
  job_id: z.string().min(1).max(200).describe('A ref such as "result 3", or a job_id.'),
};
export const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };

// The prompt a result ran, as the chat shows it; status and reuse replies give the full text.
export const shortPrompt = (prompt, max = 200) => {
  const flat = String(prompt).replace(/\s+/g, " ").trim();
  return (flat.length > max ? `${flat.slice(0, max - 1)}…` : flat).replace(
    /[\\`*_[\]<>#|]/g,
    "\\$&",
  );
};

export function registerResultTools({
  tool,
  server,
  media,
  actor,
  resolveOutput,
  reviewWaitSeconds,
}) {
  const { owner, refs } = actor;
  const resolve = async (value, signal) => (await resolveOutput(value, signal)).jobId;
  /** A value's job output: the output its number names, else `index`. */
  const target = async (value, index, signal) => {
    const found = await resolveOutput(value, signal);
    return { jobId: found.jobId, index: index || found.index || 0 };
  };
  tool(
    server,
    "status",
    "check status",
    "Status, full prompt, outputs and comparison winner, for reuse.",
    { ...job, wait_seconds: wait },
    async ({ job_id, wait_seconds }, signal) => {
      const id = await resolve(job_id, signal);
      const status = await media.job(owner, id, wait_seconds, { signal });
      const ref = media.refOf(id);
      const comparisons = await media.comparisons(owner, [id], { scope: refs, signal });
      const prompt = media.promptRecord(id)?.prompt || status.prompt;
      return mcpJson({
        job_id: id,
        ...(ref ? { ref } : {}),
        link: media.pageUrl(owner, id),
        ...media.summary(status),
        ...(prompt ? { prompt } : {}),
        ...(comparisons.length ? { comparisons } : {}),
        outputs: (status.outputs || []).flatMap((item, index) =>
          mcpOutputPath(item.url)
            ? [
                {
                  ...media.outputFeedback(id, index, item.rating),
                  url: media.url(owner, id, index),
                },
              ]
            : [],
        ),
      });
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "result",
    "show result",
    'Show results as markdown to reply with, only when the user asks ("show #3", a set, or "all" for this chat\'s). A running job returns its link: share it and stop; never poll, repeat or background this.',
    {
      job_id: z.string().min(1).max(200),
      wait_seconds: wait,
    },
    async ({ job_id, wait_seconds }, signal) => {
      if (/^\s*all\s*$/i.test(job_id)) return media.resultsAll(owner, refs, { signal });
      const set = media.setOutputs(owner, refs, job_id);
      if (set)
        return media.resultsAll(owner, refs, {
          signal,
          jobIds: [...new Set(set.map(({ jobId }) => jobId))],
        });
      return media.result(owner, await resolve(job_id, signal), wait_seconds, {
        scope: refs,
        signal,
      });
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "search",
    "search gallery",
    "Search the user's whole gallery by words, file name or look, with refs (♥ liked); filter by liked, disliked, model or lora (part of a name), aspect or before/after a date; cursor pages. summary: what all matches share. uploads: the user's uploads, as reference_asset_ids.",
    {
      query: z.string().trim().max(200).default(""),
      kind: z.enum(["image", "video"]).optional(),
      liked: z.boolean().default(false),
      disliked: z.boolean().default(false),
      model: z.string().trim().max(200).optional(),
      lora: z.string().trim().max(200).optional(),
      aspect: z.enum(["landscape", "portrait", "square"]).optional(),
      uploads: z.boolean().default(false),
      summary: z.boolean().default(false),
      limit: z
        .number()
        .int()
        .min(1)
        .max(24, "limit is at most 24; pass the reply's cursor for the next page.")
        .default(8),
      before: date.optional(),
      after: date.optional(),
      cursor: z.string().trim().optional(),
    },
    async ({ liked, disliked, summary, ...args }, signal) => {
      if (liked && disliked) throw new Error("Pass liked or disliked, not both.");
      const rating = liked ? "liked" : disliked ? "disliked" : undefined;
      if (summary) {
        const found = await media.searchSummary(owner, { ...args, rating }, { signal });
        const list = (entries) =>
          entries.map(({ name, count }) => `${name} (${count})`).join(", ") || "none";
        return {
          content: [
            {
              type: "text",
              text: `${found.count}${found.more ? "+" : ""} ${rating || "matching"} results. Profiles: ${list(found.profiles)}. LoRAs: ${list(found.loras)}. Subjects: ${list(found.subjects)}.`,
            },
          ],
          structuredContent: found,
        };
      }
      const { hits, total, cursor } = await media.search(
        owner,
        refs,
        { ...args, rating },
        { signal },
      );
      if (!hits.length)
        return {
          content: [{ type: "text", text: "Nothing in the gallery matches." }],
          structuredContent: { results: [] },
        };
      if (args.uploads) {
        const results = hits.map((item) => ({
          reference_asset_id: item.assetId,
          name: item.filename || "",
          created_at: item.createdAt || "",
        }));
        const lines = hits.map((item) =>
          [
            `- ${item.assetId}`,
            item.filename,
            String(item.createdAt || "").slice(0, 10),
            (item.caption?.text || item.suggestedPrompt) &&
              shortPrompt(item.caption?.text || item.suggestedPrompt, 80),
          ]
            .filter(Boolean)
            .join(" · "),
        );
        return {
          content: [
            {
              type: "text",
              text: `${hits.length === 1 ? "One upload" : `${hits.length} uploads`}, newest first. Pass one to generate in reference_asset_ids.\n\n${lines.join("\n")}`,
            },
          ],
          structuredContent: { results },
        };
      }
      const comparisons = await media.comparisons(
        owner,
        hits.map((item) => item.jobId),
        {
          scope: refs,
          signal,
        },
      );
      // Each output by its own number, which reuse and review take alone.
      const results = hits.map((item) => ({
        ref: item.number ? `#${item.number}` : media.refOf(item.jobId) || item.jobId,
        job_id: item.jobId,
        output_index: item.index,
        link: media.url(owner, item.jobId, item.index),
        rating: item.rating || "unrated",
      }));
      // A line each: its ref, then a gist; Details and the link keep the whole prompt.
      const lines = hits.map((item, position) => {
        const { ref, link } = results[position];
        return [
          `- [${ref}](${link})${item.rating === "liked" ? " ♥" : ""}`,
          `user feedback: ${item.rating || "unrated"}`,
          shortPrompt(item.title || item.prompt || "", 80),
          item.settings?.modelName || item.model || item.settings?.profileId,
          String(item.createdAt || "").slice(0, 10),
        ]
          .filter(Boolean)
          .join(" · ");
      });
      // The images as one picture, in the order listed; it is drawn only when opened.
      const images = hits.filter((item) => item.type === "image");
      const picture = !images.length
        ? ""
        : `\n\n![Matching images in order](${
            images.length === 1
              ? media.previewUrl(owner, images[0].jobId, images[0].index)
              : media.sheetUrl(
                  owner,
                  images.map((item) => [item.jobId, item.index]),
                )
          })`;
      const counted =
        total === undefined
          ? `${hits.length === 1 ? "One match" : `${hits.length} matches`}`
          : `${hits.length} of ${total} matches`;
      return {
        content: [
          {
            type: "text",
            text: [
              `${counted}, newest first${cursor ? `; pass cursor "${cursor}" for more` : ""}. Pass a ref (and output_index for a later output) to reuse, review or result.\n\n${lines.join("\n")}${picture}`,
              comparisonContext(comparisons),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        structuredContent: {
          ...(total === undefined ? {} : { total }),
          ...(cursor ? { cursor } : {}),
          results,
          ...(comparisons.length ? { comparisons } : {}),
        },
      };
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "handover",
    "copy chat summary",
    "A copy-paste summary for a new chat, when asked or when the host reports about 90% context used. Pass decisions and unfinished work as summary.",
    {
      summary: z.string().trim().min(1).max(12000),
    },
    async ({ summary }, signal) => {
      const jobs = (await media.scopeJobs(owner, refs, { signal }))
        .filter(
          ({ job }) =>
            !["done", "completed", "succeeded"].includes(job.status) ||
            job.outputs?.some((output) => mcpOutputPath(output.url)),
        )
        .slice(-12);
      const results = jobs.map(
        ({ jobId, number, job }) =>
          `- Result ${number}: job_id ${jobId} (${job.status}) — ${media.pageUrl(owner, jobId)}`,
      );
      const comparisons = await media.comparisons(
        owner,
        jobs.map(({ jobId }) => jobId),
        {
          scope: refs,
          signal,
        },
      );
      const handover = [
        "Continue this Studio task.",
        "",
        summary,
        "",
        "Studio Results",
        ...results,
        ...comparisons
          .filter(({ winner }) => winner)
          .map(
            ({ link, winner }) =>
              `- Comparison winner: job_id ${winner.job_id}, output_index ${winner.output_index} — ${link}`,
          ),
        "",
        "Use the job_id values above in the new chat; result numbers are local to the old chat. Do not regenerate or poll unless asked.",
      ].join("\n");
      return { content: [{ type: "text", text: handover }] };
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "review",
    "review image",
    "Inspect images only when asked to judge, compare or improve; compare_to sets one beside it; also reviews more; a set ref reviews its images.",
    {
      ...output,
      compare_to: z.string().min(1).max(200).optional(),
      compare_to_output_index: z.number().int().min(0).max(999).default(0),
      also: z
        .array(z.string().min(1).max(200))
        .max(
          maxJobsPerCall - 1,
          `also takes at most ${maxJobsPerCall - 1} images; review the rest in another call only if asked.`,
        )
        .optional()
        .describe("One image each."),
    },
    async ({ job_id, output_index, compare_to, compare_to_output_index, also = [] }, signal) => {
      // A whole set's ref stands for each of its images.
      const entries = [job_id, ...also].flatMap((value, place) => {
        const whole = media.setOutputs(owner, refs, value);
        return whole
          ? whole.map(({ jobId, index }) => ({
              label: `${media.refOf(jobId) || value}${String.fromCharCode(97 + index)}`,
              target: { jobId, index },
            }))
          : [{ label: value, value, index: place ? 0 : output_index }];
      });
      const shown = entries.slice(0, maxSplitJobs);
      const resolved = async ({ target: known, value, index }) =>
        known || (await target(value, index, signal));
      // One call for many results keeps the chat's tool steps narrow; LibreChat shrinks every
      // earlier tool call it keeps in context by the widest parallel step.
      const [first, ...rest] = shown;
      const groups = [
        {
          label: first.label,
          targets: [
            await resolved(first),
            ...(compare_to ? [await target(compare_to, compare_to_output_index, signal)] : []),
          ],
        },
        ...(await Promise.all(
          rest.map(async (entry) => {
            try {
              return { label: entry.label, targets: [await resolved(entry)] };
            } catch (error) {
              return { label: entry.label, error: error.message };
            }
          }),
        )),
      ];
      // Work about to finish is waited for briefly, together; the rest is listed with its wait.
      const jobs = await media.settle(
        owner,
        [...new Set(groups.flatMap(({ targets = [] }) => targets.map(({ jobId }) => jobId)))],
        reviewWaitSeconds,
        { signal },
      );
      const unfinished = ({ targets = [] }) =>
        targets.filter(({ jobId }) => !jobs.get(jobId).done).map(({ jobId }) => jobId);
      const ready = groups.filter((group) => !group.error && !unfinished(group).length);
      // Several results go as one picture: chats such as LibreChat keep only the first few images
      // a tool returns. One that can't be reviewed falls back to an answer each.
      const together =
        ready.length > 1
          ? await media
              .review(
                owner,
                ready.flatMap(({ targets }) => targets),
                { scope: refs, signal },
              )
              .catch((error) => {
                if (signal.aborted) throw error;
                return null;
              })
          : null;
      const replies = together
        ? [together]
        : await Promise.all(
            ready.map(async (group, index) => {
              if (groups.length === 1)
                return media.review(owner, group.targets, { scope: refs, signal });
              try {
                return await media.review(owner, group.targets, {
                  scope: refs,
                  signal,
                  brief: !index,
                });
              } catch (error) {
                return { content: [{ type: "text", text: `${group.label}: ${error.message}` }] };
              }
            }),
          );
      const failed = groups
        .filter((group) => group.error)
        .map(({ label, error }) => ({ type: "text", text: `${label}: ${error}` }));
      const waiting = [...new Set(groups.flatMap(unfinished))].map((jobId) => {
        const job = jobs.get(jobId);
        const left = Number.isFinite(job.progress?.endsAt)
          ? Math.max(0, job.progress.endsAt - Date.now())
          : 0;
        const ref = media.refOf(jobId);
        return {
          job_id: jobId,
          ...(ref ? { ref } : {}),
          status: job.status || "running",
          line: `[${ref || "Result"}](${media.pageUrl(owner, jobId)}) ${job.status || "running"}${readyIn(left, job.ahead)}`,
          ...(left ? { eta_seconds: Math.round(left / 1000) } : {}),
          ...(Number.isInteger(job.ahead) ? { jobs_ahead: job.ahead } : {}),
        };
      });
      const pending = waiting.length
        ? [
            {
              type: "text",
              text: `Not finished yet, so not reviewed: ${waiting.map(({ line }) => line).join("; ")}. ${ready.length ? "Reply with the review of the rest and" : "Reply now with the links and"} offer to review these once done; do not poll.`,
            },
          ]
        : [];
      const more =
        entries.length > shown.length
          ? [
              {
                type: "text",
                text: `Reviewed the first ${shown.length} of ${entries.length} images; review the rest in another call if asked.`,
              },
            ]
          : [];
      return {
        content: [...replies.flatMap((reply) => reply.content), ...failed, ...pending, ...more],
        ...(waiting.length
          ? { structuredContent: { waiting: waiting.map(({ line: _line, ...item }) => item) } }
          : {}),
      };
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "cancel",
    "cancel",
    "Cancel a job when the user asks.",
    job,
    async ({ job_id }, signal) => {
      const id = await resolve(job_id, signal);
      media.own(owner, id);
      return mcpJson(
        await media.request("POST", `/api/jobs/${encodeURIComponent(id)}/cancel`, {}, owner),
      );
    },
    { destructiveHint: true },
  );
  tool(
    server,
    "upload",
    "upload reference",
    `Upload a PNG, JPEG or WebP reference image (base64, at most ${maxUploadMegabytes} MB).`,
    {
      // Left unbounded below so an empty file gets upload's own advice, not a schema refusal.
      content_base64: z.string().max(maxUploadBase64),
      filename: z.string().default("reference.png"),
    },
    async ({ content_base64, filename }) =>
      mcpJson(await media.upload(owner, content_base64, filename)),
  );
  tool(
    server,
    "upload_link",
    "upload link",
    "A one-time page where the user uploads an image attached in chat, with its reference_asset_id.",
    {},
    async () => {
      const { url, expires, reference } = media.uploadUrl(owner);
      return {
        content: [
          {
            type: "text",
            text: `Ask the user to open this link and upload the photo they attached. Once they have, pass ${reference} to generate in reference_asset_ids. It works once, for ${uploadLinkMinutes} minutes.\n\n[Upload Photo](${url})`,
          },
        ],
        structuredContent: {
          link: url,
          reference_asset_id: reference,
          expires_at: new Date(expires).toISOString(),
        },
      };
    },
  );
}
