import { ActionIcon, Button, Menu } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { ActionMenuItems } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { usePhone } from "../../ui/usePhone";
import { useItemChange } from "../gallery/useItemChange";
import { useMediaIteration } from "../gallery/useMediaAction";
import { useChangeSuggestions } from "../generation/AskChange";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";

export function LibrarySuggest({ item }: { item: MediaItem }) {
  const phone = usePhone();
  const [opened, setOpened] = useState(false);
  const iteration = useMediaIteration(item);
  const change = useItemChange(item, {
    iterate: (next) => iteration.mutate(next),
    review: false,
    show: () => {},
    restore: () => {},
  });
  const suggestions = useChangeSuggestions({
    query: nextStepsQuery(item.jobId!, undefined, item.id),
    fresh: () => askNextSteps(item.jobId!, true, undefined, item.id),
    enabled: opened && change.available,
    disabled: change.pending || iteration.isPending,
    limit: 3,
    onPick: (request) => change.send(request, item.prompt!),
  });
  if (!change.available) return null;
  const loading = change.pending || iteration.isPending;
  return (
    <Menu position="top-end" width={menuWidth} onOpen={() => setOpened(true)}>
      <PopupTooltip label="Suggest">
        <Menu.Target>
          {phone ? (
            <ActionIcon variant="default" radius="xl" aria-label="Suggest" loading={loading}>
              <icons.assistant size={18} />
            </ActionIcon>
          ) : (
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<icons.assistant size={16} />}
              rightSection={<ChevronDown size={14} />}
              loading={loading}
            >
              Suggest
            </Button>
          )}
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        <ActionMenuItems groups={suggestions.action.menu!} />
      </Menu.Dropdown>
    </Menu>
  );
}
