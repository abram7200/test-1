# drawing-qa

Two small tools for checking drawing sets before they go out for print.

## `visual_check.py`: print-readiness checker

Renders every single-sheet PDF in a folder and reports what makes a sheet hard to print or review:

| Check | How |
|---|---|
| Sheet size and orientation | Displayed page size against ISO A0–A3; flags anything that is not A1 landscape, and content turned 90° on the page |
| Text storage | Live text, text converted to outlines (not searchable), or pasted images |
| Lettering height | Renders the drawing field at 10 px/mm with the title block masked, measures character-shaped marks, and reports the typical height at A1 and on an A3 half-size print (flags under 2.5 mm, and sheets where many characters are under 1.8 mm) |
| Line weights | Share of strokes drawn with one pen; flags sheets with no line hierarchy |
| Images | Effective dpi of every embedded image at its printed size, and how much of the field is raster |
| Empty field | Share of the drawing area with nothing on it |
| Title block | Drawing number and scale, where the text is searchable |
| Set level | Numbering gaps, drawing numbers that break a pattern, file names without the project prefix, a single scale stated on sheets of details |

Each sheet also gets `<sheet>_legibility.png`, with undersized characters marked red.

```sh
pip install pymupdf numpy scipy
python3 visual_check.py <pdf_dir> <out_dir> \
  --number-pattern 'ABC-XYZ-M-GN-\d{2}' \
  --file-prefix ABC- \
  --detail-sheets 'GN-(0[89]|1[0-2])$'
```

Optional `<pdf_dir>/original_names.json` maps each PDF stem to the file name it was delivered with, for the file-prefix check. Outputs: `checks.json`, `checks.md`, and the overlays.

Limits: character heights come from rendered marks, so they are good to about ±0.2 mm and include SHX text that has been turned into outlines. The checker judges print legibility and drawing hygiene, not engineering content.

## `figure/`: LOD ladder figure

`figure/build.mjs` draws an insulated duct on a rooftop support stand with the [anatomy](https://github.com/wheresryan22/anatomy) kit. Every part carries the LOD at which a shop drawing must define it, and the figure steps from LOD 200 to 400 so you can see what each level adds.

```sh
node figure/build.mjs            # figure/roof-support.html (dark)
node figure/build.mjs --light    # figure/roof-support-light.html
```

The kit files in `vendor/anatomy/` are copied unchanged from that repository under its MIT license (`vendor/anatomy/LICENSE`, source commit in `vendor/anatomy/SOURCE`).
