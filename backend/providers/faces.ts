import sharp, { type OutputInfo } from "sharp";
import { createModelFiles, createOnnxRunner } from "./onnx.ts";

/**
 * The face check's models: YuNet (OpenCV Zoo, MIT) finds faces and their five landmarks, and
 * AuraFace (fal, Apache-2.0; an ArcFace ResNet-100) turns an aligned face into a vector whose
 * cosine similarity says whether two faces are one person.
 */
export const faceSource = {
  // renovate: datasource=git-refs depName=https://github.com/opencv/opencv_zoo
  detectorRevision: "f12e12798e8314f7c074a6656816c048dcc95b7a",
  // renovate: datasource=git-refs depName=https://huggingface.co/fal/AuraFace-v1
  embedderRevision: "af6d057c9b0ec4071d4c49c80e3539258798b609",
};
const detector = "yunet.onnx";
const embedder = "glintr100.onnx";
const size = 640;
const minScore = 0.6;

// ArcFace's 112 px landmark template: eyes, nose tip, mouth corners, left to right in the image.
// YuNet lists the same points in the same order.
const template = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** An image decoded once: RGB bytes and their size, upright. */
type Pixels = { data: Buffer; info: OutputInfo };
interface Face {
  score: number;
  box: [number, number, number, number];
  points: number[][];
}
const overlap = (a: Face["box"], b: Face["box"]) => {
  const w = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return (w * h) / (a[2] * a[3] + b[2] * b[3] - w * h || 1);
};

/** The similarity transform (scale, rotation, shift) taking `from` onto `to`, least squares. */
function similarity(from: number[][], to: number[][]) {
  const mean = (points: number[][], axis: number) =>
    points.reduce((sum, point) => sum + point[axis], 0) / points.length;
  const [fx, fy, tx, ty] = [mean(from, 0), mean(from, 1), mean(to, 0), mean(to, 1)];
  let a = 0;
  let b = 0;
  let norm = 0;
  from.forEach(([x0, y0], index) => {
    const [x, y, u, v] = [x0 - fx, y0 - fy, to[index][0] - tx, to[index][1] - ty];
    a += x * u + y * v;
    b += x * v - y * u;
    norm += x * x + y * y;
  });
  a /= norm || 1;
  b /= norm || 1;
  return { a, b, tx: tx - (a * fx - b * fy), ty: ty - (b * fx + a * fy) };
}

/**
 * The face check on the CPU: models download into the data folder (`face-check/<revisions>/`) the
 * first time it is needed; `fetch` reaches GitHub and Hugging Face (Studio's fetch for both).
 */
