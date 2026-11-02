// lauv: a branch in the dark, grown from a GitHub contribution year.
// Every week is a sprig, every day with contributions is a leaf on it.
// The light that falls on the branch is decided by the day that just ended.
// Pure functions: data in, SVG string out. No I/O, no dependencies.

export interface Day { date: string; count: number }
export interface Language { name: string; color: string; share: number }
export interface Snapshot { login: string; collectedAt: string; days: Day[]; languages: Language[] }
export type Detail = 'cel' | 'film'
export interface RenderOptions {
  /** Override the last complete day's count (previews and tests). */
  yesterday?: number
  /** CSS animation (sway, motes, glints, flicker). Default true. */
  animate?: boolean
  /** Corner captions (account, date range, leaf count, yesterday). Default false. */
  hud?: boolean
  /** 'film' (default) adds veins, backlit leaves, light shafts, bokeh, grading and grain. 'cel' is flat two-tone shading. */
  detail?: Detail
}

type Pt = [number, number]
type DayW = Day & { wd: number; i: number }

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n))
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

function parse(h: string): [number, number, number] {
  let s = h.replace('#', '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(a: string, b: string, t: number): string {
  const x = parse(a)
  const y = parse(b)
  const k = clamp(t)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function rng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// GitHub-style levels: quartiles of the account's own non-zero values.
export function quartiles(values: Array<{ count: number }>): [number, number, number] {
  const nz = values.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b)
  if (!nz.length) return [1, 1, 1]
  const q = (p: number) => nz[Math.floor(p * (nz.length - 1))]
  return [q(0.25), q(0.5), q(0.75)]
}
export function level(c: number, q: [number, number, number]): number {
  if (c <= 0) return 0
  if (c <= q[0]) return 1
  if (c <= q[1]) return 2
  if (c <= q[2]) return 3
  return 4
}

function withWeekday(days: Day[]): DayW[] {
  return days.map((d, i) => ({ ...d, i, wd: new Date(d.date + 'T00:00:00Z').getUTCDay() }))
}
function toWeeks(days: DayW[]): DayW[][] {
  const weeks: DayW[][] = []
  for (const d of days) {
    if (!weeks.length || d.wd === 0) weeks.push([])
    weeks[weeks.length - 1].push(d)
  }
  return weeks
}

// ---------------------------------------------------------------- geometry

function catmull(pts: Pt[], steps: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      const c = (j: 0 | 1) =>
        0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
      out.push([c(0), c(1)])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

class Curve {
  pts: Pt[]
  cum: number[]
  len: number
  constructor(pts: Pt[]) {
    this.pts = pts
    this.cum = [0]
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    }
    this.len = this.cum[this.cum.length - 1]
  }
  at(f: number): { x: number; y: number; a: number } {
    const s = clamp(f) * this.len
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < s) i++
    const t = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1)
    const p = this.pts[i - 1]
    const q = this.pts[i]
    return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, a: Math.atan2(q[1] - p[1], q[0] - p[0]) }
  }
  /** Tapered body plus a rim strip on the upper side, as two path strings. */
  body(w0: number, w1: number, pow: number): { body: string; rim: string } {
    const left: Pt[] = []
    const right: Pt[] = []
    const rim: Pt[] = []
    for (let k = 0; k <= 120; k++) {
      const f = k / 120
      const p = this.at(f)
      const w = w1 + (w0 - w1) * Math.pow(1 - f, pow)
      const nx = -Math.sin(p.a)
      const ny = Math.cos(p.a)
      left.push([p.x - nx * w * 0.5, p.y - ny * w * 0.5])
      right.push([p.x + nx * w * 0.5, p.y + ny * w * 0.5])
      rim.push([p.x - nx * w * 0.16, p.y - ny * w * 0.16])
    }
    const poly = (a: Pt[], b: Pt[]) => `M${a.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}L${[...b].reverse().map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}Z`
    return { body: poly(left, right), rim: poly(left, rim) }
  }
}

// Leaf templates, drawn 100 units long pointing along +x, base at the origin.
// Upper half (negative y) faces the light; the lower half is the cel shadow.
// Serrated edge, teeth leaning toward the tip.
interface LeafTpl { full: string; shade: string; hl: string; vein: string; side: string; spec: string }
function leafTemplate(r: () => number): LeafTpl {
  const wr = 0.38 + r() * 0.16
  const teeth = 8 + Math.floor(r() * 4)
  const curl = (r() - 0.5) * 0.12
  const bend = (u: number) => curl * u * u * 100
  const half = (u: number) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.85) * wr * 50
  const edge: Array<[number, number]> = [] // [u, halfwidth]
  edge.push([0, 0], [0.04, half(0.04)], [0.09, half(0.09)])
  const span = 0.84 / teeth
  for (let j = 0; j < teeth; j++) {
    const u0 = 0.11 + j * span
    const up = u0 + span * 0.78
    edge.push([u0, half(u0) * 0.97], [up, half(up) * 1.1])
  }
  edge.push([0.97, half(0.97)], [1, 0])
  const P = (u: number, h: number) => `${r1(u * 100)} ${r1(bend(u) + h)}`
  const upper = edge.map(([u, h]) => P(u, -h))
  const lower = edge.map(([u, h]) => P(u, h)).reverse()
  const mid = [0, 0.2, 0.4, 0.6, 0.8, 1].map((u) => P(u, 0))
  const full = `M${upper.join('L')}L${lower.slice(1).join('L')}Z`
  const shade = `M${mid.join('L')}L${lower.slice(1).join('L')}Z`
  const band = edge.filter(([u]) => u >= 0.1 && u <= 0.88)
  const inner = band.map(([u, h]) => P(u, -h * 0.42)).reverse()
  const hl = `M${band.map(([u, h]) => P(u, -h)).join('L')}L${inner.join('L')}Z`
  const vein = `M-8 0L0 0Q${r1(50)} ${r1(bend(0.5))} ${r1(88)} ${r1(bend(0.88))}`
  // film detail: paired side veins and a specular sliver along the lit edge
  const side = [0.2, 0.33, 0.46, 0.59, 0.72]
    .map((u) => {
      const v = u + 0.11
      return `M${P(u, 0)}L${P(v, -half(v) * 0.78)}M${P(u, 0)}L${P(v, half(v) * 0.78)}`
    })
    .join('')
  const sb = edge.filter(([u]) => u >= 0.2 && u <= 0.6)
  const spec = `M${sb.map(([u, h]) => P(u, -h * 0.94)).join('L')}L${[...sb].reverse().map(([u, h]) => P(u, -h * 0.8)).join('L')}Z`
  return { full, shade, hl, vein, side, spec }
}

