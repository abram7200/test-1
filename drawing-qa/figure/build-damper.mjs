// Fig 2 — Fire / smoke damper in a rated wall, installation sequence.
// Same dimensions as the 2D shop detail (world unit = 10 mm): 200 mm blockwork, opening 606 × 406,
// 600 × 400 damper in a 500 mm sleeve, 38 mm retaining angles on the near face, breakaway joints, ducts,
// actuator and access door. Stepping 1 → 5 adds the parts in the order they are installed.
//
//   node build-damper.mjs [--light]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../vendor/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 600, HEIGHT = 380;

const WALL = { x0: 0, x1: 20, y0: -62, y1: 62, top: 92 };
const OPEN = { y0: -30.3, y1: 30.3, z0: 29.7, z1: 70.3 };          // 606 × 406
const SL = { y0: -30, y1: 30, z0: 30, z1: 70 };                     // sleeve 600 × 400 outside
const FLOOR = { x: -80, y: -72, w: 182, d: 144, r: 3 };
const ANG = 3.8, T = 0.15;                                           // 38 × 1.5 angle
const STEPS = {
  1: "Opening 606 × 406 formed in the 200 mm rated blockwork",
  2: "Damper in a 1.5 mm sleeve, 200 mm out on the actuator side, 100 mm on the other",
  3: "Retaining angles both faces, 35 mm onto the wall, fixed to the sleeve only",
  4: "Breakaway joints and ducts on both sides",
  5: "Actuator, access door and firestop label",
};

const P = k.fitProjection(
  [...k.boxCorners(FLOOR, -3, 0), ...k.boxCorners({ x: WALL.x0, y: WALL.y0, w: 20, d: WALL.y1 - WALL.y0 }, 0, WALL.top), [96, 31, 72], [-76, -31, 72]],
  WIDTH, HEIGHT, { pad: 28, azimuth: 40 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const box = (x0, x1, y0, y1) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0 });

let total = 0;
const tally = {};
function part(step, count, name, body) {
  total += count;
  tally[step] = (tally[step] || 0) + count;
  return `<g data-lod="${step}" data-count="${count}" data-part="${name}">${body}</g>`;
}

function floor() {
  return `<path class="iso-halo" d="${k.haloOf(k.insetPlan(FLOOR, -4), -3, 3, P)}"/>` +
    S(k.slabOf(FLOOR, -3, 3, P, 3, 0.5), { tone: "lo" });
}

// Blockwork: four blocks around the opening, with bed joints every 200 and perpends every 400 on the near face.
function wall() {
  const blocks = [
    { y0: WALL.y0, y1: OPEN.y0, z0: 0, z1: WALL.top },
    { y0: OPEN.y0, y1: OPEN.y1, z0: 0, z1: OPEN.z0 },
    { y0: OPEN.y0, y1: OPEN.y1, z0: OPEN.z1, z1: WALL.top },
    { y0: OPEN.y1, y1: WALL.y1, z0: 0, z1: WALL.top },
  ];
  const x = WALL.x1;
  return blocks.map((b) => {
    const joints = [];
    const plan = box(WALL.x0, WALL.x1, b.y0, b.y1);
    for (let z = 20; z < b.z1 - 1; z += 20) if (z > b.z0 + 1) joints.push(k.sideSeam(plan, z, P, 1));   // bed joints wrap the corners
    for (let z = Math.max(0, Math.floor(b.z0 / 20) * 20); z < b.z1; z += 20) {
      const lo = Math.max(z, b.z0), hi = Math.min(z + 20, b.z1);
      if (hi - lo < 2) continue;
      const shift = (z / 20) % 2 ? 20 : 0;
      for (let y = -100 + shift; y < 100; y += 40) if (y > b.y0 + 2 && y < b.y1 - 2) joints.push(k.segment([x, y, lo], [x, y, hi], P));
    }
    return S(k.slabOf(box(WALL.x0, WALL.x1, b.y0, b.y1), b.z0, b.z1 - b.z0, P, 1, 0.4), { tone: "mid", inner: L(joints.join(""), { tone: "faint" }) });
  }).join("");
}

