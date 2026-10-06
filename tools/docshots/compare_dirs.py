#!/usr/bin/env python3
"""Compare two folders of PNG pictures (for example two docshots runs) pixel by pixel.

  python tools/docshots/compare_dirs.py <before-dir> <after-dir> [--lang en] [--ignore a.png,b.png]
                                         [--noise <dir> ...] [--noise-grow N] [--common-only]
                                         [--diff-out <dir>] [--tolerance N] [--quiet]

The pictures are matched by their path relative to each folder (docshots writes <dir>/<lang>/<name>.png).
For every picture it prints one line: "same", the number of differing pixels (a pixel differs when any of its
channels differs by more than --tolerance, default 0), the bounding box of the difference and the largest
channel difference, or a size / missing-file problem. At the end it prints the totals.

Exit status: 0 when every compared picture is identical (the --ignore names are listed but not counted),
1 when something differs or is missing, 2 on a usage error.

--noise <dir> (repeatable) names more runs of the BEFORE state (the same pictures taken again). A picture that is
animated at the moment it is taken (a spinner, a blinking caret, a glow) is not reproducible: two runs of the same
program differ. The pixels that differ between <before-dir> and any --noise run are "unstable"; they are left out of
the comparison (--noise-grow N widens that area by N pixels), so the rest of such a picture is still checked exactly.
The unstable pixel count is printed next to the verdict.

--common-only compares only the pictures that exist in both folders (for a partial run, docshots --only a,b,c); without it
a picture that is in one folder only is reported as missing.

--diff-out <dir> writes, for each differing picture, <dir>/<relative path> with the pixels that differ painted
magenta over a dimmed copy of the "after" picture, so the change can be looked at.
Needs Pillow (PIL) only.
"""
import argparse
import os
import sys

try:
    from PIL import Image, ImageChops, ImageFilter
except ImportError:  # pragma: no cover
    sys.stderr.write('compare_dirs.py needs Pillow (pip install pillow)\n')
    sys.exit(2)


def list_pngs(root):
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if name.lower().endswith('.png'):
                full = os.path.join(dirpath, name)
                out[os.path.relpath(full, root).replace('\\', '/')] = full
    return out


def diff_mask(a, b, tol):
    """Return (mask 'L' image with 255 where the pixels differ, max channel difference)."""
    a = a.convert('RGBA')
    b = b.convert('RGBA')
    d = ImageChops.difference(a, b)
    channels = d.split()
    mx = max(c.getextrema()[1] for c in channels)
    mask = None
    for c in channels:
        m = c.point(lambda v, t=tol: 255 if v > t else 0)
        mask = m if mask is None else ImageChops.lighter(mask, m)
    return mask, mx


