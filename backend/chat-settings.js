import { gatewayAddress } from "./assistant.js";

const settingNames = [
  "STUDIO_CHAT_GATEWAY_URL",
  "STUDIO_CHAT_GATEWAY_KEY",
  "STUDIO_CHAT_GATEWAY_MODELS",
];

/** Session Chat has its own gateway and explicit model allowlist. */
export function chatSettings(environment = process.env) {
  const [url, key, allowed] = settingNames.map((name) => String(environment[name] || "").trim());
  if (!url && !key && !allowed) return null;
  const missing = settingNames.filter((_name, index) => ![url, key, allowed][index]);
  if (missing.length)
    throw Object.assign(new Error(`Chat needs ${missing.join(", ")}.`), { status: 503 });
  const patterns = allowed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !patterns.length ||
    patterns.some((pattern) => pattern.includes("*") && pattern.indexOf("*") !== pattern.length - 1)
  )
    throw Object.assign(
      new Error(
        "STUDIO_CHAT_GATEWAY_MODELS needs comma-separated exact model IDs or prefixes ending in *.",
      ),
      { status: 503 },
    );
  try {
    return { ...gatewayAddress(url, settingNames[0]), key, model: "", patterns };
  } catch (error) {
    throw Object.assign(error, { status: 503 });
  }
}

export function chatModelAllowed(id, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern,
  );
}

/**
 * Names the text workloads serving each model. With `running` (an account that may not start
 * workloads), a workload-served model is listed only while one of its workloads runs.
 */
export function servedChatModels(models, workloads, running) {
  return models.flatMap((model) => {
    const served = workloads.filter((item) => item.model === model.id).map(({ id }) => id);
    if (!served.length) return [model];
    if (!running) return [{ ...model, workloads: served }];
    return served.some((id) => running.includes(id)) ? [model] : [];
  });
}
