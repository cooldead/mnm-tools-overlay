#!/usr/bin/env python3
"""Copies the pixels under a framed button from the Monsters & Memories window, to use as an ability's icon.

Usage: grab.py X Y WIDTH HEIGHT (X11 root pixels). Prints one JSON line: {"width", "height", "bgrx"} with the
pixels base64-encoded as 4 bytes each (blue, green, red, unused), or {"error"}.

Only reads what the game window is showing, like a screenshot of that spot. On XWayland the root window can't
be read, so the pixels come from the game's own window, which also works while other windows cover it.
"""
import base64
import json
import sys

from Xlib import X, display

GAME_CLASSES = ('monstersandmemories', 'mnm.exe')  # same as keywatch.py


def find_game(window):
    for child in window.query_tree().children:
        try:
            if any(c in ' '.join(child.get_wm_class() or ()).lower() for c in GAME_CLASSES):
                return child
        except Exception:
            pass  # window vanished while we looked
        found = find_game(child)
        if found:
            return found
    return None


def main(x, y, width, height):
    d = display.Display()
    root = d.screen().root
    game = find_game(root)
    if not game:
        return {'error': 'The Monsters & Memories window isn\'t open.'}
    origin = game.translate_coords(root, 0, 0)  # root (0,0) in game-window coordinates
    gx, gy = x + origin.x, y + origin.y
    geometry = game.get_geometry()
    if gx < 0 or gy < 0 or gx + width > geometry.width or gy + height > geometry.height:
        return {'error': 'The frame isn\'t inside the game window. Frame the button again where the game shows it.'}
    image = game.get_image(gx, gy, width, height, X.ZPixmap, 0xffffffff)
    if image.depth not in (24, 32):
        return {'error': f'Unsupported window depth {image.depth}'}
    return {'width': width, 'height': height, 'bgrx': base64.b64encode(image.data).decode('ascii')}


if __name__ == '__main__':
    try:
        x, y, width, height = (int(round(float(v))) for v in sys.argv[1:5])
        result = main(x, y, max(1, width), max(1, height))
    except Exception as error:
        result = {'error': f'Could not read the game window: {error}'}
    print(json.dumps(result), flush=True)
