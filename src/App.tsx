import { ActionIcon, AppShell, Button, Group, Modal, Title, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Image, MessageCircle, Library, Settings, Video } from "lucide-react";
import { AccountGate } from "./features/auth/AccountGate";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
import { ChatProvider } from "./features/sessions/ChatProvider";
import { AppearanceMenu, useAppearance } from "./ui/Appearance";
import { ServiceStatus } from "./ui/ServiceStatus";
import { HeaderOptions } from "./ui/HeaderOptions";
import { AccountMenu } from "./features/auth/AccountMenu";
import { ChatPage } from "./features/sessions/SessionsPage";
import { LibraryPage, LibraryTitle } from "./features/library/LibraryPage";
import { SettingsPage, SettingsTitle } from "./features/settings/SettingsPage";
const navigation = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/images", label: "Images", icon: Image },
  { to: "/video", label: "Videos", icon: Video },
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];
function Workspace() {
  const { appearance } = useAppearance();
  const location = useLocation();
  const navigate = useNavigate();
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const overlay =
    location.pathname === "/library"
      ? "library"
      : location.pathname === "/settings"
        ? "settings"
        : null;
  const [lastPanel, setLastPanel] = useState<"library" | "settings">(overlay || "settings");
  useEffect(() => {
    if (overlay) setLastPanel(overlay);
  }, [overlay]);
  const background = location.state?.backgroundLocation || {
    pathname: "/images",
    search: "",
    hash: "",
  };
  const panel = overlay || lastPanel;
  const chatRoute = (overlay ? background.pathname : location.pathname).startsWith("/chat");
  const modeLocation = overlay ? background : location;

  const active = (to: string) =>
    (to === "/library" || to === "/settings"
      ? location.pathname
      : modeLocation.pathname
    ).startsWith(to);
  return (
    <GenerationProvider>
      <ChatProvider>
        <AppShell header={{ height: 68 }} padding={{ base: "sm", md: "lg" }}>
          <AppShell.Header>
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
                <Link to="/images" className="studio-home-link" style={{ textDecoration: "none" }}>
                  <Title className="studio-logo" order={2}>
                    Studio<span style={{ color: "var(--mantine-primary-color-filled)" }}>.</span>
                  </Title>
                </Link>
                <ServiceStatus
                  chat={chatRoute}
                  kind={modeLocation.pathname === "/video" ? "video" : "image"}
                />
              </Group>
              <Group
                gap={4}
                component="nav"
                aria-label="Creative Modes"
                className="studio-mode-tabs"
                wrap="nowrap"
              >
                {navigation.slice(0, 3).map((item) => (
                  <Tooltip key={item.to} label={item.label} disabled={!narrow}>
                    <Button
                      aria-label={item.label}
                      key={item.to}
                      component={Link}
                      to={item.to}
                      aria-current={active(item.to) ? "page" : undefined}
                      variant={active(item.to) ? "light" : "subtle"}
                      color={active(item.to) ? undefined : "gray"}
                      size="sm"
                      px={{ base: "xs", sm: "md" }}
                      radius="xl"
                    >
                      {narrow ? <item.icon size={20} /> : item.label}
                    </Button>
                  </Tooltip>
                ))}
              </Group>
              <Group gap="xs" visibleFrom="sm">
                {navigation.slice(3).map((item) => (
                  <Tooltip key={item.to} label={item.label}>
                    <ActionIcon
                      component={Link}
                      to={item.to}
                      state={{ backgroundLocation: location }}
                      variant={active(item.to) ? "light" : "subtle"}
                      color={active(item.to) ? undefined : "gray"}
                      aria-label={item.label}
                      size="lg"
                      radius="xl"
                    >
                      <item.icon size={19} />
                    </ActionIcon>
                  </Tooltip>
                ))}
                <AppearanceMenu />
                <AccountMenu />
              </Group>
              <Group hiddenFrom="sm">
                <HeaderOptions />
              </Group>
            </Group>
          </AppShell.Header>
          <AppShell.Main className={chatRoute ? "studio-chat-shell" : undefined}>
            <div
              className="studio-page studio-content"
              style={{
                maxWidth:
                  appearance.layout === "fixed" ? "var(--studio-workspace-width)" : undefined,
              }}
            >
              <Routes location={overlay ? background : location}>
                <Route path="/images" element={<GalleryPage />} />
                <Route path="/video" element={<GalleryPage />} />
                <Route path="/chat/:id?" element={<ChatPage />} />
                <Route path="*" element={<Navigate to="/images" replace />} />
              </Routes>
            </div>
          </AppShell.Main>
          <Modal
            opened={!!overlay}
            onClose={() =>
              location.state?.backgroundLocation
                ? navigate(-1)
                : navigate("/images", { replace: true })
            }
            aria-label={panel === "library" ? "Library" : "Settings"}
            title={
              narrow ? (
                <>{panel === "library" ? <LibraryTitle /> : <SettingsTitle />}</>
              ) : panel === "library" ? (
                "Library"
              ) : (
                "Settings"
              )
            }
            closeButtonProps={{
              "aria-label": `Close ${panel === "library" ? "Library" : "Settings"}`,
            }}
            size={1200}
            styles={{
              content: {
                height: narrow ? "100dvh" : "min(90dvh, 960px)",
                display: "flex",
                flexDirection: "column",
              },
              header: { flexShrink: 0 },
              title: { fontSize: "var(--mantine-font-size-xl)", fontWeight: 600 },
              body: { flex: 1, minHeight: 0, overflowY: "auto" },
            }}
            fullScreen={narrow}
          >
            {panel === "library" ? <LibraryPage /> : <SettingsPage />}
          </Modal>
        </AppShell>
      </ChatProvider>
    </GenerationProvider>
  );
}
export function App() {
  return (
    <AccountGate>
      <Workspace />
    </AccountGate>
  );
}
