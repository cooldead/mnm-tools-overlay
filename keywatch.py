#!/usr/bin/env python3
"""Passive key and mouse-click watcher for MnM Tools.

Listens for XInput2 raw key and button presses on the X server (XWayland on a Wayland session) and prints one
JSON line per press. Raw events are only observed, never grabbed, so every key and click still reaches the game.
X11 only sees keys while an X11 window is focused, which includes the game when it runs through Proton.
"""
import json
import struct
import sys

from Xlib import X, XK, display
from Xlib.ext import xinput

GENERIC_EVENT = 35  # X.GenericEvent, missing from python-xlib
GAME_CLASSES = ('monstersandmemories', 'mnm.exe')
GAME_TITLES = ('Monsters and Memories',)
SCROLL_BUTTONS = range(4, 8)  # wheel up/down/left/right arrive as buttons 4-7

# keysym value -> name ("a", "F1", "KP_1"), built from Xlib's keysym tables
KEYSYM_NAMES = {}
for group in ('latin1', 'miscellany'):
    XK.load_keysym_group(group)
for name in dir(XK):
    if name.startswith('XK_'):
        KEYSYM_NAMES.setdefault(getattr(XK, name), name[3:])


def emit(message):
    print(json.dumps(message), flush=True)


def main():
    try:
        d = display.Display()
    except Exception as error:  # no X server (DISPLAY unset, XWayland not running)
        emit({'error': f'Could not connect to the X server: {error}'})
        return 1
    if not d.has_extension('XInputExtension'):
        emit({'error': 'The X server has no XInput extension'})
        return 1

    root = d.screen().root
    root.xinput_select_events([(xinput.AllMasterDevices, xinput.RawKeyPressMask | xinput.RawButtonPressMask)])
    active_atom = d.intern_atom('_NET_ACTIVE_WINDOW')
    name_atom = d.intern_atom('_NET_WM_NAME')
    utf8_atom = d.intern_atom('UTF8_STRING')
    game_cache = {}

    def game_focused():
        prop = root.get_full_property(active_atom, X.AnyPropertyType)
        wid = prop.value[0] if prop and len(prop.value) else 0
        if not wid:
            return False  # a Wayland window has focus (X11 normally sees no keys then anyway)
        if wid not in game_cache:
            try:
                window = d.create_resource_object('window', wid)
                wm_class = ' '.join(window.get_wm_class() or ()).lower()
                title = window.get_full_property(name_atom, utf8_atom)
                title = title.value.decode('utf-8', 'replace') if title else ''
                game_cache[wid] = any(c in wm_class for c in GAME_CLASSES) or title in GAME_TITLES
            except Exception:
                return False  # window vanished between the event and the lookup
        return game_cache[wid]

    emit({'ready': True})
    while True:
        event = d.next_event()
        if event.type == X.MappingNotify:
            d.refresh_keyboard_mapping(event)
            continue
        if event.type != GENERIC_EVENT or event.evtype not in (xinput.RawKeyPress, xinput.RawButtonPress):
            continue
        # python-xlib leaves raw events unparsed: deviceid(2) time(4) detail(4) ...
        detail = struct.unpack_from('<I', event.data, 6)[0]
        # Raw events carry no position, so a click's spot comes from the pointer (in X11 root pixels).
        pointer = root.query_pointer()
        mods = {
            'shift': bool(pointer.mask & X.ShiftMask),
            'ctrl': bool(pointer.mask & X.ControlMask),
            'alt': bool(pointer.mask & X.Mod1Mask),
        }
        if event.evtype == xinput.RawButtonPress:
            if detail in SCROLL_BUTTONS:
                continue
            emit({'button': detail, 'x': pointer.root_x, 'y': pointer.root_y, **mods, 'game': game_focused()})
            continue
        keysym = d.keycode_to_keysym(detail, 0)
        emit({
            'code': detail,
            'key': KEYSYM_NAMES.get(keysym, f'0x{keysym:x}' if keysym else f'code{detail}'),
            **mods,
            'game': game_focused(),
        })


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        pass
