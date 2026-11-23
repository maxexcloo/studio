import { Alert, SegmentedControl, Select, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { defaultModelKeys, isCloudProfile } from "../../../../shared/profiles";
import { imageAspects, maxImageCount, resolutions } from "../../../../shared/resolution";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useGroupFeature } from "../auth/AccountGate";
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
const studioDefault = "Studio Default";
const sides: { value: SidePreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
const kinds: { kind: WorkKind | "dream"; label: string; description?: string }[] = [
  { kind: "images", label: "Images" },
  { kind: "videos", label: "Videos", description: "Applies to video generation and Animate." },
  { kind: "dream", label: "Dream" },
  {
    kind: "text",
    label: "Text",
    description:
      "Applies to writing and captions, including Dream. Local shares a GPU with images.",
  },
];

function DreamProcessing({ label }: { label: string }) {
  const { data, error } = useQuery(dreamQuery);
  const save = useDreamSettings();
  return (
    <SettingGroup title={label}>
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
          const makes = data.settings[kind];
          return (
            <SettingRow
              key={key}
              wide
              label={label}
              description={
                locked
                  ? lockedByAdministrator
                  : makes
                    ? "Waits for an available model."
                    : `Dream makes no ${kind}; turn them on in Settings › Dream.`
              }
            >
              <SegmentedControl
                role="radiogroup"
                aria-label={`Dream ${label}`}
                fullWidth
                value={data.settings[key]}
                disabled={locked || !makes}
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

/** Personal processing, model and image defaults. */
export function WhereWorkRuns() {
  const dream = useGroupFeature("dream");
  const cloud = useGroupFeature("cloudModels");
  const { data: status, error } = useQuery(preferencesQuery);
  const profiles = useQuery(modelsQuery).data?.profiles;
  const assistant = useQuery(assistantQuery).data;
  const save = useSavePreferences();
  if (!status)
    return error ? (
      <Alert color="red">{error.message}</Alert>
    ) : (
      <LoadingState fill label="Loading Where Work Runs" />
    );
  const { preferences } = status;
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
            clearable
            value={value}
            onChange={choose}
          />
        ) : (
          <ProfileSelect
            field
            name={name}
            unset={studioDefault}
            clearable
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
      {kinds.map(({ kind, label, description }) =>
        kind === "dream" ? (
          dream && cloud && <DreamProcessing key={kind} label={label} />
        ) : kind === "text" && !assistant?.available ? null : (
          <SettingGroup key={kind} title={label}>
            {cloud && (
              <SettingRow wide label="Run On" description={description}>
                <SegmentedControl
                  aria-label={`${label} Run On`}
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
            {kind === "images" && (
              <>
                <SettingRow
                  wide
                  label="Default Aspect"
                  description="The starting shape for image drafts when the model supports it."
                >
                  <Select
                    aria-label="Default Aspect"
                    placeholder="Profile Default"
                    data={[...imageAspects]}
                    value={preferences.imageAspect ?? null}
                    clearable
                    onChange={(choice) =>
                      save.mutate({
                        imageAspect: imageAspects.find((value) => value === choice) ?? null,
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  wide
                  label="Default Count"
                  description="How many images new image drafts make when the model can make several."
                >
                  <Select
                    aria-label="Default Count"
                    data={Array.from({ length: maxImageCount }, (_, index) => ({
                      value: String(index + 1),
                      label: plural(index + 1, "Image"),
                    }))}
                    placeholder="Profile Default"
                    value={preferences.imageCount ? String(preferences.imageCount) : null}
                    clearable
                    onChange={(choice) =>
                      save.mutate({ imageCount: choice ? Number(choice) : null })
                    }
                  />
                </SettingRow>
                <SettingRow
                  wide
                  label="Default Resolution"
                  description="The starting resolution for image drafts when the model supports it."
                >
                  <Select
                    aria-label="Default Resolution"
                    placeholder="Profile Default"
                    data={[...resolutions]}
                    value={preferences.imageResolution ?? null}
                    clearable
                    onChange={(choice) =>
                      save.mutate({
                        imageResolution: resolutions.find((value) => value === choice) ?? null,
                      })
                    }
                  />
                </SettingRow>
              </>
            )}
          </SettingGroup>
        ),
      )}
    </Stack>
  );
}
