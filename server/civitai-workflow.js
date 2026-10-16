import path from 'node:path';

const loaders = { CLIPLoader: 'text_encoders', CheckpointLoaderSimple: 'checkpoints', DualCLIPLoader: 'text_encoders', UNETLoader: 'diffusion_models', VAELoader: 'vae' };
const filename = (value) => path.win32.basename(path.basename(String(value || '')));

/** Only explicit loader provenance is eligible; prompts and arbitrary node URLs are never fetched. */
export function workflowModelSources(meta = {}) {
  let comfy = meta.comfy;
  try { if (typeof comfy === 'string') comfy = JSON.parse(comfy); } catch { return []; }
  const nodes = comfy?.workflow?.nodes;
  if (!Array.isArray(nodes)) return [];
  const sources = [];
  for (const node of nodes.slice(0, 10000)) {
    const folder = loaders[node?.type];
    if (!folder) continue;
    for (const model of Array.isArray(node.properties?.models) ? node.properties.models : []) {
      if (model.directory !== folder || !/\.(safetensors|gguf)$/i.test(model.name || '') || filename(model.name) !== model.name) continue;
      let url;
      try { url = new URL(model.url); } catch { continue; }
      if (url.protocol !== 'https:' || url.hostname !== 'huggingface.co' || url.port || url.username || url.password || url.search || url.hash) continue;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 5 || !['blob', 'resolve'].includes(parts[2])) continue;
      try { if (decodeURIComponent(parts.at(-1)) !== model.name) continue; } catch { continue; }
      const widgets = Array.isArray(node.widgets_values) ? node.widgets_values.filter((value) => typeof value === 'string').map(filename) : [];
      if (!widgets.includes(model.name)) continue;
      if (!sources.some((source) => source.url === url.href && source.folder === folder)) sources.push({ file: model.name, folder, url: url.href });
      if (sources.length > 24) throw new Error('This image references too many resources to import.');
    }
  }
  return sources;
}

export function sameResourceFilename(first, second) {
  const left = filename(first).toLowerCase();
  const right = filename(second).toLowerCase();
  const extension = /\.(safetensors|gguf|ckpt)$/;
  if (extension.test(left) && extension.test(right)) return left === right;
  return Boolean(left) && left.replace(extension, '') === right.replace(extension, '');
}
