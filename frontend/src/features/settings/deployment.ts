import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { modelsQuery } from "../generation/GenerationProvider";

interface Source {
  source: "default" | "studio" | "deployment";
  locked: boolean;
}
export type Setting = Source & { key: string; configured: string; effective: string };
export type Flag = Source & { key: string; label: string; description: string; value: boolean };
export interface Deployment {
  defaults: {
    image: Setting;
    video: Setting;
    profiles: { id: string; label: string; kind: string; ready: boolean }[];
  };
  catalogue: Flag[];
  integrations: {
    civitai: { token: { set: boolean } };
    huggingFace: { token: { set: boolean } };
    assistant: { available: boolean; note?: string; models: string[]; model: Setting };
  };
}
/** Settings › Generation and Integrations: values an administrator saves for everyone. */
export const deploymentQuery = queryOptions({
  queryKey: ["settings-deployment"],
  queryFn: () => api<Deployment>("/api/settings/deployment"),
});
/** A locked setting's description ends saying so; others need no note. */
export const lockedNote = (setting: Source) => (setting.locked ? " Set by the deployment." : "");

type Change = { key: string; value: string | boolean };
const applied = (data: Deployment, { key, value }: Change): Deployment => {
  const setting = (entry: Setting) =>
    entry.key === key ? { ...entry, configured: String(value), source: "studio" as const } : entry;
  return {
    ...data,
    defaults: {
      ...data.defaults,
      image: setting(data.defaults.image),
      video: setting(data.defaults.video),
    },
    catalogue: data.catalogue.map((flag) =>
      flag.key === key ? { ...flag, value: Boolean(value), source: "studio" } : flag,
    ),
    integrations: {
      ...data.integrations,
      assistant: {
        ...data.integrations.assistant,
        model: setting(data.integrations.assistant.model),
      },
    },
  };
};

/**
 * Saves one value at once: the control follows the hand, and the saved values (or, after a failure,
 * the refetched ones with the default notification) settle it.
 */
export function useDeploymentSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => post("/api/settings/deployment", change),
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: deploymentQuery.queryKey });
      client.setQueryData(deploymentQuery.queryKey, (data) => data && applied(data, change));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: deploymentQuery.queryKey });
      void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
    },
  });
}
