"""Tiny 2D drafting kit for shop-drawing sheets.

Everything is drawn in paper millimetres on one sheet. A View maps model millimetres (x right,
y up) onto the sheet at a drawing scale, so details are drawn true to size and plotted at 1:n.

    sh = Sheet()                          # A1 landscape, 841 x 594 mm
    v = sh.view(at=(120, 300), scale=10)  # model origin lands at paper (120, 300), drawn 1:10
    v.rect(0, 0, 200, 250, pen="cut", hatch="concrete")
    v.dim_h(0, 200, y=-60)                # dimension in model mm
    sh.save_svg("a.svg"); sh.save_dxf("a.dxf")

Pens follow the ISO 128 series. Text sizes are cap heights in paper mm (2.5 mm minimum).
"""
import html
import math

PENS = {"cut": 0.50, "heavy": 0.35, "med": 0.25, "thin": 0.18, "fine": 0.13}
DASH = {"solid": None, "hidden": "2 1", "center": "6 1 0.6 1", "phantom": "8 1 1 1 1 1"}
FONT = "FreeSans, Arial, Helvetica, sans-serif"
CAP = 0.72                     # cap height / font size for Helvetica-like faces

# Hatches in paper space: (svg pattern body, tile size, DXF pattern name, DXF scale)
HATCH = {
    "concrete": ('<circle cx="1.5" cy="2" r="0.17"/><circle cx="6.5" cy="7.2" r="0.17"/><circle cx="8.2" cy="3.1" r="0.14"/>'
                 '<circle cx="3.4" cy="8.4" r="0.14"/><path d="M5 1.2l0.9 0.2-0.6 0.7z"/><path d="M1.4 5.4l0.8-0.3 0 0.9z"/>'
                 '<path d="M8.2 6.2l0.9 0.3-0.7 0.5z"/>', 10, "AR-CONC", 0.05),
    "block": ('<path d="M0 6L6 0M-1 1L1 -1M5 7L7 5" stroke-width="0.13"/>', 2.2, "ANSI31", 0.8),
    "steel": ('<path d="M0 3L3 0M-0.5 0.5L0.5 -0.5M2.5 3.5L3.5 2.5" stroke-width="0.13"/>'
              '<path d="M0 0L3 3" stroke-width="0.13"/>', 1.2, "ANSI37", 0.4),
    "insul": ('<path d="M0 1.5Q0.75 0 1.5 1.5T3 1.5" fill="none" stroke-width="0.13"/>', 3, "INSUL", 0.3),
    "wool": ('<path d="M0 0.6Q0.5 1.6 1 0.6T2 0.6M0 2.1Q0.5 3.1 1 2.1T2 2.1" fill="none" stroke-width="0.13"/>', 2, "AR-SAND", 0.1),
    "rubber": ('<path d="M0 0L2 2M2 0L0 2" stroke-width="0.13"/>', 1.0, "ANSI37", 0.25),
    "screed": ('<circle cx="0.6" cy="0.6" r="0.14"/><circle cx="2" cy="1.7" r="0.14"/>', 2.6, "AR-SAND", 0.08),
    "earth": ('<path d="M0 2L2 0" stroke-width="0.13"/><circle cx="1.6" cy="1.6" r="0.15"/>', 2.4, "EARTH", 0.3),
    "solid": (None, None, "SOLID", 1),
}


