import { bytesForReferenceAccount, uploadBufferToComfy } from "./references.js";
import { loadSharp } from "./sharp-loader.js";

/**
 * Inpainting: change only the part of a reference image the user painted.
 *
 * The model never sees the whole picture. Studio crops the painted area with a
 * band of context around it, the graph regenerates that crop with a latent
 * noise mask (so only the painted part is repainted), and ImageCompositeMasked
 * lays the result back onto the original pixels as ComfyUI loaded them. The
 * rest of the image is never VAE encoded or decoded, so it stays exact.
 */

// The nodes inpainting adds to a profile's graph; all are ComfyUI core.
export const inpaintNodes = [
  "ImageCompositeMasked",
  "ImageScale",
  "LoadImage",
  "LoadImageMask",
  "RepeatImageBatch",
  "SetLatentNoiseMask",
];

const maxMaskBytes = 16 * 1024 * 1024;
// Below this a painted pixel is a stray brush edge, not part of the mask.
const maskThreshold = 26;
const contextFactor = 1.6;
const minContext = 512;
const snap = 16;
// Past this share of the picture, cropping saves nothing: work on the whole image.
const wholeImageShare = 0.7;

function edgeGrow(bounds) {
  const feather = Math.max(32, Math.hypot(bounds.width, bounds.height) * 0.1);
  return Math.round(4 + feather / 2);
}

/** The painted pixels' bounding box in a one-channel buffer, or null when nothing was painted. */
export function maskBounds(data, width, height, threshold = maskThreshold) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x] < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function snapUp(value, step = snap) {
  return Math.ceil(value / step) * step;
}

/**
 * Where to crop and how big to sample. The box is the painted area grown by a
 * band of context, at least `minContext` a side, kept inside the image; its
 * size snaps to 16 so model and mask stay aligned. The working size is the box
 * scaled to the pixel count the user picked, also on the 16 grid.
 */
export function inpaintGeometry({ imageWidth, imageHeight, bounds, targetPixels }) {
  const grow = edgeGrow(bounds);
  const sideFor = (painted, limit) => {
    const grown = Math.max(painted * contextFactor, painted + 2 * grow, minContext);
    return Math.min(limit, snapUp(grown));
  };
  let width = sideFor(bounds.width, imageWidth);
  let height = sideFor(bounds.height, imageHeight);
  const whole = width * height >= imageWidth * imageHeight * wholeImageShare;
  if (whole) {
    width = imageWidth;
    height = imageHeight;
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = whole ? 0 : Math.round(Math.min(Math.max(0, centerX - width / 2), imageWidth - width));
  const y = whole
    ? 0
    : Math.round(Math.min(Math.max(0, centerY - height / 2), imageHeight - height));
  const pixels = Math.max(256 * 256, Number(targetPixels) || 1024 * 1024);
  const scale = Math.sqrt(pixels / (width * height));
  const workWidth = Math.max(snap * 16, Math.round((width * scale) / snap) * snap);
  const workHeight = Math.max(snap * 16, Math.round((height * scale) / snap) * snap);
  return { box: { x, y, width, height }, work: { width: workWidth, height: workHeight } };
}

// Two sliding windows apply square morphology in linear time even for a large brush area.
function spreadMask(data, { width, height }, radius, match) {
  const pass = (source, lines, length, lineStride, pixelStride) => {
    const result = Buffer.alloc(source.length, 255 - match);
    for (let line = 0; line < lines; line += 1) {
      const start = line * lineStride;
      let hits = 0;
      for (let i = -radius; i < length; i += 1) {
        const entering = i + radius;
        const leaving = i - radius - 1;
        if (entering < length && source[start + entering * pixelStride] === match) hits += 1;
        if (leaving >= 0 && source[start + leaving * pixelStride] === match) hits -= 1;
        if (i >= 0 && hits) result[start + i * pixelStride] = match;
      }
    }
    return result;
  };
  return pass(pass(data, height, width, width, 1), width, height, 1, width);
}

export function maskBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("The painted mask didn't come through. Paint it again.");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > maxMaskBytes)
    throw new Error("The painted mask is too large.");
  return buffer;
}

/**
 * The painted mask as Radiance takes it: a PNG at the first picture's size whose alpha is 0 where
 * the picture may change. Null when nothing was painted.
 */
