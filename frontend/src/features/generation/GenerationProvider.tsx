import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useForm } from "@mantine/form";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { GenerationInput, MediaKind, Models, Profile, ReferenceAsset } from "../../types";
import { api } from "../../api";
import { useAccount } from "../auth/AccountGate";
import { isProfile } from "./payload";

export const modelsQuery = queryOptions({
  queryKey: ["models"],
  queryFn: () => api<Models>("/api/models?cached=1"),
});
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
export function inputForProfile(previous: GenerationInput, profile: Profile): GenerationInput {
  return {
    ...initialInput,
    ...profile.defaults,
    prompt: previous.prompt,
    negative: previous.negative,
    referenceAssets: previous.referenceAssets,
    referenceDetails: previous.referenceDetails,
    kind: profile.kind,
    profileId: profile.id,
    model: profile.model,
    workflow: profile.workflow,
    backendId: profile.workerIds?.includes(String(previous.backendId))
      ? previous.backendId
      : profile.workerIds?.[0],
    loras: previous.loras,
  };
}
/** The configured default for an output, else its first ready profile, else any. */
export function defaultProfile(models: Models | undefined, kind: MediaKind) {
  const profiles = models?.profiles ?? emptyProfiles;
  const selected = kind === "image" ? models?.defaults?.imageModel : models?.defaults?.videoModel;
  return (
    profiles.find((profile) => profile.id === selected && profile.kind === kind) ||
    profiles.find((profile) => profile.kind === kind && profile.ready !== false) ||
    profiles.find((profile) => profile.kind === kind)
  );
}
export interface Draft {
  input: GenerationInput;
  references: ReferenceAsset[];
  sessionId: string;
  operation: "image" | "refine" | "animate";
  parentJobId?: string;
  /** The result in `parentJobId` this draft makes a version of. */
  parentItemId?: string;
  presetId?: string;
  presetTitle?: string;
}
const empty: Draft = {
  input: initialInput,
  references: [],
  sessionId: "",
  operation: "image",
  parentJobId: undefined,
  parentItemId: undefined,
  presetId: undefined,
  presetTitle: undefined,
};
const emptyProfiles: Profile[] = [];
type Workspace = "chat" | "gallery";
const initialDrafts: Record<MediaKind, Draft> = {
  image: empty,
  video: { ...empty, input: { ...initialInput, kind: "video" }, operation: "animate" },
};
/** The gallery composer's image and video drafts as last saved for this account, over the defaults. */
function savedDrafts(key: string): Record<MediaKind, Draft> {
  const saved: Partial<Record<MediaKind, Draft>> = key
    ? JSON.parse(localStorage.getItem(key) || "{}")
    : {};
  const restore = (kind: MediaKind) => ({
    ...initialDrafts[kind],
    ...saved[kind],
    input: { ...initialDrafts[kind].input, ...saved[kind]?.input },
  });
  return { image: restore("image"), video: restore("video") };
}
function useGenerationState(workspace: Workspace, remember: boolean) {
  // A Chat card staged by Refine, Animate or Recreate keeps its own input beside the composer's.
  const [staged, setStaged] = useState<Draft | null>(null);
  // The gallery composer's drafts survive a reload, saved per account as they change.
  const account = useAccount().data?.account?.id;
  const storageKey = remember ? `studio-composer-draft:${account ?? "local"}` : "";
  const [restored] = useState(() => savedDrafts(storageKey));
  const drafts = useRef({ chat: { ...initialDrafts }, gallery: restored });
  const chatForm = useForm<Draft>({ mode: "controlled", initialValues: empty });
  const galleryForm = useForm<Draft>({ mode: "controlled", initialValues: restored.image });
  const galleryDraft = galleryForm.values;
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(drafts.current.gallery));
  }, [galleryDraft, storageKey]);
  const form = workspace === "chat" ? chatForm : galleryForm;
  const draft = form.values;
  const forms = useRef({ chat: chatForm, gallery: galleryForm });
  forms.current = { chat: chatForm, gallery: galleryForm };
  const setDraft = useCallback(
    (value: Draft | ((previous: Draft) => Draft), target: Workspace = workspace) => {
      const targetForm = forms.current[target];
      const previous = targetForm.getValues();
      const next = {
        ...empty,
        ...(typeof value === "function" ? value(previous) : value),
      };
      drafts.current[target][previous.input.kind] = previous;
      drafts.current[target][next.input.kind] = next;
      targetForm.setValues(next);
    },
    [workspace],
  );
  const changeKind = useCallback(
    (kind: MediaKind, target: Workspace = workspace) => {
      if (forms.current[target].getValues().input.kind !== kind)
        setDraft(drafts.current[target][kind], target);
    },
    [setDraft, workspace],
  );
  const models = useQuery({ ...modelsQuery, refetchInterval: 15000 });
  const profiles = models.data?.profiles ?? emptyProfiles;
  const profile = draft.input.profileId
    ? profiles.find((profile) => isProfile(profile, draft.input.profileId))
    : defaultProfile(models.data, draft.input.kind);
  function update(patch: Partial<GenerationInput>) {
    setDraft((previous) => ({ ...previous, input: { ...previous.input, ...patch } }));
  }
  function selectProfile(profile: Profile) {
    // The output toggle restores that mode's whole draft, including its chosen profile.
    if (form.getValues().input.kind !== profile.kind) {
      changeKind(profile.kind);
      return;
    }
    setDraft((previous) => ({
      ...previous,
      input: inputForProfile(previous.input, profile),
      operation: profile.kind === "video" ? "animate" : previous.operation,
    }));
  }
  return {
    form,
    draft,
    setDraft,
    changeKind,
    input: draft.input,
    update,
    profiles,
    profile,
    models,
    selectProfile,
    staged,
    setStaged,
  };
}
const Context = createContext<ReturnType<typeof useGenerationState> | null>(null);
const GenerationActionsContext = createContext<Pick<
  ReturnType<typeof useGenerationState>,
  "profiles" | "setDraft" | "changeKind" | "setStaged"
> | null>(null);
export function GenerationProvider({
  children,
  workspace,
  remember = false,
}: {
  children: ReactNode;
  workspace: Workspace;
  /** Keeps the gallery draft across reloads: the page's provider, not a surface's own. */
  remember?: boolean;
}) {
  const value = useGenerationState(workspace, remember);
  const actions = useMemo(
    () => ({
      profiles: value.profiles,
      setDraft: value.setDraft,
      changeKind: value.changeKind,
      setStaged: value.setStaged,
    }),
    [value.profiles, value.setDraft, value.changeKind, value.setStaged],
  );
  return (
    <GenerationActionsContext.Provider value={actions}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </GenerationActionsContext.Provider>
  );
}
export function useGenerationActions() {
  const context = useContext(GenerationActionsContext);
  if (!context) throw new Error("GenerationProvider is required");
  return context;
}
export function useGeneration() {
  const context = useContext(Context);
  if (!context) throw new Error("GenerationProvider is required");
  return context;
}
