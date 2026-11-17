// Fig 1 — Roof duct support, LOD ladder.
// An insulated supply duct on a rooftop support stand (a typical "on-roof duct support" detail),
// drawn with the anatomy kit. Every part carries the LOD at which a shop drawing has to define it; stepping
// the LOD from 200 to 400 resolves the parts in that order, so the figure shows what each LOD adds.
//
//   node build.mjs            -> roof-support.html (dark)
//   node build.mjs --light    -> roof-support-light.html
// Both runs also write roof-support.fragment.json (plate markup + live script) for embedding.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../vendor/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

// World unit = 10 mm.
const WIDTH = 600;
const HEIGHT = 380;
const ROOF = { x: -170, y: -66, w: 340, d: 132, r: 3 };
const ROOF_T = 14;                         // 140 mm slab + screed shown as one block
const SCREED = 4;                          // 40 mm screed line on the slab edge
const FRAMES = [-95, 95];                  // two support frames, 1.9 m apart
const LEGS = [-34, 34];                    // legs 680 mm apart
const PLINTH = 30, PLINTH_H = 15;          // 300 x 300 x 150 concrete plinth
const COLLAR = 1.6, COLLAR_H = 5;          // membrane upstand around the plinth
const BASE = 20, BASE_T = 1;               // 200 x 200 x 10 base plate
const POST = 5;                            // 50 x 50 SHS post
const POST_TOP = 56;
const XM_H = 6, XM_Y = 41;                 // 60 mm channel, 820 mm long
const PAD_H = 1.5, PAD_Y = 29;             // 15 mm neoprene isolation pad
const DUCT_Y = 30;                         // 600 mm wide over cladding
const DUCT_Z = POST_TOP + XM_H + PAD_H;    // underside 635 mm above roof finish
const DUCT_H = 50;                         // 500 mm high over cladding
const DUCT_TOP = DUCT_Z + DUCT_H;
const DUCT_X = [-165, 165];
const INSUL = 5;                           // 50 mm insulation, so the duct is 500 x 400
const FLANGES = [-40, 40];                 // TDC joints
const STRAP_W = 2.5, STRAP_T = 0.5;        // 25 mm galvanised strap (drawn proud)
const TAG = { x: -14, w: 28, z: 80, h: 16 };

const LOD_TEXT = {
  200: "Massing envelope only: approximate size and route",
  300: "Size, location and the support stand fixed",
  350: "Interfaces: plinths, upstands, plates, anchors, pads, straps, insulation",
  400: "Fabrication: TDC flanges and bolts, nuts, welds, cladding laps, tag",
};

const P = k.fitProjection(
  [...k.boxCorners(ROOF, -ROOF_T, 0), ...k.boxCorners({ x: DUCT_X[0], y: -DUCT_Y - 2, w: DUCT_X[1] - DUCT_X[0], d: DUCT_Y * 2 + 4 }, DUCT_Z, DUCT_TOP + 2)],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 56 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const sq = (cx, cy, half, r = 0.4) => ({ x: cx - half, y: cy - half, w: half * 2, d: half * 2, r });

let total = 0;
const tally = {};
// A group of parts that a shop drawing must define at `lod`. `count` is how many real parts it holds.
function part(lod, count, name, body) {
  total += count;
  tally[lod] = (tally[lod] || 0) + count;
  return `<g data-lod="${lod}" data-count="${count}" data-part="${name}">${body}</g>`;
}

function roof() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(ROOF, -4), -ROOF_T, ROOF_T, P)}"/>`];
  const screed = k.sideSeam(ROOF, -SCREED, P, 3);
  out.push(S(k.slabOf(ROOF, -ROOF_T, ROOF_T, P, 3, 0.6), { tone: "lo", inner: L(screed, { tone: "faint" }) }));
  // paver joints: every 600 mm across the roof, edge to edge
  const joints = [];
  for (let x = ROOF.x + 20; x < ROOF.x + ROOF.w - 5; x += 60) joints.push(k.lineOnTop([x, ROOF.y], [x, ROOF.y + ROOF.d], 0, P));
  joints.push(k.lineOnTop([ROOF.x, 0], [ROOF.x + ROOF.w, 0], 0, P));
  out.push(L(joints.join(""), { tone: "faint" }));
  // shadow of the lifted duct on the roof
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: DUCT_X[0] + 4, y: -DUCT_Y + 6, w: DUCT_X[1] - DUCT_X[0] - 8, d: DUCT_Y * 2 - 6, r: 6 }, 0, 0.1, P)}" style="filter:blur(5px);opacity:.55"/>`);
  return out.join("");
}

