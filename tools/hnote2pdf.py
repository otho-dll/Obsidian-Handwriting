#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hnote2pdf – converts Obsidian handwritten notes (.hnote) to PDF without Obsidian.

    python hnote2pdf.py "Studies/Physics/Lecture 1.hnote"         -> "Lecture 1.pdf" next to the note
    python hnote2pdf.py "Lecture 1.hnote" -o ~/Desktop/lecture.pdf
    python hnote2pdf.py PathToVault/Studies --recursive            -> a PDF for every note in the folder
    python hnote2pdf.py ".Lecture 1.hnote-data/history/20261016-120000_ab12cd34_auto.hnote.gz"   (an old version)

Requirements: only Python 3.8+. Pillow (pip install pillow) is optional – it speeds up PNG images
and can read less common formats (WebP, GIF…). Without it JPEG and plain PNG are supported.

The PDF is vector-based: handwriting, shapes and page patterns stay sharp at any zoom.
Page titles go into the PDF's table of contents (bookmarks).

----------------------------------------------------------------------------------------------------
The .hnote file format (JSON) – in short (full description: src/format.ts, src/types.ts in the plugin)

  { "v": 3|4, "id": "…", "defaults": { "tpl": "dots", "paper": "#ffffff", "format": "a4" },
    "pages": [ {
        "strokes": [ { "points": [[x, y], [x, y, pressure 0-100], …], "color": "#000000", "width": 2,
                       "isHighlighter": false, "alpha": 0.5,                      # pen opacity
                       "shape": "line"|"rect"|"ellipse", "dash": "dashed"|"dotted"|"dashdot", "fill": true,
                       "arrow": true, "rot": 0.3, "poly": true, "isEraser": true (old – skipped) } ],
        "images":  [ { "path": "@/attachments/abc.png" | "Folder/image.png", "data": "data:image/…",
                       "x": 0, "y": 0, "w": 100, "h": 80, "rot": 0 } ],
        "bgPath": "@/attachments/page1.jpg",     # imported PDF page (background of the whole page)
        "tpl": "lines", "paper": "#fffbea",       # pattern and colour of this page
        "w": 1131, "h": 800, "endless": true,     # v4: page size (missing = A4 portrait 800×1131)
        "title": "Lecture 3"                      # v4: page title (table of contents)
    } ] }

  Coordinates are "logical": A4 = 800 × 1131 units, Y axis pointing down.
  "@/…" = a file in the note's hidden folder ".<name>.hnote-data/…" next to the note file;
  files removed from the note but still needed by older versions live in ".<name>.hnote-data/history/attachments/".
  Other paths are relative to the vault root folder (the one containing the .obsidian folder).
----------------------------------------------------------------------------------------------------
"""
import argparse
import base64
import glob
import gzip
import json
import math
import os
import re
import struct
import sys
import zlib

A4_W, A4_H = 800.0, 1131.0
PT_PER_UNIT = 595.28 / A4_W          # 1 logical unit in PDF points (A4 = 595.28 × 841.89 pt)
KAPPA = 0.5522847498                 # arc approximation with a Bézier curve

# ------------------------------------------------------------------------------------------------
# Colours
# ------------------------------------------------------------------------------------------------

def parse_color(c, default=(0, 0, 0, 1.0)):
    """'#rrggbb' or 'rgba(r,g,b,a)' -> (r, g, b, a) with r, g, b in 0..255."""
    if not isinstance(c, str):
        return default
    c = c.strip()
    m = re.match(r'^#([0-9a-fA-F]{6})$', c)
    if m:
        v = m.group(1)
        return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), 1.0)
    m = re.match(r'^#([0-9a-fA-F]{3})$', c)
    if m:
        v = m.group(1)
        return (int(v[0] * 2, 16), int(v[1] * 2, 16), int(v[2] * 2, 16), 1.0)
    m = re.match(r'^rgba?\(([^)]*)\)$', c)
    if m:
        parts = [p.strip() for p in m.group(1).split(',')]
        try:
            r, g, b = (float(parts[0]), float(parts[1]), float(parts[2]))
            a = float(parts[3]) if len(parts) > 3 else 1.0
            return (r, g, b, a)
        except (ValueError, IndexError):
            return default
    return default


def ink_for_paper(paper):
    """Page pattern colours matched to the paper brightness (like inkForPaper in templates.ts)."""
    r, g, b, _ = parse_color(paper, (255, 255, 255, 1))
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if lum < 0.45:
        return {'line': 'rgba(226,232,240,0.20)', 'dot': 'rgba(226,232,240,0.28)', 'accent': 'rgba(248,113,113,0.45)',
                'fine': 'rgba(226,232,240,0.09)', 'strong': 'rgba(226,232,240,0.34)'}
    return {'line': 'rgba(71,85,105,0.22)', 'dot': 'rgba(71,85,105,0.26)', 'accent': 'rgba(220,38,38,0.35)',
            'fine': 'rgba(71,85,105,0.10)', 'strong': 'rgba(71,85,105,0.38)'}


def fmt(v):
    """Number for a PDF stream (short, no exponent notation)."""
    if abs(v) < 1e-9:
        return '0'
    s = '%.3f' % v
    s = s.rstrip('0').rstrip('.')
    return s if s not in ('', '-0') else '0'

# ------------------------------------------------------------------------------------------------
# Images (JPEG unchanged; PNG – Pillow or a simple decoder; other formats – Pillow)
# ------------------------------------------------------------------------------------------------

try:
    from PIL import Image  # type: ignore
    HAVE_PIL = True
except Exception:  # pragma: no cover
    HAVE_PIL = False


def jpeg_info(data):
    """(width, height, number of components) from a JPEG header, or None."""
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = struct.unpack('>H', data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            comps = data[i + 9]
            return w, h, comps
        i += 2 + length
    return None


def png_decode(data):
    """Simple PNG decoder (8 bits, no interlacing). Returns (w, h, rgb bytes, alpha bytes|None) or None."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    pos = 8
    idat = []
    plte = None
    trns = None
    w = h = depth = ctype = interlace = None
    while pos + 8 <= len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'PLTE':
            plte = chunk
        elif typ == b'tRNS':
            trns = chunk
        elif typ == b'IDAT':
            idat.append(chunk)
        elif typ == b'IEND':
            break
    if w is None or depth != 8 or interlace != 0 or ctype not in (0, 2, 3, 4, 6):
        return None
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(b''.join(idat))
    stride = w * channels
    out = bytearray(h * stride)
    prev = bytearray(stride)
    bpp = channels
    p = 0
    for y in range(h):
        f = raw[p]
        line = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    if ctype == 2:
        return w, h, bytes(out), None
    if ctype == 6:
        return w, h, bytes(b for i, b in enumerate(out) if i % 4 != 3), bytes(out[3::4])
    if ctype == 0:
        rgb = bytes(v for v in out for _ in range(3))
        return w, h, rgb, None
    if ctype == 4:
        g = out[0::2]
        return w, h, bytes(v for v in g for _ in range(3)), bytes(out[1::2])
    # palette
    if plte is None:
        return None
    rgb = bytearray()
    alpha = bytearray() if trns else None
    for idx in out:
        rgb += plte[idx * 3:idx * 3 + 3]
        if alpha is not None:
            alpha.append(trns[idx] if idx < len(trns) else 255)
    return w, h, bytes(rgb), (bytes(alpha) if alpha is not None else None)