const sleeve = (x0, x1) => S(k.slabOf(box(x0, x1, SL.y0, SL.y1), SL.z0, SL.z1 - SL.z0, P, 1, 0.3), { tone: "mid", crease: "lo" });
const ring = (xc) => S(k.slabOf(box(xc - 1, xc + 1, SL.y0 - 0.6, SL.y1 + 0.6), SL.z0 - 0.6, SL.z1 - SL.z0 + 1.2, P, 1), { tone: "mid", crease: "lo" });
const duct = (x0, x1, endLoop) => {
  const body = k.slabOf(box(x0, x1, SL.y0, SL.y1), SL.z0, SL.z1 - SL.z0, P, 1, 0.6);
  const inner = endLoop ? L(k.pathOf([[x1, SL.y0 + 0.8, SL.z0 + 0.8], [x1, SL.y1 - 0.8, SL.z0 + 0.8], [x1, SL.y1 - 0.8, SL.z1 - 0.8], [x1, SL.y0 + 0.8, SL.z1 - 0.8]].map(at), true), { tone: "lo" }) : "";
  const seam = k.lineOnTop([(x0 + x1) / 2, SL.y0], [(x0 + x1) / 2, SL.y1], SL.z1, P) + k.segment([(x0 + x1) / 2, SL.y1, SL.z0], [(x0 + x1) / 2, SL.y1, SL.z1], P);
  return S(body, { tone: "hi", crease: "lo", inner: inner + L(seam, { tone: "faint" }) });
};

function anglesWallLegs() {
  const x0 = WALL.x1, x1 = WALL.x1 + T;
  const pieces = [
    box(x0, x1, OPEN.y0 - ANG + 0.3, OPEN.y1 + ANG - 0.3),
  ];
  const top = S(k.slabOf(pieces[0], OPEN.z1, ANG - 0.3, P, 1), { tone: "mid", crease: "none" });
  const bottom = S(k.slabOf(pieces[0], OPEN.z0 - ANG + 0.3, ANG - 0.3, P, 1), { tone: "mid", crease: "none" });
  const left = S(k.slabOf(box(x0, x1, OPEN.y0 - ANG + 0.3, OPEN.y0), OPEN.z0, OPEN.z1 - OPEN.z0, P, 1), { tone: "mid", crease: "none" });
  const right = S(k.slabOf(box(x0, x1, OPEN.y1, OPEN.y1 + ANG - 0.3), OPEN.z0, OPEN.z1 - OPEN.z0, P, 1), { tone: "mid", crease: "none" });
  return left + bottom + top + right;
}

function anglesSleeveLegs() {
  const x0 = WALL.x1, x1 = WALL.x1 + ANG;
  const top = S(k.slabOf(box(x0, x1, SL.y0, SL.y1), SL.z1, T, P, 1), { tone: "mid", crease: "none" });
  const side = S(k.slabOf(box(x0, x1, SL.y1, SL.y1 + T), SL.z0, SL.z1 - SL.z0, P, 1), { tone: "mid", crease: "none" });
  const screws = [-22.5, -7.5, 7.5, 22.5].map((y) => at([x0 + 2, y, SL.z1 + T])).concat([36, 50, 64].map((z) => at([x0 + 2, SL.y1 + T, z])));
  return top + side + D(screws, { size: 0.45, tone: "hi" });
}

function actuator() {
  const plan = { x: 25, y: -14, w: 11, d: 14, r: 1 };
  const shaft = S(k.cylinder(30.5, -7, 1, SL.z1, 1.5, P, 14), { tone: "mid" });
  const body = S(k.slabOf(plan, SL.z1 + 1.5, 8, P, 2, 0.4), { tone: "mid" });
  const label = L(k.lineOnTop([27, -11], [34, -11], SL.z1 + 9.5, P), { tone: "lo", free: true }) + L(k.lineOnTop([27, -8.5], [32, -8.5], SL.z1 + 9.5, P), { tone: "lo", free: true });
  const gland = S(k.cylinder(36.6, -7, 1.3, SL.z1 + 3, 2.5, P, 14), { tone: "mid" });
  return shaft + body + label + D([at([26.5, -12.5, SL.z1 + 9.5]), at([34.5, -1.5, SL.z1 + 9.5])], { size: 0.4, tone: "mid" }) + gland;
}

function accessDoor() {
  const y = SL.y1;
  const panel = S(k.slabOf(box(48, 92, y, y + 0.6), 35, 30, P, 1), { tone: "hi", crease: "lo" });
  const latches = D([at([90, y + 0.6, 42]), at([90, y + 0.6, 58])], { size: 0.6, tone: "hi" });
  const hinges = S(k.slabOf(box(49, 51, y + 0.6, y + 1.2), 39, 4, P, 1), { tone: "mid", crease: "none" }) + S(k.slabOf(box(49, 51, y + 0.6, y + 1.2), 57, 4, P, 1), { tone: "mid", crease: "none" });
  return panel + hinges + latches;
}

function label() {
  const y = WALL.y1, x = WALL.x1;
  const plate = S(k.slabOf(box(x, x + 0.4, 36, 54), 76, 10, P, 1), { tone: "mid", crease: "none" });
  const rules = [83, 80, 77.5].map((z, i) => L(k.segment([x + 0.4, 38, z], [x + 0.4, i === 2 ? 46 : 52, z], P), { tone: "mid", free: true })).join("");
  return plate + rules;
}

