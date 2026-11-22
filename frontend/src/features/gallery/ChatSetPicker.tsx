import { Badge } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { MediaKind } from "../../types";
import { formatDateTime } from "../../ui/dates";
import { ChipOption, ChipSelect } from "../generation/ChipSelect";
import { galleryChatSetsQuery } from "./queries";

const allSets = "*";

export function ChatSetPicker({
  kind,
  chat,
  turn,
  setId,
  onChange,
}: {
  kind: MediaKind;
  chat: string;
  turn: string;
  setId: string;
  onChange: (id?: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const query = useQuery({ ...galleryChatSetsQuery(kind, chat, turn), enabled: opened });
  const sets = query.data?.sets ?? [];
  const byId = new Map(sets.map((set) => [set.id, set]));
  const data = sets.map((set) => ({ value: set.id, label: set.title || "Untitled Set" }));
  if (sets.length || setId) data.unshift({ value: allSets, label: "All Sets" });

  return (
    <ChipSelect
      name="Chat Sets"
      label="Chat Sets"
      searchable
      data={data}
      value={setId || allSets}
      onDropdownOpen={() => setOpened(true)}
      onDropdownClose={() => setOpened(false)}
      onChange={(id) => onChange(id && id !== allSets ? id : undefined)}
      nothingFoundMessage={
        query.isPending
          ? "Loading Chat Sets…"
          : query.isError
            ? "Couldn't Load Chat Sets"
            : sets.length
              ? "No Matching Sets"
              : "No Finished Sets"
      }
      renderOption={({ option, checked }) => {
        const set = byId.get(option.value);
        const description = set
          ? [set.at === null ? "" : formatDateTime(set.at), set.notes].filter(Boolean).join(" · ")
          : undefined;
        return (
          <ChipOption
            label={option.label}
            checked={checked}
            description={description}
            badges={
              set && (
                <Badge variant="light" color="gray">
                  {set.count}
                </Badge>
              )
            }
          />
        );
      }}
    />
  );
}