function leg(fx, ly) {
  const out = [];
  const plinth = sq(fx, ly, PLINTH / 2, 1.2);
  out.push(part(350, 1, "upstand", S(k.slabOf(k.insetPlan(plinth, -COLLAR), 0, COLLAR_H, P, 3), { tone: "lo", crease: "lo" })));
  out.push(part(300, 1, "plinth", S(k.slabOf(plinth, 0, PLINTH_H, P, 3, 0.5), { tone: "mid" })));
  const plate = sq(fx, ly, BASE / 2, 0.4);
  out.push(part(350, 1, "base-plate", S(k.slabOf(plate, PLINTH_H, BASE_T, P, 2), { tone: "mid", crease: "lo" })));
  const bolts = k.corners(plate, 3);
  const top = PLINTH_H + BASE_T;
  out.push(part(350, 4, "anchors", D(bolts.map(([x, y]) => at([x, y, top])), { size: 0.55, tone: "hi" })));
  const nuts = bolts.map(([x, y]) => k.ring(x, y, 1.5, top, P, 14)).join("");
  out.push(part(400, 8, "nuts-washers", L(nuts, { tone: "mid" }) + bolts.map(([x, y]) => S(k.cylinder(x, y, 0.75, top, 1.4, P, 12), { tone: "mid", crease: "none" })).join("")));
  const post = sq(fx, ly, POST / 2, 0.3);
  out.push(part(300, 1, "post", S(k.slabOf(post, top, POST_TOP - top, P, 2, 0.3), { tone: "mid" })));
  out.push(part(400, 1, "weld", L(k.sideSeam(k.insetPlan(post, -0.25), top + 0.5, P, 2), { tone: "hi" })));
  return out.join("");
}

function frame(fx) {
  const out = [];
  for (const ly of LEGS) out.push(leg(fx, ly));
  const xm = { x: fx - 3, y: -XM_Y, w: 6, d: XM_Y * 2, r: 0.5 };
  out.push(part(300, 1, "cross-member", S(k.slabOf(xm, POST_TOP, XM_H, P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(xm, POST_TOP + 1, P, 2), { tone: "faint" }) })));
  out.push(part(400, 2, "frame-bolts", D(LEGS.map((ly) => at([fx, ly, POST_TOP + XM_H])), { size: 0.5, tone: "mid" })));
  out.push(part(350, 1, "pad", S(k.slabOf({ x: fx - 2.6, y: -PAD_Y, w: 5.2, d: PAD_Y * 2, r: 0.3 }, POST_TOP + XM_H, PAD_H, P, 2), { tone: "lo", crease: "none" })));
  return out.join("");
}

const segPlan = (x0, x1) => ({ x: x0, y: -DUCT_Y, w: x1 - x0, d: DUCT_Y * 2, r: 0.6 });

function ductSegment(x0, x1, index) {
  const plan = segPlan(x0, x1);
  const body = S(k.slabOf(plan, DUCT_Z, DUCT_H, P, 3, 0.8), { tone: "hi", crease: "lo" });
  const out = [`<g data-part="duct" data-seg="${index}">${body}</g>`];
  // aluminium cladding lap: across the top and down the visible side, edge to edge
  const xm = (x0 + x1) / 2;
  const lap = k.lineOnTop([xm, -DUCT_Y], [xm, DUCT_Y], DUCT_TOP, P) + k.segment([xm, DUCT_Y, DUCT_Z], [xm, DUCT_Y, DUCT_TOP], P);
  out.push(part(400, 1, "cladding-lap", L(lap, { tone: "mid" })));
  return out.join("");
}

function flange(xf) {
  const plan = { x: xf - 1, y: -DUCT_Y - 2, w: 2, d: DUCT_Y * 2 + 4, r: 0.5 };
  const solid = S(k.slabOf(plan, DUCT_Z - 2, DUCT_H + 4, P, 2, 0.3), { tone: "hi", crease: "lo" });
  const topBolts = [-22, -7.5, 7.5, 22].map((y) => at([xf, y, DUCT_TOP + 2]));
  const sideBolts = [DUCT_Z + 8, DUCT_Z + 25, DUCT_Z + 42].map((z) => at([xf, DUCT_Y + 2, z]));
  return part(400, 8, "tdc-flange", solid + D([...topBolts, ...sideBolts], { size: 0.45, tone: "mid" }));
}