export function createFaces({
  dataDir,
  fetch,
  log = console,
}: {
  dataDir: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  log?: { info(message: string): void };
}) {
  const { detectorRevision, embedderRevision } = faceSource;
  const model = createModelFiles({
    dataDir,
    folder: "face-check",
    revision: `${detectorRevision.slice(0, 12)}-${embedderRevision.slice(0, 12)}`,
    files: {
      [detector]: `https://github.com/opencv/opencv_zoo/raw/${detectorRevision}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
      [embedder]: `https://huggingface.co/fal/AuraFace-v1/resolve/${embedderRevision}/glintr100.onnx`,
    },
    label: "face check models (about 260 MB)",
    fetch,
    log,
  });
  const runner = createOnnxRunner("face check");

  /** Every face YuNet is sure of, most confident first, in the image's own pixels. */
  async function detect({ data: pixelsIn, info }: Pixels) {
    const { width, height } = info;
    const scale = Math.min(size / width, size / height);
    const [w, h] = [Math.round(width * scale), Math.round(height * scale)];
    const data = await sharp(pixelsIn, { raw: { width, height, channels: 3 } })
      .resize(w, h)
      .extend({ right: size - w, bottom: size - h, background: { r: 0, g: 0, b: 0 } })
      .raw()
      .toBuffer();
    // BGR, 0–255, planar.
    const area = size * size;
    const pixels = new Float32Array(3 * area);
    for (let index = 0; index < area; index += 1)
      for (let channel = 0; channel < 3; channel += 1)
        pixels[channel * area + index] = data[index * 3 + 2 - channel];
    const strides = [8, 16, 32];
    const out = await runner.run({
      model: model.file(detector),
      input: "input",
      type: "float32",
      data: pixels,
      dims: [1, 3, size, size],
      outputs: strides.flatMap((s) => [`cls_${s}`, `obj_${s}`, `bbox_${s}`, `kps_${s}`]),
    });
    const found: Face[] = [];
    for (const stride of strides) {
      const [cls, obj, box, kps] = ["cls", "obj", "bbox", "kps"].map(
        (name) => out[`${name}_${stride}`],
      );
      const columns = size / stride;
      cls.forEach((value, index) => {
        const clamp = (v: number) => Math.min(1, Math.max(0, v));
        const score = Math.sqrt(clamp(value) * clamp(obj[index]));
        if (score < minScore) return;
        const [row, column] = [Math.floor(index / columns), index % columns];
        const [cx, cy] = [(column + box[index * 4]) * stride, (row + box[index * 4 + 1]) * stride];
        const [bw, bh] = [
          Math.exp(box[index * 4 + 2]) * stride,
          Math.exp(box[index * 4 + 3]) * stride,
        ];
        found.push({
          score,
          box: [(cx - bw / 2) / scale, (cy - bh / 2) / scale, bw / scale, bh / scale],
          points: [0, 1, 2, 3, 4].map((point) => [
            ((column + kps[index * 10 + point * 2]) * stride) / scale,
            ((row + kps[index * 10 + point * 2 + 1]) * stride) / scale,
          ]),
        });
      });
    }
    // One per face: the most confident of each overlapping group.
    return found
      .sort((a, b) => b.score - a.score)
      .filter((face, index, all) =>
        all.slice(0, index).every((kept) => overlap(kept.box, face.box) < 0.3),
      );
  }

  /** The face warped onto the 112 px template, RGB scaled to −1…1, planar. */
  function aligned({ data, info }: Pixels, points: number[][]) {
    const { a, b, tx, ty } = similarity(points, template);
    const det = a * a + b * b || 1;
    const area = 112 * 112;
    const out = new Float32Array(3 * area);
    const at = (x: number, y: number, channel: number) =>
      x < 0 || y < 0 || x >= info.width || y >= info.height
        ? 0
        : data[(y * info.width + x) * 3 + channel];
    for (let y = 0; y < 112; y += 1)
      for (let x = 0; x < 112; x += 1) {
        const [dx, dy] = [x - tx, y - ty];
        const [sx, sy] = [(a * dx + b * dy) / det, (-b * dx + a * dy) / det];
        const [x0, y0] = [Math.floor(sx), Math.floor(sy)];
        const [fx, fy] = [sx - x0, sy - y0];
        for (let channel = 0; channel < 3; channel += 1) {
          const value =
            at(x0, y0, channel) * (1 - fx) * (1 - fy) +
            at(x0 + 1, y0, channel) * fx * (1 - fy) +
            at(x0, y0 + 1, channel) * (1 - fx) * fy +
            at(x0 + 1, y0 + 1, channel) * fx * fy;
          out[channel * area + y * 112 + x] = (value - 127.5) / 127.5;
        }
      }
    return out;
  }

  return {
    unavailable: model.unavailable,
    downloaded: model.downloaded,
    /**
     * The most confident face's unit vector and how many faces the image holds, or null when it
     * holds none.
     */
    async embed(bytes: Uint8Array) {
      await model.ensureDownloaded();
      const pixels = await sharp(bytes)
        .rotate()
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
      const faces = await detect(pixels);
      if (!faces.length) return null;
      const data = aligned(pixels, faces[0].points);
      const output = (
        await runner.run({
          model: model.file(embedder),
          input: "data",
          type: "float32",
          data,
          dims: [1, 3, 112, 112],
          outputs: ["1333"],
        })
      )["1333"];
      const length = Math.hypot(...output) || 1;
      return { vector: Float32Array.from(output, (value) => value / length), faces: faces.length };
    },
  };
}
export type Faces = ReturnType<typeof createFaces>;
