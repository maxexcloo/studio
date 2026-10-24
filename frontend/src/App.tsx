import { AppShell, Modal } from "@mantine/core";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { AccountGate } from "./features/auth/AccountGate";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
import { ChatProvider } from "./features/sessions/ChatProvider";
import { useAppearance } from "./ui/Appearance";
import { AppHeader } from "./features/shell/AppHeader";
import { ChatWorkspace } from "./features/sessions/ChatWorkspace";
import { LibraryTitle } from "./features/library/LibraryNavigation";
// Library and Settings load with the app so their first open shows the sections, not a loader.
import { LibraryPage } from "./features/library/LibraryPage";
import { useLibraryAccess } from "./features/library/useLibraryAccess";
import { LoadingState } from "./ui/LoadingState";
import { SettingsTitle } from "./features/settings/SettingsNavigation";
import { SettingsPage } from "./features/settings/SettingsPage";
import { usePhone } from "./ui/usePhone";
const ChatPage = lazy(() =>
  import("./features/sessions/SessionsPage").then((module) => ({ default: module.ChatPage })),
);
function Workspace() {
  const { appearance } = useAppearance();
  const library = useLibraryAccess();
  const location = useLocation();
  const navigate = useNavigate();
  const phone = usePhone();
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
  const mode = (overlay ? background : location).pathname;
  const chatRoute = mode.startsWith("/chat");
  if (location.pathname === "/library" && !library.pending && !library.allowed)
    return <Navigate to="/images" replace />;
  return (
    <GenerationProvider workspace={chatRoute ? "chat" : "gallery"}>
      <ChatProvider>
        <AppShell header={{ height: 68 }} padding={{ base: "sm", md: "lg" }}>
          <AppShell.Header>
            <AppHeader chat={chatRoute} mode={mode} />
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
                <Route
                  path="/chat/:id?"
                  element={
                    <Suspense
                      fallback={
                        <ChatWorkspace>
                          <LoadingState fill label="Loading Chat" />
                        </ChatWorkspace>
                      }
                    >
                      <ChatPage />
                    </Suspense>
                  }
                />
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
              phone ? (
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
                height: phone ? "100dvh" : "min(90dvh, 960px)",
                display: "flex",
                flexDirection: "column",
              },
              header: { flexShrink: 0 },
              title: { fontSize: "var(--mantine-font-size-xl)", fontWeight: 600 },
              body: { flex: 1, minHeight: 0, overflowY: "auto" },
            }}
            fullScreen={phone}
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
