import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import type { GenerationInput, Models, Profile, ReferenceAsset } from "../../types";
import { api } from "../../api";

export const initialInput: GenerationInput = {
  kind: "image",
  profileId: "",
  prompt: "",
  negative: "",
  width: 1024,
  height: 1024,
  steps: 20,
  cfg: 5,
  seed: "",
  count: 1,
  denoise: 0.65,
  fps: 24,
  frames: 81,
  loras: [],
  referenceAssets: [],
};
interface Draft {
  input: GenerationInput;
  references: ReferenceAsset[];
  sessionId: string;
  operation: "image" | "refine" | "animate";
  parentJobId?: string;
  presetId?: string;
  presetTitle?: string;
}
const empty: Draft = {
  input: initialInput,
  references: [],
  sessionId: "",
  operation: "image",
  parentJobId: undefined,
  presetId: undefined,
  presetTitle: undefined,
};
function useGenerationState() {
  const form = useForm<Draft>({
    mode: "controlled",
    initialValues: empty,
    validate: {
      input: { prompt: (value) => (value.trim() ? null : "Describe what you want to create.") },
    },
  });
  const draft = form.values;
  const setDraft = useCallback(
    (value: Draft | ((previous: Draft) => Draft)) => {
      form.setValues({
        ...empty,
        ...(typeof value === "function" ? value(form.getValues()) : value),
      });
    },
    [form.getValues, form.setValues],
  );
  const models = useQuery({ queryKey: ["models"], queryFn: () => api<Models>("/api/models") });
  const profiles = models.data?.profiles ?? [];
  const selectedDefault =
    draft.input.kind === "image"
      ? models.data?.defaults?.imageModel
      : models.data?.defaults?.videoModel;
  const profile = draft.input.profileId
    ? profiles.find((profile) => profile.id === draft.input.profileId)
    : profiles.find(
        (profile) => profile.id === selectedDefault && profile.kind === draft.input.kind,
      ) ||
      profiles.find((profile) => profile.kind === draft.input.kind && profile.ready !== false) ||
      profiles.find((profile) => profile.kind === draft.input.kind);
  function update(patch: Partial<GenerationInput>) {
    setDraft((previous) => ({ ...previous, input: { ...previous.input, ...patch } }));
  }
  function selectProfile(profile: Profile) {
    setDraft((previous) => ({
      ...previous,
      input: {
        ...initialInput,
        ...profile.defaults,
        prompt: previous.input.prompt,
        negative: previous.input.negative,
        referenceAssets: previous.input.referenceAssets,
        kind: profile.kind,
        profileId: profile.id,
        model: profile.model,
        workflow: profile.workflow,
        backendId: profile.workerIds?.includes(String(previous.input.backendId))
          ? previous.input.backendId
          : profile.workerIds?.[0],
        loras: [],
      } as GenerationInput,
    }));
  }
  return {
    form,
    draft,
    setDraft,
    input: draft.input,
    update,
    profiles,
    profile,
    models,
    selectProfile,
  };
}
const Context = createContext<ReturnType<typeof useGenerationState> | null>(null);
export function GenerationProvider({ children }: { children: ReactNode }) {
  const value = useGenerationState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useGeneration() {
  const context = useContext(Context);
  if (!context) throw new Error("GenerationProvider is required");
  return context;
}
