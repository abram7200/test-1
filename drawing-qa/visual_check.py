#!/usr/bin/env python3
"""Print-readiness visual checker for drawing-sheet PDFs (one sheet per PDF).

Usage:
    python3 visual_check.py <pdf_dir> <out_dir> [--number-pattern REGEX] [--file-prefix TEXT]
                            [--detail-sheets REGEX] [--heading TEXT]

  --number-pattern  full-match regex every title-block drawing number must follow
  --file-prefix     prefix every original file name must start with
  --detail-sheets   regex on the sheet name for sheets of details, where a single title-block
                    scale other than NTS is flagged
  <pdf_dir>/original_names.json may map each PDF stem to the file name it was delivered with.

For every PDF it reports:
  * sheet size and orientation against ISO A1 landscape
  * how text is stored (live text, text converted to outlines, raster)
  * raster images: effective print dpi
  * line-weight hierarchy (distinct pen widths, share of the dominant pen)
  * rendered character heights at full A1 size and at A3 half-size
    (connected components of the drawing area, title block excluded)
  * empty area of the drawing field
  * title-block fields (drawing no., revision, scale, status) when searchable
and a set-level pass: numbering gaps, file name vs. drawing number,
revision/date consistency and scale plausibility.

Outputs: checks.json, checks.md, and <sheet>_legibility.png overlays that
mark undersized characters in red.
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pymupdf
from scipy import ndimage

PT_MM = 25.4 / 72
A_SIZES = {"A0": (1189, 841), "A1": (841, 594), "A2": (594, 420), "A3": (420, 297)}
PX_PER_MM = 10                # render density for the legibility pass
MIN_H_A1 = 2.5                # ISO 3098-0 minimum for notes/dims on A1, mm
MIN_H_ABS = 1.8               # below this, unreadable even at full size
A3_FACTOR = 420 / 841         # half-size print reduction


def sheet_size(page):
    r = page.rect  # displayed rect (rotation applied)
    w, h = r.width * PT_MM, r.height * PT_MM
    name = "non-standard"
    for k, (aw, ah) in A_SIZES.items():
        if (abs(w - aw) < 4 and abs(h - ah) < 4) or (abs(w - ah) < 4 and abs(h - aw) < 4):
            name = k
    return round(w), round(h), name, ("landscape" if w > h else "portrait")


def shown(page, rect):
    """Map an unrotated-page rect to displayed (rotation applied) coordinates."""
    return pymupdf.Rect(rect) * page.rotation_matrix


def title_block_zone(page):
    """Return the title-block rectangle (mm) found from its labels or logos."""
    W, H = page.rect.width * PT_MM, page.rect.height * PT_MM
    hits = [shown(page, b[:4]) for b in page.get_text("blocks") if re.search(r"KEY PLAN|OWNER|DRAWING NO", b[4])]
    if hits:
        x0 = min(b.x0 for b in hits) * PT_MM - 3
        return (x0, 0, W, H), "right"
    logos = []
    for img in page.get_images(full=True):
        for rr in page.get_image_rects(img[0]):
            rr = shown(page, rr)
            wmm, hmm = rr.width * PT_MM, rr.height * PT_MM
            if wmm < 120 and hmm < 120:
                logos.append((rr.x0 * PT_MM, rr.y0 * PT_MM, rr.x1 * PT_MM, rr.y1 * PT_MM))
    if logos:
        cx = np.mean([(a + c) / 2 for a, b, c, d in logos])
        cy = np.mean([(b + d) / 2 for a, b, c, d in logos])
        if cx > 0.7 * W:
            return (min(l[0] for l in logos) - 30, 0, W, H), "right"
        if cy > 0.7 * H:
            return (0, min(l[1] for l in logos) - 40, W, H), "bottom (content rotated 90 deg on page)"
    return (0.85 * W, 0, W, H), "assumed right"


def text_stats(page, tb):
    spans, fonts = [], Counter()
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                if not s["text"].strip():
                    continue
                bb = shown(page, s["bbox"])
                x0, y0 = bb.x0 * PT_MM, bb.y0 * PT_MM
                in_tb = tb[0] <= x0 <= tb[2] and tb[1] <= y0 <= tb[3]
                fonts[s["font"]] += 1
                # PDF font size is the em; cap height of Arial-like fonts ~0.716 em
                spans.append({"cap_mm": s["size"] * PT_MM * 0.716, "text": s["text"], "tb": in_tb,
                              "x": x0, "y": y0})
    field = [s for s in spans if not s["tb"]]
    return spans, field, fonts


def line_weights(page):
    widths = Counter()
    n = 0
    for d in page.get_drawings():
        w = d.get("width")
        if w is None:
            continue
        widths[round(w * PT_MM, 2)] += 1
        n += 1
    top = widths.most_common(6)
    dominant = top[0][1] / n if n else 0
    significant = [w for w, c in widths.items() if n and c / n >= 0.01 and w > 0]
    return n, top, dominant, sorted(significant)


def raster_stats(page, tb):
    """Images placed in the drawing field (title-block logos excluded)."""
    out = []
    for img in page.get_images(full=True):
        for rr, mat in page.get_image_rects(img[0], transform=True):
            rr = shown(page, rr)
            if rr.width <= 0:
                continue
            cx, cy = (rr.x0 + rr.x1) / 2 * PT_MM, (rr.y0 + rr.y1) / 2 * PT_MM
            if tb[0] <= cx <= tb[2] and tb[1] <= cy <= tb[3]:
                continue
            # pixels per inch along the image's own x axis (handles rotated placement)
            span_pt = (mat.a ** 2 + mat.b ** 2) ** 0.5
            dpi = img[2] / (span_pt / 72) if span_pt else 0
            out.append({"px": f"{img[2]}x{img[3]}", "mm": f"{rr.width*PT_MM:.0f}x{rr.height*PT_MM:.0f}",
                        "dpi": round(dpi), "box": [v * PT_MM for v in (rr.x0, rr.y0, rr.x1, rr.y1)]})
    return out


def legibility(page, tb, sheet, out_dir):
    """Render the drawing field and measure character-like connected components."""
    m = pymupdf.Matrix(PX_PER_MM * PT_MM, PX_PER_MM * PT_MM)
    pix = page.get_pixmap(matrix=m, colorspace=pymupdf.csGRAY, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    ink = img < 200
    x0, y0, x1, y1 = [int(v * PX_PER_MM) for v in tb]
    ink[max(y0, 0):y1, max(x0, 0):x1] = False           # drop title block
    border = int(12 * PX_PER_MM)
    ink[:border, :] = ink[-border:, :] = False
    ink[:, :border] = ink[:, -border:] = False
    if tb[1] > 0:                     # title block at bottom => content turned 90 deg
        ink = np.rot90(ink)
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    heights, small_boxes = [], []
    for i, sl in enumerate(objs):
        if sl is None:
            continue
        h = (sl[0].stop - sl[0].start) / PX_PER_MM
        w = (sl[1].stop - sl[1].start) / PX_PER_MM
        if not (0.6 <= h <= 8 and 0.12 * h <= w <= 1.15 * h):
            continue
        area = (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start)
        fill = (lab[sl] == i + 1).sum() / area
        if not (0.08 <= fill <= 0.75):      # strokes, not dots or solid fills
            continue
        heights.append(h)
        if h < MIN_H_ABS:
            small_boxes.append(sl)
    heights = np.array(heights)
    if tb[1] > 0:
        ink = np.rot90(ink, -1)
        small_boxes = []              # overlay boxes would be in turned coordinates
    # Empty-field ratio on a 20 mm grid
    g = int(20 * PX_PER_MM)
    fh, fw = ink.shape[0] // g, ink.shape[1] // g
    cells = ink[: fh * g, : fw * g].reshape(fh, g, fw, g).any(axis=(1, 3))
    fx0, fx1 = border // g, (x0 // g if tb[1] == 0 else fw)
    fy1 = (y0 // g) if tb[1] > 0 else fh
    field = cells[border // g: fy1, fx0: fx1]
    empty = 1 - field.mean() if field.size else 0
    # overlay
    rgb = np.stack([img] * 3, axis=-1).copy()
    for sl in small_boxes:
        ys, xs = sl
        rgb[ys.start:ys.stop, xs.start:xs.stop, 1:] //= 3
        rgb[ys.start:ys.stop, xs.start:xs.stop, 0] = 230
    ov = pymupdf.Pixmap(pymupdf.csRGB, pix.width, pix.height, rgb.tobytes(), False)
    ov.shrink(2)
    ov.save(str(out_dir / f"{sheet}_legibility.png"))
    if heights.size == 0:
        return {"chars": 0}, empty
    hist, edges = np.histogram(heights, bins=np.arange(0.6, 8.05, 0.1))
    mode = float(edges[hist.argmax()] + 0.05)
    return {
        "chars": int(heights.size),
        "mode_mm": round(mode, 2),
        "p10_mm": round(float(np.percentile(heights, 10)), 2),
        "median_mm": round(float(np.median(heights)), 2),
        "pct_below_1.8": round(float((heights < MIN_H_ABS).mean() * 100), 1),
        "pct_below_2.5": round(float((heights < MIN_H_A1).mean() * 100), 1),
        "mode_at_A3_mm": round(mode * A3_FACTOR, 2),
    }, round(float(empty) * 100, 1)


def title_fields(spans):
    txt = " | ".join(s["text"].strip() for s in spans if s["tb"])
    f = {}
    # labels and values are separate text blocks, so take the hyphenated code with the most
    # segments: drawing numbers (AAA-BBB-M-GN-08) outrank project numbers (BBB-Q-411)
    codes = re.findall(r"\b[A-Z0-9]+(?:-[A-Z0-9]+){2,}\b", txt)
    codes = [c for c in codes if re.search(r"\d$", c)]
    f["drawing_no"] = max(codes, key=lambda c: (c.count("-"), len(c))) if codes else None
    m = re.search(r"SCALE \|[^|]*?\|?\s*(NTS|1\s*:\s*\d+|As indicated)", txt, re.I)
    if not m:
        m = re.search(r"\b(NTS|1\s*:\s*\d+|As indicated)\b", txt, re.I)
    f["scale"] = m.group(1).replace(" ", "") if m else None
    m = re.findall(r"\b(\d{2})\s*\|\s*([A-Z][A-Z ]+?)\s*\|\s*(\d{2}\.\d{2}\.\d{4})", txt)
    f["revisions"] = [" ".join(r) for r in m]
    m = re.search(r"REVISION NO\.?\s*\|?\s*(\d{2})", txt)
    f["revision"] = m.group(1) if m else (m and None)
    return f


def check(pdf, out_dir):
    doc = pymupdf.open(pdf)
    page = doc[0]
    sheet = pdf.stem
    w, h, size, orient = sheet_size(page)
    tb, tb_side = title_block_zone(page)
    spans, field_spans, fonts = text_stats(page, tb)
    n_draw, top_w, dominant, sig_w = line_weights(page)
    rasters = raster_stats(page, tb)
    leg, empty = legibility(page, tb, sheet, out_dir)
    text_mode = "live text" if len(field_spans) >= 40 else (
        "text converted to outlines (not searchable)" if n_draw > 3000 else "raster / pasted images")
    fld_caps = [s["cap_mm"] for s in field_spans]
    r = {
        "sheet": sheet, "pages": doc.page_count,
        "size_mm": f"{w}x{h}", "iso": size, "orientation": orient, "title_block": tb_side,
        "page_rotation": page.rotation,
        "text_mode": text_mode, "fonts": dict(fonts),
        "live_text_cap_mm": {"min": round(min(fld_caps), 2), "median": round(float(np.median(fld_caps)), 2)} if fld_caps else None,
        "strokes": n_draw, "pen_widths_mm": [w for w, _ in top_w], "dominant_pen_share": round(dominant * 100, 1),
        "significant_pens": sig_w,
        "rasters": [{k: v for k, v in x.items() if k != "box"} for x in rasters], "min_raster_dpi": min((x["dpi"] for x in rasters), default=None),
        "legibility": leg, "empty_field_pct": empty,
        "title": title_fields(spans),
    }
    flags = []
    if size != "A1" or orient != "landscape":
        flags.append(f"Sheet is {size} {orient} {w}x{h} mm; set standard is A1 landscape 841x594")
    if "rotated" in tb_side:
        flags.append("Content is rotated 90 deg on the page; title block reads sideways on screen")
    # union of image footprints on a 1 mm grid (render tiles overlap)
    fw_mm, fh_mm = int(tb[0] if tb[1] == 0 else w), int(h if tb[1] == 0 else tb[1])
    cover = np.zeros((max(fh_mm, 1), max(fw_mm, 1)), bool)
    for x in rasters:
        a, b, c, d = (int(round(v)) for v in x["box"])
        cover[max(b, 0):max(d, 0), max(a, 0):max(c, 0)] = True
    raster_pct = cover.mean() * 100
    r["raster_field_pct"] = round(raster_pct, 1)
    if raster_pct > 5:
        lo = min(x["dpi"] for x in rasters)
        flags.append(f"{raster_pct:.0f}% of the drawing field is raster images ({len(rasters)} images, "
                     f"lowest {lo} dpi at print size); content is not searchable or editable")
        if lo < 300:
            flags.append(f"Raster below 300 dpi at print size ({lo} dpi)")
    if "outlines" in text_mode:
        flags.append("Text is vector outlines: sheet is not searchable and text height cannot be edited")
    if dominant > 0.85 and n_draw > 2000:
        flags.append(f"No line-weight hierarchy: {dominant*100:.0f}% of strokes use one pen ({top_w[0][0]} mm)")
    if leg.get("mode_mm") and leg["mode_mm"] < MIN_H_A1:
        flags.append(f"Typical character height {leg['mode_mm']} mm at A1 (< {MIN_H_A1} mm); "
                     f"{leg['mode_at_A3_mm']} mm when printed A3")
    if leg.get("pct_below_1.8", 0) > 15:
        flags.append(f"{leg['pct_below_1.8']}% of characters are under {MIN_H_ABS} mm at A1")
    if empty > 45:
        flags.append(f"{empty}% of the drawing field is empty")
    if len([f for f in fonts if f not in ("SegoeUISymbol",)]) > 2:
        flags.append("Mixed fonts: " + ", ".join(fonts))
    r["flags"] = flags
    return r


def set_checks(results, pdf_names, opts):
    flags = []
    numbered = [(re.match(r"(.*?)(\d+)$", r["sheet"]), r) for r in results]
    numbered = [(m.group(1), int(m.group(2)), len(m.group(2))) for m, _ in numbered if m]
    if numbered:
        prefix, width = numbered[0][0], numbered[0][2]
        nums = sorted(n for _, n, _ in numbered)
        gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in nums]
        if gaps:
            flags.append("Sheet numbering gap: " + ", ".join(f"{prefix}{g:0{width}d}" for g in gaps) + " missing from folder")
    for r in results:
        t = r["title"]
        dn = t.get("drawing_no")
        if opts.number_pattern and dn and not re.fullmatch(opts.number_pattern, dn):
            flags.append(f"{r['sheet']}: drawing number '{dn}' does not match {opts.number_pattern}")
        if (opts.detail_sheets and t.get("scale") and t["scale"].upper() != "NTS"
                and re.search(opts.detail_sheets, r["sheet"])):
            flags.append(f"{r['sheet']}: title block scale {t['scale']} on a sheet of unscaled details")
    if opts.file_prefix:
        for orig in pdf_names:
            if not orig.startswith(opts.file_prefix):
                flags.append(f"File name '{orig}' does not start with {opts.file_prefix}")
    return flags


def md_report(results, set_flags, heading):
    L = [f"# {heading}", ""]
    L += ["## Set-level", ""] + [f"- {f}" for f in set_flags] + [""]
    L += ["## Sheets", "", "| Sheet | Size | Text | Pens (dominant %) | Char mode A1 / A3 mm | <1.8 mm % | Empty % | Flags |",
          "|---|---|---|---|---|---|---|---|"]
    for r in results:
        lg = r["legibility"]
        L.append(f"| {r['sheet']} | {r['iso']} {r['orientation']} | {r['text_mode'].split(' (')[0]} | "
                 f"{len(r['significant_pens'])} ({r['dominant_pen_share']}) | "
                 f"{lg.get('mode_mm','-')} / {lg.get('mode_at_A3_mm','-')} | {lg.get('pct_below_1.8','-')} | "
                 f"{r['empty_field_pct']} | {len(r['flags'])} |")
    L.append("")
    for r in results:
        if r["flags"]:
            L += [f"### {r['sheet']}", ""] + [f"- {f}" for f in r["flags"]] + [""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Print-readiness visual checker for drawing PDFs")
    ap.add_argument("pdf_dir", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--number-pattern")
    ap.add_argument("--file-prefix")
    ap.add_argument("--detail-sheets")
    ap.add_argument("--heading", default="Print-readiness visual check")
    opts = ap.parse_args()
    pdf_dir, out_dir = opts.pdf_dir, opts.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    names_file = pdf_dir / "original_names.json"
    orig = json.loads(names_file.read_text()) if names_file.exists() else {}
    results = []
    for pdf in sorted(pdf_dir.glob("*.pdf")):
        print("checking", pdf.name, file=sys.stderr)
        results.append(check(pdf, out_dir))
    set_flags = set_checks(results, list(orig.values()), opts)
    (out_dir / "checks.json").write_text(json.dumps({"set": set_flags, "sheets": results}, indent=1))
    report = md_report(results, set_flags, opts.heading)
    (out_dir / "checks.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