class Sheet:
    def __init__(self, w=841, h=594):
        self.w, self.h = w, h
        self.items = []

    # ------------------------------------------------------------- paper primitives
    def line(self, pts, pen="med", style="solid", layer=None):
        self.items.append({"k": "line", "pts": [tuple(p) for p in pts], "pen": pen, "style": style,
                           "layer": layer or pen.upper()})

    def poly(self, pts, pen="med", fill=None, hatch=None, style="solid", layer=None, closed=True):
        self.items.append({"k": "poly", "pts": [tuple(p) for p in pts], "pen": pen, "fill": fill,
                           "hatch": hatch, "style": style, "closed": closed, "layer": layer or pen.upper()})

    def circle(self, c, r, pen="med", fill=None, style="solid", layer=None):
        self.items.append({"k": "circle", "c": tuple(c), "r": r, "pen": pen, "fill": fill, "style": style,
                           "layer": layer or pen.upper()})

    def text(self, x, y, s, h=2.5, anchor="start", bold=False, rot=0, layer="TEXT", pen=None):
        self.items.append({"k": "text", "x": x, "y": y, "s": str(s), "h": max(h, 2.5) if h < 2.5 else h,
                           "anchor": anchor, "bold": bold, "rot": rot, "layer": layer})

    def rect(self, x, y, w, h, **kw):
        self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], **kw)

    def view(self, at, scale, origin=(0, 0)):
        return View(self, at, scale, origin)

    # ------------------------------------------------------------- tables
    def table(self, x, y, cols, rows, h=2.5, pad=1.6, header=True, wrap=None):
        """cols: [(title, width_mm)], rows: [[cell, ...]]. Long cells wrap at their column width.
        Returns the table height."""
        line_h = h * 1.65
        cy = y
        all_rows = ([[c[0] for c in cols]] if header else []) + rows
        widths = [c[1] for c in cols]
        x_edges = [x]
        for wdt in widths:
            x_edges.append(x_edges[-1] + wdt)
        for ri, row in enumerate(all_rows):
            wrapped = [_wrap(str(cell), wdt - 2 * pad, h) for cell, wdt in zip(row, widths)]
            n = max(len(c) for c in wrapped)
            row_h = n * line_h + pad * 1.4
            for ci, lines in enumerate(wrapped):
                for li, ln in enumerate(lines):
                    self.text(x_edges[ci] + pad, cy + pad + h + li * line_h, ln, h=h,
                              bold=(header and ri == 0))
            self.line([(x, cy + row_h), (x_edges[-1], cy + row_h)], pen="heavy" if (header and ri == 0) else "fine")
            cy += row_h
        self.rect(x, y, x_edges[-1] - x, cy - y, pen="med")
        for xe in x_edges[1:-1]:
            self.line([(xe, y), (xe, cy)], pen="fine")
        return cy - y

    # ------------------------------------------------------------- export
    def svg(self):
        defs = []
        for name, (body, size, _, _) in HATCH.items():
            if body:
                defs.append(f'<pattern id="h-{name}" patternUnits="userSpaceOnUse" width="{size}" height="{size}">'
                            f'<g fill="#000" stroke="#000">{body}</g></pattern>')
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}mm" height="{self.h}mm" '
               f'viewBox="0 0 {self.w} {self.h}"><defs>{"".join(defs)}</defs>'
               f'<rect width="{self.w}" height="{self.h}" fill="#fff"/>']
        for it in self.items:
            out.append(_svg_item(it))
        out.append("</svg>")
        return "".join(out)

    def save_svg(self, path):
        open(path, "w").write(self.svg())

    def save_dxf(self, path):
        import ezdxf
        doc = ezdxf.new("R2018", setup=True)
        msp = doc.modelspace()
        lw = {v: int(round(v * 100)) for v in PENS.values()}
        for name in {it["layer"] for it in self.items if it.get("pen") != "none"} | {"HATCH"}:
            pen = PENS.get(name.lower(), 0.13 if name == "HATCH" else 0.25)
            if name not in doc.layers:
                doc.layers.add(name, lineweight=lw.get(pen, 25))
        ltype = {"hidden": "DASHED", "center": "CENTER", "phantom": "PHANTOM"}
        flip = lambda p: (p[0], self.h - p[1])
        for it in self.items:
            attribs = {"layer": it["layer"]}
            if it.get("pen") in PENS:
                attribs["lineweight"] = lw[PENS[it["pen"]]]
            if it.get("style") in ltype:
                attribs["linetype"] = ltype[it["style"]]
            if it["k"] == "line":
                msp.add_lwpolyline([flip(p) for p in it["pts"]], dxfattribs=attribs)
            elif it["k"] == "poly":
                pts = [flip(p) for p in it["pts"]]
                if it.get("fill") == "#fff" and not it.get("hatch"):
                    # white fills are masks in the SVG: a WIPEOUT hides what is drawn before it in CAD
                    msp.add_wipeout(pts, dxfattribs={"layer": "HATCH"})
                    if it.get("pen") != "none":
                        msp.add_lwpolyline(pts, close=it["closed"], dxfattribs=attribs)
                    continue
                if it.get("hatch") or it.get("fill"):
                    hname = it.get("hatch") or "solid"
                    _, _, dxf_name, dxf_scale = HATCH.get(hname, HATCH["solid"])
                    ht = msp.add_hatch(dxfattribs={"layer": "HATCH"})
                    if dxf_name == "SOLID" or it.get("fill"):
                        ht.set_solid_fill(color=7)
                        ht.dxf.true_color = 0x000000
                    else:
                        try:
                            ht.set_pattern_fill(dxf_name, scale=dxf_scale)
                        except Exception:
                            ht.set_pattern_fill("ANSI31", scale=dxf_scale)
                    ht.paths.add_polyline_path(pts, is_closed=True)
                if it.get("pen") != "none":
                    msp.add_lwpolyline(pts, close=it["closed"], dxfattribs=attribs)
            elif it["k"] == "circle":
                if it.get("fill") == "#fff":
                    import math as _m
                    cx, cy = flip(it["c"])
                    msp.add_wipeout([(cx + it["r"] * _m.cos(a * _m.pi / 12), cy + it["r"] * _m.sin(a * _m.pi / 12)) for a in range(24)],
                                    dxfattribs={"layer": "HATCH"})
                elif it.get("fill"):
                    ht = msp.add_hatch(dxfattribs={"layer": "HATCH"})
                    ht.set_solid_fill(color=7)
                    ht.paths.add_edge_path().add_arc(flip(it["c"]), it["r"], 0, 360)
                msp.add_circle(flip(it["c"]), it["r"], dxfattribs=attribs)
            elif it["k"] == "text":
                align = {"start": "LEFT", "middle": "CENTER", "end": "RIGHT"}[it["anchor"]]
                t = msp.add_text(it["s"], height=it["h"], dxfattribs={"layer": it["layer"], "rotation": -it["rot"]})
                if it.get("white"):
                    t.dxf.true_color = 0xFFFFFF
                from ezdxf.enums import TextEntityAlignment
                t.set_placement(flip((it["x"], it["y"])), align=getattr(TextEntityAlignment, "BOTTOM_" + align))
        doc.saveas(path)