export async function radianceMask(sharp, image, maskBuffer) {
  const { width, height } = await sharp(image).metadata();
  const painted = await sharp(maskBuffer)
    .resize(width, height, { fit: "fill", kernel: "linear" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  let any = false;
  for (const [index, value] of painted.entries()) {
    const paint = value >= maskThreshold;
    any ||= paint;
    rgba[index * 4 + 3] = paint ? 0 : 255;
  }
  return any
    ? sharp(rgba, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer()
    : null;
}

/**
 * The three files an inpaint run loads, from the source image and the painted
 * mask (any size; it is stretched over the image): the crop at working size,
 * the mask it samples with, and the mask that stitches it back at box size.
 * Null when nothing was painted. Each sharp step runs on its own, since sharp
 * orders the operations in one pipeline its own way.
 */
export async function inpaintFiles(sharp, sourceBuffer, maskBuffer, { targetPixels, feather }) {
  // ComfyUI's LoadImage applies EXIF orientation, and so did the browser the mask was painted in.
  const { data: rgb, info } = await sharp(sourceBuffer, { limitInputPixels: 80_000_000 })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imageWidth = info.width;
  const imageHeight = info.height;
  const mask = await sharp(maskBuffer)
    .resize(imageWidth, imageHeight, { fit: "fill", kernel: "linear" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const bounds = maskBounds(mask, imageWidth, imageHeight);
  if (!bounds) return null;
  const { box, work } = inpaintGeometry({ imageWidth, imageHeight, bounds, targetPixels });
  const region = { left: box.x, top: box.y, width: box.width, height: box.height };
  // sharp writes a one-channel input back out as RGB unless told otherwise.
  const gray = (buffer, width, height) => sharp(buffer, { raw: { width, height, channels: 1 } });
  const rawGray = (pipeline) => pipeline.extractChannel(0).raw().toBuffer();
  const pngGray = (pipeline) => pipeline.toColourspace("b-w").png().toBuffer();

  const crop = await sharp(rgb, {
    raw: { width: imageWidth, height: imageHeight, channels: info.channels },
  })
    .extract(region)
    .resize(work.width, work.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const boxMask = await rawGray(gray(mask, imageWidth, imageHeight).extract(region));
  const grow = edgeGrow(bounds);
  const paint = boxMask.map((value) => (value >= maskThreshold ? 255 : 0));
  const grown = spreadMask(paint, box, grow, 255);
  const samplingMask = await pngGray(
    gray(grown, box.width, box.height)
      .resize(work.width, work.height, { fit: "fill", kernel: "linear" })
      .threshold(128),
  );
  // Erode before blurring so the seam fades inside the area the sampler repaints.
  const blend = Math.round(grow * 1.25 * Math.min(1, Math.max(0, Number(feather) || 0)));
  if (blend) {
    const core = spreadMask(grown, box, Math.round(blend * 0.8), 0);
    const soft = await rawGray(gray(core, box.width, box.height).blur(Math.max(0.3, blend / 2.5)));
    for (let i = 0; i < paint.length; i += 1) {
      if (grown[i]) paint[i] = Math.max(paint[i], soft[i]);
    }
  }
  const compositeMask = await pngGray(gray(paint, box.width, box.height));
  return {
    box,
    work,
    crop,
    samplingMask,
    compositeMask,
    image: { width: imageWidth, height: imageHeight },
  };
}

/**
 * Turns the job's painted mask into what the graph loads and stages it in
 * ComfyUI. Returns null when nothing was painted, so the run goes ahead as a
 * plain edit.
 */
export async function prepareInpaint(account, body) {
  const reference = body.referenceAssets?.[0];
  if (!body.inpaint?.mask || !reference?.assetId || !reference.comfyName) return null;
  const sharp = await loadSharp();
  if (!sharp)
    throw new Error(
      "Inpainting needs image resizing, which is off: sharp could not load. Run `npm install --omit=dev` in the Studio folder, then restart.",
    );
  const source = await bytesForReferenceAccount(account, reference.assetId);
  const files = await inpaintFiles(sharp, source.buffer, maskBufferFromDataUrl(body.inpaint.mask), {
    targetPixels: Number(body.width) * Number(body.height),
    feather: body.inpaint.feather,
  });
  if (!files) return null;
  const upload = (buffer, name) =>
    uploadBufferToComfy(body.comfyBackend, { buffer, mime: "image/png", name });
  const crop = await upload(files.crop, "inpaint-crop.png");
  const mask = await upload(files.samplingMask, "inpaint-mask.png");
  const composite = await upload(files.compositeMask, "inpaint-stitch.png");
  return {
    original: reference.comfyName,
    crop: crop.comfyName,
    mask: mask.comfyName,
    composite: composite.comfyName,
    box: files.box,
    work: files.work,
    // The whole picture's size and where it came from, so the live preview can draw on top of it.
    image: files.image,
    referenceId: String(reference.assetId),
    strength: body.inpaint.strength,
    feather: body.inpaint.feather,
  };
}

/** The staged file names an inpaint run adds. */
export function inpaintInputNames(inpaint) {
  return inpaint ? [inpaint.crop, inpaint.mask, inpaint.composite].filter(Boolean) : [];
}

/** The graph's image saves, which inpainting stitches into the original picture. */
export function imageSaves(graph = {}) {
  return Object.values(graph).filter(
    (node) => node?.class_type === "SaveImage" && Array.isArray(node.inputs?.images),
  );
}

/**
 * Inpaints with a profile's own graph, which already samples the crop as its
 * reference at the working size. A sampler that starts from the encoded crop
 * (img2img) repaints only the painted part, at the inpaint strength; an edit
 * model edits the whole crop. Either way only the painted part is stitched back.
 */
export function inpaintGraph(graph, inpaint, count = 1) {
  let next = 0;
  const add = (class_type, inputs) => {
    const id = `studio_inpaint_${(next += 1)}`;
    graph[id] = { class_type, inputs };
    return [id, 0];
  };
  for (const node of Object.values(graph)) {
    const latent = node.inputs?.latent_image;
    if (graph[latent?.[0]]?.class_type !== "VAEEncode") continue;
    node.inputs.latent_image = add("SetLatentNoiseMask", {
      samples: latent,
      mask: add("LoadImageMask", { image: inpaint.mask, channel: "red" }),
    });
    if (typeof node.inputs.denoise === "number")
      node.inputs.denoise = Number(inpaint.strength ?? 1);
  }
  const { box } = inpaint;
  let destination = add("LoadImage", { image: inpaint.original });
  if (count > 1) destination = add("RepeatImageBatch", { image: destination, amount: count });
  const mask = add("LoadImageMask", { image: inpaint.composite, channel: "red" });
  for (const save of imageSaves(graph)) {
    const source = add("ImageScale", {
      image: save.inputs.images,
      upscale_method: "lanczos",
      width: box.width,
      height: box.height,
      crop: "disabled",
    });
    save.inputs.images = add("ImageCompositeMasked", {
      destination,
      source,
      x: box.x,
      y: box.y,
      resize_source: false,
      mask,
    });
  }
  return graph;
}