function templateDefs(tpls: LeafTpl[], film: boolean): string {
  return tpls
    .map(
      (t, i) =>
        `<path id="l${i}" d="${t.full}"/><path id="s${i}" d="${t.shade}"/><path id="h${i}" d="${t.hl}"/><path id="v${i}" d="${t.vein}" fill="none" stroke-width="2.6" stroke-linecap="round"/>` +
        (film ? `<path id="x${i}" d="${t.side}" fill="none" stroke-width="1.4" stroke-linecap="round"/><path id="p${i}" d="${t.spec}"/>` : ''),
    )
    .join('')
}

// ------------------------------------------------------------------- light

interface Light {
  moon: boolean
  lv: number
  k: number
  sigma: number
  a: Pt
  b: Pt
  dir: Pt
  nrm: Pt
  op: number
  beam: string
  rim: string
  at: (x: number, y: number) => number
}
function makeLight(lv: number, warm: [Pt, Pt], cold: [Pt, Pt], sigmas: number[], coldSigma: number): Light {
  const moon = lv === 0
  const [a, b] = moon ? cold : warm
  const k = moon ? 0.42 : [0, 0.52, 0.7, 0.86, 1][lv]
  const sigma = moon ? coldSigma : sigmas[lv]
  const dl = Math.hypot(b[0] - a[0], b[1] - a[1])
  const dir: Pt = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl]
  const nrm: Pt = [-dir[1], dir[0]]
  return {
    moon, lv, k, sigma, a, b, dir, nrm,
    op: moon ? 0.035 : 0.05 + 0.11 * k,
    beam: moon ? '#9fc0f0' : '#fff0c4',
    rim: moon ? '#6f93ad' : '#b8784a',
    at: (x, y) => {
      const d = (x - a[0]) * nrm[0] + (y - a[1]) * nrm[1]
      return k * Math.exp(-((d / sigma) ** 2))
    },
  }
}

const SEASON: Record<number, [string, number]> = {
  12: ['#4f8c8c', 0.16], 1: ['#4f8c8c', 0.18], 2: ['#4f8c8c', 0.14],
  3: ['#c8ec5c', 0.16], 4: ['#c8ec5c', 0.2], 5: ['#b6e34e', 0.14],
  6: ['#000000', 0], 7: ['#000000', 0], 8: ['#000000', 0],
  9: ['#d2a63a', 0.18], 10: ['#e09a2e', 0.32], 11: ['#d4822a', 0.4],
}

interface Ctx {
  light: Light
  film: boolean
  animate: boolean
  bloom: string[]
  glints: number
  tpls: number
}

interface LeafSpec {
  x: number // attach point, in the coordinates of the enclosing group
  y: number
  gx: number // leaf centre, in scene coordinates (for light)
  gy: number
  a: number // direction, radians
  len: number
  lit: number
  month: number
  back: boolean
  r: () => number
}

