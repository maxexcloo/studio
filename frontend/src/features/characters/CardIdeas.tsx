import { ActionIcon, Group, Menu, getDefaultZIndex } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { CardKind } from "../../../../shared/characters";
import { post } from "../../api";
import { menuWidth } from "../../theme";
import type { ReferenceAsset } from "../../types";
import { type Action, ActionMenuItems } from "../../ui/ActionBar";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { UndoButton, assistMenu, suggested } from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";

type Field = "name" | "description";
// Above the card's dialog, which sits over the desktop References popover (CardDialog).
const zIndex = getDefaultZIndex("overlay") + 1;
const nouns = { name: "Name", description: "Description" } as const;

/**
 * A card field's AI menu: Suggestions of names or descriptions the prompt assistant writes from the
 * card's images, asked for when it opens, then Custom… to say what to write and Refresh for others.
 * Picking one fills the field, with Undo beside it until the field next changes.
 */
export function useCardIdeas({
  kind,
  field,
  images,
  value,
  onChange,
}: {
  kind: CardKind;
  field: Field;
  images: ReferenceAsset[];
  value: string;
  onChange: (value: string) => void;
}) {
  const client = useQueryClient();
  const [requested, setRequested] = useState(false);
  const [custom, setCustom] = useState(false);
  const [picked, setPicked] = useState<{ before: string; after: string } | null>(null);
  const assetIds = images.map((asset) => asset.id);
  const ask = (body: { request?: string; avoid?: string[] }) =>
    post<{ options: string[] }>("/api/assistant/cards/ideas", { kind, field, assetIds, ...body });
  const queryKey = ["card-ideas", kind, field, ...assetIds];
  const ideas = useQuery({
    queryKey,
    queryFn: () => ask({}),
    enabled: requested,
    staleTime: Infinity,
  });
  const pick = (idea: string) => {
    setPicked({ before: picked && value === picked.after ? picked.before : value, after: idea });
    onChange(idea);
  };
  const again = useMutation({
    mutationFn: (request?: string) => ask({ request, avoid: ideas.data?.options }),
    onSuccess: (answer, request) => {
      client.setQueryData(queryKey, answer);
      if (request) pick(answer.options[0]);
    },
  });
  const options = [...(ideas.data?.options ?? [])]
    .sort(compareNames)
    .map((idea): Action => ({ id: `idea:${idea}`, label: idea, onClick: () => pick(idea) }));
  const noun = nouns[field];
  return {
    action: {
      id: "card-ideas",
      label: `Suggest ${noun}`,
      icon: icons.assistant,
      heading: false,
      menu: assistMenu({
        suggestions: suggested(options, {
          loading: again.isPending || ideas.isFetching,
          answered: Boolean(ideas.data || ideas.error || again.error),
          failure: again.error?.message || ideas.error?.message,
          onRefresh: () => again.mutate(undefined),
        }),
        templates: [],
        custom: [
          { id: "custom", label: "Custom…", icon: icons.custom, onClick: () => setCustom(true) },
        ],
        last: [],
      }),
      onOpen: () => setRequested(true),
    } satisfies Action,
    undo: picked && value === picked.after && (
      <UndoButton
        onClick={() => {
          onChange(picked.before);
          setPicked(null);
        }}
      />
    ),
    dialog: (
      <CustomDialog
        opened={custom}
        onClose={() => setCustom(false)}
        title={`Custom ${noun}`}
        zIndex={zIndex}
        action="Ask"
        label="Request"
        placeholder={
          field === "name" ? "What kind of name, like “short and Japanese”" : "What to stress"
        }
        onSend={(request) => again.mutate(request)}
      />
    ),
  };
}

/** The single-line Name field keeps its own suggestion picker, opened from the plain AI icon. */
export function CardIdeas(props: Parameters<typeof useCardIdeas>[0]) {
  const { action, undo, dialog } = useCardIdeas(props);
  return (
    <Group gap={2} wrap="nowrap" pr={4}>
      {undo}
      <Menu position="bottom-end" width={menuWidth} zIndex={zIndex} onOpen={action.onOpen}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={action.label}>
            <icons.assistant size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <ActionMenuItems groups={action.menu} />
        </Menu.Dropdown>
      </Menu>
      {dialog}
    </Group>
  );
}
