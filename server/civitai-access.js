import { envFileKeys, removeLocalEnvValue, writeLocalEnvValue } from './env.js';

export function civitaiTokenStatus() {
  return { set: Boolean(process.env.CIVITAI_API_TOKEN), editable: !process.env.CIVITAI_API_TOKEN || envFileKeys.has('CIVITAI_API_TOKEN') };
}

export function saveCivitaiToken(value) {
  if (!civitaiTokenStatus().editable) throw new Error('The Civitai token is managed by the environment.');
  const token = String(value || '').trim();
  if (token && !/^[A-Za-z0-9_-]{16,256}$/.test(token)) throw new Error('Enter a valid Civitai API token.');
  if (token) {
    writeLocalEnvValue('CIVITAI_API_TOKEN', token);
    envFileKeys.add('CIVITAI_API_TOKEN');
  } else removeLocalEnvValue('CIVITAI_API_TOKEN');
  return civitaiTokenStatus();
}

function allowedUrl(value, media) {
  const url = new URL(value);
  const host = url.hostname;
  const allowed = media ? host === 'image.civitai.com'
    : host === 'civitai.com' || host.endsWith('.civitai.com') || host.endsWith('.r2.cloudflarestorage.com');
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Unsupported Civitai address.');
  return url;
}

/** Follow provider redirects ourselves: credentials never go to the file CDN. */
export async function civitaiFetch(input, init = {}, { transport = fetch, token = process.env.CIVITAI_API_TOKEN, media = false } = {}) {
  let url = allowedUrl(input, media);
  for (let hop = 0; hop < 6; hop += 1) {
    const headers = new Headers(init.headers);
    headers.delete('authorization');
    if (!media && token && url.hostname === 'civitai.com') headers.set('authorization', `Bearer ${token}`);
    let response;
    try { response = await transport(url, { ...init, headers, redirect: 'manual' }); }
    catch { throw new Error('Couldn’t reach Civitai. Try again shortly.'); }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Civitai returned an incomplete redirect.');
    url = allowedUrl(new URL(location, url), media);
  }
  throw new Error('Civitai redirected too many times.');
}

export async function limitedBody(response, limit) {
  if (!response.body) throw new Error('The provider returned an empty response.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('The provider response is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function civitaiJson(pathname, { request = civitaiFetch } = {}) {
  const response = await request(`https://civitai.com/api/v1/${pathname}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 401 || response.status === 403 ? 'Civitai requires a token or access to this resource.'
      : response.status === 404 ? 'That Civitai resource is unavailable.' : response.status === 429 ? 'Civitai is busy. Try again shortly.' : `Civitai answered HTTP ${response.status}.`);
  }
  try { return JSON.parse((await limitedBody(response, 4 * 1024 * 1024)).toString()); }
  catch { throw new Error('Civitai returned unreadable metadata.'); }
}
