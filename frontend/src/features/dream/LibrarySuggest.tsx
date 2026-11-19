import { Button, Menu } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { ActionMenuItems } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { useItemChange } from "../gallery/useItemChange";
import { useMediaIteration } from "../gallery/useMediaAction";
import { useChangeSuggestions } from "../generation/AskChange";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";

import classes from "./DreamPage.module.css";

export function LibrarySuggest({ item }: { item: MediaItem }) {
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
  return (
    <div className={classes.suggest}>
      <Menu position="bottom-end" width={menuWidth} onOpen={() => setOpened(true)}>
        <PopupTooltip label="Suggest">
          <Menu.Target>
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<icons.assistant size={16} />}
              rightSection={<ChevronDown size={14} />}
              loading={change.pending || iteration.isPending}
            >
              Suggest
            </Button>
          </Menu.Target>
        </PopupTooltip>
        <Menu.Dropdown>
          <ActionMenuItems groups={suggestions.action.menu!} />
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
