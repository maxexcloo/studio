import { Fragment } from "react";
import { Group, Kbd, Stack, Switch, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { useShareWithoutSettings } from "../gallery/mediaShare";
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
  const client = useQueryClient();
  const account = useAccount();
  const admin = useIsAdmin();
  const historyAllowed = admin || account.data?.account?.features?.promptHistory === true;
  const history = useQuery({
    queryKey: ["prompt-history", "positive"],
    queryFn: () => api<{ enabled: boolean }>("/api/prompts?kind=positive"),
    enabled: historyAllowed,
  });
  const keepPrompts = useMutation({
    mutationFn: (enabled: boolean) => post("/api/prompts/enabled", { enabled }),
    onSettled: () => void client.invalidateQueries({ queryKey: ["prompt-history"] }),
  });
  const [shareWithoutSettings, setShareWithoutSettings] = useShareWithoutSettings();
  return (
    <Stack gap="lg">
      <SettingGroup title="Generation">
        {historyAllowed && (
          <SettingRow
            label="Keep Recent Prompts"
            description="Offer your recent prompts in the composer’s history. Pinned prompts stay either way."
          >
            <Switch
              aria-label="Keep Recent Prompts"
              checked={keepPrompts.isPending ? keepPrompts.variables : !!history.data?.enabled}
              disabled={!history.data || keepPrompts.isPending}
              onChange={(event) => keepPrompts.mutate(event.currentTarget.checked)}
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
