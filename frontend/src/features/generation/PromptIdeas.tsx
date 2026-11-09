import { useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Transition } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { MediaKind } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { useGroupFeature } from "../auth/AccountGate";
import { promptIdeasQuery } from "../taste/suggestions";
import { ChipSelect } from "./ChipSelect";
import classes from "./PromptIdeas.module.css";

// Pressing the chip keeps focus, and so the phone editor and keyboard, in the text; its list's
// options keep focus themselves.
const keepFocus = {
  onPointerDown: undefined,
  onMouseDown: (event: MouseEvent) => event.preventDefault(),
};

/**
 * Taste-led prompt ideas for an empty, focused prompt, listed by one Suggestions chip. Spread
 * `focusProps` on an element holding both the prompt and `ideas`; the ideas are fetched on first
 * focus and the chip floats over the empty prompt (callers position it through `className`), so it
 * never moves the layout.
 */
export function usePromptIdeas({
  kind,
  empty,
  onPick,
  className,
}: {
  kind: MediaKind;
  empty: boolean;
  onPick: (idea: string) => void;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [asked, setAsked] = useState(false);
  const [listed, setListed] = useState(false);
  const motionDuration = useMotionDuration();
  // A group without Prompt Assistant gets no ideas, so they are never asked for.
  const offered = useGroupFeature("promptAssistant");
  const query = useQuery({ ...promptIdeasQuery(kind), enabled: asked && offered });
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
      // Focus stays in the prompt while the list is open, so its Escape closes only the list.
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!listed || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        setListed(false);
      },
    },
    ideas: (
      <Transition
        // The open list keeps the chip, wherever focus has gone.
        mounted={((focused && empty) || listed) && list.length > 0}
        transition="fade"
        duration={motionDuration}
      >
        {(styles) => (
          <div className={`${classes.ideas} ${className || ""}`} style={styles}>
            <ChipSelect
              name="Suggestions"
              label="Suggestions"
              target={keepFocus}
              data={list}
              value={null}
              dropdownOpened={listed}
              onDropdownOpen={() => setListed(true)}
              onDropdownClose={() => setListed(false)}
              onChange={(idea) => idea && onPick(idea)}
            />
          </div>
        )}
      </Transition>
    ),
  };
}
