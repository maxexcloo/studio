import { ActionIcon, Menu } from "@mantine/core";
import { Library } from "lucide-react";
import { Link, useLocation } from "react-router";

import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { AccountMenuContent } from "../auth/AccountMenu";

export function HeaderOptions() {
  const location = useLocation();
  return (
    <Menu position="bottom-end" shadow="md">
      <PopupTooltip label="More Options">
        <Menu.Target>
          <ActionIcon aria-label="More Options" variant="subtle" color="gray">
            <icons.more size={20} />
          </ActionIcon>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        <AccountMenuContent>
          <Menu.Item
            component={Link}
            to="/library"
            state={{ backgroundLocation: location }}
            leftSection={<Library size={16} />}
          >
            Library
          </Menu.Item>
          <Menu.Item
            component={Link}
            to="/settings"
            state={{ backgroundLocation: location }}
            leftSection={<icons.settings size={16} />}
          >
            Settings
          </Menu.Item>
        </AccountMenuContent>
      </Menu.Dropdown>
    </Menu>
  );
}
