// Sketches on the frame: vector strokes normalized to the video picture (0–1), drawn as SVG over the <video>.
// Used by the review page (draw + show) and the guest share page (show only).

export const COLORS = ['#ffd60a', '#ff453a', '#64d2ff', '#ffffff'];
export const TOOLS = [['pen', '✎', 'Pen'], ['arrow', '↗', 'Arrow'], ['circle', '◯', 'Circle']];
const NS = 'http://www.w3.org/2000/svg';
const round = (n) => Math.round(n * 10000) / 10000;

// Where the picture actually sits inside a <video> with object-fit: contain.
export function pictureRect(video) {
  const box = video.getBoundingClientRect();
  const host = video.offsetParent?.getBoundingClientRect() || box;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const scale = Math.min(box.width / vw, box.height / vh);
  const width = vw * scale, height = vh * scale;
  return { left: box.left - host.left + (box.width - width) / 2, top: box.top - host.top + (box.height - height) / 2, width, height };
}

// Pinned to the picture; call again on resize or when the video's size becomes known.
export function placeLayer(svg, video) {
  const rect = pictureRect(video);
  Object.assign(svg.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  return rect;
}

function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function strokeNode(s, W, H) {
  const color = COLORS.includes(s.color) ? s.color : COLORS[0];
  const width = Math.max(2, (Number(s.w) || 0.006) * W);
  const pts = (s.pts || []).map(([x, y]) => [x * W, y * H]);
  const base = { fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (!pts.length) return null;
  if (s.tool === 'circle' && pts.length >= 2) {
    const [[x1, y1], [x2, y2]] = [pts[0], pts[pts.length - 1]];
    return el('ellipse', { ...base, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 });
  }
  if (s.tool === 'arrow' && pts.length >= 2) {
    const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(10, width * 3.5);
    const wing = (a) => `${x2 - head * Math.cos(angle + a)} ${y2 - head * Math.sin(angle + a)}`;
    return el('path', { ...base, d: `M${x1} ${y1} L${x2} ${y2} M${wing(0.5)} L${x2} ${y2} L${wing(-0.5)}` });
  }
  const d = pts.length === 1 ? `M${pts[0][0]} ${pts[0][1]} l0.01 0` : `M${pts.map((p) => p.join(' ')).join(' L')}`;
  return el('path', { ...base, d });
}

// Draws one or more sketches into the layer (replacing what was there).
export function paintSketches(svg, sketches) {
  const W = parseFloat(svg.style.width) || svg.clientWidth, H = parseFloat(svg.style.height) || svg.clientHeight;
  svg.replaceChildren();
  for (const sketch of sketches) {
    for (const s of sketch?.strokes || []) {
      const node = strokeNode(s, W, H);
      if (node) svg.append(node);
    }
  }
}

// When a note's sketch is on screen: across a range, or for 2 seconds from a moment.
export const sketchShowsAt = (n, t) => (n.t_end === null || n.t_end === undefined
  ? t >= Number(n.t_start) - 0.08 && t <= Number(n.t_start) + 2
  : t >= Number(n.t_start) - 0.08 && t <= Number(n.t_end));

// Lets someone draw on the layer. Returns { strokes, undo, clear, stop }.
// `mirrored()` says whether the picture is flipped, so marks land on the right side of the real video.
export function startDrawing(svg, { tool, color, mirrored, onChange }) {
  const strokes = [];
  let current = null;
  const point = (e) => {
    const box = svg.getBoundingClientRect();
    let x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (mirrored()) x = 1 - x;
    return [round(Math.min(1, Math.max(0, x))), round(Math.min(1, Math.max(0, y)))];
  };
  const repaint = () => { paintSketches(svg, [{ strokes: current ? [...strokes, current] : strokes }]); onChange?.(strokes); };
  const down = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    svg.setPointerCapture?.(e.pointerId);
    current = { tool: tool(), color: color(), w: 0.006, pts: [point(e)] };
    repaint();
  };
  const move = (e) => {
    if (!current) return;
    const p = point(e);
    if (current.tool === 'pen') {
      const [lx, ly] = current.pts[current.pts.length - 1];
      if (Math.hypot(p[0] - lx, p[1] - ly) < 0.004) return;
      if (current.pts.length < 600) current.pts.push(p);
    } else current.pts = [current.pts[0], p];
    repaint();
  };
  const up = () => {
    if (!current) return;
    const [a, b] = [current.pts[0], current.pts[current.pts.length - 1]];
    // A tap with the arrow or circle tool draws nothing.
    if (current.tool === 'pen' || Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) strokes.push(current);
    current = null;
    repaint();
  };
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  return {
    strokes,
    undo() { strokes.pop(); repaint(); },
    clear() { strokes.length = 0; repaint(); },
    stop() {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
    }
  };
}