def _wrap(s, width, h):
    """Greedy wrap on an average glyph width of 0.6 x font size."""
    if not s:
        return [""]
    per = max(4, int(width / (h / CAP * 0.56)))
    out = []
    for para in s.split("\n"):
        words, cur = para.split(" "), ""
        for wd in words:
            if len(cur) + len(wd) + (1 if cur else 0) <= per:
                cur = f"{cur} {wd}" if cur else wd
            else:
                if cur:
                    out.append(cur)
                cur = wd
        out.append(cur)
    return out


def _svg_item(it):
    if it["k"] == "text":
        size = it["h"] / CAP
        weight = ' font-weight="bold"' if it["bold"] else ""
        rot = f' transform="rotate({it["rot"]} {it["x"]:.2f} {it["y"]:.2f})"' if it["rot"] else ""
        fill = ' fill="#fff"' if it.get("white") else ""
        return (f'<text x="{it["x"]:.2f}" y="{it["y"]:.2f}" font-family="{FONT}" font-size="{size:.2f}"'
                f' text-anchor="{it["anchor"]}"{weight}{rot}{fill}>{html.escape(it["s"])}</text>')
    pen = PENS.get(it.get("pen"), 0.25)
    dash = DASH.get(it.get("style"))
    stroke = f' stroke="#000" stroke-width="{pen}" stroke-linejoin="round" stroke-linecap="round"' if it.get("pen") != "none" else ' stroke="none"'
    if dash:
        stroke += f' stroke-dasharray="{dash}"'
    if it["k"] == "circle":
        fill = it.get("fill") or "none"
        return f'<circle cx="{it["c"][0]:.2f}" cy="{it["c"][1]:.2f}" r="{it["r"]:.2f}" fill="{fill}"{stroke}/>'
    d = "M" + "L".join(f"{x:.2f} {y:.2f}" for x, y in it["pts"]) + ("Z" if it.get("closed") else "")
    if it["k"] == "line":
        return f'<path d="{d}" fill="none"{stroke}/>'
    parts = []
    if it.get("fill"):
        parts.append(f'<path d="{d}" fill="{it["fill"]}" stroke="none"/>')
    if it.get("hatch"):
        name = it["hatch"]
        fill = "#000" if name == "solid" else f"url(#h-{name})"
        if name != "solid":
            parts.append(f'<path d="{d}" fill="#fff" stroke="none"/>')
        parts.append(f'<path d="{d}" fill="{fill}" stroke="none"/>')
    parts.append(f'<path d="{d}" fill="none"{stroke}/>')
    return "".join(parts)


