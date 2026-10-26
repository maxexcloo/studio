import { AppShell, FocusTrap, Modal } from "@mantine/core";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { AccountGate } from "./features/auth/AccountGate";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
import { CompareProvider } from "./features/compare/CompareDialog";
import { ChatProvider } from "./features/sessions/ChatProvider";
import { useAppearance } from "./ui/Appearance";
import { AppHeader } from "./features/shell/AppHeader";
import { ChatWorkspace, chatShellClass } from "./features/sessions/ChatWorkspace";
import { LibraryTitle } from "./features/library/LibraryNavigation";
// Library and Settings load with the app so their first open shows the sections, not a loader.
import { LibraryPage } from "./features/library/LibraryPage";
import { useLibraryAccess } from "./features/library/useLibraryAccess";
import { LoadingState } from "./ui/LoadingState";
import { SettingsTitle } from "./features/settings/SettingsNavigation";
import { SettingsPage } from "./features/settings/SettingsPage";
import { usePhone } from "./ui/usePhone";
const ComparePage = lazy(() =>
  import("./features/compare/ComparePage").then((module) => ({ default: module.ComparePage })),
);
const DreamPage = lazy(() =>
  import("./features/dream/DreamPage").then((module) => ({ default: module.DreamPage })),
);
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
        <CompareProvider>
          <AppShell
            header={{ height: 68 }}
            padding={{ base: "sm", md: "lg" }}
            // Chat's own padding switches with the mode; animating it slides the whole page.
            transitionDuration={0}
          >
            <AppShell.Header>
              <AppHeader chat={chatRoute} mode={mode} />
            </AppShell.Header>
            <AppShell.Main className={chatRoute ? chatShellClass : undefined}>
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
                    path="/compare/:id"
                    element={
                      <Suspense fallback={<LoadingState fill label="Loading Comparison" />}>
                        <ComparePage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/dream"
                    element={
                      <Suspense fallback={<LoadingState fill label="Loading Dream" />}>
                        <DreamPage />
                      </Suspense>
                    }
                  />
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
                title: { fontSize: "var(--mantine-font-size-xl)" },
                body: { flex: 1, minHeight: 0, overflowY: "auto" },
              }}
              fullScreen={phone}
            >
              {/* Initial focus lands here, so the close button doesn't show a focus ring on open. */}
              <FocusTrap.InitialFocus />
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
        </CompareProvider>
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
