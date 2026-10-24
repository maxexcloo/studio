import { forwardRef, useState } from "react";
import { ActionIcon, Menu, Popover } from "@mantine/core";
import { Library, MoreHorizontal, Palette, Settings } from "lucide-react";
import { Link, useLocation } from "react-router";
import { AppearanceControls } from "../../ui/Appearance";
import { AccountMenuContent } from "../auth/AccountMenu";
import { useLibraryAccess } from "../library/useLibraryAccess";

// The outer popover and inner menu each retain a ref to the same DOM anchor.
const OptionsTarget = forwardRef<HTMLButtonElement, { onStyle: () => void }>(function OptionsTarget(
  { onStyle },
  ref,
) {
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const library = useLibraryAccess();
  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-end" shadow="md">
      <Menu.Target>
        <ActionIcon ref={ref} aria-label="More Options" variant="subtle" color="gray" size={36}>
          <MoreHorizontal size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <AccountMenuContent accountFirst>
          {library.allowed && (
            <Menu.Item
              component={Link}
              to="/library"
              state={{ backgroundLocation: location }}
              leftSection={<Library size={18} />}
            >
              Library
            </Menu.Item>
          )}
          <Menu.Item
            component={Link}
            to="/settings"
            state={{ backgroundLocation: location }}
            leftSection={<Settings size={18} />}
          >
            Settings
          </Menu.Item>
          <Menu.Item
            leftSection={<Palette size={18} />}
            onClick={() => {
              setOpened(false);
              onStyle();
            }}
          >
            Theme
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
