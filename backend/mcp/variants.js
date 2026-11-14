// Lettered options: one result varied in one thing, side by side (domain/compare.ts), and the user's pick.
import { z } from "zod";
import { compareVariants } from "../../shared/compare.ts";
import { mcpJson } from "./media.js";

const letter = (index) => String.fromCharCode(65 + index);

/** Registers variants: offer lettered options of a result, or record which one the user picked. */
export function registerVariantsTool({ tool, server, media, owner, refs, chat, resolveOutput }) {
  tool(
    server,
    "variants",
    "offer variants",
    "Lettered options of one result varying one axis, side by side with its seed: each its full prompt with only that changed. pick records the user's letter or number for taste and the brief.",
    {
      result: z.string().min(1).optional(),
      axis: z.string().trim().min(1).max(40).optional(),
      options: z
        .array(z.object({ label: z.string().trim().min(1), prompt: z.string().trim().min(1) }))
        .min(compareVariants.min)
        .max(6)
        .optional(),
      pick: z.string().min(1).optional(),
    },
    async ({ result, axis, options, pick }, signal) => {
      if (pick) {
        const voted = await media.pick(owner, refs, await resolveOutput(pick, signal), signal);
        const winner = voted.variants.find(({ jobId }) => jobId === voted.vote);
        return mcpJson({
          picked: winner?.label,
          ...(voted.brief
            ? {
                brief: voted.brief,
                note: `Tell the user ${voted.brief.name}'s brief now keeps this ${voted.axis}; they can undo it on Studio's Dream page.`,
              }
            : {}),
        });
      }
      if (!result || !axis || !options)
        throw new Error("Pass result, axis and options to offer variants, or pick.");
      const found = await resolveOutput(result, signal);
      const item = await media.source(owner, found.jobId, found.index || 0);
      const project = chat
        ? await media
            .request("POST", "/api/dream/projects/activity", { chat }, owner, { signal })
            .then(
              (answer) => answer.project,
              () => null,
            )
        : null;
      const made = await media.request(
        "POST",
        "/api/comparisons/variants",
        { itemId: item.id, axis, ...(project ? { projectId: project.id } : {}), variants: options },
        owner,
        { signal },
      );
      const jobs = made.variants.map(({ jobId }) => jobId);
      media.adopt(owner, refs, { jobs });
      media.noteNumbers(made.variants.map((variant) => variant.item).filter(Boolean));
      media.offer(owner, refs, made.id, jobs);
      const source = media.refOf(found.jobId) || "the result";
      const lines = made.variants.map(
        ({ jobId, label }) =>
          `[${label}](${media.pageUrl(owner, jobId)}) ${media.refOf(jobId) || ""}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Queued options ${letter(0)}–${letter(jobs.length - 1)} of ${source}, varying ${axis}, with its seed. Share the comparison link and options, ask the user to pick a letter, and end your turn.\n\n[Compare Side by Side](${media.publicUrl}/compare/${encodeURIComponent(made.id)})\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
}
