// Runs all computer vision off the main thread so the camera preview and UI never stutter.
/* global importScripts, cv, createVision */
let vision = null;
let source = null; // { key, mat }
let warped = null; // { id, mat }

async function init() {
  importScripts("/opencv/opencv.js", "/scanner/vision.js");
  vision = createVision(await cv);
}
const ready = init();

function setSource(key, image) {
  if (source) source.mat.delete();
  if (warped) warped.mat.delete();
  warped = null;
  source = { key, mat: vision.toMat(image) };
}

/** Warps once per corner set: re-enhancing and previews reuse the flattened page. */
function warpedFor(corners) {
  const id = corners.map((c) => c.map((v) => v.toFixed(5)).join(",")).join(";");
  if (warped?.id === id) return warped.mat;
  if (warped) warped.mat.delete();
  warped = { id, mat: vision.warpPage(source.mat, corners) };
  return warped.mat;
}

const handlers = {
  ping: () => ({ ok: true }),

  detect: ({ image }) => vision.detect(image),

  /** Stores a captured photo, finds the page and the upright rotation. */
  analyze({ key, image }) {
    setSource(key, image);
    const r = vision.detectPrecise(image);
    const rotation = r.found ? vision.detectRotation(warpedFor(r.corners)) : 0;
    return { ...r, rotation };
  },

  load({ key, image }) {
    setSource(key, image);
    return { ok: true };
  },

  /** Renders one page through crop → enhancement → rotation. maxSide limits previews. */
  render({ key, corners, rotation, mode, options, maxSide }) {
    if (!source || source.key !== key) throw new Error("source-missing");
    const page = warpedFor(corners);
    const small = maxSide ? vision.resizeToFit(page, maxSide) : page;
    let out = null;
    let turned = null;
    try {
      out = vision.enhance(small, mode, options);
      turned = vision.rotateMat(out, rotation || 0);
      return vision.fromMat(turned);
    } finally {
      if (small !== page) small.delete();
      out?.delete();
      turned?.delete();
    }
  },
};

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    await ready;
    const result = handlers[type](payload);
    const transfer = result?.data?.buffer ? [result.data.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: e?.message ?? String(e) });
  }
};
