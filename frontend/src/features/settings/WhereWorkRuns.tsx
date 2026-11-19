import { SegmentedControl, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { isCloudProfile } from "../../../../shared/profiles";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { assistantQuery } from "../generation/PromptAssistant";
import { TextModelSelect } from "../generation/TextModelSelect";
import {
  type SidePreference,
  type WorkKind,
  defaultModelKeys,
  preferencesQuery,
  useSavePreferences,
} from "./accountPreferences";

/** The model a side uses until the account picks one. */
const studioDefault = "Studio's Default";
const sides: { value: SidePreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
const kinds: { kind: WorkKind; label: string; description: string }[] = [
  { kind: "images", label: "Images", description: "Where new images run until you pick a model." },
  {
    kind: "videos",
    label: "Videos",
    description: "Where new videos and Animate run until you pick a model.",
  },
  {
    kind: "text",
    label: "Text",
    description:
      "Where prompt writing, titles, captions, suggestions and Dream's writing run. Local shares a GPU with images.",
  },
];

/** Settings › Where Work Runs: default processing and models by media kind. */
export function WhereWorkRuns() {
  const account = useAccount().data;
  const status = useQuery(preferencesQuery).data;
  const profiles = useQuery(modelsQuery).data?.profiles;
  const assistant = useQuery(assistantQuery).data;
  const save = useSavePreferences();
  if (!status) return null;
  const { preferences } = status;
  const cloud =
    preferences.cloudModels && (account?.mode === "single-user" || status.grants.cloudModels);
  const defaultRow = (kind: WorkKind, side: SidePreference) => {
    const key = defaultModelKeys[kind][side];
    const sideLabel = side === "cloud" ? "Cloud" : "Local";
    const name = `${sideLabel} Model`;
    const value = preferences[key] ?? null;
    const choose = (choice: string | null) => save.mutate({ [key]: choice || null });
    const text = (assistant?.models || []).filter(
      (model) => model.startsWith("local/") === (side === "local"),
    );
    return (
      <SettingRow key={key} wide label={name} description="Used until you pick another model.">
        {kind === "text" ? (
          <TextModelSelect
            name={name}
            models={text}
            unset={studioDefault}
            value={value}
            onChange={choose}
          />
        ) : (
          <ProfileSelect
            field
            name={name}
            unset={studioDefault}
            profiles={(profiles || []).filter(
              (profile) =>
                profile.kind === (kind === "images" ? "image" : "video") &&
                isCloudProfile(profile) === (side === "cloud"),
            )}
            value={value}
            onChange={(profile) => choose(profile?.id ?? null)}
          />
        )}
      </SettingRow>
    );
  };
  return (
    <Stack gap="lg">
      {kinds.map(({ kind, label, description }) => (
        <SettingGroup key={kind} title={label}>
          {cloud && (
            <SettingRow wide label="Default" description={description}>
              <SegmentedControl
                aria-label="Default"
                fullWidth
                data={sides}
                value={
                  preferences[kind] ||
                  (kind === "text" ? assistant?.defaultTextSide || "cloud" : "local")
                }
                onChange={(side) => save.mutate({ [kind]: side as SidePreference })}
              />
            </SettingRow>
          )}
          {cloud && defaultRow(kind, "cloud")}
          {defaultRow(kind, "local")}
        </SettingGroup>
      ))}
    </Stack>
  );
}
