import { maxProjectBrief } from "../shared/projects.ts";
import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/** The brief fields Projects no longer has, which this step folds into `description`, in order. */
const retired = [
  ["subjects", ""],
  ["ethnicity", "Ethnicity"],
  ["age", "Age"],
  ["body", "Body"],
  ["rules", "Rules"],
];
const retiredKeys = new Set(retired.map(([key]) => key));
const line = (label, text) => (label ? `${label}: ${text}` : text);

/** A brief in its new shape: the subjects first, then each other retired field on its own line. */
function brief(old) {
  const description = retired
    .filter(([key]) => old[key])
    .map(([key, label]) => line(label, old[key]))
    .join("\n");
  return {
    description,
    ...Object.fromEntries(Object.entries(old).filter(([key]) => !retiredKeys.has(key))),
  };
}
/** Constraints in their new shape: a single aspect or resolution becomes a list of one. */
function constraints({ profiles, loras, aspect, resolution }) {
  return {
    profiles,
    aspects: aspect ? [aspect] : [],
    resolutions: resolution ? [resolution] : [],
    loras: loras ? [] : "none",
    ranges: {},
  };
}
const content = (value) => ({
  ...value,
  brief: brief(value.brief),
  constraints: constraints(value.constraints),
});
const old = (value) => value && "aspect" in (value.constraints ?? {});
/** A change record's fields and words, with the retired fields as `description`. */
function change(entry) {
  if (!entry.fields.some((field) => retiredKeys.has(field))) return entry;
  const fields = [
    ...new Set(entry.fields.map((field) => (retiredKeys.has(field) ? "description" : field))),
  ];
  if (!entry.text) return { ...entry, fields };
  const text = Object.fromEntries(
    Object.entries(entry.text).filter(([key]) => !retiredKeys.has(key)),
  );
  const words = (side) =>
    retired
      .filter(([key]) => entry.text[key]?.[side])
      .map(([key, label]) => line(label, entry.text[key][side]))
      .join("\n");
  if (retired.some(([key]) => entry.text[key]))
    text.description = { before: words("before"), after: words("after") };
  return { ...entry, fields, text };
}
/** A pending proposal that still names a retired brief field, which Dream proposes afresh instead. */
const stale = (proposal) =>
  Object.keys(proposal.change?.brief ?? {}).some((key) => retiredKeys.has(key));
const proposal = (entry) =>
  old(entry.change?.project)
    ? { ...entry, change: { ...entry.change, project: content(entry.change.project) } }
    : entry;

/**
 * The migrate-runtime step that moves projects to the three-box brief and their allowed inputs
 * (shared/projects.ts): subjects, ethnicity, age, body and rules join `description`, one line each,
 * the subjects unlabelled first; one aspect or resolution becomes a list of one, and LoRAs off
 * becomes "none". It does the same to each project's Undo snapshot and change history, and to
 * new-project proposals in the Inbox; brief edits that name a retired field are dropped, for
 * Dream to propose again. A description over the brief's length is a conflict, and a conflict
 * applies nothing. Safe while Studio runs: each document is read and written in one turn. Plans
 * by default; `apply` writes. A second run finds nothing.
 */
export function projectsSimplify(dataDir, { apply = false } = {}) {
  const projects = [];
  const proposals = [];
  const conflicts = [];
  const changed = [];
  for (const { name, value } of ownerDocuments(dataDir, "projects")) {
    if (!value?.projects?.some((project) => old(project) || old(project.previous))) continue;
    const next = value.projects.map((project) => {
      if (!old(project) && !old(project.previous)) return project;
      const moved = old(project) ? content(project) : project;
      if (moved.brief.description.length > maxProjectBrief)
        conflicts.push(
          `${name.slice("projects:".length)}/${project.name}: its brief would run to ${moved.brief.description.length} characters, over ${maxProjectBrief}.`,
        );
      projects.push({ account: name.slice("projects:".length), project: project.name });
      return {
        ...moved,
        ...(project.previous && old(project.previous)
          ? { previous: { ...content(project.previous), change: project.previous.change } }
          : {}),
        ...(project.changes ? { changes: project.changes.map(change) } : {}),
      };
    });
    changed.push({ name, value: { ...value, projects: next } });
  }
  for (const { name, value } of ownerDocuments(dataDir, "inbox")) {
    const entries = [
      ...(value?.proposals ?? []),
      ...(value?.declined ?? []).map((d) => d.proposal),
    ];
    const touched = entries.filter((entry) => stale(entry) || old(entry.change?.project));
    if (!touched.length) continue;
    proposals.push({
      account: name.slice("inbox:".length),
      moved: touched.filter((entry) => !stale(entry)).length,
      dropped: touched.filter(stale).length,
    });
    changed.push({
      name,
      value: {
        ...value,
        proposals: (value.proposals ?? []).filter((entry) => !stale(entry)).map(proposal),
        ...(value.declined
          ? {
              declined: value.declined
                .filter((entry) => !stale(entry.proposal))
                .map((entry) => ({ ...entry, proposal: proposal(entry.proposal) })),
            }
          : {}),
      },
    });
  }
  const applied = apply && !conflicts.length;
  if (applied) for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
  return { applied, projects, proposals, conflicts };
}