def main(argv):
    ap = argparse.ArgumentParser(description='pixel-compare two folders of PNG pictures')
    ap.add_argument('before')
    ap.add_argument('after')
    ap.add_argument('--lang', help='compare only <dir>/<lang>/ (for example en)')
    ap.add_argument('--ignore', default='', help='comma separated picture names (with or without .png) that are listed but not counted')
    ap.add_argument('--tolerance', type=int, default=0, help='channel difference allowed per pixel (default 0 = exact)')
    ap.add_argument('--noise', action='append', default=[], help='another run of the before state; pixels that differ from it are unstable and ignored (repeatable)')
    ap.add_argument('--noise-grow', type=int, default=0, help='widen the unstable area by this many pixels')
    ap.add_argument('--common-only', action='store_true', help='compare only the pictures that exist in both folders')
    ap.add_argument('--diff-out', help='write a picture of the differing pixels for each differing file here')
    ap.add_argument('--quiet', action='store_true', help='print only the differing / missing pictures and the totals')
    args = ap.parse_args(argv)

    for d in (args.before, args.after):
        if not os.path.isdir(d):
            sys.stderr.write('not a folder: %s\n' % d)
            return 2
    ignore = set()
    for n in args.ignore.split(','):
        n = n.strip()
        if n:
            ignore.add(n[:-4] if n.lower().endswith('.png') else n)

    noise_files = []
    for nd in args.noise:
        if not os.path.isdir(nd):
            sys.stderr.write('not a folder: %s\n' % nd)
            return 2
        noise_files.append(list_pngs(nd))
    a_files = list_pngs(args.before)
    b_files = list_pngs(args.after)
    if args.lang:
        prefix = args.lang.strip('/') + '/'
        a_files = {k: v for k, v in a_files.items() if k.startswith(prefix)}
        b_files = {k: v for k, v in b_files.items() if k.startswith(prefix)}
    names = sorted(set(a_files) & set(b_files)) if args.common_only else sorted(set(a_files) | set(b_files))
    if not names:
        sys.stderr.write('no PNG pictures found\n')
        return 2

    same = 0
    differing = []   # (name, text)
    problems = []    # missing / size
    ignored = []
    for name in names:
        base = name[:-4]
        short = base.split('/')[-1]
        is_ignored = base in ignore or short in ignore
        if name not in a_files or name not in b_files:
            where = 'only in the after folder' if name not in a_files else 'only in the before folder'
            line = '%-40s MISSING (%s)' % (name, where)
            (ignored if is_ignored else problems).append((name, line))
            print(line + ('  [ignored]' if is_ignored else ''))
            continue
        ia = Image.open(a_files[name])
        ib = Image.open(b_files[name])
        if ia.size != ib.size:
            line = '%-40s SIZE %dx%d -> %dx%d' % (name, ia.size[0], ia.size[1], ib.size[0], ib.size[1])
            (ignored if is_ignored else problems).append((name, line))
            print(line + ('  [ignored]' if is_ignored else ''))
            continue
        mask, mx = diff_mask(ia, ib, args.tolerance)
        unstable = None
        for nf in noise_files:
            if name in nf:
                other = Image.open(nf[name])
                if other.size == ia.size:
                    nm, _ = diff_mask(ia, other, args.tolerance)
                    unstable = nm if unstable is None else ImageChops.lighter(unstable, nm)
        n_unstable = 0
        if unstable is not None:
            if args.noise_grow > 0:
                unstable = unstable.filter(ImageFilter.MaxFilter(2 * args.noise_grow + 1))
            n_unstable = unstable.histogram()[255]
            mask = ImageChops.subtract(mask, unstable)
        bbox = mask.getbbox()
        note = '  (%d px unstable in the baseline, left out)' % n_unstable if n_unstable else ''
        if bbox is None:
            if is_ignored:
                ignored.append((name, name))
            else:
                same += 1
            if not args.quiet or n_unstable:
                print('%-40s same%s' % (name, note) + ('  [ignored]' if is_ignored else ''))
            continue
        n_px = mask.histogram()[255]
        line = '%-40s %d px differ  bbox=%s  max-channel-delta=%d%s' % (name, n_px, bbox, mx, note)
        (ignored if is_ignored else differing).append((name, line))
        print(line + ('  [ignored]' if is_ignored else ''))
        if args.diff_out:
            out = os.path.join(args.diff_out, name)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            dim = Image.blend(ib.convert('RGBA'), Image.new('RGBA', ib.size, (0, 0, 0, 255)), 0.6)
            dim.paste(Image.new('RGBA', ib.size, (255, 0, 255, 255)), (0, 0), mask)
            dim.convert('RGB').save(out)

    total = len(names)
    print('-' * 60)
    print('compared %d pictures: %d identical, %d differ, %d missing or resized, %d ignored'
          % (total, same, len(differing), len(problems), len(ignored)))
    if differing:
        print('differing: ' + ', '.join(n for n, _ in differing))
    if problems:
        print('missing/resized: ' + ', '.join(n for n, _ in problems))
    return 1 if (differing or problems) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