def load_image(data):
    """Returns an image description for the PDF: dict(w, h, filter, data, cs, smask) or None."""
    if data[:2] == b'\xff\xd8':
        info = jpeg_info(data)
        if info:
            w, h, comps = info
            cs = {1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK'}.get(comps, '/DeviceRGB')
            return {'w': w, 'h': h, 'filter': '/DCTDecode', 'data': data, 'cs': cs, 'smask': None,
                    'decode': '[1 0 1 0 1 0 1 0]' if comps == 4 else None}
    if HAVE_PIL:
        try:
            import io
            im = Image.open(io.BytesIO(data))
            im.load()
            if im.mode in ('P', 'LA', 'L') and 'transparency' in im.info:
                im = im.convert('RGBA')
            if im.mode not in ('RGB', 'RGBA'):
                im = im.convert('RGBA' if 'A' in im.mode else 'RGB')
            alpha = im.getchannel('A').tobytes() if im.mode == 'RGBA' else None
            if alpha is not None and min(alpha) == 255:
                alpha = None
            rgb = im.convert('RGB').tobytes()
            return {'w': im.width, 'h': im.height, 'filter': '/FlateDecode', 'data': zlib.compress(rgb, 6), 'cs': '/DeviceRGB',
                    'smask': zlib.compress(alpha, 6) if alpha else None, 'decode': None}
        except Exception:
            return None
    dec = png_decode(data) if data[:4] == b'\x89PNG' else None
    if dec:
        w, h, rgb, alpha = dec
        return {'w': w, 'h': h, 'filter': '/FlateDecode', 'data': zlib.compress(rgb, 6), 'cs': '/DeviceRGB',
                'smask': zlib.compress(alpha, 6) if alpha else None, 'decode': None}
    return None

# ------------------------------------------------------------------------------------------------
# Minimal PDF writer
# ------------------------------------------------------------------------------------------------

class PdfWriter:
    def __init__(self):
        self.objs = []          # object contents (bytes); number = index + 1

    def reserve(self):
        self.objs.append(None)
        return len(self.objs)

    def set(self, num, content):
        self.objs[num - 1] = content if isinstance(content, bytes) else content.encode('latin-1')

    def add(self, content):
        n = self.reserve()
        self.set(n, content)
        return n

    def stream(self, dict_body, data, compress=True):
        if compress:
            data = zlib.compress(data, 6)
            dict_body += ' /Filter /FlateDecode'
        return self.add(b'<< ' + dict_body.encode('latin-1') + b' /Length ' + str(len(data)).encode() + b' >>\nstream\n' + data + b'\nendstream')

    def write(self, path, root, info):
        out = bytearray(b'%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')
        offsets = []
        for i, c in enumerate(self.objs):
            offsets.append(len(out))
            out += ('%d 0 obj\n' % (i + 1)).encode() + (c or b'null') + b'\nendobj\n'
        xref = len(out)
        out += ('xref\n0 %d\n0000000000 65535 f \n' % (len(self.objs) + 1)).encode()
        for off in offsets:
            out += ('%010d 00000 n \n' % off).encode()
        out += ('trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(self.objs) + 1, root, info, xref)).encode()
        with open(path, 'wb') as f:
            f.write(out)


def pdf_text(s):
    """Unicode text as a UTF-16BE string in <…> brackets."""
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'


class Content:
    """Page content stream (PDF operators) with a cache of transparency states."""

    def __init__(self, page):
        self.ops = []
        self.page = page          # PageBuilder – registry of ExtGStates / images

    def add(self, s):
        self.ops.append(s)

    def color(self, rgba, stroke=False, fill=True):
        r, g, b, _ = rgba
        c = '%s %s %s' % (fmt(r / 255), fmt(g / 255), fmt(b / 255))
        if fill:
            self.add(c + ' rg')
        if stroke:
            self.add(c + ' RG')

    def alpha(self, a):
        self.add('/%s gs' % self.page.gstate(a))

    def data(self):
        return '\n'.join(self.ops).encode('latin-1')


class PageBuilder:
    def __init__(self, writer):
        self.w = writer
        self.gstates = {}
        self.xobjects = {}

    def gstate(self, a):
        a = round(max(0.0, min(1.0, a)), 3)
        if a not in self.gstates:
            self.gstates[a] = 'GS%d' % len(self.gstates)
        return self.gstates[a]

    def xobject(self, num):
        name = 'X%d' % len(self.xobjects)
        self.xobjects[name] = num
        return name

    def resources(self):
        gs = ' '.join('/%s << /Type /ExtGState /ca %s /CA %s >>' % (n, fmt(a), fmt(a)) for a, n in self.gstates.items())
        xo = ' '.join('/%s %d 0 R' % (n, num) for n, num in self.xobjects.items())
        return '<< /ExtGState << %s >> /XObject << %s >> >>' % (gs, xo)

# ------------------------------------------------------------------------------------------------
# Path geometry
# ------------------------------------------------------------------------------------------------

def circle_ops(cx, cy, r):
    """Circle as 4 Bézier curves (increasing angle – the same winding as arc() in canvas)."""
    ops = []
    for k in range(4):
        t0, t1 = k * math.pi / 2, (k + 1) * math.pi / 2
        x0, y0 = cx + r * math.cos(t0), cy + r * math.sin(t0)
        x3, y3 = cx + r * math.cos(t1), cy + r * math.sin(t1)
        x1, y1 = x0 - KAPPA * r * math.sin(t0), y0 + KAPPA * r * math.cos(t0)
        x2, y2 = x3 + KAPPA * r * math.sin(t1), y3 - KAPPA * r * math.cos(t1)
        if k == 0:
            ops.append('%s %s m' % (fmt(x0), fmt(y0)))
        ops.append('%s %s %s %s %s %s c' % (fmt(x1), fmt(y1), fmt(x2), fmt(y2), fmt(x3), fmt(y3)))
    ops.append('h')
    return ops


def ellipse_ops(cx, cy, rx, ry):
    ops = []
    for k in range(4):
        t0, t1 = k * math.pi / 2, (k + 1) * math.pi / 2
        x0, y0 = cx + rx * math.cos(t0), cy + ry * math.sin(t0)
        x3, y3 = cx + rx * math.cos(t1), cy + ry * math.sin(t1)
        x1, y1 = x0 - KAPPA * rx * math.sin(t0), y0 + KAPPA * ry * math.cos(t0)
        x2, y2 = x3 + KAPPA * rx * math.sin(t1), y3 - KAPPA * ry * math.cos(t1)
        if k == 0:
            ops.append('%s %s m' % (fmt(x0), fmt(y0)))
        ops.append('%s %s %s %s %s %s c' % (fmt(x1), fmt(y1), fmt(x2), fmt(y2), fmt(x3), fmt(y3)))
    ops.append('h')
    return ops

# ------------------------------------------------------------------------------------------------
# Strokes (port of strokeDraw.ts)
# ------------------------------------------------------------------------------------------------

class Settings:
    pressure_enabled = True
    pressure_sensitivity = 0.7
    pattern = True


def pressure_factor(p, st):
    if not st.pressure_enabled:
        return 1.0
    return max(0.2, 1 + st.pressure_sensitivity * (p - 0.5) * 2)


def norm_points(raw):
    pts = []
    for p in raw or []:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            pr = p[2] / 100.0 if len(p) > 2 and isinstance(p[2], (int, float)) else 0.5
            pts.append((float(p[0]), float(p[1]), pr))
        elif isinstance(p, dict) and 'x' in p and 'y' in p:
            pts.append((float(p['x']), float(p['y']), float(p.get('pressure', 0.5))))
    return pts


def dash_ops(stroke, w):
    d = stroke.get('dash')
    if d == 'dashed':
        return '0 J [%s %s] 0 d' % (fmt(w * 4 + 6), fmt(w * 2.5 + 5))
    if d == 'dotted':
        return '0 J [%s %s] 0 d' % (fmt(w * 1.2 + 0.8), fmt(w * 2 + 3))
    if d == 'dashdot':
        gap = fmt(w * 2 + 3.5)
        return '0 J [%s %s %s %s] 0 d' % (fmt(w * 4 + 6), gap, fmt(w * 1.2 + 0.8), gap)
    return None


def draw_shape(c, s, pts):
    p0, p1 = pts[0], pts[-1]
    w = max(0.5, float(s.get('width', 1)))
    col = parse_color(s.get('color'))
    c.color(col, stroke=True, fill=True)
    c.add('%s w 1 j' % fmt(w))
    dash = dash_ops(s, w)
    c.add(dash if dash else '1 J [] 0 d')
    shape = s.get('shape')
    rot = s.get('rot') or 0
    rotated = bool(rot) and shape != 'line'
    cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    c.add('q')
    ox = oy = 0.0
    if rotated:
        co, si = math.cos(rot), math.sin(rot)
        c.add('%s %s %s %s %s %s cm' % (fmt(co), fmt(si), fmt(-si), fmt(co), fmt(cx), fmt(cy)))
        ox, oy = cx, cy
    ax, ay, bx, by = p0[0] - ox, p0[1] - oy, p1[0] - ox, p1[1] - oy
    if shape == 'line':
        c.add('%s %s m %s %s l' % (fmt(p0[0]), fmt(p0[1]), fmt(p1[0]), fmt(p1[1])))
    elif shape == 'rect':
        c.add('%s %s %s %s re' % (fmt(min(ax, bx)), fmt(min(ay, by)), fmt(abs(bx - ax)), fmt(abs(by - ay))))
    else:
        c.ops.extend(ellipse_ops((ax + bx) / 2, (ay + by) / 2, abs(bx - ax) / 2, abs(by - ay) / 2))
    c.add('B' if (s.get('fill') and shape != 'line') else 'S')
    c.add('Q')
    if shape == 'line' and s.get('arrow'):
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        head = max(12, w * 5)
        c.add('1 J [] 0 d')
        c.add('%s %s m %s %s l %s %s l S' % (
            fmt(p1[0] - head * math.cos(ang - math.pi / 6)), fmt(p1[1] - head * math.sin(ang - math.pi / 6)),
            fmt(p1[0]), fmt(p1[1]),
            fmt(p1[0] - head * math.cos(ang + math.pi / 6)), fmt(p1[1] - head * math.sin(ang + math.pi / 6))))
    c.add('[] 0 d')


def sharp_turn(pts, i):
    """Sharp turn of the stroke at point i (turn > ~110°) – there the stroke passes exactly through the point."""
    ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
    bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
    la, lb = math.hypot(ax, ay), math.hypot(bx, by)
    if la < 1e-6 or lb < 1e-6:
        return False
    return (ax * bx + ay * by) / (la * lb) < -0.35


def pressure_path(pts, width, st):
    """Stroke with variable width: a union of "capsules" (quads + circles) – like drawPressureStroke."""
    n = len(pts)
    w_of = lambda p: width * pressure_factor(p[2], st)
    X, Y, W = [], [], []

    def push(x, y, w):
        X.append(x); Y.append(y); W.append(max(0.15, w))

    state = {'sx': pts[0][0], 'sy': pts[0][1], 'sw': w_of(pts[0])}
    push(state['sx'], state['sy'], state['sw'])

    def quad(cx, cy, cw, ex, ey, ew):
        sx, sy, sw = state['sx'], state['sy'], state['sw']
        ln = math.hypot(cx - sx, cy - sy) + math.hypot(ex - cx, ey - cy)
        k = max(1, int(math.ceil(ln / 2.4)))
        for j in range(1, k + 1):
            t = j / k
            u = 1 - t
            push(u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey, u * u * sw + 2 * u * t * cw + t * t * ew)
        state['sx'], state['sy'], state['sw'] = ex, ey, ew

    for i in range(1, n - 1):
        p1, p2 = pts[i], pts[i + 1]
        if sharp_turn(pts, i):
            quad((state['sx'] + p1[0]) / 2, (state['sy'] + p1[1]) / 2, (state['sw'] + w_of(p1)) / 2, p1[0], p1[1], w_of(p1))
            continue
        quad(p1[0], p1[1], w_of(p1), (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (w_of(p1) + w_of(p2)) / 2)
    last = pts[-1]
    quad((state['sx'] + last[0]) / 2, (state['sy'] + last[1]) / 2, (state['sw'] + w_of(last)) / 2, last[0], last[1], w_of(last))

    # One outline (right edge forwards, left edge back) + circles at the ends and in tight turns
    # – like outlinePath in strokeDraw.ts. All parts have the same winding (nonzero fill).
    PX, PY, PW = [X[0]], [Y[0]], [W[0]]
    for j in range(1, len(X)):
        if math.hypot(X[j] - PX[-1], Y[j] - PY[-1]) < 1e-4:
            PW[-1] = max(PW[-1], W[j])
            continue
        PX.append(X[j]); PY.append(Y[j]); PW.append(W[j])
    m = len(PX) - 1
    ops = []
    if m == 0:
        return circle_ops(PX[0], PY[0], PW[0] / 2)
    ux, uy, dd = [], [], []
    for j in range(m):
        dx, dy = PX[j + 1] - PX[j], PY[j + 1] - PY[j]
        l = math.hypot(dx, dy)
        ux.append(dx / l); uy.append(dy / l); dd.append(l)
    NX, NY = [], []
    for j in range(m + 1):
        if j == 0:
            ax, ay = ux[0], uy[0]
        elif j == m:
            ax, ay = ux[m - 1], uy[m - 1]
        else:
            ax, ay = ux[j - 1] + ux[j], uy[j - 1] + uy[j]
            l = math.hypot(ax, ay)
            if l < 1e-3:
                ax, ay = ux[j - 1], uy[j - 1]
            else:
                ax, ay = ax / l, ay / l
        NX.append(-ay); NY.append(ax)
    pts_r = ['%s %s' % (fmt(PX[j] - NX[j] * PW[j] / 2), fmt(PY[j] - NY[j] * PW[j] / 2)) for j in range(m + 1)]
    pts_l = ['%s %s' % (fmt(PX[j] + NX[j] * PW[j] / 2), fmt(PY[j] + NY[j] * PW[j] / 2)) for j in range(m, -1, -1)]
    ops.append(pts_r[0] + ' m')
    ops.extend(p + ' l' for p in pts_r[1:])
    ops.extend(p + ' l' for p in pts_l)
    ops.append('h')
    ops.extend(circle_ops(PX[0], PY[0], PW[0] / 2))
    ops.extend(circle_ops(PX[m], PY[m], PW[m] / 2))
    for j in range(1, m):
        cos = ux[j - 1] * ux[j] + uy[j - 1] * uy[j]
        if cos > 0.9999:
            continue
        tan_half = float('inf') if cos <= -0.999 else math.sqrt((1 - cos) / (1 + cos))
        if (PW[j] / 2) * tan_half > 0.45 * min(dd[j - 1], dd[j]):
            ops.extend(circle_ops(PX[j], PY[j], PW[j] / 2))
    return ops


def draw_stroke(c, s, st):
    """One stroke (pen, highlighter or shape) – like drawSmoothStroke."""
    if s.get('isEraser'):
        return
    pts = norm_points(s.get('points'))
    if not pts:
        return
    hl = bool(s.get('isHighlighter'))
    alpha = s.get('alpha')
    use_alpha = isinstance(alpha, (int, float)) and alpha < 1 and not hl
    c.add('q')
    if use_alpha:
        c.alpha(float(alpha))
    if s.get('shape'):
        draw_shape(c, s, pts)
        c.add('Q')
        return
    w = float(s.get('width', 1))
    col = parse_color(s.get('color'))
    c.color(col, stroke=True, fill=True)
    if len(pts) == 1:
        x, y, _ = pts[0]
        if hl:
            c.add('%s %s %s %s re f' % (fmt(x - w / 4), fmt(y - w / 2), fmt(w / 2), fmt(w)))
        else:
            c.ops.extend(circle_ops(x, y, w / 2))
            c.add('f')
        c.add('Q')
        return
    has_pressure = not hl and any(abs(p[2] - 0.5) > 1e-9 for p in pts)
    if has_pressure:
        c.ops.extend(pressure_path(pts, w, st))
        c.add('f')
        c.add('Q')
        return
    poly = bool(s.get('poly')) or hl     # highlighter: polyline, flat ends and sharp corners
    c.add('%s w %d J %d j %s M' % (fmt(w), 0 if hl else 1, 0 if poly else 1, '2.2' if hl else '4'))
    dash = dash_ops(s, w)
    c.add(dash if dash else '[] 0 d')
    c.add('%s %s m' % (fmt(pts[0][0]), fmt(pts[0][1])))
    if poly:
        for p in pts[1:]:
            c.add('%s %s l' % (fmt(p[0]), fmt(p[1])))
    else:
        cx, cy = pts[0][0], pts[0][1]
        for i in range(1, len(pts) - 1):
            p1, p2 = pts[i], pts[i + 1]
            if sharp_turn(pts, i):
                c.add('%s %s l' % (fmt(p1[0]), fmt(p1[1])))
                cx, cy = p1[0], p1[1]
                continue
            ex, ey = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
            # quadratic curve -> cubic
            c1x, c1y = cx + 2 / 3 * (p1[0] - cx), cy + 2 / 3 * (p1[1] - cy)
            c2x, c2y = ex + 2 / 3 * (p1[0] - ex), ey + 2 / 3 * (p1[1] - ey)
            c.add('%s %s %s %s %s %s c' % (fmt(c1x), fmt(c1y), fmt(c2x), fmt(c2y), fmt(ex), fmt(ey)))
            cx, cy = ex, ey
        c.add('%s %s l' % (fmt(pts[-1][0]), fmt(pts[-1][1])))
    c.add('S')
    c.add('Q')

# ------------------------------------------------------------------------------------------------
# Page patterns (port of templateGeometry / drawPageTemplate from templates.ts)
# ------------------------------------------------------------------------------------------------

GX = A4_W / 42
GY = A4_H / 56
SP = A4_H / 42
MM = A4_W / 210
MARGIN_X = 96
CORNELL_SUMMARY = 204
STAFF_GAP = 9
STAFF_MIN_SPACE = 48
STAFF_MARGIN_Y, STAFF_MARGIN_X = 64, 48


def fl(x):
    return int(math.floor(x + 1e-6))


def template_geometry(tpl, W, H):
    def lines_from(bottom, n=None):
        return {'y0': 2 * SP + SP - 1, 'step': SP, 'n': max(0, fl(bottom / SP) - 2) if n is None else n, 'x0': 0, 'x1': W}
    if tpl == 'dots':
        nx, ny = max(2, round(W / GX)), max(2, round(H / GY))
        return {'dots': (W / nx, H / ny, nx, ny)}
    if tpl in ('lines', 'margin', 'checklist'):
        g = {'lines': lines_from(H, max(0, fl(H / SP) - 3))}
        if tpl == 'margin':
            g['accents'] = [(MARGIN_X, 0, 1.5, H)]
        if tpl == 'checklist':
            g['checks'] = (26, 13)
        return g
    if tpl == 'cornell':
        cue, summ = round(W * 0.28), H - CORNELL_SUMMARY
        return {'lines': lines_from(summ), 'accents': [(cue, 0, 1.5, summ), (0, summ, W, 1.5)]}
    if tpl == 'grid':
        return {'grid': GX}
    if tpl == 'isometric':
        return {'iso': GX}
    if tpl == 'mm':
        cm = 10 * MM
        cols, rows = max(1, fl((W - 16 * MM) / cm)), max(1, fl((H - 16 * MM) / cm))
        return {'mm': (round((W - cols * cm) / 2), round((H - rows * cm) / 2), cols, rows)}
    if tpl == 'music':
        staff = 4 * STAFF_GAP
        n = max(1, fl((H - 2 * STAFF_MARGIN_Y + STAFF_MIN_SPACE) / (staff + STAFF_MIN_SPACE)))
        pitch = (H - 2 * STAFF_MARGIN_Y - staff) / (n - 1) if n > 1 else 0
        return {'staves': (STAFF_MARGIN_X, W - STAFF_MARGIN_X, STAFF_MARGIN_Y, pitch, n)}
    return {}


def draw_template(c, tpl, W, H, paper):
    ink = {k: parse_color(v) for k, v in ink_for_paper(paper).items()}
    g = template_geometry(tpl, W, H)

    def use(name):
        col = ink[name]
        c.color(col)
        c.alpha(col[3])

    def rect(x, y, w, h):
        c.add('%s %s %s %s re' % (fmt(x), fmt(y), fmt(w), fmt(h)))

    c.add('q')
    if 'dots' in g:
        sx, sy, nx, ny = g['dots']
        use('dot')
        for j in range(1, ny):
            for i in range(1, nx):
                c.ops.extend(circle_ops(i * sx, j * sy, 1.2))
        c.add('f')
    if 'lines' in g:
        L = g['lines']
        use('line')
        for k in range(L['n']):
            rect(L['x0'], L['y0'] + k * L['step'], L['x1'] - L['x0'], 1)
        c.add('f')
        if 'checks' in g:
            x, size = g['checks']
            col = ink['strong']
            c.color(col, stroke=True, fill=False)
            c.alpha(col[3])
            c.add('1.2 w')
            for k in range(L['n']):
                y = L['y0'] + k * L['step'] - size - 5
                rect(x + 1, y, size, size)
            c.add('S')
    if 'grid' in g:
        st = g['grid']
        use('line')
        k = 0
        while k * st < W - 0.01:
            rect(k * st, 0, 1, H); k += 1
        k = 0
        while k * st < H - 0.01:
            rect(0, k * st, W, 1); k += 1
        c.add('f')
    if 'iso' in g:
        s = g['iso']
        h = s * 0.866
        use('dot')
        j = 0
        while (j + 0.5) * h < H:
            y = (j + 0.5) * h
            x = s / 2 if j % 2 == 0 else s
            while x < W - 2:
                c.ops.extend(circle_ops(x, y, 1.2))
                x += s
            j += 1
        c.add('f')
    if 'mm' in g:
        x0, y0, cols, rows = g['mm']
        cm = 10 * MM
        w, h = cols * cm, rows * cm
        for step, name in ((MM, 'fine'), (cm / 2, 'line'), (cm, 'strong')):
            use(name)
            n = round(cm / step)
            for k in range(cols * n + 1):
                rect(x0 + k * step, y0, 1, h + 1)
            for k in range(rows * n + 1):
                rect(x0, y0 + k * step, w + 1, 1)
            c.add('f')
    if 'staves' in g:
        x0, x1, y0, pitch, n = g['staves']
        use('strong')
        for k in range(n):
            for l in range(5):
                rect(x0, y0 + k * pitch + l * STAFF_GAP, x1 - x0, 1)
        c.add('f')
    if 'accents' in g:
        use('accent')
        for (x, y, w, h) in g['accents']:
            rect(x, y, w, h)
        c.add('f')
    c.add('Q')

# ------------------------------------------------------------------------------------------------
# Note -> PDF
# ------------------------------------------------------------------------------------------------

def find_vault_root(start):
    d = os.path.abspath(start)
    while True:
        if os.path.isdir(os.path.join(d, '.obsidian')):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def read_plugin_settings(vault, st):
    """Pressure sensitivity from the plugin settings in the vault (so stroke widths match Obsidian)."""
    if not vault:
        return
    for p in glob.glob(os.path.join(vault, '.obsidian', 'plugins', '*', 'data.json')):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                d = json.load(f)
        except Exception:
            continue
        if isinstance(d, dict) and 'pressureSensitivity' in d and 'penPalette' in d:
            st.pressure_enabled = bool(d.get('pressureEnabled', True))
            try:
                st.pressure_sensitivity = float(d.get('pressureSensitivity', 0.7))
            except (TypeError, ValueError):
                pass
            return


def data_dir_for(note_path):
    d, name = os.path.split(note_path)
    base = re.sub(r'\.hnote$', '', name, flags=re.I)
    return os.path.join(d, '.' + base + '.hnote-data')


def read_ref(ref, note_path, vault):
    """Bytes of the image file referenced in the note, or None."""
    if not ref:
        return None
    if ref.startswith('data:'):
        try:
            return base64.b64decode(ref.split(',', 1)[1])
        except Exception:
            return None
    cands = []
    if ref.startswith('@/'):
        rel = ref[2:]
        dd = data_dir_for(note_path)
        cands.append(os.path.join(dd, *rel.split('/')))
        if rel.startswith('attachments/'):
            cands.append(os.path.join(dd, 'history', 'attachments', rel[len('attachments/'):]))
    else:
        if vault:
            cands.append(os.path.join(vault, *ref.split('/')))
        cands.append(os.path.join(os.path.dirname(note_path), *ref.split('/')))
    for p in cands:
        if os.path.isfile(p):
            with open(p, 'rb') as f:
                return f.read()
    return None


def load_note(path):
    with open(path, 'rb') as f:
        raw = f.read()
    if path.lower().endswith('.gz') or raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    d = json.loads(raw.decode('utf-8'))
    if isinstance(d, dict) and 'strokes' in d and 'pages' not in d:   # v1
        d = {'pages': [{'strokes': d['strokes']}]}
    if not isinstance(d, dict) or not isinstance(d.get('pages'), list) or not d['pages']:
        d = {'pages': [{'strokes': []}]}
    v = d.get('v', 1)
    if isinstance(v, (int, float)) and v > 4:
        print('  warning: the note was saved in a newer format (v%s) – some items may not be shown' % v, file=sys.stderr)
    return d


def note_source_path(path):
    """For a history snapshot (…hnote-data/history/x.hnote.gz) – path of the note it belongs to (for images)."""
    p = os.path.abspath(path)
    m = re.search(r'^(.*)[\\/]\.([^\\/]+)\.hnote-data[\\/]history[\\/][^\\/]+$', p)
    if m:
        return os.path.join(m.group(1), m.group(2) + '.hnote')
    return p


def convert(note_path, out_path, pattern=True, pressure=None, no_pressure=False, vault=None, quiet=False):
    note = load_note(note_path)
    src = note_source_path(note_path)
    vault = vault or find_vault_root(os.path.dirname(src))
    st = Settings()
    st.pattern = pattern
    read_plugin_settings(vault, st)
    # command-line options take precedence over the plugin settings
    if pressure is not None:
        st.pressure_sensitivity = max(0.0, min(1.0, pressure))
    if no_pressure:
        st.pressure_enabled = False
    defaults = note.get('defaults') or {}
    pdf = PdfWriter()
    catalog = pdf.reserve()
    pages_obj = pdf.reserve()
    page_nums = []
    page_heights = []
    image_cache = {}
    missing = 0

    def image_xobject(ref):
        nonlocal missing
        if ref in image_cache:
            return image_cache[ref]
        data = read_ref(ref, src, vault)
        img = load_image(data) if data else None
        num = None
        if img:
            extra = ''
            if img['smask']:
                sm = pdf.add(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n' % (img['w'], img['h'], len(img['smask'])) + img['smask'] + b'\nendstream')
                extra += ' /SMask %d 0 R' % sm
            if img.get('decode'):
                extra += ' /Decode ' + img['decode']
            head = '<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter %s%s /Length %d >>\nstream\n' % (
                img['w'], img['h'], img['cs'], img['filter'], extra, len(img['data']))
            num = pdf.add(head.encode('latin-1') + img['data'] + b'\nendstream')
        else:
            missing += 1
        image_cache[ref] = (num, img['w'] if img else 0, img['h'] if img else 0)
        return image_cache[ref]

    for page in note['pages']:
        if not isinstance(page, dict):
            page = {'strokes': []}
        W = float(page.get('w') or A4_W)
        H = float(page.get('h') or A4_H)
        pb = PageBuilder(pdf)
        c = Content(pb)
        sc = PT_PER_UNIT
        # coordinate system: note units, Y axis pointing down
        c.add('%s 0 0 %s 0 %s cm' % (fmt(sc), fmt(-sc), fmt(H * sc)))
        bg_ref = page.get('bgPath') or page.get('bgImage')
        paper = page.get('paper') or defaults.get('paper') or '#ffffff'
        tpl = page.get('tpl') or defaults.get('tpl') or 'dots'
        c.color((255, 255, 255, 1) if bg_ref else parse_color(paper, (255, 255, 255, 1)))
        c.add('0 0 %s %s re f' % (fmt(W), fmt(H)))
        if bg_ref:
            num, iw, ih = image_xobject(bg_ref)
            if num:
                k = min(W / iw, H / ih)
                dw, dh = iw * k, ih * k
                name = pb.xobject(num)
                c.add('q %s 0 0 %s %s %s cm /%s Do Q' % (fmt(dw), fmt(-dh), fmt((W - dw) / 2), fmt((H - dh) / 2 + dh), name))
        elif st.pattern and tpl != 'blank':
            draw_template(c, tpl, W, H, paper)
        # images
        for im in page.get('images') or []:
            if not isinstance(im, dict):
                continue
            ref = im.get('path') or im.get('data')
            x, y, w, h = (float(im.get(k, 0)) for k in ('x', 'y', 'w', 'h'))
            rot = float(im.get('rot') or 0)
            num, _, _ = image_xobject(ref) if ref else (None, 0, 0)
            c.add('q')
            co, si = math.cos(rot), math.sin(rot)
            c.add('%s %s %s %s %s %s cm' % (fmt(co), fmt(si), fmt(-si), fmt(co), fmt(x + w / 2), fmt(y + h / 2)))
            if num:
                c.add('%s 0 0 %s %s %s cm /%s Do' % (fmt(w), fmt(-h), fmt(-w / 2), fmt(h / 2), pb.xobject(num)))
            else:
                c.add('0.86 0.89 0.92 rg 0.58 0.64 0.72 RG 2 w %s %s %s %s re B' % (fmt(-w / 2), fmt(-h / 2), fmt(w), fmt(h)))
            c.add('Q')
        strokes = [s for s in (page.get('strokes') or []) if isinstance(s, dict)]
        # highlighter: one transparency group (overlapping strokes don't darken – like in Obsidian)
        highs = [s for s in strokes if s.get('isHighlighter') and not s.get('isEraser')]
        if highs:
            hc = Content(pb)
            for s in highs:
                draw_stroke(hc, s, st)
            data = zlib.compress(hc.data(), 6)
            form = pdf.add(('<< /Type /XObject /Subtype /Form /BBox [0 0 %s %s] /Group << /S /Transparency /CS /DeviceRGB >> /Resources %s /Filter /FlateDecode /Length %d >>\nstream\n' % (
                fmt(W), fmt(H), pb.resources(), len(data))).encode('latin-1') + data + b'\nendstream')
            c.add('q /%s gs /%s Do Q' % (pb.gstate(0.4), pb.xobject(form)))
        for s in strokes:
            if not s.get('isHighlighter'):
                draw_stroke(c, s, st)
        contents = pdf.stream('', c.data())
        page_num = pdf.add('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] /Resources %s /Contents %d 0 R >>' % (
            pages_obj, fmt(W * PT_PER_UNIT), fmt(H * PT_PER_UNIT), pb.resources(), contents))
        page_nums.append(page_num)
        page_heights.append(H * PT_PER_UNIT)

    pdf.set(pages_obj, '<< /Type /Pages /Count %d /Kids [%s] >>' % (len(page_nums), ' '.join('%d 0 R' % n for n in page_nums)))
    # bookmarks from page titles
    titled = [(i, p.get('title')) for i, p in enumerate(note['pages']) if isinstance(p, dict) and isinstance(p.get('title'), str) and p['title'].strip()]
    outline = ''
    if titled:
        root = pdf.reserve()
        items = [pdf.reserve() for _ in titled]
        for k, (i, t) in enumerate(titled):
            parts = ['/Title %s' % pdf_text(t.strip()), '/Parent %d 0 R' % root, '/Dest [%d 0 R /XYZ 0 %s 0]' % (page_nums[i], fmt(page_heights[i]))]
            if k > 0:
                parts.append('/Prev %d 0 R' % items[k - 1])
            if k < len(items) - 1:
                parts.append('/Next %d 0 R' % items[k + 1])
            pdf.set(items[k], '<< %s >>' % ' '.join(parts))
        pdf.set(root, '<< /Type /Outlines /First %d 0 R /Last %d 0 R /Count %d >>' % (items[0], items[-1], len(items)))
        outline = ' /Outlines %d 0 R /PageMode /UseOutlines' % root
    pdf.set(catalog, '<< /Type /Catalog /Pages %d 0 R%s >>' % (pages_obj, outline))
    title = re.sub(r'\.hnote(\.gz)?$', '', os.path.basename(src), flags=re.I)
    info = pdf.add('<< /Title %s /Producer (hnote2pdf) >>' % pdf_text(title))
    pdf.write(out_path, catalog, info)
    if not quiet:
        msg = '  %s -> %s (%d %s)' % (note_path, out_path, len(page_nums), 'page' if len(page_nums) == 1 else 'pages')
        if missing:
            msg += ' – %d images not found (grey rectangles)' % missing
        print(msg)
    return out_path


def main(argv=None):
    ap = argparse.ArgumentParser(description='Converts handwritten notes (.hnote) to PDF – without Obsidian.')
    ap.add_argument('inputs', nargs='+', help='.hnote files (or .hnote.gz snapshots) or folders')
    ap.add_argument('-o', '--output', help='PDF file (for a single note) or a folder for the PDFs')
    ap.add_argument('-r', '--recursive', action='store_true', help='also look for notes in subfolders')
    ap.add_argument('--vault', help='vault root folder (default: detected by the .obsidian folder)')
    ap.add_argument('--no-pattern', action='store_true', help='no page pattern (dots, lines…) – plain paper')
    ap.add_argument('--pressure', type=float, help='pressure sensitivity 0–1 (default: from the plugin settings, otherwise 0.7)')
    ap.add_argument('--no-pressure', action='store_true', help='constant stroke width (no pressure)')
    a = ap.parse_args(argv)

    notes = []
    for inp in a.inputs:
        if os.path.isdir(inp):
            pattern = '**/*.hnote' if a.recursive else '*.hnote'
            for p in sorted(glob.glob(os.path.join(inp, pattern), recursive=a.recursive)):
                if not any(part.startswith('.') for part in os.path.relpath(p, inp).split(os.sep)[:-1]):
                    notes.append(p)
        elif os.path.isfile(inp):
            notes.append(inp)
        else:
            print('No such file or folder: %s' % inp, file=sys.stderr)
    if not notes:
        print('No notes to convert.', file=sys.stderr)
        return 1
    out_dir = None
    if a.output and (len(notes) > 1 or os.path.isdir(a.output) or a.output.endswith(('/', '\\'))):
        out_dir = a.output
        os.makedirs(out_dir, exist_ok=True)
    errors = 0
    for n in notes:
        name = re.sub(r'\.hnote(\.gz)?$', '', os.path.basename(n), flags=re.I) + '.pdf'
        out = os.path.join(out_dir, name) if out_dir else (a.output or os.path.join(os.path.dirname(os.path.abspath(n)), name))
        try:
            convert(n, out, pattern=not a.no_pattern, pressure=a.pressure, no_pressure=a.no_pressure, vault=a.vault)
        except Exception as e:  # pragma: no cover
            errors += 1
            print('  ERROR %s: %s' % (n, e), file=sys.stderr)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
