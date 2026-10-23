# MnM Tools

Overlays for Monsters & Memories: ability cooldowns, follow-ups and counters, a quest tracker, a game clock, and
MnM Atlas and wiki maps with a minimap. It works on its own, with no OpenDeck or Stream Deck needed. (It used to be called
MnM Cooldowns; its settings move from `~/.config/mnm-cooldowns` to `~/.config/mnm-tools` the first time it starts
while no old copy is running.)

For the cooldowns, you list your abilities (icon, the key you use in game, and the cooldown in seconds). When you press that key in
game, its icon starts counting down.

## How it detects abilities

The game doesn't log ability use anywhere on disk, so the app watches your keypresses (and, optionally, clicks
on framed buttons) instead. `keywatch.py`
listens to XInput2 *raw* key events on XWayland. It only observes keys: it never grabs them, never sends input,
and never touches the game's memory or network traffic. Every key still reaches the game as normal.

On a Wayland session, X11 only sees keys while an X11 window is focused. The game (through Proton) is one,
so this works in game. By default only keys pressed in the Monsters & Memories window count.

Typing in chat counts too. Use **Reset all cooldowns and counters** in the tray menu if a chat message sets something off.

## Run

```sh
git clone https://github.com/cooldead/mnm-tools-overlay.git mnm-tools
cd mnm-tools
npm install
npm start
```

Needs `python3` with `python-xlib` (`pacman -S python-xlib`). Like MnM Map, the overlay shows over the game in
**Borderless Windowed** mode: KDE keeps an exclusive-fullscreen game above "keep on top" windows.

- **Settings:** click the tray icon, or start the app again while it's running.
- **Restart:** tray menu, **Restart** (for example after updating the app).
- **Move the overlays:** tray menu, **Move overlays**, drag them, then untick it.
- **Menu entry:** save this as `~/.local/share/applications/mnm-tools.desktop`, with `/path/to/mnm-tools` changed to
  where you put the app:

  ```ini
  [Desktop Entry]
  Type=Application
  Name=MnM Tools
  Exec=/path/to/mnm-tools/node_modules/electron/dist/electron /path/to/mnm-tools --ozone-platform=x11
  Path=/path/to/mnm-tools
  Icon=/path/to/mnm-tools/assets/icon.png
  Categories=Game;
  ```

## Profiles (one per character)

Each profile has its own abilities, follow-ups, counters and class/race/level for **Import for my class**.
Layout, sizes, overlay positions and the game clock are shared. Pick a profile under **Profile** at the top of the
settings or from the tray menu. **New…** starts an empty profile, **Copy…** duplicates the current one.

**Switch automatically** (on by default) reads the game's `Player.log` to see which character logged in, and
switches to the profile with that character's name. A desktop notification says when it does. The log names the
character on every zone change, so a switch only happens when a different character logs in (or after going back
to character select), and a profile you picked by hand stays put while you play.

- The first character to log in takes over your existing setup (the *Default* profile), since you most likely
  set it up for them. After that, a character's first login makes a new, empty profile named after them.
- Name a profile exactly like the character (e.g. *Brannoc*) for it to be picked automatically.
- Running cooldowns, counters and follow-ups are cleared when the profile changes.
- The log is looked for in the launcher's Proton prefix
  (`~/.local/share/mnm/mnm/pfx/drive_c/users/steamuser/AppData/LocalLow/Niche Worlds Cult/Monsters and Memories/Player.log`).
  Set `MNM_PLAYER_LOG` to use another path. Only the log is read; nothing in the game folder is changed.

## Clicking abilities (framed buttons)

If you click an ability on the game's hotbar instead of pressing its key, press **Frame** on that ability (or on a
follow-up) in the settings. The screen dims and you drag a box around the ability's button in game. Drag the box
to move it, use the arrow keys to nudge it and Shift+arrows to resize it, then press **Save** (or Enter). Esc
cancels, and **Remove frame** clears it. After that, a left click inside the box counts the same as the key. The
key still works too.

Clicks are watched the same way as keys: `keywatch.py` reads XInput2 raw button presses and the pointer position.
It only observes them, so every click still reaches the game. Right clicks and the scroll wheel are ignored.