function drawLeaf(ctx: Ctx, s: LeafSpec): string {
  const { light, film } = ctx
  const lit = clamp(s.lit)
  const backlit = film && !light.moon && !s.back && lit > 0.5 && s.r() < 0.32
  let base: string, dark: string, vein: string, hl: string, hlOp: number
  if (light.moon) {
    base = mix('#11262e', '#3c7586', lit)
    dark = mix('#0a171d', '#1b4250', lit)
    vein = '#08141a'
    hl = '#a6d6ec'
    hlOp = clamp((lit - 0.18) / 0.5) * 0.75
  } else if (backlit) {
    // light coming through the leaf: translucent lime, veins dark against it
    base = mix('#4f8f2a', '#cdf06c', lit)
    dark = mix('#3e7a22', '#a8da55', lit)
    vein = '#4a7f22'
    hl = '#f4ffc0'
    hlOp = 0
  } else {
    base = mix('#143428', '#8fd046', Math.pow(lit, 0.85))
    dark = mix('#0b1f17', '#3f8b2f', lit)
    vein = mix('#08170f', '#2a6620', lit)
    hl = '#dcf28c'
    hlOp = clamp((lit - 0.28) / 0.45) * 0.85
  }
  const [tint, amt] = SEASON[s.month] ?? ['#000000', 0]
  if (amt) {
    const k = amt * (0.25 + 0.75 * lit)
    base = mix(base, tint, k)
    dark = mix(dark, mix(tint, '#000000', backlit ? 0.2 : 0.45), k)
  }
  // which half faces the light: mirror the template if it's the lower one
  const nx = Math.sin(s.a)
  const ny = -Math.cos(s.a)
  const flip = nx * -light.dir[0] + ny * -light.dir[1] > 0 ? 1 : -1
  const t = Math.floor(s.r() * ctx.tpls)
  const k = s.len / 100
  let out =
    `<g transform="translate(${r1(s.x)} ${r1(s.y)}) rotate(${r1(deg(s.a))}) scale(${r2(k)} ${r2(k * flip)})">` +
    `<use href="#l${t}" fill="${base}"/><use href="#s${t}" fill="${dark}"/>` +
    (hlOp > 0.04 ? `<use href="#h${t}" fill="${hl}" opacity="${r2(hlOp)}"/>` : '')
  if (film) {
    out += `<use href="#x${t}" stroke="${backlit ? '#3f6e1c' : vein}" opacity="${backlit ? 0.75 : r2(0.25 + 0.4 * lit)}"/>`
    if (!light.moon && lit > 0.5 && !backlit) out += `<use href="#p${t}" fill="#fffbe6" opacity="${r2(0.5 * lit)}"/>`
  }
  out += `<use href="#v${t}" stroke="${vein}"/></g>`

  if (s.lit > 0.42) {
    const a = r1(deg(s.a))
    const at = `transform="rotate(${a} ${r1(s.gx)} ${r1(s.gy)})"`
    ctx.bloom.push(`<ellipse cx="${r1(s.gx)}" cy="${r1(s.gy)}" rx="${r1(s.len * 0.62)}" ry="${r1(s.len * 0.34)}" ${at} fill="${light.moon ? '#7fb6dc' : '#c4f26a'}" opacity="${r2((backlit ? 0.3 : 0.15) * s.lit)}"/>`)
    if (!light.moon) ctx.bloom.push(`<ellipse cx="${r1(s.gx)}" cy="${r1(s.gy)}" rx="${r1(s.len * 0.95)}" ry="${r1(s.len * 0.55)}" ${at} fill="#ff6a3d" opacity="${r2(0.045 * s.lit)}"/>`)
    if (film && !light.moon && s.lit > 0.75) ctx.bloom.push(`<ellipse cx="${r1(s.gx)}" cy="${r1(s.gy)}" rx="${r1(s.len * 1.4)}" ry="${r1(s.len * 0.8)}" ${at} fill="#ff3d64" opacity="${r2(0.05 * s.lit)}"/>`)
  }
  return out
}

function glint(ctx: Ctx, x: number, y: number): string {
  ctx.glints++
  return `<path class="gl g${ctx.glints % 3}" d="M${r1(x)} ${r1(y - 4.5)}L${r1(x + 1)} ${r1(y - 1)}L${r1(x + 4.5)} ${r1(y)}L${r1(x + 1)} ${r1(y + 1)}L${r1(x)} ${r1(y + 4.5)}L${r1(x - 1)} ${r1(y + 1)}L${r1(x - 4.5)} ${r1(y)}L${r1(x - 1)} ${r1(y - 1)}Z" fill="#fffbe8"/>`
}

// ------------------------------------------------------------- atmosphere

