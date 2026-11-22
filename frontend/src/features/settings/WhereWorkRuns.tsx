import { Alert, SegmentedControl, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { defaultModelKeys, isCloudProfile } from "../../../../shared/profiles";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount, useGroupFeature } from "../auth/AccountGate";
import { lockedByAdministrator, useDreamSettings } from "../dream/DreamSettings";
import { dreamQuery } from "../dream/queries";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { assistantQuery } from "../generation/PromptAssistant";
import { TextModelSelect } from "../generation/TextModelSelect";
import {
  type SidePreference,
  type WorkKind,
  preferencesQuery,
  useSavePreferences,
} from "./accountPreferences";

/** The model a side uses until the account picks one. */
const studioDefault = "Studio's Default";
const sides: { value: SidePreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
const kinds: { kind: WorkKind; label: string; description?: string }[] = [
  { kind: "images", label: "Images" },
  { kind: "videos", label: "Videos", description: "Applies to video generation and Animate." },
  {
    kind: "text",
    label: "Text",
    description:
      "Applies to writing and captions, including Dream. Local shares a GPU with images.",
  },
];

function DreamProcessing() {
  const { data, error } = useQuery(dreamQuery);
  const save = useDreamSettings();
  return (
    <SettingGroup title="Dream">
      {!data ? (
        error ? (
          <Alert color="red">{error.message}</Alert>
        ) : (
          <LoadingState label="Loading Dream" fill />
        )
      ) : (
        (["images", "videos"] as const).map((kind) => {
          const label = kind === "images" ? "Images" : "Videos";
          const key = kind === "images" ? "imageBackend" : "videoBackend";
          const locked = data.locked.includes(key);
          return (
            <SettingRow
              key={key}
              wide
              label={label}
              description={locked ? lockedByAdministrator : "Waits for an available model."}
            >
              <SegmentedControl
                role="radiogroup"
                aria-label={`Dream ${label}`}
                fullWidth
                value={data.settings[key]}
                disabled={locked || !data.settings[kind]}
                data={sides}
                onChange={(value) => save.mutate({ [key]: value })}
              />
            </SettingRow>
          );
        })
      )}
      {save.error && <Alert color="red">{save.error.message}</Alert>}
    </SettingGroup>
  );
}

/** Settings › Where Work Runs: default processing and models by media kind. */
export function WhereWorkRuns() {
  const account = useAccount().data;
  const dream = useGroupFeature("dream");
  const { data: status, error } = useQuery(preferencesQuery);
  const profiles = useQuery(modelsQuery).data?.profiles;
  const assistant = useQuery(assistantQuery).data;
  const save = useSavePreferences();
  if (!status)
    return error ? (
      <Alert color="red">{error.message}</Alert>
    ) : (
      <LoadingState fill label="Loading Work Preferences" />
    );
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
      <SettingRow key={key} wide label={name}>
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
            <SettingRow wide label="Run On" description={description}>
              <SegmentedControl
                aria-label="Run On"
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
      {dream && <DreamProcessing />}
    </Stack>
  );
}