**Icons from your hotbar:** once an ability (or counter) has a frame, **Grab from frame** in its icon picker copies
the picture under the frame from the game window, so the icon matches what the game shows, even for abilities the
wiki has no icon for. A preview lets you trim off the slot's border and key number before using it, and nothing
changes until you press **Use this icon**. Grab while the ability is ready, so the cooldown sweep isn't in the
picture. The game window has to be open, and the frame has to be inside it. `grab.py` reads only those pixels from
the game's window, like a screenshot of that spot; it doesn't touch the game's files or memory.

**Icons from MnM Icon Creator:** its **Add to MnM Tools** button saves spellbook icons in `custom-icons/` in the
data folder. They show in the icon picker under **Custom**, are used when you import or upgrade abilities, and replace
the wiki icon on abilities with the same name. Pictures you chose yourself (grabbed or custom images) are kept.

Under **Key and click watching**, **Framed buttons** sets whether the frames are invisible, flash green when
clicked (the default), or always show as a faint outline over the game. Frames are fixed spots on the screen, so
frame the buttons again after moving the game window, changing its resolution or rearranging the hotbar.

## Follow-ups

A follow-up is a timer between two keypresses: "when I press **this**, count down N seconds to my **next ability**".
A pop-up (styled like the old OpenDeck countdown overlay) shows the seconds and a draining bar over the next
ability's icon, flashes **GO**, then fades. Pressing the next ability's key clears it early, and pressing the
trigger again restarts it. For a chain A → B → C, add a follow-up for A (next: B) and one for B (next: C).

The pop-up has its own size and position (move it with **Move overlays** in the tray) and can fade out completely
or stay faintly visible between countdowns.

## Counters

A counter counts presses of a key (or clicks on its framed button) and goes back to 0 once a set number of
seconds pass. Pick when that time runs from: **after the last press** (each press adds one and starts the wait
over) or **after the first press** (presses still add one, but the reset stays fixed from the press that started
the count). Every counter gets its own
square in the counter overlay: its icon, the count, and a gold bar that drains until the reset. Add them under
**Counters** in the settings (icon, name, key, optional frame, and the reset time).

The overlay has four sizes and moves with **Move overlays**. A counter at 0 can stay visible, stay faint (the
default) or fade out completely. **Reset all cooldowns and counters** in the tray menu sets every count back to 0.

## Game clock

