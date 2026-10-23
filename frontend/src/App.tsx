import { ActionIcon, AppShell, Group, Modal, Title, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Library, Settings } from "lucide-react";
import { AccountGate } from "./features/auth/AccountGate";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
import { ChatProvider } from "./features/sessions/ChatProvider";
import { AppearanceMenu, useAppearance } from "./ui/Appearance";
import { ServiceStatus, RuntimeStatusAction, ModeSwitcher } from "./ui/ServiceStatus";
import { HeaderOptions } from "./ui/HeaderOptions";
import { AccountMenu } from "./features/auth/AccountMenu";
import { ChatPage } from "./features/sessions/SessionsPage";
import { LibraryPage, LibraryTitle } from "./features/library/LibraryPage";
import { useLibraryAccess } from "./features/library/useLibraryAccess";
import { LoadingState } from "./ui/LoadingState";
import { SettingsPage, SettingsTitle } from "./features/settings/SettingsPage";
const navigation = [
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];
function Workspace() {
  const { appearance } = useAppearance();
  const library = useLibraryAccess();
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
  if (location.pathname === "/library" && !library.pending && !library.allowed)
    return <Navigate to="/images" replace />;
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
                <ServiceStatus
                  chat={chatRoute}
                  kind={modeLocation.pathname === "/video" ? "video" : "image"}
                />
                <Link to="/images" className="studio-home-link" style={{ textDecoration: "none" }}>
                  <Title className="studio-logo" order={2}>
                    Studio<span style={{ color: "var(--mantine-primary-color-filled)" }}>.</span>
                  </Title>
                </Link>
              </Group>
              <ModeSwitcher active={active} />
              <Group gap="xs" visibleFrom="sm">
                <RuntimeStatusAction />
                {navigation
                  .filter((item) => item.to !== "/library" || library.allowed)
                  .map((item) => (
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
            {panel === "library" ? (
              library.allowed ? (
                <LibraryPage />
              ) : (
                <LoadingState label="Loading Library" fill />
              )
            ) : (
              <SettingsPage />
            )}
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
