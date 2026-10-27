import { Fragment } from "react";
import { Group, Kbd, Stack, Switch, Text } from "@mantine/core";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { useKeepRecentPrompts } from "../generation/PromptHistory";
import { useShareWithoutSettings } from "../gallery/mediaShare";
import { useTileCaptions } from "../gallery/useGalleryLayout";
import { FinishStarredImages } from "./FinishStarredImages";
import { SettingGroup, SettingRow } from "./SettingRows";

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const shortcuts: { keys: string[][]; action: string }[] = [
  { keys: [["/"], [mod, "F"]], action: "Search the Gallery" },
  { keys: [[mod, "Enter"]], action: "Generate" },
  { keys: [["Enter"]], action: "Send a Chat Message" },
  { keys: [["Shift", "Enter"]], action: "New Line in Chat" },
  { keys: [["←"], ["→"]], action: "Previous or Next in the Viewer" },
  { keys: [["F"]], action: "Star the Viewed Item" },
  { keys: [["Delete"]], action: "Delete the Viewed Item" },
  { keys: [["+"], ["−"], ["0"]], action: "Zoom In, Out or Fit" },
  { keys: [["Esc"]], action: "Close Search, Panels and the Viewer" },
];

/** Settings › Studio: preferences that change how Studio behaves for you. */
export function StudioPreferences() {
  const account = useAccount();
  const admin = useIsAdmin();
  const historyAllowed = admin || account.data?.account?.features?.promptHistory === true;
  const galleryAllowed = admin || account.data?.account?.features?.gallery === true;
  const keep = useKeepRecentPrompts(historyAllowed);
  const [shareWithoutSettings, setShareWithoutSettings] = useShareWithoutSettings();
  const [tileCaptions, setTileCaptions] = useTileCaptions();
  return (
    <Stack gap="lg">
      <SettingGroup title="Generation">
        {historyAllowed && (
          <SettingRow
            label="Keep Recent Prompts"
            description="Offer your recent prompts in the composer’s history. Pinned prompts stay either way."
          >
            <Switch
              // Remounts once loaded so the saved state appears without the thumb sliding.
              key={keep.history.data ? "loaded" : "loading"}
              aria-label="Keep Recent Prompts"
              checked={!!keep.history.data?.enabled}
              disabled={!keep.history.data}
              onChange={(event) => keep.change.mutate(event.currentTarget.checked)}
            />
          </SettingRow>
        )}
        <SettingRow
          label="Share Without Settings"
          description="Leave the prompt, seed and workflow out of files you download or share."
        >
          <Switch
            aria-label="Share Without Settings"
            checked={shareWithoutSettings}
            onChange={(event) => setShareWithoutSettings(event.currentTarget.checked)}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Gallery">
        <SettingRow
          label="Tile Captions"
          description="Show each tile’s title and details on phones. Desktop shows them on hover."
        >
          <Switch
            aria-label="Tile Captions"
            checked={tileCaptions}
            onChange={(event) => setTileCaptions(event.currentTarget.checked)}
          />
        </SettingRow>
        {galleryAllowed && <FinishStarredImages />}
      </SettingGroup>
      <SettingGroup title="Keyboard Shortcuts">
        {shortcuts.map((shortcut) => (
          <SettingRow key={shortcut.action} label={shortcut.action}>
            {shortcut.keys.map((combo, index) => (
              <Fragment key={combo.join("+")}>
                {index > 0 && (
                  <Text span size="xs" c="dimmed">
                    or
                  </Text>
                )}
                <Group gap={2} wrap="nowrap">
                  {combo.map((key) => (
                    <Kbd key={key} size="xs">
                      {key}
                    </Kbd>
                  ))}
                </Group>
              </Fragment>
            ))}
          </SettingRow>
        ))}
      </SettingGroup>
    </Stack>
  );
}
