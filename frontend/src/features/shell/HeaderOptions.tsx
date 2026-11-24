import { ActionIcon, Menu } from "@mantine/core";
import { Link, useLocation } from "react-router";

import { menuWidth } from "../../theme";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { useAccount } from "../auth/AccountGate";
import { AccountMenuContent } from "../auth/AccountMenu";

export function HeaderOptions() {
  const location = useLocation();
  const { data } = useAccount();
  const multi = data?.mode === "multi-user";
  const name = multi ? data.account?.username || "Your Account" : "Single-User Development";
  return (
    <Menu position="bottom-end" width={menuWidth}>
      <PopupTooltip label="Actions">
        <Menu.Target>
          <ActionIcon aria-label="Actions" variant="subtle" color="gray">
            <icons.more size={20} />
          </ActionIcon>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        <AccountMenuContent name={name} multi={multi}>
          <Menu.Item
            component={Link}
            to="/library"
            state={{ backgroundLocation: location }}
            leftSection={<icons.library size={16} />}
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
