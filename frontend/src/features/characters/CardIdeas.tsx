import { Button, Group, Menu, getDefaultZIndex } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { CardKind } from "../../../../shared/characters";
import { post } from "../../api";
import type { ReferenceAsset } from "../../types";
import { type Action, ActionMenuItems } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { UndoButton, assistMenu, suggested } from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";

type Field = "name" | "description";
// Above the card's dialog, which sits over the desktop References popover (CardDialog).
const zIndex = getDefaultZIndex("overlay") + 1;
const nouns = { name: "Name", description: "Description" } as const;

/**
 * A card field's ✨ ▾: names or descriptions the prompt assistant writes from the card's images,
 * asked for when it opens, then Refresh… for others and Custom… to say what to write.
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
  const options = [...(ideas.data?.options ?? [])].sort((a, b) => a.localeCompare(b));
  const loading = again.isPending || (ideas.isFetching && !options.length);
  const noun = nouns[field];
  const suggestions = suggested(
    loading,
    options.map((idea): Action => ({
      id: `idea:${idea}`,
      label: idea,
      icon: icons.assistant,
      onClick: () => pick(idea),
    })),
    { onClick: () => again.mutate(undefined) },
  );
  const groups = assistMenu({
    templates: [],
    suggestions: [
      { id: "heading", label: "Suggested", heading: true },
      ...suggestions.options,
      suggestions.again,
    ],
    last: [{ id: "custom", label: "Custom…", icon: icons.custom, onClick: () => setCustom(true) }],
  });
  return {
    action: {
      id: "card-ideas",
      label: `Suggest ${noun}`,
      icon: icons.assistant,
      menu: groups,
      onOpen: () => setRequested(true),
    } satisfies Action,
    loading,
    pending: again.isPending,
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

/** The single-line Name field keeps its own suggestion picker. */
export function CardIdeas(props: Parameters<typeof useCardIdeas>[0]) {
  const { action, loading, pending, undo, dialog } = useCardIdeas(props);
  const [opened, setOpened] = useState(false);
  return (
    <Group gap={2} wrap="nowrap" pr={4}>
      {undo}
      <Menu
        position="bottom-end"
        width={320}
        zIndex={zIndex}
        opened={opened}
        onChange={setOpened}
        onOpen={action.onOpen}
      >
        <PopupTooltip label={action.label}>
          <Menu.Target>
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              radius="xl"
              px={6}
              aria-label={action.label}
              loading={pending && !opened}
              rightSection={<ChevronDown size={12} />}
            >
              <icons.assistant size={16} />
            </Button>
          </Menu.Target>
        </PopupTooltip>
        <Menu.Dropdown aria-busy={loading || undefined}>
          <ActionMenuItems groups={action.menu} />
        </Menu.Dropdown>
      </Menu>
      {dialog}
    </Group>
  );
}
