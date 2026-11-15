import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";

const definitions = {
  animate: { label: "Animate", icon: icons.animate },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
  dislike: { label: "Dislike", icon: icons.dislike },
  edit: { label: "Edit", icon: icons.edit },
  like: { label: "Like", icon: icons.like },
  recreate: { label: "Recreate", icon: icons.recreate },
  report: { label: "Report", icon: icons.report },
  retry: { label: "Retry", icon: icons.retry },
  share: { label: "Share", icon: icons.share },
  similar: { label: "Similar", icon: icons.similar },
  stop: { label: "Stop", icon: icons.stop },
  upscale: { label: "Upscale", icon: icons.upscale },
};
type ItemActionId = keyof typeof definitions;
const menus: ItemActionId[] = ["animate", "edit", "recreate", "upscale"];
// Alphabetical but for Like before Dislike and Delete last. Retry and Stop lead for unfinished
// work and running upscales.
const ratings: ItemActionId[] = ["like", "dislike", "report", "share"];
const others: ItemActionId[] = ["similar", "delete"];
/** Bars: Animate, Edit, Recreate, Upscale | Like, Dislike, Report, Share | Similar, Delete. */
const barSections: ItemActionId[][] = [["retry", "stop", ...menus], ratings, others];
/** Menus put the rating first: Like, Dislike, Report, Share ── the four menus ── Similar, Delete. */
const menuSections: ItemActionId[][] = [["retry", "stop"], ratings, menus, others];
/** Bars name Retry, Stop and the four menus; the rest are icons. */
export const namedItemActions: string[] = ["retry", "stop", ...menus];

/** An item action with its shared label and icon. */
export const itemAction = (id: ItemActionId, action: Partial<Action> = {}): Action => ({
  id,
  ...definitions[id],
  ...action,
});
/** Places actions in a bar's or a menu's sections and order; absent ones are left out. */
export const itemActionGroups = (
  actions: (Action | null | false | undefined)[],
  layout: "bar" | "menu" = "bar",
): ActionGroups =>
  (layout === "bar" ? barSections : menuSections).map((ids) =>
    ids.flatMap((id) => actions.filter((action): action is Action => !!action && action.id === id)),
  );