const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT,
  label: "A combination fire and smoke damper installed in a 200 millimetre rated blockwork wall: a 606 by 406 opening, the damper in a 1.5 millimetre steel sleeve, retaining angles on the wall face fixed to the sleeve, breakaway joints and ducts on both sides, an actuator on the sleeve and an access door in the duct. Stepping through shows the installation order.",
  body: [
    floor(),
    part(4, 1, "duct-far", duct(-76, -11, false)),
    part(4, 1, "joint-far", ring(-10)),
    part(2, 1, "sleeve-far", sleeve(-9, WALL.x0)),
    wall(),
    part(3, 4, "angles-wall", anglesWallLegs()),
    part(2, 2, "sleeve-near", sleeve(WALL.x1, 39)),
    part(3, 9, "angles-sleeve", anglesSleeveLegs()),
    part(5, 3, "actuator", actuator()),
    part(4, 1, "joint-near", ring(40)),
    part(4, 1, "duct-near", duct(41, 96, true)),
    part(5, 5, "access-door", accessDoor()),
    part(5, 1, "label", label()),
  ],
});
total += 1; tally[1] = (tally[1] || 0) + 1;   // the opening itself
const ORDER = [1, 2, 3, 4, 5];
const cumulative = {};
let run = 0;
for (const s of ORDER) { run += tally[s] || 0; cumulative[s] = run; }

const live = `
const P = ${JSON.stringify(P)};
const LODS = ${JSON.stringify(ORDER)};
const TOTAL = ${total};
const DEFINED = ${JSON.stringify(cumulative)};
const TEXT = ${JSON.stringify(STEPS)};
const stage = document.querySelector('.iso-stage[data-fig="damper"]');
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
    const fresh = g.lod === lod;
    for (const s of g.el.querySelectorAll(".iso-solid")) fresh ? s.setAttribute("data-lit", "") : s.removeAttribute("data-lit");
    for (const line of g.el.querySelectorAll("[data-tone0]")) line.dataset.tone = fresh ? "lit" : line.dataset.tone0;
  }
  const text = "Step " + lod + " of " + LODS.length + " · " + DEFINED[lod] + " of " + TOTAL + " parts";
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
    g.el.setAttribute("transform", g.v === 1 ? "" : translateAlong(P, [(1 - g.v) * 10, 0, 0]));
  }
  return moving;
}
const dwell = (i) => (LODS[i] === 5 ? 4.6 : 2.2);
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) { clock += dt; if (clock > dwell(index)) { clock = 0; index = (index + 1) % LODS.length; apply(); } }
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
  const b = svg.getBoundingClientRect();
  steer(Math.floor(Math.min(0.999, Math.max(0, (event.clientX - b.left) / b.width)) * LODS.length));
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

const CSS = `
.iso-stage[data-fig="damper"]{outline:none}
.iso-stage[data-fig="damper"]:focus-visible{box-shadow:0 0 0 2px var(--anatomy-mid);border-radius:8px}
`;
const plate = k.plateHtml({
  fig: "Fig 2",
  title: "Fire / smoke damper · install order",
  hint: "Hover or ← → to step",
  readout: `Step 5 of 5 · ${total} of ${total} parts`,
  keys: [
    { mark: "lit", label: "Parts this step installs" },
    { mark: "raised", label: "Parts already in place" },
  ],
  caption:
    "A 600 × 400 combination fire and smoke damper in 200 mm rated blockwork, as on shop detail SD-02. The opening is 606 × 406: 3 mm per 305 mm of width and height, minimum 6 mm, so the sleeve can expand in a fire. " +
    "The 1.5 mm sleeve runs 200 mm out on the actuator side and 100 mm on the other. The 38 mm retaining angles lap 35 mm onto the wall and are screwed to the sleeve only, never to the wall. " +
    "Breakaway joints let the ducts fall away without pulling the damper out of the wall. The actuator and access door sit on the near side, where they can be reached for testing.",
  body: `<div class="iso-stage" data-fig="damper" data-lod="5" tabindex="0" role="slider" aria-label="Fire and smoke damper: arrow keys step through the installation order" aria-valuemin="1" aria-valuemax="5" aria-valuenow="5">${svg}</div>`,
});
const name = theme === "light" ? "damper-light.html" : "damper.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Fire smoke damper", theme, body: `<style>${CSS}</style>${plate}`, script: kitScript() + live }));
writeFileSync(join(HERE, "damper.fragment.json"), JSON.stringify({ css: CSS, plate, live, total, cumulative }));
console.log("wrote", name, "parts", total, JSON.stringify(cumulative));
