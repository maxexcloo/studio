import { lazy, Suspense, useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  AspectRatio,
  Badge,
  Button,
  Checkbox,
  FileButton,
  Group,
  Image,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, failure, post } from "../../api";
import type { GenerationInput, ReferenceAsset, Session } from "../../types";
import { useGeneration } from "./GenerationProvider";
import { ModelPicker } from "./ModelPicker";
import { LoraPicker } from "./LoraPicker";
import { PresetEditor } from "./PresetEditor";
const MaskEditor = lazy(() => import("./MaskEditor"));

export function GenerationForm({
  onSubmitted,
  compact = false,
  onControls,
}: {
  onSubmitted?: () => void;
  compact?: boolean;
  onControls?: () => void;
}) {
  const { form, draft, setDraft, input, update, profile, profiles, selectProfile, models } =
    useGeneration();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [maskOpen, setMaskOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const assistant = useQuery({
    queryKey: ["assistant"],
    queryFn: () =>
      api<{
        available: boolean;
        defaultPreset: string;
        presets: { id: string; label?: string; name?: string }[];
      }>("/api/assistant"),
  });
  const [assistantPreset, setAssistantPreset] = useState<string | null>(null);
  useEffect(() => {
    if (!input.profileId && profile) selectProfile(profile);
  }, [input.profileId, profile]);
  const submit = useMutation({
    mutationFn: async () => {
      if (form.validate().hasErrors) throw new Error("Describe what you want to create.");
      if (!profile) throw new Error("Choose an available model first.");
      const payload = {
        ...input,
        profileId: profile.id,
        model: profile.model,
        workflow: profile.workflow,
        provider: profile.provider,
        profileName: profile.displayName || profile.label,
        referenceAssets: draft.references.length
          ? draft.references.map((asset, i) => ({
              assetId: asset.id,
              slot: profile.mediaInputs?.[i]?.id || profile.mediaInputs?.[0]?.id || "image",
            }))
          : input.referenceAssets,
        referenceDetails: draft.references,
        operation: draft.operation,
        parentJobId: draft.parentJobId,
      };
      let sessionId = draft.sessionId;
      if (!sessionId) {
        const result = await post<{ session: Session }>("/api/sessions", {
          title: input.prompt.slice(0, 80),
          inputs: payload,
        });
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
      }
      await post(`/api/sessions/${sessionId}/generations`, payload);
      return sessionId;
    },
    onSuccess: (sessionId) => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      void client.invalidateQueries({ queryKey: ["session", sessionId] });
      onSubmitted?.();
      if (location.pathname !== "/") navigate(`/sessions/${sessionId}`);
    },
    onError: failure,
  });
  const rewrite = useMutation({
    mutationFn: () =>
      post<{ prompt: string; source?: string; reason?: string }>("/api/assistant/rewrite", {
        profileId: profile?.id,
        prompt: input.prompt,
        preset: assistantPreset || assistant.data?.defaultPreset,
        stream: false,
        loras: input.loras.map((l) => l.name),
      }),
    onSuccess: (result) => {
      if (result.source === "fallback")
        return failure(result.reason || "Prompt assistance is unavailable.");
      update({ prompt: result.prompt });
    },
    onError: failure,
  });
  async function upload(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const result = await api<{ asset: ReferenceAsset }>("/api/reference-assets/upload", {
        method: "POST",
        body: form,
      });
      setDraft((value) => ({ ...value, references: [...value.references, result.asset] }));
    } catch (error) {
      failure(error);
    } finally {
      setUploading(false);
    }
  }
  const number = (
    key: keyof GenerationInput,
    label: string,
    props: Record<string, unknown> = {},
  ) => (
    <NumberInput
      key={key}
      label={label}
      value={Number(input[key])}
      onChange={(value) => update({ [key]: value })}
      {...props}
    />
  );
  const requiredReference =
    profile?.mediaInputs?.some((slot) => slot.required) &&
    draft.references.length === 0 &&
    input.referenceAssets.length === 0;
  if (compact)
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <Stack gap="xs">
          {draft.parentJobId && (
            <Group gap="xs">
              <Badge variant="light">{draft.operation === "animate" ? "Animate" : "Refine"}</Badge>
              <Text size="xs" c="dimmed">
                Continue from the selected result
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() =>
                  setDraft((value) => ({
                    ...value,
                    parentJobId: undefined,
                    operation: "image",
                    references: [],
                  }))
                }
              >
                Clear
              </Button>
            </Group>
          )}
          {draft.references.length > 0 && (
            <Group gap="xs">
              {draft.references.map((asset) => (
                <Group gap={4} key={asset.id}>
                  <Image src={asset.thumbnailUrl} alt={asset.name} h={36} w={36} radius="sm" />
                  <Text size="xs" c="dimmed">
                    {asset.name}
                  </Text>
                </Group>
              ))}
            </Group>
          )}
          <Textarea
            data-composer-prompt
            aria-label="Prompt"
            placeholder={
              input.kind === "video" ? "Describe the motion…" : "Describe it. Make it yours."
            }
            autosize
            minRows={2}
            maxRows={5}
            variant="unstyled"
            value={input.prompt}
            onChange={(event) => update({ prompt: event.currentTarget.value })}
            required
          />
          <Group justify="space-between" wrap="nowrap" className="studio-composer-actions">
            <Group gap="xs" wrap="nowrap" className="studio-composer-tools">
              <FileButton onChange={(file) => void upload(file)} accept="image/*">
                {(props) => (
                  <Button
                    {...props}
                    aria-label="Upload Reference"
                    variant="subtle"
                    size="compact-sm"
                    loading={uploading}
                  >
                    <span className="studio-generation-label-wide">+ Reference</span>
                    <span className="studio-generation-label-narrow">+</span>
                  </Button>
                )}
              </FileButton>
              <Button
                data-generation-controls
                variant="default"
                size="compact-sm"
                onClick={onControls}
              >
                {profile?.displayName || profile?.label || "Model & Controls"}
              </Button>
            </Group>
            <Button
              type="submit"
              className="studio-generate-button"
              aria-label={
                draft.operation === "refine"
                  ? "Refine Image"
                  : input.kind === "video"
                    ? "Generate Video"
                    : "Generate Image"
              }
              size="sm"
              loading={submit.isPending}
              disabled={
                !profile || profile.ready === false || !input.prompt.trim() || requiredReference
              }
            >
              <span className="studio-generation-label-wide">
                {draft.operation === "refine"
                  ? "Refine Image"
                  : input.kind === "video"
                    ? "Generate Video"
                    : "Generate Image"}
              </span>
              <span className="studio-generation-label-narrow">
                {draft.operation === "refine"
                  ? "Refine"
                  : input.kind === "video"
                    ? "Animate"
                    : "Generate"}
              </span>
            </Button>
          </Group>
          {!!submit.error && (
            <Text c="red" size="xs">
              {submit.error instanceof Error ? submit.error.message : String(submit.error)}
            </Text>
          )}
        </Stack>
      </form>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600}>Create</Text>
          <Badge variant="light">
            {draft.operation === "image"
              ? "New Image"
              : draft.operation === "refine"
                ? "Refine"
                : "Animate"}
          </Badge>
        </Group>
        <Select
          label="Output"
          data={[
            { value: "image", label: "Image" },
            { value: "video", label: "Video" },
          ]}
          value={input.kind}
          onChange={(value) => {
            const next = profiles.find((p) => p.kind === value);
            if (next) selectProfile(next);
            else update({ kind: value as "image" | "video", profileId: "" });
          }}
          allowDeselect={false}
        />
        <ModelPicker />
        {profile?.ready === false && (
          <Alert color="yellow">
            This model needs additional files or worker nodes before it can run.
          </Alert>
        )}
        {!models.isPending && !profile && (
          <Alert color="yellow">
            {input.profileId && profiles.length
              ? "The selected profile is unavailable. Choose another model explicitly."
              : "No models are available. Check your worker and mounted configuration."}
          </Alert>
        )}
        {models.error && <Alert color="red">{models.error.message}</Alert>}
        <Textarea
          label="Prompt"
          placeholder={
            input.kind === "image"
              ? "Describe the image you want to create…"
              : "Describe the motion and camera…"
          }
          autosize
          minRows={5}
          maxRows={12}
          value={input.prompt}
          onChange={(event) => update({ prompt: event.currentTarget.value })}
          required
        />
        {assistant.data?.available && (
          <Group grow>
            <Select
              aria-label="Prompt Assistance Style"
              placeholder="Assistance Style"
              data={assistant.data.presets.map((p) => ({
                value: p.id,
                label: p.label || p.name || p.id,
              }))}
              value={assistantPreset || assistant.data.defaultPreset}
              onChange={setAssistantPreset}
            />
            <Button
              variant="default"
              loading={rewrite.isPending}
              disabled={!input.prompt.trim()}
              onClick={() => rewrite.mutate()}
            >
              Improve Prompt
            </Button>
          </Group>
        )}
        {profile?.capabilities?.negativePrompt !== false && (
          <Textarea
            label="Negative Prompt"
            autosize
            minRows={2}
            value={input.negative}
            onChange={(e) => update({ negative: e.currentTarget.value })}
          />
        )}
        {profile?.mediaInputs?.length ||
        profile?.capabilities?.img2img ||
        profile?.capabilities?.imageInput ? (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                References
              </Text>
              <FileButton onChange={(file) => void upload(file)} accept="image/*">
                {(props) => (
                  <Button {...props} size="compact-sm" variant="default" loading={uploading}>
                    Upload Reference
                  </Button>
                )}
              </FileButton>
            </Group>
            {draft.references.map((asset) => (
              <Paper key={asset.id} p="xs">
                <Group wrap="nowrap">
                  <AspectRatio ratio={1} w={52}>
                    <Image src={asset.thumbnailUrl} alt={asset.name} fallbackSrc="" />
                  </AspectRatio>
                  <Text size="sm" lineClamp={1} flex={1}>
                    {asset.name}
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      setDraft((value) => ({
                        ...value,
                        references: value.references.filter((a) => a.id !== asset.id),
                        input: { ...value.input, referenceAssets: [] },
                      }))
                    }
                  >
                    Remove
                  </Button>
                </Group>
              </Paper>
            ))}
            {requiredReference && (
              <Text size="xs" c="dimmed">
                This workflow requires a reference image.
              </Text>
            )}
            {draft.references.length > 0 && profile?.capabilities?.inpaint && (
              <Group>
                <Button variant="default" size="compact-sm" onClick={() => setMaskOpen(true)}>
                  {input.inpaint ? "Edit Mask" : "Paint Mask"}
                </Button>
                {!!input.inpaint && (
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => update({ inpaint: null })}
                  >
                    Remove Mask
                  </Button>
                )}
              </Group>
            )}
          </Stack>
        ) : null}
        <SimpleGrid cols={2}>
          {number("width", "Width", { min: 64, step: 64 })}
          {number("height", "Height", { min: 64, step: 64 })}
        </SimpleGrid>
        <Accordion variant="separated" transitionDuration={0}>
          <Accordion.Item value="expert">
            <Accordion.Control>Expert Controls</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <SimpleGrid cols={2}>
                  {number("steps", "Steps", { min: 1, max: 200 })}
                  {profile?.capabilities?.cfg !== false &&
                    number("cfg", "Guidance", { min: 0, max: 30, step: 0.5 })}
                  {number("count", "Count", { min: 1, max: 8 })}
                  {number("denoise", "Denoise", { min: 0, max: 1, step: 0.05 })}
                </SimpleGrid>
                <TextInput
                  label="Seed"
                  description="Leave blank for a random seed."
                  value={String(input.seed)}
                  onChange={(e) => update({ seed: e.currentTarget.value })}
                />
                {input.kind === "video" && (
                  <SimpleGrid cols={2}>
                    {number("fps", "FPS", { min: 1, max: 120 })}
                    {number("frames", "Frames", { min: 1 })}
                    {number("duration", "Duration (Seconds)", { min: 1 })}
                  </SimpleGrid>
                )}
                {["samplers", "schedulers", "textEncoders", "vaes", "resolutions"].map((key) =>
                  profile?.options?.[key]?.length ? (
                    <Select
                      key={key}
                      label={
                        {
                          samplers: "Sampler",
                          schedulers: "Scheduler",
                          textEncoders: "Text Encoder",
                          vaes: "VAE",
                          resolutions: "Resolution",
                        }[key]
                      }
                      data={profile.options[key]}
                      value={String(
                        input[
                          {
                            samplers: "sampler",
                            schedulers: "scheduler",
                            textEncoders: "textEncoder",
                            vaes: "vae",
                            resolutions: "resolution",
                          }[key]!
                        ] || "",
                      )}
                      onChange={(value) =>
                        update({
                          [{
                            samplers: "sampler",
                            schedulers: "scheduler",
                            textEncoders: "textEncoder",
                            vaes: "vae",
                            resolutions: "resolution",
                          }[key]!]: value,
                        })
                      }
                    />
                  ) : null,
                )}
                {profile?.capabilities?.lora && <LoraPicker />}
                {profile?.provider !== "cliproxyapi" && (
                  <Checkbox
                    label="Allow Fallback to Another Worker"
                    description="Studio waits for the selected backend unless you allow another."
                    checked={Boolean(input.allowFallback)}
                    onChange={(e) => update({ allowFallback: e.currentTarget.checked })}
                  />
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="presets">
            <Accordion.Control>Saved Presets</Accordion.Control>
            <Accordion.Panel>
              <PresetEditor />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        {!!submit.error && (
          <Alert color="red">
            {submit.error instanceof Error ? submit.error.message : String(submit.error)}
          </Alert>
        )}
        <Button
          type="submit"
          fullWidth
          size="lg"
          loading={submit.isPending}
          disabled={
            !profile ||
            profile.ready === false ||
            !input.prompt.trim() ||
            requiredReference ||
            rewrite.isPending
          }
        >
          {draft.operation === "refine"
            ? "Refine Image"
            : input.kind === "video"
              ? "Generate Video"
              : "Generate Image"}
        </Button>
        <Text size="xs" c="dimmed">
          Inputs and results are saved together in a session.
        </Text>
        {maskOpen && draft.references[0] && (
          <Suspense fallback={null}>
            <MaskEditor
              asset={draft.references[0]}
              close={() => setMaskOpen(false)}
              save={(mask) => update({ inpaint: { mask, strength: 1, feather: 8 } })}
            />
          </Suspense>
        )}
      </Stack>
    </form>
  );
}
