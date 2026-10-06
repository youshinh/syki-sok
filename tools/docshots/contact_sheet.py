#!/usr/bin/env python
"""Contact sheets: many docshots pictures on a few pages, to look at a whole run at a glance.

A run with a media condition (node tools/docshots/run.mjs --media forced-colors:active --out <dir> ...) makes 70 pictures per
language and condition. Looking at them one by one is slow, so this tiles them (Pillow), each with its name, and a person
opens the full-size picture only for what looks doubtful. Nothing here is committed: the pictures are for looking.

  python tools/docshots/contact_sheet.py <dir> [<dir2> ...] [--out <prefix>] [--cols 2] [--rows 3] [--width 560]
                                         [--only name,name] [--skip name,name] [--order shots|name]

* one directory: one cell per picture (<dir>/*.png, or <dir>/<lang>/*.png when <dir> holds a language folder; --lang picks it)
* several directories: one cell per picture NAME, the pictures of the directories side by side (a condition against another:
  ink beside paper, no media beside forced colours). A name missing from a directory leaves a gap.
* the sheets are <prefix>-01.png, <prefix>-02.png ... (prefix defaults to <first dir>/_sheet)
* --order shots (default) follows tools/docshots/shots.json, --order name sorts by file name

Prints the sheet file names, one per line, so a script can open them.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\segoeui.ttf',
    r'C:\Windows\Fonts\arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def pictures_of(directory, lang):
    """{name: path} of the PNGs of a directory (or of its language folder)."""
    base = directory
    if lang and os.path.isdir(os.path.join(directory, lang)):
        base = os.path.join(directory, lang)
    elif not any(f.lower().endswith('.png') for f in os.listdir(directory)):
        for cand in ('en', 'ja'):
            if os.path.isdir(os.path.join(directory, cand)):
                base = os.path.join(directory, cand)
                break
    out = {}
    for f in sorted(os.listdir(base)):
        if f.lower().endswith('.png') and not f.startswith('_sheet') and not f.startswith('sheet'):
            out[f[:-4]] = os.path.join(base, f)
    return out


def shot_order():
    try:
        with open(os.path.join(HERE, 'shots.json'), encoding='utf-8') as fh:
            return [s['name'] for s in json.load(fh)['shots']]
    except (OSError, ValueError, KeyError):
        return []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dirs', nargs='+')
    ap.add_argument('--out', default='')
    ap.add_argument('--cols', type=int, default=2, help='cells per row')
    ap.add_argument('--rows', type=int, default=3, help='rows per sheet')
    ap.add_argument('--width', type=int, default=560, help='width of one picture in a cell, pixels')
    ap.add_argument('--only', default='')
    ap.add_argument('--skip', default='')
    ap.add_argument('--lang', default='en')
    ap.add_argument('--order', choices=['shots', 'name'], default='shots')
    a = ap.parse_args()

    sets = [pictures_of(d, a.lang) for d in a.dirs]
    names = []
    for s in sets:
        for n in s:
            if n not in names:
                names.append(n)
    if a.only:
        keep = [n.strip() for n in a.only.split(',') if n.strip()]
        names = [n for n in names if n in keep]
    if a.skip:
        drop = [n.strip() for n in a.skip.split(',') if n.strip()]
        names = [n for n in names if n not in drop]
    if a.order == 'shots':
        order = shot_order()
        names.sort(key=lambda n: (order.index(n) if n in order else len(order), n))
    else:
        names.sort()
    if not names:
        print('no pictures found', file=sys.stderr)
        return 1

    font = load_font(15)
    pad, label_h = 8, 24
    per_sheet = a.cols * a.rows
    prefix = a.out or os.path.join(a.dirs[0], '_sheet')
    sheets = []
    for page, start in enumerate(range(0, len(names), per_sheet), 1):
        chunk = names[start:start + per_sheet]
        cells = []
        for n in chunk:
            ims = []
            for s in sets:
                if n in s:
                    im = Image.open(s[n]).convert('RGB')
                    h = max(1, round(im.height * a.width / im.width)) if im.width > a.width else im.height
                    w = a.width if im.width > a.width else im.width
                    ims.append(im.resize((w, h), Image.LANCZOS))
                else:
                    ims.append(None)
            cells.append((n, ims))
        cell_w = [max((c[1][i].width for c in cells if c[1][i] is not None), default=a.width) for i in range(len(sets))]
        cell_widths = sum(cell_w) + pad * (len(sets) - 1)
        row_h = []
        for r in range(0, len(cells), a.cols):
            row = cells[r:r + a.cols]
            row_h.append(max((im.height for _, ims in row for im in ims if im is not None), default=40))
        sheet_w = a.cols * (cell_widths + pad) + pad
        sheet_h = sum(h + label_h + pad for h in row_h) + pad
        sheet = Image.new('RGB', (sheet_w, sheet_h), (60, 60, 64))
        d = ImageDraw.Draw(sheet)
        y = pad
        for ri, r in enumerate(range(0, len(cells), a.cols)):
            x = pad
            for n, ims in cells[r:r + a.cols]:
                d.text((x, y + 2), n, fill=(240, 240, 240), font=font)
                cx = x
                for i, im in enumerate(ims):
                    if im is not None:
                        sheet.paste(im, (cx, y + label_h))
                    else:
                        d.rectangle((cx, y + label_h, cx + cell_w[i], y + label_h + 40), outline=(160, 160, 160))
                        d.text((cx + 6, y + label_h + 10), '(none)', fill=(200, 200, 200), font=font)
                    cx += cell_w[i] + pad
                x += cell_widths + pad
            y += row_h[ri] + label_h + pad
        path = '%s-%02d.png' % (prefix, page)
        sheet.save(path)
        sheets.append(path)
    for p in sheets:
        print(p)
    return 0


if __name__ == '__main__':
    sys.exit(main())