/** Beam, gradients, bokeh, motes, rays, framing leaves, grade, vignette, grain. */
function atmosphere(ctx: Ctx, W: number, H: number, R: () => number, seed: number, nearLeaves: Array<{ x: number; y: number; a: number; s: number }>) {
  const { light: L, film, animate } = ctx
  const defs: string[] = []
  const hw = L.sigma * 2.4
  const ext = 260
  const A0: Pt = [L.a[0] - L.dir[0] * ext, L.a[1] - L.dir[1] * ext]
  const A1: Pt = [L.b[0] + L.dir[0] * ext, L.b[1] + L.dir[1] * ext]
  const quad = (c0: Pt, c1: Pt, w: number, n: Pt) =>
    [[c0[0] - n[0] * w, c0[1] - n[1] * w], [c0[0] + n[0] * w, c0[1] + n[1] * w], [c1[0] + n[0] * w, c1[1] + n[1] * w], [c1[0] - n[0] * w, c1[1] - n[1] * w]]
      .map((p) => `${r1(p[0])} ${r1(p[1])}`)
      .join('L')
  const gStops = (color: string, peak: number) =>
    Array.from({ length: 11 }, (_, j) => {
      const o = j / 10
      const d = (o - 0.5) * 2 * hw
      return `<stop offset="${r2(o)}" stop-color="${color}" stop-opacity="${r2(peak * Math.exp(-((d / L.sigma) ** 2)))}"/>`
    }).join('')
  const g = `gradientUnits="userSpaceOnUse" x1="${r1(L.a[0] - L.nrm[0] * hw)}" y1="${r1(L.a[1] - L.nrm[1] * hw)}" x2="${r1(L.a[0] + L.nrm[0] * hw)}" y2="${r1(L.a[1] + L.nrm[1] * hw)}"`
  defs.push(`<linearGradient id="beam" ${g}>${gStops(L.beam, 1)}</linearGradient>`)
  defs.push(`<linearGradient id="rim" ${g}>${gStops(L.rim, L.k)}</linearGradient>`)

  // out-of-focus background foliage
  const bk = ['#11291f', '#0c222a', L.moon ? '#0f1a2a' : '#24190b']
  bk.forEach((c, i) => defs.push(`<radialGradient id="bk${i}"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`))
  const bokeh: string[] = []
  for (let i = 0; i < 9; i++) {
    const x = R() * W
    const y = R() * H
    const r = 50 + R() * 120
    const lit = L.at(x, y)
    bokeh.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="url(#bk${lit > 0.3 && !L.moon ? 2 : Math.floor(R() * 2)})" opacity="${r2(0.35 + R() * 0.35)}"/>`)
  }

  const nearFill = L.moon ? '#08141a' : '#0a1a10'
  const near = nearLeaves.map((n, i) => `<use href="#l${i % ctx.tpls}" transform="translate(${n.x} ${n.y}) rotate(${n.a}) scale(${n.s})" fill="${film ? (L.moon ? '#050c10' : '#06110a') : nearFill}"/>`).join('')

  const motes: string[] = []
  const nMotes = [0, 7, 13, 20, 30][L.lv] ?? 0
  for (let i = 0; i < nMotes; i++) {
    const t = 0.18 + R() * 0.6
    const off = (R() + R() + R() - 1.5) * L.sigma * 0.7
    const x = L.a[0] + (L.b[0] - L.a[0]) * t + L.nrm[0] * off
    const y = L.a[1] + (L.b[1] - L.a[1]) * t + L.nrm[1] * off
    const cls = animate ? ` class="m m${i % 4}" style="animation-delay:-${r1(R() * 10)}s"` : ''
    motes.push(`<g${cls}><circle cx="${r1(x)}" cy="${r1(y)}" r="${r2(0.6 + R() * 1.3)}" fill="#fff6dc" opacity="${r2(0.35 + R() * 0.55)}"/></g>`)
  }

  // film: shafts within the beam, specks of out-of-focus light, colour grade
  const fr = rng(seed ^ 0x9e3779b9)
  const rays: string[] = []
  const specks: string[] = []
  if (film) {
    const nRays = L.moon ? 2 : L.lv >= 3 ? 3 : 2
    for (let i = 0; i < nRays; i++) {
      const tilt = rad((fr() - 0.5) * 7)
      const d: Pt = [L.dir[0] * Math.cos(tilt) - L.dir[1] * Math.sin(tilt), L.dir[0] * Math.sin(tilt) + L.dir[1] * Math.cos(tilt)]
      const n: Pt = [-d[1], d[0]]
      const off = (fr() - 0.5) * 1.3 * L.sigma
      const c0: Pt = [L.a[0] + L.nrm[0] * off - d[0] * ext, L.a[1] + L.nrm[1] * off - d[1] * ext]
      const c1: Pt = [c0[0] + d[0] * (ext * 2 + 900), c0[1] + d[1] * (ext * 2 + 900)]
      const w = L.sigma * (0.05 + fr() * 0.1)
      const cls = animate ? ` class="ry r${i % 3}" style="animation-delay:-${r1(fr() * 9)}s"` : ''
      rays.push(`<g${cls}><path d="M${quad(c0, c1, w, n)}Z" fill="${L.beam}" opacity="${r2((L.moon ? 0.1 : 0.12 + 0.12 * L.k) * (0.6 + fr() * 0.5))}"/></g>`)
    }
    const warm = L.moon ? '#a9c8ff' : '#ffe2a6'
    defs.push(`<radialGradient id="spk"><stop offset="0" stop-color="${warm}"/><stop offset="0.55" stop-color="${warm}" stop-opacity="0.55"/><stop offset="0.8" stop-color="${warm}" stop-opacity="0.9"/><stop offset="1" stop-color="${warm}" stop-opacity="0"/></radialGradient>`)
    const nSpecks = L.moon ? 7 : 8 + 5 * L.lv
    for (let i = 0; i < nSpecks; i++) {
      let x = fr() * W
      let y = fr() * H
      if (fr() < 0.65) {
        const t = 0.1 + fr() * 0.8
        const off = (fr() + fr() - 1) * L.sigma * 1.2
        x = L.a[0] + (L.b[0] - L.a[0]) * t + L.nrm[0] * off
        y = L.a[1] + (L.b[1] - L.a[1]) * t + L.nrm[1] * off
      }
      const lit = L.moon ? 0.4 : L.at(x, y)
      const cls = animate && i % 3 === 0 ? ` class="m m${i % 4}" style="animation-delay:-${r1(fr() * 12)}s"` : ''
      specks.push(`<g${cls}><circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(2.5 + fr() * 9)}" fill="url(#spk)" opacity="${r2((0.1 + 0.5 * lit) * (0.5 + fr() * 0.5))}"/></g>`)
    }
    defs.push(
      `<linearGradient id="grade" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${L.moon ? '#1e3f78' : '#14605c'}"/><stop offset="0.5" stop-color="#808080"/><stop offset="1" stop-color="${L.moon ? '#9cb8ff' : '#ffb067'}"/></linearGradient>`,
      `<filter id="ray" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${r1(Math.max(6, L.sigma * 0.08))}"/></filter>`,
    )
  }

  // brightest point of the beam along a curve gets a warm glow behind it
  defs.push(
    `<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.3"/></filter>`,
    `<filter id="bloom" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="18"/></filter>`,
    `<filter id="far" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${film ? 9 : 7}"/></filter>`,
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed % 97}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`,
    `<radialGradient id="vig" cx="0.55" cy="0.45" r="0.78"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></radialGradient>`,
    `<radialGradient id="hot"><stop offset="0" stop-color="${L.moon ? '#9cc4ff' : '#ffc87a'}"/><stop offset="1" stop-color="${L.moon ? '#9cc4ff' : '#ffc87a'}" stop-opacity="0"/></radialGradient>`,
  )

  const bm = animate ? ' class="bm"' : ''
  const under = (hot: { x: number; y: number }) =>
    `<g>${bokeh.join('')}</g>` +
    `<g${bm}><path d="M${quad(A0, A1, hw, L.nrm)}Z" fill="url(#beam)" opacity="${r2(L.op * (film ? 0.75 : 1))}"/></g>` +
    (film ? `<g filter="url(#ray)">${rays.join('')}</g>` : '') +
    `<ellipse cx="${r1(hot.x)}" cy="${r1(hot.y)}" rx="${r1(L.sigma * 1.5)}" ry="${r1(L.sigma * 1.1)}" fill="url(#hot)" opacity="${r2((L.moon ? 0.05 : 0.11) * L.k)}"/>` +
    `<g filter="url(#bloom)">${ctx.bloom.join('')}</g>`
  const over =
    `<g>${motes.join('')}</g>` +
    (film ? `<g>${specks.join('')}</g>` : '') +
    `<g filter="url(#far)">${near}</g>` +
    (film ? `<rect width="${W}" height="${H}" fill="url(#grade)" opacity="0.42" style="mix-blend-mode:soft-light"/>` : '') +
    `<rect width="${W}" height="${H}" fill="url(#vig)"/>` +
    `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="${film ? 0.11 : 0.09}"/>`
  return { defs, under, over }
}

function css(animate: boolean, film: boolean): string {
  if (!animate) return ''
  return `<style>
