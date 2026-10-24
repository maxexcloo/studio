import { ActionIcon, Box, Button, Group, Tooltip } from "@mantine/core";
import { Image, Library, MessageCircle, Settings, Video } from "lucide-react";
import { Link, useLocation } from "react-router";
import { AppearanceMenu, useAppearance } from "../../ui/Appearance";
import { StudioLogo } from "../../ui/StudioLogo";
import { AccountMenu } from "../auth/AccountMenu";
import { useLibraryAccess } from "../library/useLibraryAccess";
import { HeaderOptions } from "./HeaderOptions";
import { RuntimeStatusAction, ServiceStatus } from "./ServiceStatus";
import { usePhone } from "../../ui/usePhone";

const modes = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/images", label: "Images", icon: Image },
  { to: "/video", label: "Videos", icon: Video },
];
const navigation = [
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];
function ModeSwitcher({ mode }: { mode: string }) {
  const phone = usePhone();
  return (
    <Group
      gap={2}
      component="nav"
      aria-label="Creative Modes"
      className="studio-mode-tabs"
      wrap="nowrap"
    >
      {modes.map((item) => {
        const active = mode.startsWith(item.to);
        return (
          <Tooltip key={item.to} label={item.label} disabled={!phone}>
            <Box component="span" style={{ display: "inline-flex" }}>
              <Button
                component={Link}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                variant={active ? "light" : "subtle"}
                color={active ? undefined : "gray"}
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
        <ServiceStatus chat={chat} kind={mode === "/video" ? "video" : "image"} />
        <Link to="/images" className="studio-home-link" style={{ textDecoration: "none" }}>
          <StudioLogo order={2} />
        </Link>
      </Group>
      <ModeSwitcher mode={mode} />
      <Group gap="xs" visibleFrom="sm">
        <RuntimeStatusAction />
        {navigation
          .filter((item) => item.to !== "/library" || library.allowed)
          .map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Tooltip key={item.to} label={item.label}>
                <ActionIcon
                  component={Link}
                  to={item.to}
                  state={{ backgroundLocation: location }}
                  variant={active ? "light" : "subtle"}
                  color={active ? undefined : "gray"}
                  aria-label={item.label}
                  size="lg"
                  radius="xl"
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
