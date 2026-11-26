import { isComparisonSet } from "./compare.ts";
import { promptWords, titleCase } from "./titles.ts";

interface QueueLabelInput {
  kind?: unknown;
  prompt?: unknown;
  resultSet?: { title?: string; variation?: string; source?: string };
  writing?: {
    kind?: string;
    theme?: string;
    instruction?: string;
    extend?: boolean;
    note?: string;
    scope?: string;
  };
}

export interface QueueLabelJob {
  operation?: string;
  dream?: boolean | object;
  input?: QueueLabelInput;
  items?: readonly unknown[];
}

const promptBoilerplate =
  /^(?:integrated_multimodal_description:\s*)?(?:\[shot\s*\d+\]\s*)?(?:live-action,\s*)?/i;

/** Strips technical video prompt wrappers so queue rows show the actual subject. */
export function cleanQueuePrompt(prompt: unknown) {
  const raw = String(prompt || "").trim();
  if (!raw) return "";
  const stripped = raw.replace(promptBoilerplate, "").trim();
  return stripped || raw;
}

/** A clear label for a single queue row (never bare "Generation" when we know the action). */
export function queueJobTitle(job: QueueLabelJob) {
  const input = job.input ?? {};
  const set = input.resultSet;
  const prompt = cleanQueuePrompt(input.prompt);
  if (set?.variation && !isComparisonSet(set)) return set.variation;
  const firstItem = job.items?.[0];
  const titled =
    firstItem &&
    typeof firstItem === "object" &&
    "title" in firstItem &&
    typeof firstItem.title === "string"
      ? firstItem.title.trim()
      : "";
  if (titled) return titled;
  if (prompt) return prompt;
  const writing = input.writing;
  if (writing?.kind === "animate") {
    const verb = writing.extend ? "Extend Video" : "Animate";
    if (writing.theme && writing.theme !== "custom")
      return `${verb} · ${titleCase(writing.theme.replace(/[-_]+/g, " "))}`;
    const instruction = cleanQueuePrompt(writing.instruction);
    if (instruction) return `${verb} · ${instruction.slice(0, 60)}`;
    return verb;
  }
  if (writing?.kind === "set") {
    if (set?.title) return `More Like ${set.title}`;
    return writing.scope === "image" ? "More Like This Image" : "More Like This Set";
  }
  if (writing?.kind === "sheet") return "Character Sheet";
  if (writing?.kind === "dream") {
    if (writing.note?.trim()) return writing.note.trim();
    return input.kind === "video" ? "Dream Video" : "Dream Image";
  }
  if (job.operation === "upscale") return "Upscale Image";
  if (job.operation === "refine") return "Edit Image";
  if (job.operation === "animate") return "Animate Video";
  if (job.dream) return input.kind === "video" ? "Dream Video" : "Dream Image";
  return input.kind === "video" ? "Video Generation" : "Image Generation";
}

/** A clear heading for a grouped queue set row. */
export function queueSetTitle(members: QueueLabelJob[]) {
  const first = members[0];
  if (!first) return "Generations";
  if (first.dream) {
    const hasImages = members.some((job) => job.input?.kind !== "video");
    const hasVideos = members.some((job) => job.input?.kind === "video");
    if (hasImages && hasVideos) return "Dream · Images & Videos";
    if (hasVideos) return "Dream · Videos";
    if (hasImages) return "Dream · Images";
    return "Dream";
  }
  const set = first.input?.resultSet;
  if (set?.title) {
    if (set.title === "Comparison") {
      const subject = promptWords(cleanQueuePrompt(first.input?.prompt));
      return subject ? `Compare: ${subject}` : "Comparison";
    }
    return set.title;
  }
  if (first.input?.writing?.kind === "set") {
    return first.input.writing.scope === "image" ? "More Like This Image" : "More Like This";
  }
  return queueJobTitle(first);
}
