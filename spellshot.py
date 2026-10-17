#!/usr/bin/env python3
"""Reads the text of a Monsters & Memories spell window from a screenshot, for the Wiki helper.

Usage: spellshot.py [--icons DIR] IMAGE... Prints one JSON line per image:
  {"path", "title", "lines": [{"text", "conf", "words": [{"text", "conf"}]}], "icon": "<PNG, base64>", "book": [...]}
or {"path", "error"}.

A screenshot can also show a spellbook page. Its icons sit on their coloured backgrounds there, like the wiki's
icon files, so each one is cut out with the name under it ("book": [{"label", "icon", "matches"}]) and, with
--icons (the app's icons folder), compared with the wiki icons: "matches" are the closest few, best first,
as {"wikiName", "distance"}. A distance under MATCH means it is that wiki icon.

A screenshot is of the spell window itself (its title bar at the top). The text is light on a grey stone
background, so the image is turned black-on-white and enlarged before Tesseract reads it. Only the screenshot
is read; nothing touches the game.
"""
import base64
import csv
import io
import json
import os
import subprocess
import sys
from collections import deque

from PIL import Image

# Where things are in the spell window, in screenshot pixels at the game's default UI size.
TITLE_HEIGHT = 36  # the title bar
TEXT_LEFT = 135  # the text column starts right of the icon
RIGHT_MARGIN = 58  # the scroll bar
BOTTOM_MARGIN = 12
ICON_BOX = (30, 40, 140, 150)
SCALE = 3
INK = 165  # brighter than this is text

# Brightness down the window's top edge (columns 200-700) and across its left edge (rows 60-300) in a screenshot
# taken right at the window. A screenshot with a margin round the window is lined up against these first, so
# the crops above land on the same parts of the window; one that doesn't line up isn't a spell window.
FRAME_ROWS = [121, 139, 137, 78, 51, 42, 27, 49, 61, 94, 87, 82, 70, 73, 69, 34, 40, 64, 67, 50, 38, 37, 45, 58, 62,
              57, 37, 36, 57, 81, 87, 91, 81, 57, 67, 108, 69, 62, 61, 36, 34, 41, 43, 45, 50, 52, 53, 53, 55, 60]
FRAME_COLS = [34, 42, 78, 69, 60, 41, 51, 48, 39, 49, 55, 53, 67, 66, 52, 95, 116, 83, 31, 67, 89, 88, 85, 77, 69, 69,
              97, 63, 44, 51, 57, 61, 64, 65, 65, 65, 66, 69, 71, 71]
FRAME_FIT = 12  # mean brightness difference above which the frame isn't there


def tesseract(image, psm):
    with io.BytesIO() as buffer:
        image.save(buffer, format='PNG')
        out = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', str(psm), 'tsv'], input=buffer.getvalue(),
                             capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    lines = {}
    for row in csv.DictReader(io.StringIO(out), delimiter='\t', quoting=csv.QUOTE_NONE):
        if row['level'] == '5' and row['text'].strip():
            key = (int(row['block_num']), int(row['par_num']), int(row['line_num']))
            lines.setdefault(key, []).append({'text': row['text'], 'conf': round(float(row['conf'])), 'top': int(row['top'])})
    result = []
    for words in sorted(lines.values(), key=lambda ws: min(w['top'] for w in ws)):
        result.append({'text': ' '.join(w['text'] for w in words), 'conf': round(sum(w['conf'] for w in words) / len(words)),
                       'words': [{'text': w['text'], 'conf': w['conf']} for w in words]})
    return result


def ink(image):
    grey = image.convert('L')
    return grey.resize((grey.width * SCALE, grey.height * SCALE), Image.LANCZOS).point(lambda v: 0 if v > INK else 255)


def best_shift(profile, reference, most=40):
    best = None
    for shift in range(-4, most):
        pairs = [(reference[i], profile[i + shift]) for i in range(len(reference)) if 0 <= i + shift < len(profile)]
        if len(pairs) < len(reference) // 2:
            continue
        score = sum(abs(a - b) for a, b in pairs) / len(pairs)
        if best is None or score < best[0]:
            best = (score, shift)
    return best or (999, 0)


# Where the window's top-left corner is in the screenshot, or None when there is no spell window frame.
def frame_offset(image):
    import numpy as np
    grey = np.asarray(image.convert('L')).astype(float)
    height, width = grey.shape
    if width < 700 or height < 300:
        return None
    rows_fit, dy = best_shift(grey[:, 200:700].mean(1), FRAME_ROWS)
    top = max(0, dy)
    cols_fit, dx = best_shift(grey[60 + top:300 + top, :].mean(0), FRAME_COLS)
    return (dx, dy) if rows_fit < FRAME_FIT and cols_fit < FRAME_FIT else None


