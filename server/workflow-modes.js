// Keep validation and graph construction on the same image mode.
export function hasReferenceImage(body) {
  return Boolean(body.startImage || body.startImageId || (body.referenceAssets || []).some((item) => item?.assetId || item?.comfyName));
}

export function resolveImageMode(workflow, body) {
  return workflow.imageModes?.[hasReferenceImage(body) ? 'reference' : 'generate'] || workflow;
}

export function selectImageMode(workflow, body) {
  const references = (body.referenceAssets || []).filter((item) => item?.comfyName);
  const hasImage = hasReferenceImage(body);
  const mode = resolveImageMode(workflow, body);
  if (mode === workflow) return workflow;
  const selected = { ...workflow, ...mode, graph: structuredClone(mode.graph || workflow.graph) };
  if (!hasImage) return selected;

  const slots = selected.mediaInputs || [];
  if (references.length && slots.length && !references.some((item) => item.slot === slots[0].id)) {
    throw new Error('Add the first reference image before additional references.');
  }
  for (const [index, slot] of slots.entries()) {
    if (references.some((item) => item.slot === slot.id) || index === 0 && (body.startImage || body.startImageId)) continue;
    omitReference(selected.graph, slot.control?.node);
  }
  return selected;
}

function linkedTo(value, id) {
  return Array.isArray(value) && value.length === 2 && value[0] === id;
}

function omitReference(graph, loader) {
  if (!loader || !graph[loader]) return;
  const removed = [loader];
  delete graph[loader];
  while (removed.length) {
    const missing = removed.shift();
    for (const [id, node] of Object.entries(graph)) {
      const affected = Object.entries(node.inputs || {}).filter(([, value]) => linkedTo(value, missing));
      if (!affected.length) continue;
      if (node.class_type === 'ReferenceLatent' && affected.every(([name]) => name === 'latent')) {
        const replacement = node.inputs.conditioning;
        for (const consumer of Object.values(graph)) {
          for (const [name, value] of Object.entries(consumer.inputs || {})) {
            if (linkedTo(value, id)) consumer.inputs[name] = [...replacement];
          }
        }
        delete graph[id];
      } else if (['ImageScaleToTotalPixels', 'VAEEncode', 'GetImageSize'].includes(node.class_type)) {
        delete graph[id];
        removed.push(id);
      } else if (affected.every(([name]) => name.startsWith('images.') || name.startsWith('ref_images.'))) {
        for (const [name] of affected) delete node.inputs[name];
      } else {
        throw new Error(`Cannot omit optional reference from ${node.class_type}.${affected[0][0]}.`);
      }
    }
  }
}
