// MCP's tools for finished and running work: status, results, search, handover, review, cancel and uploads.
import { z } from "zod";
import {
  mcpJson,
  comparisonContext,
  maxUploadBase64,
  maxUploadMegabytes,
  mcpOutputPath,
  uploadLinkMinutes,
} from "./media.js";

// The status and result tools wait briefly at most: a chat waiting on a tool blocks its turn.
const wait = z.number().int().min(0).max(20).default(0);
export const job = {
  job_id: z.string().min(1).max(200).describe('A ref such as "result 3", or a job_id.'),
};
export const output = { ...job, output_index: z.number().int().min(0).max(999).default(0) };

// The prompt a result ran, as the chat shows it; the result page has the full text.
const maxShownPromptCharacters = 200;
export const shortPrompt = (prompt) => {
  const flat = String(prompt).replace(/\s+/g, " ").trim();
  return (
    flat.length > maxShownPromptCharacters
      ? `${flat.slice(0, maxShownPromptCharacters - 1)}…`
      : flat
  ).replace(/[\\`*_[\]<>#|]/g, "\\$&");
};

export function registerResultTools({ tool, server, media, actor, resolve, imageWaitSeconds }) {
  const { owner, refs } = actor;
  tool(
    server,
    "status",
    "check status",
    "Status, output links and chosen comparison winner, ready for reuse.",
    { ...job, wait_seconds: wait },
    async ({ job_id, wait_seconds }, signal) => {
      const id = resolve(job_id);
      const status = await media.job(owner, id, wait_seconds, { signal });
      const ref = media.refOf(owner, refs, id);
      const comparisons = await media.comparisons(owner, [id], { scope: refs, signal });
      return mcpJson({
        job_id: id,
        ...(ref ? { ref } : {}),
        link: media.pageUrl(owner, id),
        ...media.summary(status),
        ...(comparisons.length ? { comparisons } : {}),
        outputs: (status.outputs || []).flatMap((item, index) =>
          mcpOutputPath(item.url)
            ? [{ output_index: index, url: media.url(owner, id, index) }]
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
    'Show results as markdown to reply with, only when the user asks ("show result 3"; job_id "all" for this chat\'s). A running job returns its link: share it and stop; never poll, repeat or background this.',
    {
      job_id: z.string().min(1).max(200),
      wait_seconds: wait,
    },
    ({ job_id, wait_seconds }, signal) =>
      /^\s*all\s*$/i.test(job_id)
        ? media.resultsAll(owner, refs, { signal })
        : media.result(owner, resolve(job_id), wait_seconds, { scope: refs, signal }),
    { readOnlyHint: true },
  );
  tool(
    server,
    "search",
    "search gallery",
    "Search the user's whole gallery by words, file name or look, with refs for reuse, review and result (★ starred); filter by starred, model or lora (part of a name) or aspect. uploads: the user's uploads, as reference_asset_ids.",
    {
      query: z.string().trim().max(200).default(""),
      kind: z.enum(["image", "video"]).optional(),
      starred: z.boolean().default(false),
      model: z.string().trim().max(200).optional(),
      lora: z.string().trim().max(200).optional(),
      aspect: z.enum(["landscape", "portrait", "square"]).optional(),
      uploads: z.boolean().default(false),
      limit: z.number().int().min(1).max(24).default(8),
    },
    async (args, signal) => {
      const hits = await media.search(owner, refs, args, { signal });
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
              shortPrompt(item.caption?.text || item.suggestedPrompt),
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
      const results = hits.map((item) => ({
        ref: media.refOf(owner, refs, item.jobId),
        job_id: item.jobId,
        output_index: item.index,
        link: media.url(owner, item.jobId, item.index),
        starred: Boolean(item.favorite),
      }));
      const lines = hits.map((item, position) => {
        const { ref, output_index, link } = results[position];
        return [
          `- [${ref[0].toUpperCase()}${ref.slice(1)}${output_index ? ` output ${output_index}` : ""}](${link})${item.favorite ? " ★" : ""}`,
          item.title && shortPrompt(item.title),
          item.settings?.modelName || item.model || item.settings?.profileId,
          String(item.createdAt || "").slice(0, 10),
          item.prompt && shortPrompt(item.prompt),
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
      return {
        content: [
          {
            type: "text",
            text: [
              `${hits.length === 1 ? "One match" : `${hits.length} matches`}, newest first. Pass a ref (and output_index for a later output) to reuse, review or result.\n\n${lines.join("\n")}${picture}`,
              comparisonContext(comparisons),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        structuredContent: { results, ...(comparisons.length ? { comparisons } : {}) },
      };
    },
    { readOnlyHint: true },
  );
  tool(
    server,
    "handover",
    "copy chat summary",
    "A copy-paste summary for a new chat, when asked or when the host reports about 90% context used. Pass decisions, preferences and unfinished work as summary.",
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
    "Inspect images only when asked to judge, compare or improve; compare_to chooses another result.",
    {
      ...output,
      compare_to: z.string().min(1).max(200).optional(),
      compare_to_output_index: z.number().int().min(0).max(999).default(0),
    },
    ({ job_id, output_index, compare_to, compare_to_output_index }, signal) =>
      media.review(
        owner,
        [
          { jobId: resolve(job_id), index: output_index },
          ...(compare_to ? [{ jobId: resolve(compare_to), index: compare_to_output_index }] : []),
        ],
        { scope: refs, signal, waitSeconds: imageWaitSeconds },
      ),
    { readOnlyHint: true },
  );
  tool(
    server,
    "cancel",
    "cancel",
    "Cancel a job when the user asks.",
    job,
    async ({ job_id }) => {
      const id = resolve(job_id);
      media.own(owner, id);
      await media.job(owner, id);
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
    `Upload a PNG, JPEG or WebP reference image (base64, at most ${maxUploadMegabytes} MB) for generate.`,
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