class View:
    """Model mm (y up) to paper mm at 1:scale. `at` is the paper point of model `origin`."""

    def __init__(self, sheet, at, scale, origin=(0, 0)):
        self.sh, self.ax, self.ay, self.s = sheet, at[0], at[1], scale
        self.ox, self.oy = origin

    def P(self, x, y):
        return (self.ax + (x - self.ox) / self.s, self.ay - (y - self.oy) / self.s)

    def Ps(self, pts):
        return [self.P(x, y) for x, y in pts]

    def line(self, pts, **kw):
        self.sh.line(self.Ps(pts), **kw)

    def poly(self, pts, **kw):
        self.sh.poly(self.Ps(pts), **kw)

    def rect(self, x, y, w, h, **kw):
        self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], **kw)

    def circle(self, x, y, r, **kw):
        self.sh.circle(self.P(x, y), r / self.s, **kw)

    def text(self, x, y, s, h=2.5, **kw):
        px, py = self.P(x, y)
        self.sh.text(px, py, s, h=h, **kw)

    # ------------------------------------------------------------- annotation (sizes in paper mm)
    def _arrow(self, tip, toward):
        (tx, ty), (fx, fy) = tip, toward
        a = math.atan2(fy - ty, fx - tx)
        L, W = 2.5, 0.45
        p1 = (tx + L * math.cos(a) + W * math.sin(a), ty + L * math.sin(a) - W * math.cos(a))
        p2 = (tx + L * math.cos(a) - W * math.sin(a), ty + L * math.sin(a) + W * math.cos(a))
        self.sh.poly([tip, p1, p2], pen="fine", fill="#000", layer="DIM")

    def dim_h(self, x1, x2, y, ref_y=None, text=None, h=2.5):
        """Horizontal dimension between model x1 and x2, dimension line at model y."""
        a, b = self.P(x1, y), self.P(x2, y)
        if ref_y is not None:
            for x in (x1, x2):
                r = self.P(x, ref_y)
                sgn = 1 if a[1] > r[1] else -1
                self.sh.line([(r[0], r[1] + sgn * 1.0), (r[0], a[1] + sgn * 2.0)], pen="thin", layer="DIM")
        self.sh.line([a, b], pen="thin", layer="DIM")
        if abs(b[0] - a[0]) > 7:
            self._arrow(a, b); self._arrow(b, a)
        else:
            self._arrow(a, (a[0] - 3, a[1])); self._arrow(b, (b[0] + 3, b[1]))
        label = text if text is not None else f"{abs(x2 - x1):.0f}"
        mid = (a[0] + b[0]) / 2
        if abs(b[0] - a[0]) < len(label) * 1.9 + 2:
            self.sh.text(max(a[0], b[0]) + 3.5, a[1] + 1.2, label, h=h, layer="DIM")
        else:
            self.sh.text(mid, a[1] - 1.0, label, h=h, anchor="middle", layer="DIM")

    def dim_v(self, y1, y2, x, ref_x=None, text=None, h=2.5):
        a, b = self.P(x, y1), self.P(x, y2)
        if ref_x is not None:
            for y in (y1, y2):
                r = self.P(ref_x, y)
                sgn = 1 if a[0] > r[0] else -1
                self.sh.line([(r[0] + sgn * 1.0, r[1]), (a[0] + sgn * 2.0, r[1])], pen="thin", layer="DIM")
        self.sh.line([a, b], pen="thin", layer="DIM")
        if abs(b[1] - a[1]) > 7:
            self._arrow(a, b); self._arrow(b, a)
        else:
            self._arrow(a, (a[0], a[1] + 3 * (1 if a[1] > b[1] else -1)))
            self._arrow(b, (b[0], b[1] - 3 * (1 if a[1] > b[1] else -1)))
        label = text if text is not None else f"{abs(y2 - y1):.0f}"
        mid = (a[1] + b[1]) / 2
        if abs(b[1] - a[1]) < len(label) * 1.9 + 2:
            self.sh.text(a[0] - 1.0, max(a[1], b[1]) + 4.5, label, h=h, anchor="middle", rot=-90, layer="DIM")
        else:
            self.sh.text(a[0] - 1.0, mid, label, h=h, anchor="middle", rot=-90, layer="DIM")

    def tag(self, x, y, n, to, flag=None):
        """Numbered callout: leader from model point (x, y) to a bubble at paper offset `to` (dx, dy)."""
        p = self.P(x, y)
        q = (p[0] + to[0], p[1] + to[1])
        r = 3.0
        d = math.hypot(q[0] - p[0], q[1] - p[1]) or 1
        edge = (q[0] - (q[0] - p[0]) / d * r, q[1] - (q[1] - p[1]) / d * r)
        self.sh.circle(p, 0.45, pen="fine", fill="#000", layer="DIM")
        self.sh.line([p, edge], pen="thin", layer="DIM")
        self.sh.circle(q, r, pen="med", fill="#fff", layer="DIM")
        self.sh.text(q[0], q[1] + 1.25, str(n), h=2.5, anchor="middle", layer="DIM")
        if flag:
            fx = q[0] + r + 0.6
            self.sh.rect(fx, q[1] - 2.2, 4.4, 4.4, pen="thin", fill="#fff" if flag != "A" else "#000", layer="DIM")
            self.sh.items.append({"k": "text", "x": fx + 2.2, "y": q[1] + 1.25, "s": flag, "h": 2.5, "anchor": "middle",
                                  "bold": True, "rot": 0, "layer": "DIM", "white": flag == "A"})

    def cut_mark(self, x1, y1, x2, y2, letter, side=1):
        """Section cut line with view arrows; side +1 looks toward +normal."""
        a, b = self.P(x1, y1), self.P(x2, y2)
        self.sh.line([a, b], pen="med", style="phantom", layer="SECTION")
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L * side, dx / L * side
        for p in (a, b):
            tip = (p[0] + nx * 6, p[1] + ny * 6)
            self.sh.line([p, tip], pen="heavy", layer="SECTION")
            self._arrow(tip, p)
            self.sh.text(p[0] + nx * 9, p[1] + ny * 9 + 1.75, letter, h=3.5, anchor="middle", bold=True, layer="SECTION")


def title_bubble(sheet, x, y, number, ref, title, scale_text, width=150):
    """Detail title: bubble with detail number over sheet reference, title and scale beside it."""
    r = 7.5
    sheet.circle((x + r, y), r, pen="heavy")
    sheet.line([(x, y), (x + 2 * r, y)], pen="med")
    sheet.text(x + r, y - 1.6, number, h=3.5, anchor="middle", bold=True)
    sheet.text(x + r, y + 5.0, ref, h=2.5, anchor="middle")
    sheet.text(x + 2 * r + 3, y - 1.8, title, h=5.0, bold=True)
    sheet.line([(x + 2 * r, y + 0.6), (x + 2 * r + width, y + 0.6)], pen="heavy")
    sheet.text(x + 2 * r + 3, y + 5.6, scale_text, h=3.5)
