import { Alert, SegmentedControl, Select, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { defaultModelKeys, isCloudProfile } from "../../../../shared/profiles";
import {
  grokVideoAspects,
  imageAspects,
  maxImageCount,
  resolutions,
  videoResolutions,
} from "../../../../shared/resolution";
import { LoadFailed } from "../../ui/LoadFailed";
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

/** The choice of no preference, listed first and shown selected. */
const studioDefault = "Default (Studio)";
const profileDefault = { value: "", label: "Default (Model)" };
const runs = { images: "images run", text: "writing runs", videos: "videos run" } as const;
const sides: { value: SidePreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
const kinds: { kind: WorkKind | "dream"; label: string; description?: string }[] = [
  { kind: "images", label: "Images", description: "Applies to image generation and edits." },
  { kind: "videos", label: "Videos", description: "Applies to video generation and Animate." },
  { kind: "dream", label: "Dream" },
  {
    kind: "text",
    label: "Text",
    description: "Applies to writing and captions. Local shares a GPU with images.",
  },
];

function DreamProcessing({ label }: { label: string }) {
  const { data, error } = useQuery(dreamQuery);
  const save = useDreamSettings();
  return (
    <SettingGroup title={label}>
      {!data ? (
        error ? (
          <LoadFailed error={error}>Couldn't Load Dream</LoadFailed>
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

/** Personal processing, model and output defaults. */
export function WhereWorkRuns() {
  const dream = useGroupFeature("dream");
  const cloud = useGroupFeature("cloudModels");
  const { data: status, error } = useQuery(preferencesQuery);
  const profiles = useQuery(modelsQuery).data?.profiles;
  const assistant = useQuery(assistantQuery).data;
  const save = useSavePreferences();
  if (!status)
    return error ? (
      <LoadFailed error={error}>Couldn't Load Where Work Runs</LoadFailed>
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
      <SettingRow
        key={key}
        wide
        label={name}
        description={`Used when ${runs[kind]} ${side === "cloud" ? "in the cloud" : "on this machine"}.`}
      >
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
            {(kind === "images" || kind === "videos") && (
              <>
                <SettingRow
                  wide
                  label="Default Aspect"
                  description={
                    kind === "images"
                      ? "The starting shape for image drafts, where supported."
                      : "The starting shape for video drafts. A start frame can override it."
                  }
                >
                  <Select
                    aria-label="Default Aspect"
                    data={[
                      profileDefault,
                      ...(kind === "images" ? imageAspects : grokVideoAspects),
                    ]}
                    value={
                      (kind === "images" ? preferences.imageAspect : preferences.videoAspect) ?? ""
                    }
                    allowDeselect={false}
                    onChange={(choice) =>
                      save.mutate(
                        kind === "images"
                          ? { imageAspect: imageAspects.find((value) => value === choice) ?? null }
                          : {
                              videoAspect:
                                grokVideoAspects.find((value) => value === choice) ?? null,
                            },
                      )
                    }
                  />
                </SettingRow>
                {kind === "images" && (
                  <SettingRow
                    wide
                    label="Default Count"
                    description="How many images new drafts make, where the model can."
                  >
                    <Select
                      aria-label="Default Count"
                      data={[
                        profileDefault,
                        ...Array.from({ length: maxImageCount }, (_, index) => ({
                          value: String(index + 1),
                          label: plural(index + 1, "Image"),
                        })),
                      ]}
                      value={preferences.imageCount ? String(preferences.imageCount) : ""}
                      allowDeselect={false}
                      onChange={(choice) =>
                        save.mutate({ imageCount: choice ? Number(choice) : null })
                      }
                    />
                  </SettingRow>
                )}
                <SettingRow
                  wide
                  label="Default Resolution"
                  description={
                    kind === "images"
                      ? "The starting resolution for image drafts, where supported."
                      : "The starting resolution for video drafts and Animate."
                  }
                >
                  <Select
                    aria-label="Default Resolution"
                    data={[profileDefault, ...(kind === "images" ? resolutions : videoResolutions)]}
                    value={
                      (kind === "images"
                        ? preferences.imageResolution
                        : preferences.videoResolution) ?? ""
                    }
                    allowDeselect={false}
                    onChange={(choice) =>
                      save.mutate(
                        kind === "images"
                          ? {
                              imageResolution:
                                resolutions.find((value) => value === choice) ?? null,
                            }
                          : {
                              videoResolution:
                                videoResolutions.find((value) => value === choice) ?? null,
                            },
                      )
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
