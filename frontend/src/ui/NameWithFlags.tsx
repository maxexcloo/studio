import { Group } from "@mantine/core";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A record's name with its flags (AI, Failing, Default) right after it, outside any link or button
 * the name is, at one fixed gap; the pair wraps as a unit when the row is narrow.
 */
export function NameWithFlags({ name, flags }: { name: ReactNode; flags?: ReactNode }) {
  if (!flags) return name;
  return (
    <Group component="span" gap={6} wrap="wrap" align="center" miw={0}>
      {name}
      {flags}
    </Group>
  );
}

/** The check after a chosen option's name, the same in every list; hidden keeps its room. */
export function ChosenMark({ chosen }: { chosen: boolean }) {
  return <Check size={14} aria-hidden visibility={chosen ? undefined : "hidden"} />;
}
