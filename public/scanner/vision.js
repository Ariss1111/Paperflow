// Document-scanner computer vision on OpenCV.js.
// Plain script so one file serves both the browser worker and the Node test suite.
// Images are { data: Uint8ClampedArray (RGBA), width, height }. Corners are normalised [x, y] pairs in
// the order top-left, top-right, bottom-right, bottom-left.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createVision = factory;
})(typeof self !== "undefined" ? self : this, function createVision(cv) {
  const DETECT_SIDE = 720;
  const REFINE_SIDE = 1600;
  const BW_MIN_SIDE = 2200;
  const MIN_AREA = 0.12;
  const PAPER_RATIOS = [Math.SQRT2 /* A series */, 11 / 8.5 /* Letter */, 14 / 8.5 /* Legal */];

  /** Runs fn with a tracker; every Mat handed to track() is freed afterwards, even on error. */
  function scoped(fn) {
    const mats = [];
    const track = (m) => (mats.push(m), m);
    try {
      return fn(track);
    } finally {
      for (const m of mats) if (!m.isDeleted()) m.delete();
    }
  }

  function toMat(img) {
    const m = new cv.Mat(img.height, img.width, cv.CV_8UC4);
    m.data.set(img.data);
    return m;
  }

  function fromMat(m) {
    return scoped((t) => {
      let rgba = m;
      if (m.channels() === 1) cv.cvtColor(m, (rgba = t(new cv.Mat())), cv.COLOR_GRAY2RGBA);
      else if (m.channels() === 3) cv.cvtColor(m, (rgba = t(new cv.Mat())), cv.COLOR_RGB2RGBA);
      return { data: new Uint8ClampedArray(rgba.data), width: rgba.cols, height: rgba.rows };
    });
  }

  function resizeToFit(src, maxSide) {
    const k = maxSide / Math.max(src.cols, src.rows);
    const dst = new cv.Mat();
    if (k >= 1) src.copyTo(dst);
    else cv.resize(src, dst, new cv.Size(Math.max(1, Math.round(src.cols * k)), Math.max(1, Math.round(src.rows * k))), 0, 0, cv.INTER_AREA);
    return dst;
  }

  const odd = (n) => (Math.max(3, Math.round(n)) | 1);

  // ---------------------------------------------------------------- geometry

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function polygonArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % p.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  }

  /** Clockwise from the corner nearest the image's top-left. */
  function orderCorners(points) {
    const cx = points.reduce((s, p) => s + p[0], 0) / 4;
    const cy = points.reduce((s, p) => s + p[1], 0) / 4;
    const sorted = [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let start = 0;
    let best = Infinity;
    sorted.forEach((p, i) => {
      if (p[0] + p[1] < best) {
        best = p[0] + p[1];
        start = i;
      }
    });
    return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  }

  function isConvexQuad(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross === 0) continue;
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
    return true;
  }

  /** The worst interior-angle deviation from 90°, in degrees. */
  function angleDeviation(q) {
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const p = q[(i + 3) % 4];
      const c = q[i];
      const n = q[(i + 1) % 4];
      const v1 = [p[0] - c[0], p[1] - c[1]];
      const v2 = [n[0] - c[0], n[1] - c[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      worst = Math.max(worst, Math.abs((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI - 90));
    }
    return worst;
  }

  function matPoints(contour) {
    const out = [];
    for (let i = 0; i < contour.rows; i++) out.push([contour.data32S[i * 2], contour.data32S[i * 2 + 1]]);
    return out;
  }

  // ---------------------------------------------------------------- candidates

  /** Fits a quadrilateral to a contour, or returns null when it isn't page-shaped. */
  function quadFromContour(contour, w, h) {
    return scoped((t) => {
      const frame = w * h;
      const area = cv.contourArea(contour);
      if (area < frame * MIN_AREA) return null;
      const hull = t(new cv.Mat());
      cv.convexHull(contour, hull, false, true);
      const peri = cv.arcLength(hull, true);
      let quad = null;
      for (const eps of [0.012, 0.02, 0.03, 0.045, 0.065, 0.09]) {
        const approx = t(new cv.Mat());
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          quad = matPoints(approx);
          break;
        }
      }
      if (!quad) {
        // no clean four-point fit (rounded corners, an occluding thumb): use the enclosing rectangle if it's tight
        const r = cv.minAreaRect(hull);
        const box = cv.rotatedRectPoints(r).map((p) => [p.x, p.y]);
        if (area / (polygonArea(box) || 1) < 0.82) return null;
        quad = box;
      }
      const q = straightenSides(contour, orderCorners(quad), w, h);
      if (!isConvexQuad(q)) return null;
      const quadArea = polygonArea(q);
      const dev = angleDeviation(q);
      if (dev > 38) return null;
      const top = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
      const side = (dist(q[1], q[2]) + dist(q[0], q[3])) / 2;
      const aspect = Math.max(top, side) / (Math.min(top, side) || 1);
      if (aspect > 4) return null;
      const margin = 0.012 * Math.max(w, h);
      const atEdge = q.filter(([x, y]) => x < margin || y < margin || x > w - margin || y > h - margin).length;
      // the whole frame is the camera's edge, not a document
      if (atEdge >= 3 && quadArea > frame * 0.8) return null;
      const fill = Math.min(1, area / (quadArea || 1));
      const score = Math.sqrt(Math.min(1, quadArea / frame)) * fill * fill * (1 - dev / 60) * (atEdge ? 0.65 : 1);
      return { corners: q, score };
    });
  }

  /**
   * Re-derives corners from robust straight-line fits along each side of the outline, so a thumb or a
   * dog-ear that bends the outline can't drag a corner away from where the paper's edges really meet.
   */
  function straightenSides(contour, quad, w, h) {
    const outline = [];
    const raw = matPoints(contour);
    const spacing = Math.max(w, h) / 240;
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i];
      const b = raw[(i + 1) % raw.length];
      const steps = Math.max(1, Math.floor(dist(a, b) / spacing));
      for (let s = 0; s < steps; s++) outline.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
    }
    let q = quad;
    const tolerance = Math.max(w, h) / 360;
    for (let round = 0; round < 3; round++) {
      const sides = [[], [], [], []];
      for (const p of outline) {
        let best = 0;
        let bestD = Infinity;
        for (let e = 0; e < 4; e++) {
          const d = segmentDistance(p, q[e], q[(e + 1) % 4]);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        sides[best].push(p);
      }
      const lines = sides.map((pts) => ransacLine(pts, tolerance));
      if (lines.some((l) => !l)) return q;
      const next = [];
      for (let i = 0; i < 4; i++) {
        const p = intersect(lines[(i + 3) % 4], lines[i]);
        if (!p || p[0] < -0.02 * w || p[0] > 1.02 * w || p[1] < -0.02 * h || p[1] > 1.02 * h) return q;
        next.push([Math.max(0, Math.min(w, p[0])), Math.max(0, Math.min(h, p[1]))]);
      }
      q = next;
    }
    return q;
  }

  function segmentDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - f * dx, p[1] - a[1] - f * dy);
  }

  /** The line through the most points (deterministic sampling), polished by least squares on its inliers. */
  function ransacLine(points, tolerance) {
    if (points.length < 8) return null;
    let best = null;
    let bestCount = 0;
    const n = points.length;
    const stride = Math.max(1, Math.floor(n / 16));
    for (let i = 0; i < n; i += stride) {
      for (const span of [0.5, 0.33, 0.2]) {
        const a = points[i];
        const b = points[(i + Math.max(2, Math.floor(n * span))) % n];
        const len = dist(a, b);
        if (!len) continue;
        const dx = (b[0] - a[0]) / len;
        const dy = (b[1] - a[1]) / len;
        const inliers = points.filter((p) => Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) <= tolerance);
        if (inliers.length > bestCount) {
          bestCount = inliers.length;
          best = inliers;
        }
      }
    }
    return best && bestCount >= 6 ? fitLine(best) : null;
  }

  function candidatesFromBinary(binary, w, h, out, bonus = 1) {
    scoped((t) => {
      const contours = t(new cv.MatVector());
      const hierarchy = t(new cv.Mat());
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const q = quadFromContour(c, w, h);
        if (q) out.push({ corners: q.corners, score: q.score * bonus });
        c.delete();
      }
    });
  }

  /** Per-pixel colour distance from the frame's border colour: separates a page from a low-contrast desk. */
  function borderDistance(rgb) {
    return scoped((t) => {
      const lab = t(new cv.Mat());
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      const w = lab.cols;
      const h = lab.rows;
      const strip = Math.max(2, Math.round(Math.min(w, h) * 0.03));
      const samples = [[], [], []];
      const d = lab.data;
      const step = Math.max(1, Math.round((w + h) / 300));
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          if (x >= strip && x < w - strip && y >= strip && y < h - strip) continue;
          const k = (y * w + x) * 3;
          samples[0].push(d[k]);
          samples[1].push(d[k + 1]);
          samples[2].push(d[k + 2]);
        }
      }
      const med = samples.map((s) => s.sort((a, b) => a - b)[s.length >> 1]);
      const out = new cv.Mat(h, w, cv.CV_8UC1);
      const o = out.data;
      for (let i = 0, n = w * h; i < n; i++) {
        const v = Math.abs(d[i * 3] - med[0]) + 1.5 * Math.abs(d[i * 3 + 1] - med[1]) + 1.5 * Math.abs(d[i * 3 + 2] - med[2]);
        o[i] = v > 255 ? 255 : v;
      }
      return out;
    });
  }

  /** Finds the best page quad. Returns corners in the coordinates of `rgb`, or null. */
  function findQuad(rgb) {
    return scoped((t) => {
      const w = rgb.cols;
      const h = rgb.rows;
      const unit = Math.max(w, h) / 720;
      const gray = t(new cv.Mat());
      cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      // closing wipes dark text and lines off the bright page, leaving only the page shape
      const textKernel = t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(13 * unit), odd(13 * unit))));
      const closed = t(new cv.Mat());
      cv.morphologyEx(gray, closed, cv.MORPH_CLOSE, textKernel);
      const small = t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      const joinKernel = t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(9 * unit), odd(9 * unit))));
      const openKernel = t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(15 * unit), odd(15 * unit))));
      const candidates = [];

      // 1. brightness: page vs darker surroundings
      const otsu = t(new cv.Mat());
      const level = cv.threshold(closed, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(otsu, otsu, cv.MORPH_OPEN, openKernel); // detaches thin bridges to bright clutter
      candidatesFromBinary(otsu, w, h, candidates, 1);

      // 2. colour distance from the border: low-contrast desks, coloured surfaces
      const distance = t(borderDistance(rgb));
      cv.GaussianBlur(distance, distance, new cv.Size(5, 5), 0);
      const distBin = t(new cv.Mat());
      cv.threshold(distance, distBin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(distBin, distBin, cv.MORPH_CLOSE, textKernel);
      cv.morphologyEx(distBin, distBin, cv.MORPH_OPEN, openKernel);
      candidatesFromBinary(distBin, w, h, candidates, 0.97);

      // 3. edges, at two sensitivities: uneven light where no global threshold works
      for (const [lo, hi, bonus] of [[level * 0.5, level, 0.95], [12, 36, 0.85]]) {
        const edges = t(new cv.Mat());
        cv.Canny(closed, edges, lo, hi);
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, joinKernel);
        cv.dilate(edges, edges, small);
        candidatesFromBinary(edges, w, h, candidates, bonus);
      }

      if (!candidates.length) return null;
      candidates.sort((a, b) => b.score - a.score);
      return { corners: candidates[0].corners, score: candidates[0].score };
    });
  }

  /**
   * Snaps each edge to the strongest gradient near it at higher resolution, fitting straight lines
   * with outlier rejection. Coarse corners from a 720 px search would otherwise leave slivers of desk.
   */
  function refineCorners(rgba, corners) {
    return scoped((t) => {
      const scaled = t(resizeToFit(rgba, REFINE_SIDE));
      const gray = t(new cv.Mat());
      cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
      const kernel = t(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
      cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, kernel);
      cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
      const w = gray.cols;
      const h = gray.rows;
      const d = gray.data;
      const at = (x, y) => {
        const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
        const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
        return d[yi * w + xi];
      };
      const q = corners.map(([x, y]) => [x * w, y * h]);
      const cx = q.reduce((s, p) => s + p[0], 0) / 4;
      const cy = q.reduce((s, p) => s + p[1], 0) / 4;
      const reach = Math.round(Math.max(w, h) * 0.012);
      const lines = [];
      for (let e = 0; e < 4; e++) {
        const a = q[e];
        const b = q[(e + 1) % 4];
        const len = dist(a, b) || 1;
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        // normal pointing away from the page centre
        let nx = -uy;
        let ny = ux;
        if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const pts = [];
        const samples = Math.min(90, Math.round(len / 6));
        for (let i = 0; i < samples; i++) {
          const f = 0.08 + (0.84 * i) / Math.max(1, samples - 1);
          const sx = a[0] + (b[0] - a[0]) * f;
          const sy = a[1] + (b[1] - a[1]) * f;
          let bestG = 0;
          let bestS = null;
          for (let s = -reach; s <= reach; s++) {
            const inner = at(sx + nx * (s - 2), sy + ny * (s - 2));
            const outer = at(sx + nx * (s + 2), sy + ny * (s + 2));
            const g = Math.abs(inner - outer);
            // favour the transition closest to the coarse edge when strengths tie
            const weighted = g * (1 - (Math.abs(s) / reach) * 0.25);
            if (weighted > bestG) {
              bestG = weighted;
              bestS = s;
            }
          }
          if (bestS !== null && bestG >= 4) pts.push([sx + nx * bestS, sy + ny * bestS]);
        }
        lines.push(fitLine(pts) ?? { px: a[0], py: a[1], dx: ux, dy: uy });
      }
      const refined = [];
      for (let i = 0; i < 4; i++) {
        // corner i joins edge i-1 and edge i
        const p = intersect(lines[(i + 3) % 4], lines[i]);
        if (!p || dist(p, q[i]) > reach * 2.5) refined.push(q[i]);
        else refined.push(p);
      }
      return refined.map(([x, y]) => [Math.max(0, Math.min(1, x / w)), Math.max(0, Math.min(1, y / h))]);
    });
  }

  /** Total-least-squares line fit, re-fitted after dropping samples far from the first estimate. */
  function fitLine(points) {
    if (points.length < 6) return null;
    let pts = points;
    let line = null;
    for (let round = 0; round < 3; round++) {
      const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (const [x, y] of pts) {
        sxx += (x - mx) ** 2;
        sxy += (x - mx) * (y - my);
        syy += (y - my) ** 2;
      }
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      line = { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
      const dists = points.map(([x, y]) => Math.abs((x - mx) * line.dy - (y - my) * line.dx));
      const sorted = [...dists].sort((a, b) => a - b);
      const limit = Math.max(1.5, sorted[sorted.length >> 1] * 2.5);
      const kept = points.filter((_, i) => dists[i] <= limit);
      if (kept.length < 6 || kept.length === pts.length) break;
      pts = kept;
    }
    return line;
  }

  function intersect(a, b) {
    const denom = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(denom) < 1e-6) return null;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / denom;
    return [a.px + a.dx * t, a.py + a.dy * t];
  }

  /** Moves corners slightly inward so the anti-aliased page edge (half desk, half paper) never survives the crop. */
  function inset(corners, amount) {
    const cx = corners.reduce((s, p) => s + p[0], 0) / 4;
    const cy = corners.reduce((s, p) => s + p[1], 0) / 4;
    return corners.map(([x, y]) => [x + (cx - x) * amount, y + (cy - y) * amount]);
  }

  // ---------------------------------------------------------------- public: detection

  /** Fast detection for live preview frames. */
  function detect(img) {
    return scoped((t) => {
      const rgba = t(toMat(img));
      const small = t(resizeToFit(rgba, DETECT_SIDE));
      const rgb = t(new cv.Mat());
      cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
      const r = findQuad(rgb);
      if (!r) return { found: false, corners: null, score: 0 };
      return { found: true, score: r.score, corners: r.corners.map(([x, y]) => [x / rgb.cols, y / rgb.rows]) };
    });
  }

  /** Precise detection for a captured photo: coarse search, edge refinement, tiny inset. */
  function detectPrecise(img) {
    return scoped((t) => {
      const rgba = t(toMat(img));
      const small = t(resizeToFit(rgba, DETECT_SIDE));
      const rgb = t(new cv.Mat());
      cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
      const r = findQuad(rgb);
      if (!r) return { found: false, corners: null, score: 0 };
      const coarse = r.corners.map(([x, y]) => [x / rgb.cols, y / rgb.rows]);
      const refined = refineCorners(rgba, coarse);
      return { found: true, score: r.score, corners: inset(refined, 0.006) };
    });
  }

  // ---------------------------------------------------------------- public: perspective

  /** Real page proportions (width / height), recovered from the homography (Zhang & He), else from edge lengths. */
  function pageRatio(corners, width, height) {
    const [tl, tr, br, bl] = corners.map(([x, y]) => [x * width, y * height]);
    const edgeW = (dist(tl, tr) + dist(bl, br)) / 2;
    const edgeH = (dist(tl, bl) + dist(tr, br)) / 2;
    const edgeRatio = edgeW / (edgeH || 1);
    const u = width / 2;
    const v = height / 2;
    const h = ([x, y]) => [x - u, y - v, 1];
    const [m1, m2, m3, m4] = [h(tl), h(tr), h(bl), h(br)];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
    const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
    const n2 = m2.map((c, i) => k2 * c - m1[i]);
    const n3 = m3.map((c, i) => k3 * c - m1[i]);
    let ratio = edgeRatio;
    const denom = n2[2] * n3[2];
    if (Math.abs(denom) > 1e-9) {
      const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / denom;
      if (f2 > 0) {
        const q = (n) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
        const r = Math.sqrt(q(n2) / q(n3));
        // an implausible estimate means the principal-point assumption failed (e.g. a cropped photo)
        if (r > edgeRatio * 0.7 && r < edgeRatio / 0.7) ratio = r;
      }
    }
    // snap to standard paper when within measurement error
    const long = Math.max(ratio, 1 / ratio);
    for (const p of PAPER_RATIOS) {
      if (Math.abs(long - p) / p < 0.035) return ratio >= 1 ? p : 1 / p;
    }
    return ratio;
  }

  /** Flattens the quad into a rectangular page with the page's true proportions. */
  function warpPage(src, corners, maxSide = 4000) {
    return scoped((t) => {
      const w = src.cols;
      const h = src.rows;
      const [tl, tr, br, bl] = corners.map(([x, y]) => [x * w, y * h]);
      const edgeW = Math.max(dist(tl, tr), dist(bl, br));
      const edgeH = Math.max(dist(tl, bl), dist(tr, br));
      const ratio = pageRatio(corners, w, h);
      // keep the larger measured edge so no detail is lost, and derive the other from the true ratio
      let outW;
      let outH;
      if (edgeH * ratio >= edgeW) {
        outH = edgeH;
        outW = edgeH * ratio;
      } else {
        outW = edgeW;
        outH = edgeW / ratio;
      }
      const k = Math.min(1, maxSide / Math.max(outW, outH));
      outW = Math.max(16, Math.round(outW * k));
      outH = Math.max(16, Math.round(outH * k));
      const from = t(cv.matFromArray(4, 1, cv.CV_32FC2, [...tl, ...tr, ...br, ...bl]));
      const to = t(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]));
      const M = t(cv.getPerspectiveTransform(from, to));
      const dst = new cv.Mat();
      cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
      return dst;
    });
  }

  /**
   * Clockwise rotation (0/90/180/270) that makes text upright, from the warped page.
   * Sideways: text lines produce a much stronger row profile than column profile.
   * Upside down: Latin text has more ascenders than descenders. Returns 0 when there's no clear text signal.
   */
  function detectRotation(page) {
    return scoped((t) => {
      const small = t(resizeToFit(page, 1000));
      const gray = t(new cv.Mat());
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      const bin = t(new cv.Mat());
      const block = odd(Math.max(gray.cols, gray.rows) * 0.05);
      cv.adaptiveThreshold(gray, bin, 1, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 18);
      const w = bin.cols;
      const h = bin.rows;
      const d = bin.data;
      const rows = new Float64Array(h);
      const cols = new Float64Array(w);
      let ink = 0;
      // ignore the outer margin: page-edge shadows aren't text
      const mx = Math.round(w * 0.04);
      const my = Math.round(h * 0.04);
      for (let y = my; y < h - my; y++) {
        for (let x = mx; x < w - mx; x++) {
          if (d[y * w + x]) {
            rows[y]++;
            cols[x]++;
            ink++;
          }
        }
      }
      if (ink < w * h * 0.004) return 0;
      const roughness = (a) => {
        // sum of squared differences responds to fine text-line structure, not broad blobs
        let s = 0;
        for (let i = 1; i < a.length; i++) s += (a[i] - a[i - 1]) ** 2;
        return s / a.length;
      };
      // normalise: a profile sums over the perpendicular extent
      const rowScore = roughness(rows) / (w * w);
      const colScore = roughness(cols) / (h * h);
      const sideways = colScore > rowScore * 1.8;
      if (!sideways && rowScore < colScore * 1.3) return 0; // no dominant direction: not line-structured text

      if (sideways) {
        const turned = t(new cv.Mat());
        cv.rotate(bin, turned, cv.ROTATE_90_CLOCKWISE);
        return upsideDown(turned) ? 270 : 90;
      }
      return upsideDown(bin) ? 180 : 0;
    });
  }

  /** True when text lines show more ink below the x-height band than above it (descenders outnumbering ascenders). */
  function upsideDown(bin) {
    const w = bin.cols;
    const h = bin.rows;
    const d = bin.data;
    const profile = new Float64Array(h);
    const margin = Math.round(w * 0.04);
    for (let y = 0; y < h; y++) for (let x = margin; x < w - margin; x++) profile[y] += d[y * w + x];
    const peak = profile.reduce((a, b) => Math.max(a, b), 0);
    if (!peak) return false;
    const lineLevel = peak * 0.08;
    let top = 0;
    let bottom = 0;
    let lines = 0;
    let y = 0;
    while (y < h) {
      if (profile[y] <= lineLevel) {
        y++;
        continue;
      }
      const start = y;
      while (y < h && profile[y] > lineLevel) y++;
      const end = y;
      const height = end - start;
      if (height < 5 || height > h * 0.1) continue;
      // the x-height band is where a line's ink is densest
      let lineMax = 0;
      for (let i = start; i < end; i++) lineMax = Math.max(lineMax, profile[i]);
      let bandTop = start;
      while (bandTop < end && profile[bandTop] < lineMax * 0.5) bandTop++;
      let bandBottom = end - 1;
      while (bandBottom > start && profile[bandBottom] < lineMax * 0.5) bandBottom--;
      for (let i = start; i < bandTop; i++) top += profile[i];
      for (let i = bandBottom + 1; i < end; i++) bottom += profile[i];
      lines++;
    }
    return lines >= 3 && bottom > top * 1.25;
  }

  // ---------------------------------------------------------------- public: enhancement

  /** Divides out slowly varying illumination (shadows, vignetting, paper tint). Accepts 1 or 3 channels. */
  function flatten(src) {
    return scoped((t) => {
      const small = t(resizeToFit(src, 640));
      const unit = Math.max(small.cols, small.rows);
      const kernel = t(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(odd(unit * 0.035), odd(unit * 0.035))));
      const bg = t(new cv.Mat());
      // dilation keeps the paper's brightness and erases ink; the blur smooths the blocky result
      cv.dilate(small, bg, kernel);
      cv.GaussianBlur(bg, bg, new cv.Size(odd(unit * 0.07), odd(unit * 0.07)), 0);
      // floor the estimate so dark photos on the page aren't blown out to white
      const floor = small.channels() === 1 ? new cv.Scalar(95) : new cv.Scalar(95, 95, 95);
      const floorMat = t(new cv.Mat(bg.rows, bg.cols, bg.type(), floor));
      cv.max(bg, floorMat, bg);
      const full = t(new cv.Mat());
      cv.resize(bg, full, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
      const out = new cv.Mat();
      cv.divide(src, full, out, 245);
      return out;
    });
  }

  function applyLut(src, amount) {
    return scoped((t) => {
      // contrast around mid-grey with extra headroom at the white end, so paper stays white
      const gain = 1 + amount * 1.1;
      const table = new Uint8Array(256);
      for (let i = 0; i < 256; i++) table[i] = Math.max(0, Math.min(255, Math.round(((i / 255 - 0.56) * gain + 0.56) * 255)));
      const lut = t(cv.matFromArray(256, 1, cv.CV_8UC1, Array.from(table)));
      const out = new cv.Mat();
      if (src.channels() === 1) {
        cv.LUT(src, lut, out);
        return out;
      }
      const planes = t(new cv.MatVector());
      cv.split(src, planes);
      const merged = t(new cv.MatVector());
      for (let i = 0; i < planes.size(); i++) {
        const p = planes.get(i);
        const q = new cv.Mat();
        cv.LUT(p, lut, q);
        merged.push_back(q);
        p.delete();
        q.delete();
      }
      cv.merge(merged, out);
      return out;
    });
  }

  function localContrast(src) {
    return scoped((t) => {
      const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
      try {
        const out = new cv.Mat();
        if (src.channels() === 1) {
          clahe.apply(src, out);
          return out;
        }
        const lab = t(new cv.Mat());
        cv.cvtColor(src, lab, cv.COLOR_RGB2Lab);
        const planes = t(new cv.MatVector());
        cv.split(lab, planes);
        const l = planes.get(0);
        const l2 = t(new cv.Mat());
        clahe.apply(l, l2);
        l.delete();
        planes.set(0, l2);
        cv.merge(planes, lab);
        cv.cvtColor(lab, out, cv.COLOR_Lab2RGB);
        return out;
      } finally {
        clahe.delete();
      }
    });
  }

  function unsharp(src, amount) {
    return scoped((t) => {
      const sigma = Math.max(0.8, Math.max(src.cols, src.rows) / 2400);
      const blurred = t(new cv.Mat());
      cv.GaussianBlur(src, blurred, new cv.Size(0, 0), sigma);
      const out = new cv.Mat();
      cv.addWeighted(src, 1 + amount, blurred, -amount, 0, out);
      return out;
    });
  }

  function blackAndWhite(gray) {
    return scoped((t) => {
      // Thresholding small text destroys letter shapes, so low-resolution pages are enlarged first:
      // the grey anti-aliasing then decides the stroke edges at sub-pixel precision.
      const k = Math.min(2.5, BW_MIN_SIDE / Math.max(gray.cols, gray.rows));
      let src = gray;
      if (k > 1) {
        src = t(new cv.Mat());
        cv.resize(gray, src, new cv.Size(Math.round(gray.cols * k), Math.round(gray.rows * k)), 0, 0, cv.INTER_CUBIC);
      }
      const long = Math.max(src.cols, src.rows);
      const out = new cv.Mat();
      cv.adaptiveThreshold(src, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, odd(long * 0.022), 13);
      // single-pixel specks left by paper texture
      cv.medianBlur(out, out, 3);
      return out;
    });
  }

  const MODE_DEFAULTS = {
    original: { shadows: false, contrast: 0, readability: false, sharpen: false },
    color: { shadows: true, contrast: 0.2, readability: false, sharpen: true },
    gray: { shadows: true, contrast: 0.15, readability: false, sharpen: true },
    bw: { shadows: true, contrast: 0, readability: false, sharpen: false },
  };

  /** Applies a mode and options to a flattened RGBA page. Returns a new Mat (1 or 3 channels). */
  function enhance(page, mode, options) {
    const o = { ...MODE_DEFAULTS[mode], ...(options || {}) };
    return scoped((t) => {
      const grayMode = mode === "gray" || mode === "bw";
      let cur = t(new cv.Mat());
      cv.cvtColor(page, cur, grayMode ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGBA2RGB);
      if (o.shadows || mode === "bw") cur = t(flatten(cur));
      if (o.readability) cur = t(localContrast(cur));
      if (o.contrast > 0) cur = t(applyLut(cur, o.contrast));
      if (o.sharpen) cur = t(unsharp(cur, 0.7));
      const out = new cv.Mat();
      if (mode === "bw") {
        const bw = t(blackAndWhite(cur));
        bw.copyTo(out);
      } else cur.copyTo(out);
      return out;
    });
  }

  function rotateMat(src, degrees) {
    if (!degrees) return src.clone();
    const out = new cv.Mat();
    cv.rotate(src, out, degrees === 90 ? cv.ROTATE_90_CLOCKWISE : degrees === 180 ? cv.ROTATE_180 : cv.ROTATE_90_COUNTERCLOCKWISE);
    return out;
  }

  return { scoped, toMat, fromMat, resizeToFit, detect, detectPrecise, warpPage, detectRotation, enhance, rotateMat, pageRatio, orderCorners, isConvexQuad, MODE_DEFAULTS };
});