function strap(sx) {
  const x = sx - STRAP_W / 2;
  const out = [];
  out.push(S(k.slabOf({ x, y: -DUCT_Y - 6.5, w: STRAP_W, d: 6.5 - STRAP_T, r: 0 }, POST_TOP + XM_H, STRAP_T, P, 1), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x, y: -DUCT_Y - STRAP_T, w: STRAP_W, d: STRAP_T, r: 0 }, POST_TOP + XM_H, DUCT_TOP - POST_TOP - XM_H + STRAP_T, P, 1), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x, y: -DUCT_Y - STRAP_T, w: STRAP_W, d: DUCT_Y * 2 + STRAP_T * 2, r: 0 }, DUCT_TOP, STRAP_T, P, 1), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x, y: DUCT_Y, w: STRAP_W, d: STRAP_T, r: 0 }, POST_TOP + XM_H, DUCT_TOP - POST_TOP - XM_H + STRAP_T, P, 1), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x, y: DUCT_Y + STRAP_T, w: STRAP_W, d: 6, r: 0 }, POST_TOP + XM_H, STRAP_T, P, 1), { tone: "mid", crease: "none" }));
  const strapPart = part(350, 1, "strap", out.join(""));
  const bolts = part(400, 2, "strap-bolts", D([at([sx, DUCT_Y + 4, POST_TOP + XM_H + STRAP_T]), at([sx, -DUCT_Y - 4, POST_TOP + XM_H + STRAP_T])], { size: 0.45, tone: "hi" }));
  return strapPart + bolts;
}

function endFace() {
  // insulation build-up on the cut end: duct inside a 50 mm wrap
  const x = DUCT_X[1];
  const z0 = DUCT_Z + INSUL, z1 = DUCT_TOP - INSUL, y = DUCT_Y - INSUL;
  const loop = k.pathOf([[x, -y, z0], [x, y, z0], [x, y, z1], [x, -y, z1]].map(at), true);
  return part(350, 1, "insulation", L(loop, { tone: "mid" }));
}

function tag() {
  const y = DUCT_Y;
  const plan = { x: TAG.x, y, w: TAG.w, d: 0.6, r: 0.3 };
  const rules = [TAG.z + 12, TAG.z + 8.5, TAG.z + 5].map((z) => L(k.segment([TAG.x + 3, y + 0.6, z], [TAG.x + TAG.w - 3 - (z === TAG.z + 5 ? 8 : 0), y + 0.6, z], P), { tone: "mid", free: true })).join("");
  const rivets = D([[TAG.x + 1.5, TAG.z + 1.5], [TAG.x + TAG.w - 1.5, TAG.z + 1.5], [TAG.x + 1.5, TAG.z + TAG.h - 1.5], [TAG.x + TAG.w - 1.5, TAG.z + TAG.h - 1.5]].map(([x, z]) => at([x, y + 0.6, z])), { size: 0.4, tone: "mid" });
  return part(400, 1, "tag", S(k.slabOf(plan, TAG.z, TAG.h, P, 2), { tone: "mid", crease: "none" }) + rules + rivets);
}

// Duct painted far to near (depth grows with x). A ring is painted after the segment that runs into it
// and before the segment that starts at its near face.
function duct() {
  const rings = [
    ...FRAMES.map((x) => ({ x, kind: "strap", end: x + STRAP_W / 2 })),
    ...FLANGES.map((x) => ({ x, kind: "flange", end: x + 1 })),
  ].sort((a, b) => a.x - b.x);
  const out = [];
  let from = DUCT_X[0];
  rings.forEach((ring, index) => {
    out.push(ductSegment(from, ring.end, index));
    out.push(ring.kind === "strap" ? strap(ring.x) : flange(ring.x));
    from = ring.end;
  });
  out.push(ductSegment(from, DUCT_X[1], rings.length));
  // the tag sits on the middle segment's face, so it goes after every segment that could cover it
  out.splice(out.findIndex((s) => s.includes('data-seg="3"')), 0, tag());
  out.push(endFace());
  return out.join("");
}

// the duct itself is defined from LOD 200 (as an envelope)
total += 1;
tally[200] = (tally[200] || 0) + 1;

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "An insulated supply duct, 600 by 500 millimetres over its aluminium cladding, carried across a roof on two steel support frames. Each frame has two square posts on base plates bolted to concrete plinths, a channel cross member and a neoprene pad under the duct, with a galvanised strap holding the duct down. Stepping the level of development from 200 to 400 adds the parts a shop drawing must define at each level.",
  body: [roof(), ...FRAMES.map(frame), duct()],
});

const LODS = [200, 300, 350, 400];
const cumulative = {};
let run = 0;
for (const l of LODS) { run += tally[l] || 0; cumulative[l] = run; }

