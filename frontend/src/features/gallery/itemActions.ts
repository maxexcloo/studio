import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";

const definitions = {
  animate: { label: "Animate", icon: icons.animate },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
  dislike: { label: "Dislike", icon: icons.dislike },
  edit: { label: "Edit", icon: icons.edit },
  like: { label: "Like", icon: icons.like },
  recreate: { label: "Recreate", icon: icons.recreate },
  retry: { label: "Retry", icon: icons.retry },
  share: { label: "Share", icon: icons.share },
  stop: { label: "Stop", icon: icons.stop },
};
type ItemActionId = keyof typeof definitions;
/**
 * The sections and order everywhere: Animate, Edit, Recreate | Share | Like, Dislike, Delete. Retry and Stop
 * lead for unfinished work and running upscales.
 */
const sections: ItemActionId[][] = [
  ["retry", "stop", "animate", "edit", "recreate"],
  ["share"],
  ["like", "dislike", "delete"],
];
/** Bars name every action but Like, Dislike and Delete, whose icons say what they do. */
export const namedItemActions: string[] = ["retry", "stop", "animate", "edit", "recreate", "share"];

/** An item action with its shared label and icon. */
export const itemAction = (id: ItemActionId, action: Partial<Action> = {}): Action => ({
  id,
  ...definitions[id],
  ...action,
});
/** Places actions in the shared sections and order; absent ones are left out. */
export const itemActionGroups = (actions: (Action | null | false | undefined)[]): ActionGroups =>
  sections.map((ids) =>
    ids.flatMap((id) => actions.filter((action): action is Action => !!action && action.id === id)),
  );
