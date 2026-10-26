import { useState, type FocusEvent } from "react";
import { Button, Group, Transition } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { MediaKind } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { promptIdeasQuery } from "../taste/suggestions";
import classes from "./PromptIdeas.module.css";

/**
 * Taste-led prompt ideas for an empty, focused prompt. Spread `focusProps` on an element holding
 * both the prompt and `ideas`; the ideas are fetched on first focus and float over the empty
 * prompt (callers position them through `className`), so they never move the layout.
 */
export function usePromptIdeas({
  kind,
  empty,
  onPick,
  className,
  stacked = false,
}: {
  kind: MediaKind;
  empty: boolean;
  onPick: (idea: string) => void;
  className?: string;
  /** Stacks the ideas, each on up to two lines, for a tall prompt. */
  stacked?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [asked, setAsked] = useState(false);
  const motionDuration = useMotionDuration();
  const query = useQuery({ ...promptIdeasQuery(kind), enabled: asked });
  const list = query.data?.suggestions ?? [];
  return {
    focusProps: {
      onFocus: () => {
        setFocused(true);
        setAsked(true);
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
    },
    ideas: (
      <Transition
        mounted={focused && empty && list.length > 0}
        transition="fade"
        duration={motionDuration}
      >
        {(styles) => (
          <Group
            role="group"
            aria-label="Prompt Ideas"
            gap={6}
            data-stacked={stacked || undefined}
            className={`${classes.ideas} ${className || ""}`}
            style={styles}
          >
            {list.map((idea) => (
              <Button
                key={idea}
                size="compact-sm"
                radius="xl"
                variant="default"
                className={classes.idea}
                classNames={{ inner: classes.inner, label: classes.label }}
                leftSection={<Sparkles size={12} aria-hidden />}
                title={idea}
                // Keeps the prompt focused, so the ideas stay until the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(idea)}
              >
                <span className={classes.text}>{idea}</span>
              </Button>
            ))}
          </Group>
        )}
      </Transition>
    ),
  };
}
