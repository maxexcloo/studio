import { useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaKind } from "../../types";
import { useGroupFeature } from "../auth/AccountGate";
import { promptIdeasQuery } from "../taste/suggestions";
import { ChipSelect } from "./ChipSelect";

// Pressing the chip keeps focus, and so the keyboard, in the text; its list's options keep focus
// themselves.
const keepFocus = {
  onPointerDown: undefined,
  onMouseDown: (event: MouseEvent) => event.preventDefault(),
};

/**
 * Taste-led prompt ideas for an empty prompt, listed by one Suggestions chip in the box's chip row.
 * Spread `focusProps` on an element holding the prompt; the ideas are fetched on first focus, and
 * `chip` shows while the prompt is empty (or its list is open).
 */
export function usePromptIdeas({
  kind,
  empty,
  onPick,
}: {
  kind: MediaKind;
  empty: boolean;
  onPick: (idea: string) => void;
}) {
  const [asked, setAsked] = useState(false);
  const [listed, setListed] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // A group without Prompt Assistant gets no ideas, so they are never asked for.
  const offered = useGroupFeature("promptAssistant");
  const query = useQuery({ ...promptIdeasQuery(kind), enabled: asked && offered });
  const list = query.data?.suggestions ?? [];
  return {
    focusProps: {
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.target instanceof HTMLTextAreaElement) field.current = event.target;
        setAsked(true);
      },
      // Focus stays in the prompt while the list is open, so its Escape closes only the list.
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!listed || event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        setListed(false);
      },
    },
    chip: (empty || listed) && list.length > 0 && (
      <ChipSelect
        name="Suggestions"
        label="Suggestions"
        target={keepFocus}
        data={list}
        value={null}
        dropdownOpened={listed}
        onDropdownOpen={() => setListed(true)}
        onDropdownClose={() => setListed(false)}
        onChange={(idea) => {
          if (!idea) return;
          onPick(idea);
          // The list returns focus to the chip, which the filled prompt then hides.
          requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
        }}
      />
    ),
  };
}
