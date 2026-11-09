import { AppShell, FocusTrap, Modal } from "@mantine/core";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { AccountGate, useGroupFeature, useIsAdmin } from "./features/auth/AccountGate";
import { useRemembered } from "./features/auth/useRemembered";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
import { CompareProvider } from "./features/compare/CompareDialog";
import { ChatProvider } from "./features/sessions/ChatProvider";
import { useAppearance } from "./ui/Appearance";
import { AppHeader } from "./features/shell/AppHeader";
import { ChatWorkspace, chatShellClass } from "./features/sessions/ChatWorkspace";
import { LibraryTitle } from "./features/library/LibraryNavigation";
import { LoadingState } from "./ui/LoadingState";
import { closeWhenTop } from "./ui/popupClicks";
import { SettingsTitle } from "./features/settings/SettingsNavigation";
import { useDialogKeyboard } from "./ui/useKeyboard";
import { usePhone } from "./ui/usePhone";
const ComparePage = lazy(() =>
  import("./features/compare/ComparePage").then((module) => ({ default: module.ComparePage })),
);
const loadDream = () => import("./features/dream/DreamPage");
const loadChat = () => import("./features/sessions/SessionsPage");
const DreamPage = lazy(() => loadDream().then((module) => ({ default: module.DreamPage })));
const ChatPage = lazy(() => loadChat().then((module) => ({ default: module.ChatPage })));
const loadLibrary = () => import("./features/library/LibraryPage");
const loadSettings = () => import("./features/settings/SettingsPage");
const LibraryPage = lazy(() => loadLibrary().then((module) => ({ default: module.LibraryPage })));
const SettingsPage = lazy(() =>
  loadSettings().then((module) => ({ default: module.SettingsPage })),
);
const noSections: Partial<Record<"library" | "settings", string>> = {};
function Workspace() {
  const { appearance } = useAppearance();
  const admin = useIsAdmin();
  const chat = useGroupFeature("chat");
  const dream = useGroupFeature("dream");
  const location = useLocation();
  const navigate = useNavigate();
  const phone = usePhone();
  useDialogKeyboard();
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
  // Opening Library or Settings returns to the section last shown there.
  const [sections, setSections] = useRemembered("sections", noSections);
  useEffect(() => {
    if (overlay && location.hash) setSections((saved) => ({ ...saved, [overlay]: location.hash }));
  }, [overlay, location.hash, setSections]);
  const resumeSection = overlay && !location.hash && sections[overlay];
  // The other modes, Library and Settings load once the first mode is up, so opening them never
  // shows their loader.
  useEffect(() => {
    void loadDream();
    void loadChat();
    void loadLibrary();
    void loadSettings();
  }, []);
  const background = location.state?.backgroundLocation || {
    pathname: "/images",
    search: "",
    hash: "",
  };
  const panel = overlay || lastPanel;
  const mode = (overlay ? background : location).pathname;
  const chatRoute = mode.startsWith("/chat");
  if (
    (location.pathname === "/library" && !admin) ||
    (chatRoute && !chat) ||
    (mode === "/dream" && !dream)
  )
    return <Navigate to="/images" replace />;
  return (
    <GenerationProvider workspace={chatRoute ? "chat" : "gallery"} remember>
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
                      // The Chats list stays outside Suspense so a selection or search started while
                      // the page loads survives it.
                      <ChatWorkspace>
                        <Suspense fallback={<LoadingState fill label="Loading Chat" />}>
                          <ChatPage />
                        </Suspense>
                      </ChatWorkspace>
                    }
                  />
                  <Route path="*" element={<Navigate to="/images" replace />} />
                </Routes>
              </div>
            </AppShell.Main>
            <Modal
              id="workspace"
              opened={!!overlay}
              onClose={closeWhenTop("workspace", () =>
                location.state?.backgroundLocation
                  ? navigate(-1)
                  : navigate("/images", { replace: true }),
              )}
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
              size={1320}
              styles={{
                content: {
                  height: phone ? "100dvh" : "min(92dvh, 1040px)",
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
              {resumeSection ? (
                <Navigate
                  to={{ pathname: location.pathname, search: location.search, hash: resumeSection }}
                  replace
                  state={location.state}
                />
              ) : panel === "library" ? (
                admin ? (
                  <Suspense fallback={<LoadingState label="Loading Library" fill />}>
                    <LibraryPage />
                  </Suspense>
                ) : (
                  <LoadingState label="Loading Library" fill />
                )
              ) : (
                <Suspense fallback={<LoadingState label="Loading Settings" fill />}>
                  <SettingsPage />
                </Suspense>
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