**Show game clock** in the tray menu (or under **Game clock** in the settings) turns on a small clock with the
in-game time, the day of the 20-day cycle and the game date (for example *Matsden, the 3rd of Sheafall*). It's
off by default. It is worked out the same way as the clock in the
[wiki's](https://monstersandmemories.miraheze.org/wiki/Main_Page) sidebar: 20 game days pass per real day,
starting at midnight UTC, and the date is today's UTC date with the weekday and month given their game names.
Nothing is read from the game. It has three sizes, the date line can be turned off, and it moves with
**Move overlays** like the other overlays.

## Import for my class

**Import for my class…** (or **Check for new abilities…** in the tray menu) asks for your class, optional race
and level, then lists what you should have from the wiki spell list:

- **New abilities with a cooldown:** ticked. Spells with ranks only bring the best rank you can use.
- **No recast listed:** unticked, so the bar isn't flooded with tiles that have no timer. Tick any you want and
  enter their cooldown yourself.
- **Upgrades:** after you level up, a better rank of an ability you have replaces it and keeps its key.

Nothing changes until **Add selected**. **Update from wiki** in the dialog refreshes the spell list first.

## Spells from the wiki

**+ Add from wiki** lists every spell and ability on the
[Monsters & Memories wiki](https://monstersandmemories.miraheze.org/wiki/Category:Spells_%26_Abilities)
(about 1,900), with a class filter. Picking one fills in its name, icon and cooldown (its recast time), or its
duration as a buff timer. You only set the key.

Which abilities a class has, and at what level, comes from the class's own wiki page (for example
[Beastmaster](https://monstersandmemories.miraheze.org/wiki/Beastmaster)), because class reworks are written
there first and many spell pages still name classes that no longer get the spell. Icons, cast times and recasts
come from the spell pages. An ability that's only on a class page has no recast to fill in; a new rank of a
spell line ("Maul IV") shows that line's icon. If a class page can't be read, its spell pages are used instead.

Most wiki pages leave the recast blank, often because the spell only has the global cooldown. Those are added
with the cooldown left blank (highlighted) for you to fill in; nothing is guessed. A few wiki pages have no icon.

The list ships with the app (`data/spells.json`). **Update from wiki** in that dialog fetches a fresh copy into
`~/.config/mnm-tools/`, downloading only icons it doesn't already have. To refresh the bundled copy and its
icons (`icons/spells/`), run `npm run update-spells`.

## Wiki helper (spell screenshots)

**Wiki helper (spell screenshots)…** in the tray menu turns screenshots of the game's spell windows into wiki
edits. It needs Tesseract, Pillow and numpy (`pacman -S tesseract tesseract-data-eng python-pillow python-numpy`).

1. Open a spell's window in game and screenshot the whole window (Spectacle's window or region mode). If it
   scrolls, scroll down and take another. The screenshots of one spell are joined where they overlap, in
   whatever order you took them; if they don't overlap, the helper says a line may be missing.
2. Add them with **Add screenshots…**, by dropping them on the window, or tick **Read new screenshots from** to
   pick up every screenshot saved to that folder while the window is open.
3. Each spell gets a card: the text read from the screenshots (shaky readings in orange), and a table of the
   spell page's fields, with what the wiki has now and what the game says. Only fields that differ are ticked.
   Fields marked **(check)** are worded differently by the game and the wiki, so they only fill blanks unless
   you tick them. Every value can be corrected before it's used. "Requires Line of Sight" and the like go into
   `other`; lines the helper doesn't know are listed, never dropped.
4. **Page text to publish** shows the exact text. For a page that exists only the ticked fields change; for a
   new page it's a whole `{{Spellpagesmart}}` page with its categories.
5. **Icons:** add a screenshot of a spellbook page too. There the icons sit on their coloured backgrounds, like
   the wiki's icon files, so each one is matched with the wiki's icons by its picture and its name under it.
   A match becomes the page's `spellicon` (and corrects a page whose icon is wrong). An icon the wiki doesn't
   have yet can be uploaded with **Upload icon to the wiki…** (a 63 x 63 PNG in Category:Spell Icons, under the
   file name you give it) and is then used on the page; a name that's taken is refused, and if the same picture
   is already on the wiki that file is used instead. **Save icon image…** saves the same PNG to upload by hand. (The spell
   window's own icon has no background, so it's only shown, not matched.)
6. **Class page:** with your class chosen at the top, the window's "Required Level" says where the ability
   belongs on your class page. If it isn't listed, the helper makes the row in that page's own layout and can
   add it under the right level (making the level's section if the page has none yet).

Then either **Copy** the text (or **Open the edit page**, which copies it too) and paste it in yourself, or
**Publish**, which saves that one edit under your own wiki account after you confirm it. Publishing uses a bot
password from the wiki's Special:BotPasswords page, kept in your desktop keyring if you tick **Remember**. An
edit is refused, not forced, if someone changed the page after the helper read it. The helper never edits on
its own: every edit is one you looked at and pressed Publish for.

Reading screenshots is all it does with the game: it doesn't read game files, memory or traffic.

## Quest tracker

Open it from the tray (**Quest tracker…**) or the **Quests** button in Settings. Pick a zone, then a quest that
starts in that zone, and its walkthrough from the wiki is shown as steps:

- Things to say show as blue chips and commands (`/look`, `/throw wall`, …) as purple ones. Click one to copy it
  (say lines copy as `/say …`), then paste it into the game's chat.
- Hand-ins ("Give Torn Note to Sinastin Aspenleaf") are highlighted and marked **IN GAME**, since you do those yourself.
- Items and experience you receive are listed small, in green, so you can tell a step worked. NPC dialogue, emotes
  and notes you read are hidden unless you tick **Show dialogue**.
- Tick steps off as you go. The chosen quest and ticked steps belong to the profile, so each character keeps their
  own progress. Quests with a quick guide on the wiki can switch to its shorter checklist.
- **<Class> quests only** hides other classes' quests, using the class set for importing abilities in this profile.
- The window stays above the game unless you untick **On top**.

The walkthroughs are read from every page in the wiki's Category:Quests (`quests.js`). The pages are written by
hand, so the parser goes by the usual patterns (`You say, "…"`, `{{Chat|say|…}}`, `/command` in the text,
"Give … to …"); a step written some other way still shows, just without a copy chip or highlight. A snapshot is
bundled in `data/quests.json` (`npm run update-quests` refreshes it), and **Update from wiki** in the tracker
saves a newer copy in the app's data folder.

## Maps (MnM Atlas and the wiki) and the minimap

Maps come from [MnM Atlas](https://www.mnmatlas.com/), a fan atlas of illustrated maps. They are shown live from
the site, never copied into the app; its credits and licences are on each map.

- **Maps (atlas and wiki)…** (tray menu, or the **Map** tab in Settings) opens the map window. Its **MnM Atlas** /
  **Wiki** tabs pick the source. The atlas works as on the website (search, markers, notes, sign-in);
  Alt+Left / Alt+Right go back and forward, F5 reloads. It opens on the map of the zone you are in, and
  **Show on minimap** puts the map you're looking at on the minimap at the same spot.
- **Show minimap** puts the atlas's one-map view over the game, round or square, see-through and click-through.
  When you zone, it switches to that zone's map (from `[Client][ZONE] Start zoning process to <zone>` in
  `Player.log`); zones the atlas has no map for leave the last map up.
- The **Wiki** tab shows the zone maps players have drawn for the
  [Monsters & Memories Wiki](https://monstersandmemories.miraheze.org/) (CC BY-SA 4.0; each map's artist and the
  licence are shown under it). Pick a map, drag to pan, scroll or +/− to zoom, 0 to fit. When a zone has more than one, the one you pick becomes that zone's map. The wiki has no map
  category, so maps are found by file name (`wikimaps.js`): files with "map" in the name that a zone page shows or
  whose name spells a zone, minus placeholders. The list is bundled (`data/wiki-maps.json`,
  `npm run update-maps`) and refreshed from the wiki once a day; the images load from the wiki, never copied.
- **Minimap uses** (Map tab, or the tray's **Minimap map** menu): atlas maps first or wiki maps first when you
  zone. If the preferred source has no map of the zone, the other one is used.
- The game doesn't log where your character is, so the minimap can't follow you inside a zone. Press your
  **minimap key** (set it in the Map tab) or use **Use the minimap** in the tray to pan and zoom it, then press the
  key again to lock it. Each map remembers where you left it.
- Move and resize it with **Move overlays** (drag it, or drag its corner).
- Notes you add in the atlas are kept in this app's own browser profile. To bring notes over from your web browser,
  use the atlas's **Export notes** there and **Import notes** here.

## Options

- Add, remove and reorder abilities; pick from 759 bundled wiki icons or your own image.
- Horizontal or vertical layout, four icon sizes, optional key labels.
- When an ability is ready: show, dim or hide its icon.
- Stacking: only abilities on cooldown are shown, packed side by side (or top to bottom) in the order they
  started. One cooldown takes one square, and the bar fades out completely when nothing is cooling down.
- Pressing again during a cooldown: ignore it (like the game) or restart the timer.
- Loading screens (on by default): the cooldown bar, follow-up pop-up and counters hide while the game shows a
  loading screen. This is read from `Player.log`: the screen starts at `Received Preparing Zone` (or `[Client][ZONE] Start zoning process`) and
  ends at `Done waiting, hide LoadingPanel`, or at a disconnect or character select. The log is checked every half
  second, so the overlays can disappear a moment after the loading screen appears. Timers keep counting while
  hidden, and **Move overlays** still shows everything. The game clock hides too unless you untick its own
  **Hide while loading** option.

Settings are saved to `~/.config/mnm-tools/settings.json`. Saves are atomic (temp file, then rename), and each start that reads the file cleanly copies it to `settings.json.bak`. If the file can't be read, it is kept as `settings.json.broken-<time>`, the backup is loaded, and a dialog says so.

## Tests

```sh
npm test
```

`MNM_KEYWATCH=/path/to/script.py npm start` runs a different watcher script, e.g. one that replays presses.

Icons: see NOTICE.md.
