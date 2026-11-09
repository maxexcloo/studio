import { forwardRef, useState } from "react";
import { ActionIcon, Menu, Popover } from "@mantine/core";
import { Library, Palette } from "lucide-react";
import { icons } from "../../ui/icons";
import { Link, useLocation } from "react-router";
import { AppearanceControls } from "../../ui/Appearance";
import { AccountMenuContent } from "../auth/AccountMenu";
import { useIsAdmin } from "../auth/AccountGate";

// The outer popover and inner menu each retain a ref to the same DOM anchor.
const OptionsTarget = forwardRef<HTMLButtonElement, { onStyle: () => void }>(function OptionsTarget(
  { onStyle },
  ref,
) {
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const admin = useIsAdmin();
  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-end" shadow="md">
      <Menu.Target>
        <ActionIcon ref={ref} aria-label="More Options" variant="subtle" color="gray">
          <icons.more size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <AccountMenuContent>
          <Menu.Item
            leftSection={<Palette size={16} />}
            onClick={() => {
              setOpened(false);
              onStyle();
            }}
          >
            Appearance
          </Menu.Item>
          {admin && (
            <Menu.Item
              component={Link}
              to="/library"
              state={{ backgroundLocation: location }}
              leftSection={<Library size={16} />}
            >
              Library
            </Menu.Item>
          )}
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
});
export function HeaderOptions() {
  const [style, setStyle] = useState(false);
  return (
    <Popover
      opened={style}
      onChange={setStyle}
      width={290}
      position="bottom-end"
      offset={18}
      trapFocus
      shadow="md"
    >
      <Popover.Target>
        <OptionsTarget onStyle={() => setStyle(true)} />
      </Popover.Target>
      <Popover.Dropdown>
        <AppearanceControls />
      </Popover.Dropdown>
    </Popover>
  );
}