.sw{transform-origin:0 0;animation:sw 6.4s ease-in-out infinite alternate}
.w1{animation-duration:7.7s}.w2{animation-duration:9.1s}.w3{animation-duration:5.6s}
@keyframes sw{from{transform:rotate(-1.3deg)}to{transform:rotate(1.7deg)}}
.m{animation:m 11s linear infinite}.m1{animation-duration:14s}.m2{animation-duration:9s}.m3{animation-duration:17s}
@keyframes m{0%{transform:translate(0,0);opacity:0}15%{opacity:.9}85%{opacity:.9}100%{transform:translate(-26px,34px);opacity:0}}
.gl{opacity:0;animation:gl 7s ease-in-out infinite}.g1{animation-delay:-2.4s;animation-duration:9s}.g2{animation-delay:-5s;animation-duration:11s}
@keyframes gl{0%,100%{opacity:0}50%{opacity:.75}}
.bm{animation:bm 8s ease-in-out infinite alternate}
@keyframes bm{from{opacity:.78}to{opacity:1}}
${film ? `.ry{animation:ry 7s ease-in-out infinite alternate}.r1{animation-duration:9.5s}.r2{animation-duration:12s}
@keyframes ry{from{opacity:.45}to{opacity:1}}
` : ''}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`
}

const FONT = `font-family="ui-sans-serif,system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif"`

// -------------------------------------------------------------------- hero

const W = 1200
const H = 520
const LEAF_LEN = [0, 30, 38, 46, 55]

export function render(snap: Snapshot, opts: RenderOptions = {}): string {
  const animate = opts.animate !== false
  const hud = opts.hud === true
  const film = opts.detail !== 'cel'
  const days = withWeekday(snap.days)
  const q = quartiles(days)
  const yesterday = opts.yesterday ?? (days.length ? days[days.length - 1].count : 0)
  const lv = level(yesterday, q)
  const seed = hash(snap.login.toLowerCase())
  const R = rng(seed)

  // Warm shaft from the upper right on a working day, cold moonlight otherwise.
  const L = makeLight(lv, [[1175, -80], [500, 600]], [[40, -140], [780, 640]], [0, 80, 112, 160, 225], 260)
  const ctx: Ctx = { light: L, film, animate, bloom: [], glints: 0, tpls: 6 }

  const weeks = toWeeks(days)
  const weekOf = new Map<number, number>()
  weeks.forEach((wk, wi) => wk.forEach((d) => weekOf.set(d.i, wi)))

  // Streaks of 7+ days bear fruit, coloured by the language mix.
  const streaks: Array<{ end: number; len: number }> = []
  let run = 0
  days.forEach((d, i) => {
    if (d.count > 0) run++
    if ((d.count === 0 || i === days.length - 1) && run >= 7) streaks.push({ end: d.count > 0 ? i : i - 1, len: run })
    if (d.count === 0) run = 0
  })
  const langs = snap.languages.filter((l) => l.color).slice(0, 3)
  const fruitLang: Language[] = []
  if (langs.length && streaks.length) {
    const tot = langs.reduce((s, l) => s + l.share, 0)
    const raw = langs.map((l) => (l.share / tot) * streaks.length)
    const n = raw.map(Math.floor)
    let left = streaks.length - n.reduce((s, v) => s + v, 0)
    const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
    for (let j = 0; left > 0; j++, left--) n[order[j % order.length][1]]++
    langs.forEach((l, i) => { for (let j = 0; j < n[i]; j++) fruitLang.push(l) })
  }
  const fruitAt = new Map<number, { len: number; lang: Language; rank: number }>()
  ;[...streaks].sort((a, b) => b.len - a.len).forEach((s, j) => {
    const lang = fruitLang[j]
    if (lang) fruitAt.set(s.end, { len: s.len, lang, rank: langs.indexOf(lang) })
  })
  const fruitWeeks = new Set([...fruitAt.keys()].map((i) => weekOf.get(i)))

  // The branch: oldest week at the left edge, this week at the tip.
  const branch = new Curve(catmull([[-70, 414], [150, 364], [400, 322], [640, 264], [860, 236], [1010, 198], [1124, 188]], 40))
  const tpls = Array.from({ length: 6 }, () => leafTemplate(R))

  const backLayer: string[] = []
  const upLayer: string[] = []
  const downLayer: string[] = []
  let swayN = 0

  weeks.forEach((wk, wi) => {
    const rr = rng(hash(snap.login + wk[0].date))
    const N = weeks.length
    const f = 0.035 + 0.935 * (N === 1 ? 1 : wi / (N - 1)) + (rr() - 0.5) * 0.013
    const p = branch.at(f)
    let side = wi % 2 === 0 ? -1 : 1
    if (rr() < 0.18) side = -side
    const back = wi < N - 3 && !fruitWeeks.has(wi) && rr() < 0.26
    const active = wk.filter((d) => d.count > 0)
    const twigLen = active.length ? 12 + 8.5 * active.length + rr() * 8 : 5
    const spread = side < 0 ? 40 + rr() * 30 : 36 + rr() * 32
    let ta = p.a + rad(side * spread)
    if (side > 0) ta += rad(10) // hanging sprigs droop
    const bend = (rr() - 0.5) * 0.32 * twigLen
    const cx = Math.cos(ta)
    const sy = Math.sin(ta)
    const C: Pt = [cx * twigLen * 0.5 - sy * bend, sy * twigLen * 0.5 + cx * bend]
    const E: Pt = [cx * twigLen, sy * twigLen]
    const quad = (u: number): Pt => [2 * (1 - u) * u * C[0] + u * u * E[0], 2 * (1 - u) * u * C[1] + u * u * E[1]]
    const quadT = (u: number) => Math.atan2(2 * (1 - u) * C[1] + 2 * u * (E[1] - C[1]), 2 * (1 - u) * C[0] + 2 * u * (E[0] - C[0]))

    const litTwig = L.at(p.x + E[0] / 2, p.y + E[1] / 2) * (back ? 0.5 : 1)
    const parts: string[] = []
    if (!active.length) return
    parts.push(`<path d="M0 0Q${r1(C[0])} ${r1(C[1])} ${r1(E[0])} ${r1(E[1])}" fill="none" stroke="${mix('#1d120c', L.moon ? '#3d5868' : '#8a5a33', litTwig * 0.85)}" stroke-width="2" stroke-linecap="round"/>`)

    const glints: string[] = []
    for (const d of active) {
      const lr = rng(hash(d.date))
      const u = 0.1 + 0.9 * (d.wd / 6)
      const at = quad(u)
      const lside = d.wd % 2 === 0 ? -1 : 1
      let la = quadT(u) + rad(lside * (d.wd === 6 ? 8 + lr() * 10 : 32 + lr() * 28))
      const droop = side > 0 ? 0.42 : 0.16
      la = Math.atan2(Math.sin(la) + droop, Math.cos(la))
      const len = LEAF_LEN[level(d.count, q)] * (0.9 + lr() * 0.2) * (back ? 0.88 : 1)
      const gx = p.x + at[0] + Math.cos(la) * len * 0.5
      const gy = p.y + at[1] + Math.sin(la) * len * 0.5
      const lit = L.at(gx, gy) * (back ? 0.55 : 1) * (0.85 + lr() * 0.3)
      parts.push(drawLeaf(ctx, { x: at[0], y: at[1], gx, gy, a: la, len, lit, month: parseInt(d.date.slice(5, 7), 10), back, r: lr }))
      if (!back && lit > 0.66 && lr() < 0.3 && ctx.glints < 22) {
        const flip = Math.sin(la) * -L.dir[0] - Math.cos(la) * -L.dir[1] > 0 ? 1 : -1
        glints.push(glint(ctx, at[0] + Math.cos(la) * len * 0.42 + Math.sin(la) * len * 0.12 * flip, at[1] + Math.sin(la) * len * 0.42 - Math.cos(la) * len * 0.12 * flip))
      }
      const fruit = fruitAt.get(d.i)
      if (fruit) parts.push(drawFruit(L, fruit, at, lit, lr))
    }
    parts.push(...glints)

    const body = parts.join('')
    if (back) {
      backLayer.push(`<g transform="translate(${r1(p.x)} ${r1(p.y)})">${body}</g>`)
    } else {
      const cls = animate ? ` class="sw w${swayN++ % 4}" style="animation-delay:-${r1(rr() * 8)}s"` : ''
      ;(side < 0 ? upLayer : downLayer).push(`<g transform="translate(${r1(p.x)} ${r1(p.y)})"><g${cls}>${body}</g></g>`)
    }
  })

  const br = branch.body(19, 2, 1.1)
  let best = 0
  let hot = branch.at(0.7)
  for (let k = 0; k <= 60; k++) {
    const p = branch.at(k / 60)
    const v = L.at(p.x, p.y)
    if (v > best) { best = v; hot = p }
  }

  const near = film
    ? [{ x: -40, y: 30, a: 30, s: 2.6 }, { x: -60, y: 470, a: -24, s: 2.9 }, { x: 40, y: 540, a: -62, s: 2.3 }, { x: 1250, y: -10, a: 150, s: 2.4 }]
    : [{ x: -30, y: 40, a: 32, s: 2.6 }]
  const atm = atmosphere(ctx, W, H, R, seed, near)

  const active = days.filter((d) => d.count > 0).length
  const first = days[0]?.date ?? ''
  const last = days[days.length - 1]?.date ?? ''
  const fmt = (d: string) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase() : '')
  const hudSvg = hud
    ? `<g ${FONT} font-size="12" letter-spacing="2.2" fill="#ece7dc" opacity="0.66">` +
      `<text x="36" y="44">${esc(snap.login.toUpperCase())}</text>` +
      `<text x="${W - 36}" y="44" text-anchor="end">${fmt(first)} — ${fmt(last)}</text>` +
      `<text x="36" y="${H - 34}">(${active}) DAYS ON THE BRANCH</text>` +
      `<text x="${W - 36}" y="${H - 34}" text-anchor="end">YESTERDAY (${yesterday})</text>` +
      `</g>`
    : ''
  const title = `${snap.login}: ${active} leaves, one for every day with contributions between ${first} and ${last}. Yesterday: ${yesterday}.`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
${css(animate, film)}
<defs>${templateDefs(tpls, film)}${atm.defs.join('')}<clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath></defs>
<g clip-path="url(#frame)">
<rect width="${W}" height="${H}" fill="${L.moon ? '#04060a' : '#050605'}"/>
${atm.under({ x: hot.x, y: hot.y })}
<g filter="url(#soft)" opacity="0.92">${backLayer.join('')}</g>
${upLayer.join('\n')}
<path d="${br.body}" fill="#1f130d"/><path d="${br.rim}" fill="url(#rim)"/>
${downLayer.join('\n')}
${atm.over}
${hudSvg}
</g>
</svg>
`
}

