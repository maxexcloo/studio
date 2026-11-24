import type { CloudUsage } from "../../shared/services.ts";

interface Options {
  base: string;
  /** CLIProxyAPI's management key, which reads its credentials and their quota. */
  managementKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
}
interface Credential {
  auth_index?: string;
  disabled?: boolean;
  provider?: string;
}

// The Grok CLI's billing call, as CLIProxyAPI's management panel makes it with the account's token.
const billing = {
  method: "GET",
  url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
  header: {
    Authorization: "Bearer $TOKEN$",
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": "1.0.70",
    "user-agent": "grok-pager/1.0.70 grok-shell/1.0.70 (macos; aarch64)",
  },
};

/**
 * Each Grok account's share of its weekly credits, read through CLIProxyAPI's management API at
 * most once per `cacheMs`. A failure reads as unknown; the last reading answers while the next loads.
 */
export function createCloudUsage({
  base,
  managementKey,
  fetchImpl = fetch,
  now = Date.now,
  cacheMs = 60_000,
}: Options) {
  const management = `${base.replace(/\/$/, "")}/v8/management`;
  const call = async (route: string, body?: object) => {
    const response = await fetchImpl(management + route, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${managementKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`CLIProxyAPI's management API returned HTTP ${response.status}.`);
    }
    return response.json();
  };
  const unknown = (label: string, reason: string): CloudUsage => ({ label, reason });
  const account = async (index: string, label: string): Promise<CloudUsage> => {
    const result = await call("/requests/api-call", { auth_index: index, ...billing });
    if (result.status_code !== 200)
      return unknown(label, `Grok's billing returned HTTP ${result.status_code}.`);
    const config = JSON.parse(result.body).config;
    const used = Number(config?.creditUsagePercent);
    if (config?.creditUsagePercent === undefined || !Number.isFinite(used))
      return unknown(label, "Grok's billing reported no weekly usage.");
    return {
      label,
      used,
      reason: "Grok's weekly credits used.",
      ...(config.currentPeriod?.end ? { resetsAt: config.currentPeriod.end } : {}),
    };
  };
  const read = async (): Promise<CloudUsage[]> => {
    if (!managementKey)
      return [unknown("Grok", "Set STUDIO_CLIPROXYAPI_MANAGEMENT_KEY to read Grok's usage.")];
    try {
      const { files } = (await call("/credentials")) as { files: Credential[] };
      const accounts = files.filter(
        (file) => file.provider === "xai" && !file.disabled && file.auth_index,
      );
      return await Promise.all(
        accounts.map((file, index) => {
          const label = accounts.length > 1 ? `Grok ${index + 1}` : "Grok";
          return account(file.auth_index!, label).catch(() =>
            unknown(label, "Grok's usage could not be read."),
          );
        }),
      );
    } catch {
      return [unknown("Grok", "CLIProxyAPI's credentials could not be read.")];
    }
  };
  let current: CloudUsage[] | undefined;
  let until = 0;
  let pending: Promise<void> | undefined;
  return async () => {
    if (now() >= until && !pending)
      pending = read().then((usage) => {
        current = usage;
        until = now() + cacheMs;
        pending = undefined;
      });
    if (!current) await pending;
    return current!;
  };
}

/**
 * Whether new cloud work runs locally instead: every account has used at least
 * STUDIO_CLOUD_USAGE_LIMIT percent (80 unless set) of its window. Unknown usage never holds back.
 */
export function cloudHeld(usage: CloudUsage[] | undefined, environment = process.env) {
  const limit = Number(environment.STUDIO_CLOUD_USAGE_LIMIT || 80);
  return Boolean(
    usage?.length && usage.every((account) => account.used !== undefined && account.used >= limit),
  );
}

export function configuredCloudUsage(environment = process.env) {
  const base = environment.STUDIO_CLIPROXYAPI_URL;
  if (!base) return;
  return createCloudUsage({ base, managementKey: environment.STUDIO_CLIPROXYAPI_MANAGEMENT_KEY });
}
