import { SegmentedControl, Switch, Text } from "@mantine/core";

import type { DreamSettings } from "../../../../shared/dream";
import { NumberSetting } from "../../ui/NumberSetting";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { type Deployment, lockedNote } from "./deployment";

export function DreamAdministration({
  settings,
  save,
}: {
  settings: Deployment["dream"];
  save(change: { key: string; value: string | boolean | number }): void;
}) {
  const toggle = (name: keyof DreamSettings, label: string, description: string) => {
    const setting = settings[name];
    return (
      <SettingRow label={label} description={description + lockedNote(setting)}>
        <Switch
          aria-label={`Default Dream ${label}`}
          checked={Boolean(setting.value)}
          disabled={setting.locked}
          onChange={(event) => save({ key: setting.key, value: event.currentTarget.checked })}
        />
      </SettingRow>
    );
  };
  const media = (kind: "image" | "video", label: string) => {
    const cap = settings[kind === "image" ? "dailyImages" : "dailyVideos"];
    const backend = settings[kind === "image" ? "imageBackend" : "videoBackend"];
    return (
      <>
        {toggle(
          kind === "image" ? "images" : "videos",
          label,
          `Make ${label.toLowerCase()} while Studio is idle.`,
        )}
        <SettingRow
          label={`${label} per Day`}
          description={`Daily default per account.${lockedNote(cap)}`}
        >
          <NumberSetting
            key={`${cap.key}:${cap.value}`}
            label={`Default Dream ${label} per Day`}
            value={cap.value}
            min={0}
            max={kind === "image" ? 500 : 100}
            disabled={cap.locked}
            onSave={(value) => save({ key: cap.key, value })}
          />
        </SettingRow>
        <SettingRow
          label={`${label} Run On`}
          description={`Uses ready models allowed for the account; waits if this backend is unavailable.${lockedNote(backend)}`}
        >
          <SegmentedControl
            role="radiogroup"
            aria-label={`Default Dream ${label} Run On`}
            value={backend.value}
            disabled={backend.locked}
            data={[
              { value: "local", label: "Local" },
              { value: "cloud", label: "Cloud" },
            ]}
            onChange={(value) => save({ key: backend.key, value })}
          />
        </SettingRow>
      </>
    );
  };
  return (
    <SettingGroup title="Dream">
      <Text size="sm" c="dimmed">
        Defaults for accounts without a saved choice. Existing account settings take precedence.
        Cloud needs access to a ready cloud model.
      </Text>
      {toggle("enabled", "Enabled", "Make new media from each account's taste.")}
      {media("image", "Images")}
      {toggle("paused", "Paused", "Pause idle generation by default.")}
      {toggle(
        "spicy",
        "Spicy",
        "Allow explicit themes only for accounts with Uncensored Models access.",
      )}
      {media("video", "Videos")}
    </SettingGroup>
  );
}