function drawFruit(L: Light, fr: { len: number; lang: Language; rank: number }, at: Pt, lit: number, lr: () => number): string {
  const col = fr.lang.color
  const lx = -L.dir[0]
  const ly = -L.dir[1]
  const ax = at[0]
  const ay = at[1] + 9
  const out: string[] = [`<path d="M${r1(at[0])} ${r1(at[1])}L${r1(ax)} ${r1(ay)}" stroke="#1d120c" stroke-width="1.6"/>`]
  const shade = clamp(lit)
  if (fr.rank === 0) {
    const n = Math.min(8, 3 + Math.floor(fr.len / 5))
    for (let j = 0; j < n; j++) {
      const ang = j * 2.4 + lr() * 0.6
      const rad0 = j === 0 ? 0 : 5 + Math.sqrt(j) * 3.6
      const bx = ax + Math.cos(ang) * rad0
      const by = ay + 6 + Math.abs(Math.sin(ang)) * rad0 * 0.9
      const br = 5.4 + lr() * 2
      out.push(`<path d="M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}" stroke="#1d120c" stroke-width="1"/>`)
      out.push(`<circle cx="${r1(bx)}" cy="${r1(by)}" r="${r1(br)}" fill="${mix(mix(col, '#000000', 0.55), col, shade)}"/>`)
      out.push(`<circle cx="${r1(bx + lx * br * 0.28)}" cy="${r1(by + ly * br * 0.28)}" r="${r1(br * 0.68)}" fill="${mix(mix(col, '#000000', 0.35), mix(col, '#ffffff', 0.18), shade)}"/>`)
      out.push(`<circle cx="${r1(bx + lx * br * 0.45)}" cy="${r1(by + ly * br * 0.45)}" r="${r1(br * 0.2)}" fill="#ffffff" opacity="${r2(0.25 + 0.7 * shade)}"/>`)
    }
  } else {
    const petals = fr.rank === 1 ? 5 : 4
    const pr = fr.rank === 1 ? 9 + Math.min(4, fr.len / 6) : 6.5
    const fx = ax + (lr() - 0.5) * 6
    const fy = ay + 7
    const rot = lr() * 72
    for (let j = 0; j < petals; j++) {
      const a = rad(rot + (j * 360) / petals)
      const px = fx + Math.cos(a) * pr * 0.55
      const py = fy + Math.sin(a) * pr * 0.55
      const facing = Math.cos(a) * lx + Math.sin(a) * ly
      const fill = facing > 0 ? mix(mix(col, '#000000', 0.5), mix(col, '#ffffff', 0.32), shade) : mix(mix(col, '#000000', 0.62), col, shade)
      out.push(`<ellipse cx="${r1(px)}" cy="${r1(py)}" rx="${r1(pr * 0.62)}" ry="${r1(pr * 0.36)}" transform="rotate(${r1(deg(a))} ${r1(px)} ${r1(py)})" fill="${fill}"/>`)
    }
    out.push(`<circle cx="${r1(fx)}" cy="${r1(fy)}" r="${r1(pr * 0.24)}" fill="${mix('#5a4210', '#ffd36a', shade)}"/>`)
  }
  return out.join('')
}