def read(path):
    image = Image.open(path).convert('RGB')
    width, height = image.size
    if width < TEXT_LEFT + RIGHT_MARGIN + 50 or height < TITLE_HEIGHT + 40:
        return {'path': path, 'error': 'Too small to be a spell window'}
    offset = frame_offset(image)
    if offset is None:
        return {'path': path, 'title': '', 'lines': [], 'icon': None, 'window': False}
    dx, dy = offset
    title = tesseract(ink(image.crop((40 + dx, 4 + dy, width - 50, TITLE_HEIGHT - 2 + dy))), 7)
    body = tesseract(ink(image.crop((TEXT_LEFT + dx, TITLE_HEIGHT + dy, width - RIGHT_MARGIN, height - BOTTOM_MARGIN))), 6)
    x0, y0, x1, y1 = ICON_BOX
    icon = png(image.crop((x0 + dx, y0 + dy, x1 + dx, y1 + dy)))
    return {'path': path, 'title': ' '.join(line['text'] for line in title), 'lines': body, 'icon': icon, 'window': True}


# ---- Spellbook pages ----
TILE_MIN, TILE_MAX = 40, 170  # icon tile size in pixels
MATCH = 17  # mean colour difference (0-255) below which a tile is that wiki icon
INSET = 0.1  # the tile's grey frame
COMPARE = 16
WIKI_ICON = 63  # the wiki's spell icons are 63 x 63


def png(image):
    with io.BytesIO() as buffer:
        image.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode('ascii')


# Icon tiles: square blobs of colour on the spellbook's light grey stone.
def find_tiles(image):
    import numpy as np
    a = np.asarray(image).astype(float) / 255
    top, low = a.max(2), a.min(2)
    ink = ~((top > 0.5) & ((top - low) / np.maximum(top, 1e-6) < 0.2))
    small = ink[::2, ::2]
    height, width = small.shape
    seen = np.zeros(small.shape, bool)
    tiles = []
    for y, x in zip(*np.nonzero(small)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        queue, count = deque([(y, x)]), 0
        y0 = y1 = y
        x0 = x1 = x
        while queue:
            cy, cx = queue.popleft()
            count += 1
            y0, y1, x0, x1 = min(y0, cy), max(y1, cy), min(x0, cx), max(x1, cx)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < height and 0 <= nx < width and small[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        w, h = (x1 - x0 + 1) * 2, (y1 - y0 + 1) * 2
        if TILE_MIN <= w <= TILE_MAX and 0.8 <= w / h <= 1.25 and count * 4 / (w * h) > 0.6:
            tiles.append((int(x0) * 2, int(y0) * 2, int(x0) * 2 + w, int(y0) * 2 + h))
    return sorted(tiles, key=lambda b: (round(b[1] / ((b[3] - b[1]) * 0.75)), b[0]))


def label(image, box):
    x0, y0, x1, y1 = box
    size, middle = x1 - x0, (x0 + x1) / 2
    strip = image.crop((int(middle - size), y1, int(middle + size), int(y1 + size * 0.32))).convert('L')
    strip = strip.resize((strip.width * 4, strip.height * 4), Image.LANCZOS).point(lambda v: 0 if v < 120 else 255)
    with io.BytesIO() as buffer:
        strip.save(buffer, format='PNG')
        out = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', '7'], input=buffer.getvalue(), capture_output=True, check=True)
    return out.stdout.decode('utf-8', 'replace').strip()


def icon_vector(image):
    import numpy as np
    w, h = image.size
    d = int(min(w, h) * 0.14)
    return np.asarray(image.convert('RGB').crop((d, d, w - d, h - d)).resize((COMPARE, COMPARE), Image.BILINEAR)).astype(float)


_wiki_icons = None


def wiki_icons(folder):
    global _wiki_icons
    if _wiki_icons is None:
        _wiki_icons = []
        with open(os.path.join(folder, 'catalog.json')) as f:
            for entry in json.load(f)['icons']:
                if entry.get('wikiName'):
                    try:
                        _wiki_icons.append((entry['wikiName'], icon_vector(Image.open(os.path.join(folder, entry['file'])))))
                    except OSError:
                        pass
    return _wiki_icons


def read_book(image, icons):
    import numpy as np
    found = []
    for box in find_tiles(image):
        x0, y0, x1, y1 = box
        d = int((x1 - x0) * INSET)
        tile = image.crop((x0 + d, y0 + d, x1 - d, y1 - d)).resize((WIKI_ICON, WIKI_ICON), Image.LANCZOS)
        entry = {'label': label(image, box), 'icon': png(tile), 'matches': []}
        if icons:
            vector = icon_vector(image.crop(box))
            scores = sorted((float(np.abs(vector - v).mean()), name) for name, v in wiki_icons(icons))
            entry['matches'] = [{'wikiName': name, 'distance': round(score, 1)} for score, name in scores[:4]]
            entry['match'] = entry['matches'][0]['wikiName'] if scores and scores[0][0] < MATCH else None
        found.append(entry)
    return found if len(found) >= 3 else []


def main():
    args, icons = sys.argv[1:], None
    if args[:1] == ['--icons']:
        icons, args = args[1], args[2:]
    for path in args:
        try:
            result = read(path)
            try:
                result['book'] = read_book(Image.open(path).convert('RGB'), icons)
            except ImportError:
                result['book'] = []
                result['bookError'] = 'Reading spellbook icons needs numpy (python-numpy)'
        except ImportError:
            result = {'path': path, 'error': 'The Wiki helper needs numpy (python-numpy)'}
        except FileNotFoundError as error:
            result = {'path': path, 'error': 'Tesseract is not installed' if 'tesseract' in str(error) else str(error)}
        except Exception as error:  # an unreadable image shouldn't stop the others
            result = {'path': path, 'error': str(error)}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