const live = `
const P = ${JSON.stringify(P)};
const LODS = ${JSON.stringify(LODS)};
const TOTAL = ${total};
const DEFINED = ${JSON.stringify(cumulative)};
const TEXT = ${JSON.stringify(LOD_TEXT)};
const stage = document.querySelector('.iso-stage[data-fig="roof-support"]');
const svg = stage.querySelector("svg");
const readout = stage.closest(".iso-plate").querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const groups = [...svg.querySelectorAll("[data-lod]")].map((el) => ({ el, lod: +el.dataset.lod, v: 1 }));
for (const g of groups) for (const line of g.el.querySelectorAll(".iso-line:not(.iso-edge):not(.iso-crease):not(.iso-bevel), .iso-dots")) line.dataset.tone0 = line.dataset.tone;
let index = LODS.length - 1, frame = 0, last = 0, clock = 0, touring = !still.matches, visible = false, idle = 0;
function apply() {
  const lod = LODS[index];
  stage.dataset.lod = String(lod);
  for (const g of groups) {
    const fresh = g.lod === lod && lod > 200;
    for (const s of g.el.querySelectorAll(".iso-solid")) fresh ? s.setAttribute("data-lit", "") : s.removeAttribute("data-lit");
    for (const line of g.el.querySelectorAll("[data-tone0]")) line.dataset.tone = fresh ? "lit" : line.dataset.tone0;
  }
  const text = "LOD " + lod + " · " + DEFINED[lod] + " of " + TOTAL + " parts defined";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(lod));
  stage.setAttribute("aria-valuetext", text + ". " + TEXT[lod]);
}
function draw(dt, calm) {
  let moving = false;
  const lod = LODS[index];
  for (const g of groups) {
    const want = g.lod <= lod ? 1 : 0;
    g.v = calm ? want : g.v + (want - g.v) * (1 - Math.exp(-dt / 0.2));
    if (Math.abs(want - g.v) < 0.004) g.v = want; else moving = true;
    g.el.style.opacity = g.v.toFixed(3);
    g.el.style.display = g.v === 0 ? "none" : "";
    g.el.setAttribute("transform", g.v === 1 ? "" : translateAlong(P, [0, 0, (1 - g.v) * 8]));
  }
  return moving;
}
const dwell = (i) => (LODS[i] === 400 ? 4.6 : 2.4);
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) {
    clock += dt;
    if (clock > dwell(index)) { clock = 0; index = (index + 1) % LODS.length; apply(); }
  }
  const moving = draw(dt, still.matches);
  frame = visible && (touring || moving) ? requestAnimationFrame(tick) : 0;
}
const go = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
function steer(i) {
  touring = false;
  if (i !== index) { index = i; apply(); }
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; clock = 0; go(); }, 4200);
  go();
}
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) go(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width));
  steer(Math.floor(share * LODS.length));
});
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(LODS.length - 1, index + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, index - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = LODS.length - 1;
  if (to === null) return;
  event.preventDefault();
  steer(to);
});
apply();
draw(0, true);
`;

const EXTRA_CSS = `
.iso-stage[data-fig="roof-support"]{outline:none}
.iso-stage[data-fig="roof-support"]:focus-visible{box-shadow:0 0 0 2px var(--anatomy-mid);border-radius:8px}
.iso-stage[data-lod="200"] [data-part="duct"] .iso-edge{stroke:var(--anatomy-lo)}
.iso-stage[data-lod="200"] [data-part="duct"] .iso-top,.iso-stage[data-lod="200"] [data-part="duct"] .iso-shade{opacity:.55}
`;

const plate = k.plateHtml({
  fig: "Fig 1",
  title: "Roof duct support · LOD ladder",
  hint: "Hover or ← → to step the LOD",
  readout: `LOD 400 · ${total} of ${total} parts defined`,
  keys: [
    { mark: "lit", label: "Parts this LOD step adds" },
    { mark: "raised", label: "Parts defined at a lower LOD" },
    { mark: "flat", label: "Roof slab, screed and paving: the host trade" },
  ],
  caption:
    `A 600 × 500 mm insulated supply duct (500 × 400 mm inside a 50 mm wrap) on two roof frames 1.9 m apart, underside 635 mm above the roof finish. ` +
    `LOD 200 is a massing envelope. LOD 300 fixes size, route and the stand (${cumulative[300]} parts). ` +
    `LOD 350 adds everything that touches another trade: plinths, membrane upstands, base plates, anchors, isolation pads, hold-down straps and the insulation build-up (${cumulative[350]}). ` +
    `LOD 400 adds what a fabricator needs: TDC flanges and their bolts, nuts and washers, post welds, cladding laps and the equipment tag (${cumulative[400]}).`,
  body: `<div class="iso-stage" data-fig="roof-support" data-lod="400" tabindex="0" role="slider" aria-label="Roof duct support: arrow keys step the level of development" aria-valuemin="200" aria-valuemax="400" aria-valuenow="400">${svg}</div>`,
});

const name = theme === "light" ? "roof-support-light.html" : "roof-support.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Roof duct support", theme, body: `<style>${EXTRA_CSS}</style>${plate}`, script: kitScript() + live }));
writeFileSync(join(HERE, "roof-support.fragment.json"), JSON.stringify({ css: k.ISO_CSS + EXTRA_CSS, plate, live, kit: kitScript(), total, cumulative }));
console.log("wrote", name, "parts", total, JSON.stringify(cumulative));