// ----------------------------------------------------------------- cutting

export interface CuttingInput {
  /** Shown in the caption, e.g. "K—lab". */
  name: string
  /** Position in the row, shown as (01), (02)… */
  index: number
  /** One line under the name. */
  tagline?: string
  /** Daily activity for this project over the last year. One leaf per active week. */
  days: Day[]
}

const CW = 600
const CH = 800
const CUT_LEN = [0, 46, 56, 67, 80]

function wrap(text: string, max: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) {
      lines.push(cur)
      cur = w
    } else cur = cur ? cur + ' ' + w : w
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 2)
}

/**
 * A single cut twig for one project, in a portrait frame with its caption.
 * Leaves are the project's active weeks, oldest at the base. The light is how
 * recently it was worked on: within a day is full light, months ago is moonlight.
 */
export function renderCutting(c: CuttingInput, opts: { animate?: boolean; detail?: Detail } = {}): string {
  const animate = opts.animate !== false
  const film = opts.detail !== 'cel'
  const days = withWeekday(c.days)
  const weeks = toWeeks(days).map((wk) => ({ date: wk[0].date, count: wk.reduce((s, d) => s + d.count, 0), month: parseInt(wk[wk.length - 1].date.slice(5, 7), 10) }))
  const q = quartiles(weeks)
  const lastActive = [...days].reverse().find((d) => d.count > 0)
  const end = days[days.length - 1]
  const since = lastActive && end ? (Date.parse(end.date) - Date.parse(lastActive.date)) / 86400000 : Infinity
  const lv = since <= 1 ? 4 : since <= 7 ? 3 : since <= 30 ? 2 : since <= 90 ? 1 : 0
  const seed = hash('cutting:' + c.name.toLowerCase())
  const R = rng(seed)

  const L = makeLight(lv, [[660, -80], [90, 820]], [[-60, -100], [520, 820]], [0, 80, 110, 150, 200], 230)
  const ctx: Ctx = { light: L, film, animate, bloom: [], glints: 0, tpls: 6 }
  const tpls = Array.from({ length: 6 }, () => leafTemplate(R))

  // twig from below the frame, curving up; every other cutting leans the other way
  const mirror = c.index % 2 === 0
  const mx = (x: number) => (mirror ? CW - x : x)
  const j = () => (R() - 0.5) * 50
  const pts: Pt[] = [[170 + j(), 880], [170 + j(), 680], [230 + j(), 500], [330 + j(), 360], [400 + j(), 230], [420, 120]]
  const twig = new Curve(catmull(pts.map(([x, y]) => [mx(x), y] as Pt), 30))

  // The sprig spans the project's active life, first to last commit week;
  // how long ago that last week was is told by the light, not by bare stem.
  const leaves: string[] = []
  const firstW = weeks.findIndex((w) => w.count > 0)
  const lastW = weeks.length - 1 - [...weeks].reverse().findIndex((w) => w.count > 0)
  const span = Math.max(1, lastW - firstW)
  let swayN = 0
  weeks.forEach((wk, wi) => {
    if (wk.count <= 0) return
    const lr = rng(hash(c.name + wk.date))
    const f = 0.2 + 0.77 * ((wi - firstW) / span)
    const p = twig.at(f)
    const side = wi % 2 === 0 ? -1 : 1
    let la = p.a + rad(side * (38 + lr() * 30))
    la = Math.atan2(Math.sin(la) + 0.22, Math.cos(la))
    const len = CUT_LEN[level(wk.count, q)] * (0.9 + lr() * 0.2)
    const gx = p.x + Math.cos(la) * len * 0.5
    const gy = p.y + Math.sin(la) * len * 0.5
    const lit = L.at(gx, gy) * (0.85 + lr() * 0.3)
    const leaf = drawLeaf(ctx, { x: 0, y: 0, gx, gy, a: la, len, lit, month: wk.month, back: false, r: lr })
    const g = !L.moon && lit > 0.66 && lr() < 0.3 && ctx.glints < 8 ? glint(ctx, Math.cos(la) * len * 0.45, Math.sin(la) * len * 0.45) : ''
    const cls = animate ? ` class="sw w${swayN++ % 4}" style="animation-delay:-${r1(lr() * 8)}s"` : ''
    leaves.push(`<g transform="translate(${r1(p.x)} ${r1(p.y)})"><g${cls}>${leaf}${g}</g></g>`)
  })

  const br = twig.body(10, 1.8, 1.2)
  let best = 0
  let hot = twig.at(0.6)
  for (let k = 0; k <= 40; k++) {
    const p = twig.at(k / 40)
    const v = L.at(p.x, p.y)
    if (v > best) { best = v; hot = p }
  }
  const near = film ? [{ x: mx(-60), y: 90, a: mirror ? 160 : 20, s: 2.2 }] : []
  const atm = atmosphere(ctx, CW, CH, R, seed, near)

  const num = `(${String(c.index).padStart(2, '0')})`
  const title = `${c.name}${c.tagline ? `: ${c.tagline}` : ''}. ${weeks.filter((w) => w.count > 0).length} leaves, one for every week with commits in the last year.`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
${css(animate, film)}
<defs>${templateDefs(tpls, film)}${atm.defs.join('')}<clipPath id="frame"><rect width="${CW}" height="${CH}" rx="22"/></clipPath><linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030403" stop-opacity="0"/><stop offset="1" stop-color="#030403"/></linearGradient></defs>
<g clip-path="url(#frame)">
<rect width="${CW}" height="${CH}" fill="${L.moon ? '#04060a' : '#050605'}"/>
${atm.under({ x: hot.x, y: hot.y })}
<path d="${br.body}" fill="#1f130d"/><path d="${br.rim}" fill="url(#rim)"/>
${leaves.join('\n')}
${atm.over}
<rect y="${CH - 300}" width="${CW}" height="300" fill="url(#foot)"/>
<g ${FONT} fill="#ece7dc">
<text x="44" y="${CH - 128}" font-size="23" letter-spacing="4" opacity="0.6">${num}</text>
<text x="${CW - 44}" y="${CH - 128}" font-size="23" letter-spacing="4" text-anchor="end" opacity="0.94">${esc(c.name.toUpperCase())}</text>
${wrap(c.tagline ?? '', 34).map((line, i) => `<text x="44" y="${CH - 80 + i * 34}" font-size="25" opacity="0.62">${esc(line)}</text>`).join('')}
</g>
</g>
</svg>
`
}
