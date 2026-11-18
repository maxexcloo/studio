import type { CardKind } from "./characters.ts";
import type { ProjectBrief, ProjectContent } from "./projects.ts";

/**
 * What Dream proposes in Dream › Projects' Inbox: a new project, an edit to a project's brief, a
 * rule, a project's pacing (pause it, give it more turns, or vary results that look alike) or a
 * card. Nothing changes until the person accepts one.
 */
export const proposalKinds = ["project", "brief", "rule", "pacing", "card"] as const;
export type ProposalKind = (typeof proposalKinds)[number];
/** What Accept applies; Edit then Accept sends its own. */
export interface ProposalChange {
  /** A new project (`project`). */
  project?: ProjectContent;
  /** Brief fields, each replaced whole (`brief`, and `pacing` that varies alike results). */
  brief?: Partial<ProjectBrief>;
  /** Pausing a project or giving it more turns (`pacing`). */
  paused?: boolean;
  favoured?: boolean;
  /** A rule for Taste › Rules (`rule`). */
  rule?: string;
  /** A character, outfit or scene card (`card`). */
  card?: { kind: CardKind; name: string; description: string };
}
export interface Proposal<Item> {
  id: string;
  kind: ProposalKind;
  /** What it proposes in a few words, such as "Pause Beach". */
  title: string;
  /** Why, in one line. */
  why: string;
  at: string;
  /** The project it changes, for `brief` and `pacing`. */
  projectId?: string;
  change: ProposalChange;
  /** Results that show why. */
  evidence: Item[];
  /** A new project's sample results, kept out of the gallery and taste until accepted. */
  drafts?: Item[];
}
/** `GET /api/dream/inbox`. */
export interface Inbox<Item> {
  proposals: Proposal<Item>[];
}
/** `POST /api/dream/inbox/:id/accept`: the Inbox after, and what Undo can take back. */
export interface Accepted<Item> extends Inbox<Item> {
  accepted: { id: string; title: string };
}
export const maxDismissReason = 200;
