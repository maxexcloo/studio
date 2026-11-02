export function isCivitaiHost(host) {
  return host === "civitai.com" || host === "civitai.red";
}

/** Whether the deployment set a Civitai API token, never the token itself. */
export function civitaiTokenStatus() {
  return { set: Boolean(process.env.CIVITAI_API_TOKEN) };
}

export function civitaiAssetUrl(value) {
  const url = new URL(value);
  const allowed = ["civitai.com", "civitai.red", "r2.cloudflarestorage.com"].some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
  if (!allowed) throw new Error("Unsupported Civitai address.");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw new Error("Unsupported Civitai address.");
  return url;
}

/** Follow provider redirects ourselves: credentials never go to the file CDN. */
export async function civitaiFetch(
  input,
  init = {},
  { transport = fetch, token = process.env.CIVITAI_API_TOKEN, media = false } = {},
) {
  let url = civitaiAssetUrl(input);
  for (let hop = 0; hop < 6; hop += 1) {
    const headers = new Headers(init.headers);
    headers.delete("authorization");
    if (!media && token && url.hostname === "civitai.com")
      headers.set("authorization", `Bearer ${token}`);
    let response;
    try {
      response = await transport(url, { ...init, headers, redirect: "manual" });
    } catch {
      throw new Error("Couldn’t reach Civitai. Try again shortly.");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Civitai returned an incomplete redirect.");
    url = civitaiAssetUrl(new URL(location, url));
  }
  throw new Error("Civitai redirected too many times.");
}

export async function limitedBody(response, limit) {
  if (!response.body) throw new Error("The provider returned an empty response.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("The provider response is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function civitaiJson(pathname, { request = civitaiFetch } = {}) {
  const response = await request(`https://civitai.com/api/v1/${pathname}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Civitai requires a token or access to this resource."
        : response.status === 404
          ? "That Civitai resource is unavailable."
          : response.status === 429
            ? "Civitai is busy. Try again shortly."
            : `Civitai answered HTTP ${response.status}.`,
    );
  }
  try {
    return JSON.parse((await limitedBody(response, 4 * 1024 * 1024)).toString());
  } catch {
    throw new Error("Civitai returned unreadable metadata.");
  }
}

/** The public page retains generation associations omitted by the REST image API. */
export async function civitaiGenerationData(id, { request = civitaiFetch } = {}) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Choose a valid Civitai image.");
  const response = await request(`https://civitai.com/images/${id}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("The source generation associations are unavailable.");
  }
  const html = (await limitedBody(response, 8 * 1024 * 1024)).toString();
  const script = html.match(
    /<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!script) return null;
  const state = JSON.parse(script[1])?.props?.pageProps?.trpcState;
  const query = (state?.json?.queries || state?.queries || []).find(
    (entry) =>
      entry.queryKey?.[0]?.join(".") === "image.getGenerationData" &&
      entry.queryKey?.[1]?.input?.id === id,
  );
  return query?.state?.data || null;
}
