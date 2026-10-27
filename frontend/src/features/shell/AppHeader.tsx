import { useState } from "react";
import { ActionIcon, Box, Button, FloatingIndicator, Group, Tooltip } from "@mantine/core";
import { Image, Library, MessageCircle, Settings, Sparkles, Video } from "lucide-react";
import { Link, useLocation } from "react-router";
import { AppearanceMenu, useAppearance } from "../../ui/Appearance";
import { StudioLogo } from "../../ui/StudioLogo";
import { AccountMenu } from "../auth/AccountMenu";
import { useLibraryAccess } from "../library/useLibraryAccess";
import { HeaderOptions } from "./HeaderOptions";
import { StatusAction } from "./ServiceStatus";
import { usePhone } from "../../ui/usePhone";
import classes from "./AppHeader.module.css";

const modes = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/dream", label: "Dream", icon: Sparkles },
  { to: "/images", label: "Images", icon: Image },
  { to: "/video", label: "Videos", icon: Video },
];
const navigation = [
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];
function ModeSwitcher({ mode }: { mode: string }) {
  const phone = usePhone();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  return (
    <Group
      ref={setRoot}
      gap={2}
      component="nav"
      aria-label="Creative Modes"
      className={classes.modes}
      wrap="nowrap"
    >
      <FloatingIndicator target={selected} parent={root} className={classes.indicator} />
      {modes.map((item) => {
        const active = mode.startsWith(item.to);
        return (
          <Tooltip key={item.to} label={item.label} disabled={!phone}>
            <Box component="span" style={{ display: "inline-flex" }}>
              <Button
                ref={active ? setSelected : undefined}
                component={Link}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                variant="subtle"
                color={active ? undefined : "gray"}
                className={classes.mode}
                px={{ base: 8, sm: 12 }}
                size="sm"
                radius="xl"
              >
                {phone ? <item.icon size={20} /> : item.label}
              </Button>
            </Box>
          </Tooltip>
        );
      })}
    </Group>
  );
}
/** `mode` is the creative-mode path, which stays behind Library and Settings. */
export function AppHeader({ chat, mode }: { chat: boolean; mode: string }) {
  const { appearance } = useAppearance();
  const phone = usePhone();
  const library = useLibraryAccess();
  const location = useLocation();
  return (
    <Group
      h="100%"
      px={{ base: "sm", sm: "lg" }}
      gap="xs"
      justify="space-between"
      wrap="nowrap"
      w="100%"
      mx="auto"
      maw={appearance.layout === "fixed" ? "var(--studio-workspace-width)" : undefined}
    >
      <Group gap="xs" wrap="nowrap">
        <StatusAction chat={chat} />
        <Link to="/images" replace={mode === "/images"} className={classes.home}>
          <StudioLogo order={phone ? 3 : 2} />
        </Link>
      </Group>
      <ModeSwitcher mode={mode} />
      <Group gap="xs" visibleFrom="sm">
        {navigation
          .filter((item) => item.to !== "/library" || library.pending || library.allowed)
          .map((item) => {
            const active = location.pathname.startsWith(item.to);
            // Library keeps its place while access loads, so the icons beside it don't move.
            const holding = item.to === "/library" && library.pending;
            return (
              <Tooltip key={item.to} label={item.label} disabled={holding}>
                <ActionIcon
                  style={holding ? { visibility: "hidden" } : undefined}
                  tabIndex={holding ? -1 : undefined}
                  component={Link}
                  to={item.to}
                  state={{ backgroundLocation: location }}
                  variant={active ? "light" : "subtle"}
                  color={active ? undefined : "gray"}
                  aria-label={item.label}
                >
                  <item.icon size={19} />
                </ActionIcon>
              </Tooltip>
            );
          })}
        <AppearanceMenu />
        <AccountMenu />
      </Group>
      <Group hiddenFrom="sm">
        <HeaderOptions />
      </Group>
    </Group>
  );
}
