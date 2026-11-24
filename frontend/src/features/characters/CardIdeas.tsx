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
import { ProposalLabel, assistMenu, proposalUndo, suggested } from "../generation/AskChange";
import { CustomDialog } from "../generation/CustomDialog";

type Field = "name" | "description";
// Above the card's dialog, which sits over the desktop References popover (CardDialog).
const zIndex = getDefaultZIndex("overlay") + 1;
const nouns = { name: "Name", description: "Description" } as const;

/**
 * A card field's AI menu: for a description, Improve rewrites the typed text to its kind's rules;
 * with `images` the text model reads, Suggestions of names or descriptions written from them, asked
 * for when it opens, then Custom… to say what to write and Refresh for others. Either replaces the
 * field in place, with Undo first in this menu and the change shown below it (`below`) until the
 * field next changes.
 */
export function useCardIdeas({
  kind,
  field,
  name = "",
  images,
  value,
  onChange,
}: {
  kind: CardKind;
  field: Field;
  /** The card's name, which Improve writes for. */
  name?: string;
  /** Images the text model reads, for Suggestions; none without a model that reads them. */
  images: ReferenceAsset[];
  value: string;
  onChange: (value: string) => void;
}) {
  const client = useQueryClient();
  const [requested, setRequested] = useState(false);
  const [custom, setCustom] = useState(false);
  const [picked, setPicked] = useState<{ before: string; after: string; how: string } | null>(null);
  const assetIds = images.map((asset) => asset.id);
  const suggesting = assetIds.length > 0;
  const ask = (body: { request?: string; avoid?: string[] }) =>
    post<{ options: string[] }>("/api/assistant/cards/ideas", { kind, field, assetIds, ...body });
  const queryKey = ["card-ideas", kind, field, ...assetIds];
  const ideas = useQuery({
    queryKey,
    queryFn: () => ask({}),
    enabled: requested && suggesting,
    staleTime: Infinity,
  });
  const standing = picked && value === picked.after ? picked : null;
  const pick = (idea: string, how: string) => {
    setPicked({ before: standing ? standing.before : value, after: idea, how });
    onChange(idea);
  };
  const again = useMutation({
    mutationFn: (request?: string) => ask({ request, avoid: ideas.data?.options }),
    onSuccess: (answer, request) => {
      client.setQueryData(queryKey, answer);
      if (request) pick(answer.options[0], "Custom");
    },
  });
  const improve = useMutation({
    mutationFn: () =>
      post<{ description: string }>("/api/assistant/cards/improve", {
        kind,
        name: name.trim(),
        description: value,
      }),
    onSuccess: ({ description }) => pick(description, "Improve"),
  });
  const options = [...(ideas.data?.options ?? [])].sort(compareNames).map((idea): Action => ({
    id: `idea:${idea}`,
    label: idea,
    onClick: () => pick(idea, "Suggest"),
  }));
  const noun = nouns[field];
  // A description's Improve, after any Suggestions.
  const improving: Action[][] =
    field === "description"
      ? [
          [
            {
              id: "improve",
              label: "Improve",
              icon: icons.assistant,
              disabled: !value.trim() || improve.isPending,
              onClick: () => improve.mutate(),
            },
          ],
        ]
      : [];
  return {
    action: {
      id: "card-ideas",
      label: suggesting ? `Suggest ${noun}` : "Improve",
      icon: icons.assistant,
      heading: false,
      menu: [
        ...proposalUndo(
          standing &&
            (() => {
              onChange(standing.before);
              setPicked(null);
            }),
        ),
        ...(suggesting
          ? assistMenu({
              suggestions: suggested(options, {
                loading: again.isPending || ideas.isFetching,
                answered: Boolean(ideas.data || ideas.error || again.error),
                failure: again.error?.message || ideas.error?.message,
                onRefresh: () => again.mutate(undefined),
              }),
              templates: [],
              custom: [
                {
                  id: "custom",
                  label: "Custom…",
                  icon: icons.custom,
                  onClick: () => setCustom(true),
                },
              ],
              others: improving,
              last: [],
            })
          : improving),
      ],
      // Suggestions load as the menu opens; Improve alone runs on click.
      ...(suggesting ? { onOpen: () => setRequested(true) } : {}),
    } satisfies Action,
    busy: improve.isPending ? "Improving…" : undefined,
    error: improve.error?.message,
    below: standing && (
      <ProposalLabel
        proposal={{ action: "edit", label: standing.how, request: "", prompt: value }}
        before={standing.before}
        labels={{ edit: standing.how }}
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
  const { action, dialog } = useCardIdeas(props);
  return (
    <Group gap={2} wrap="nowrap" pr={4}>
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
