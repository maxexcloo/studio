import { useEffect, useId, useRef, useState } from "react";
import { Button, Collapse, Drawer, Group, Paper, SegmentedControl } from "@mantine/core";
import {
  useClickOutside,
  useDisclosure,
  useMediaQuery,
  useMergedRef,
  useReducedMotion,
} from "@mantine/hooks";
import { ChevronDown } from "lucide-react";
import { useSearchParams } from "react-router";
import { GenerationForm } from "./GenerationForm";
import { useGeneration } from "./GenerationProvider";
import { ChatComposer } from "../sessions/ChatComposer";
import { galleryReferenceType, useGalleryReference } from "./references";
import { failure } from "../../api";
export function ComposerDock({ chat = false }: { chat?: boolean }) {
  const { draft } = useGeneration();
  const [manual, setManual] = useState(false);
  const [params, setParams] = useSearchParams();
  const [opened, { open, close }] = useDisclosure(params.get("compose") === "1");
  const narrow = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const reducedMotion = useReducedMotion();
  const dock = useRef<HTMLDivElement>(null);
  const returningFocus = useRef(false);
  const focusIntent = useRef("[data-model-picker]");
  const [dragging, setDragging] = useState(false);
  const reference = useGalleryReference();
  const controlsId = useId();
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    if (chat && draft.parentJobId) setManual(true);
  }, [chat, draft.parentJobId, draft.operation]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () =>
      setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);
  useEffect(() => {
    if (params.get("compose") === "1") open();
  }, [params, open]);
  function collapse(restoreFocus = true) {
    returningFocus.current = restoreFocus;
    close();
    if (params.has("compose")) {
      const next = new URLSearchParams(params);
      next.delete("compose");
      setParams(next, { replace: true });
    }
  }
  function focusCompact() {
    if (!returningFocus.current) return;
    dock.current
      ?.querySelector<HTMLButtonElement>("[data-generation-controls]")
      ?.focus({ preventScroll: true });
    returningFocus.current = false;
  }
  const outside = useClickOutside<HTMLDivElement>(
    (event) => {
      if (
        (event.target as HTMLElement).closest(
          '[role="dialog"], [data-composer-layer], .mantine-Combobox-dropdown, .mantine-Popover-dropdown',
        )
      )
        return;
      collapse(false);
    },
    ["mousedown", "touchstart"],
    undefined,
    !narrow && opened,
  );
  const dockRef = useMergedRef(dock, outside);
  useEffect(() => {
    if (narrow) return;
    const frame = requestAnimationFrame(() => {
      if (opened)
        dock.current
          ?.querySelector<HTMLElement>(focusIntent.current)
          ?.focus({ preventScroll: true });
      else focusCompact();
    });
    return () => cancelAnimationFrame(frame);
  }, [opened, narrow]);
  return (
    <>
      <div
        ref={dockRef}
        className="studio-composer-dock"
        hidden={narrow && opened}
        data-reference-drop={dragging || undefined}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(galleryReferenceType)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          const data = event.dataTransfer.getData(galleryReferenceType);
          if (!data) return;
          event.preventDefault();
          setDragging(false);
          try {
            reference.mutate(JSON.parse(data));
          } catch (error) {
            failure(error);
          }
        }}
        onKeyDown={(event) => {
          if (
            !narrow &&
            opened &&
            event.key === "Escape" &&
            !event.defaultPrevented &&
            event.currentTarget.contains(event.target as Node) &&
            !(event.target as HTMLElement).closest('[role="combobox"][aria-expanded="true"]')
          ) {
            event.preventDefault();
            collapse();
          }
        }}
        style={{
          bottom: `calc(${narrow ? ".5rem" : "1rem"} + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
        }}
      >
        {!(narrow && opened) && (
          <Paper p="md" radius="xl" shadow="xl" className="studio-composer-surface">
            {!narrow && (
              <Collapse
                expanded={opened}
                keepMounted={false}
                transitionDuration={reducedMotion ? 0 : 180}
                onTransitionEnd={() => {
                  if (opened)
                    dock.current
                      ?.querySelector<HTMLElement>(focusIntent.current)
                      ?.focus({ preventScroll: true });
                }}
              >
                <div
                  className="studio-expanded-composer"
                  id={controlsId}
                  role="region"
                  aria-label="Generation Controls"
                  aria-hidden={!opened}
                  inert={!opened}
                >
                  <Group justify="space-between" mb="md">
                    <Button
                      variant="subtle"
                      color="gray"
                      size="compact-sm"
                      onClick={() => collapse()}
                      leftSection={<ChevronDown size={16} />}
                    >
                      Collapse Controls
                    </Button>
                  </Group>
                  <GenerationForm onSubmitted={collapse} />
                </div>
              </Collapse>
            )}
            <Collapse
              expanded={!opened}
              keepMounted={false}
              transitionDuration={reducedMotion ? 0 : 180}
              onTransitionEnd={focusCompact}
            >
              <div
                aria-hidden={opened}
                inert={opened}
                onClick={(event) => {
                  if (
                    (chat && !manual) ||
                    (event.target as HTMLElement).closest(
                      'button,a,[role="radio"],input[type="radio"]',
                    )
                  )
                    return;
                  focusIntent.current = "[data-expanded-prompt]";
                  open();
                }}
              >
                {chat && (
                  <SegmentedControl
                    aria-label="Composer Mode"
                    size="xs"
                    mb="xs"
                    value={manual ? "generate" : "chat"}
                    onChange={(value) => setManual(value === "generate")}
                    data={[
                      { value: "chat", label: "Chat" },
                      { value: "generate", label: "Generate" },
                    ]}
                  />
                )}
                {chat && !manual ? (
                  <ChatComposer
                    onControls={() => {
                      focusIntent.current = "[data-model-picker]";
                      open();
                    }}
                  />
                ) : (
                  <GenerationForm
                    compact
                    onControls={() => {
                      focusIntent.current = "[data-model-picker]";
                      open();
                    }}
                  />
                )}
              </div>
            </Collapse>
          </Paper>
        )}
      </div>
      {narrow && (
        <Drawer
          opened={opened}
          onClose={collapse}
          title="Generation Controls"
          closeButtonProps={{ "aria-label": "Close Generation Controls" }}
          position="right"
          size="100%"
          returnFocus={false}
          onExitTransitionEnd={focusCompact}
        >
          <GenerationForm
            onSubmitted={collapse}
            autoFocusPrompt={focusIntent.current === "[data-expanded-prompt]"}
          />
        </Drawer>
      )}
    </>
  );
}
