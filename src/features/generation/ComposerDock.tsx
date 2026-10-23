import { useEffect, useState } from "react";
import { Button, Drawer, Group, Paper } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useSearchParams } from "react-router";
import { GenerationForm } from "./GenerationForm";
export function ComposerDock() {
  const [params, setParams] = useSearchParams();
  const [opened, { open, close }] = useDisclosure(params.get("compose") === "1");
  const narrow = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [keyboardInset, setKeyboardInset] = useState(0);
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
  function collapse() {
    close();
    if (params.has("compose")) {
      const next = new URLSearchParams(params);
      next.delete("compose");
      setParams(next, { replace: true });
    }
  }
  return (
    <>
      <div
        className="studio-composer-dock"
        hidden={narrow && opened}
        style={{
          bottom: `calc(${narrow ? ".5rem" : "1rem"} + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
        }}
      >
        {!(narrow && opened) && (
          <Paper p="md" radius="xl" shadow="xl">
            {opened && !narrow ? (
              <div className="studio-expanded-composer">
                <Group justify="space-between" mb="md">
                  <Button variant="subtle" color="gray" size="compact-sm" onClick={collapse}>
                    Collapse Controls
                  </Button>
                </Group>
                <GenerationForm onSubmitted={collapse} />
              </div>
            ) : (
              <GenerationForm compact onControls={open} />
            )}
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
        >
          <GenerationForm onSubmitted={collapse} />
        </Drawer>
      )}
    </>
  );
}
