const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, screen, dialog, nativeImage, clipboard, shell, session, safeStorage } = require('electron');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const core = require('./core');
const wiki = require('./wiki');
const questWiki = require('./quests');
const wikiMaps = require('./wikimaps');
const wikiEdit = require('./wikiedit');
const spellshot = require('./spellshot');
const store = require('./store');

// Wayland doesn't let apps place their own windows or keep them on top, and the key watcher needs X11,
// so run through XWayland. Like MnM Map, the overlay shows over the game in Borderless Windowed mode.
app.commandLine.appendSwitch('ozone-platform', 'x11');
// Transparent always-on-top windows can crash the GPU process on some drivers; the overlay doesn't need it.
app.disableHardwareAcceleration();

// ---- Data folder ----
// The app used to be called MnM Cooldowns, with its data in ~/.config/mnm-cooldowns. The folder moves to
// ~/.config/mnm-tools the first time it isn't in use, and saved paths into it (custom icons) are updated.
const DATA_DIR = path.join(app.getPath('appData'), 'mnm-tools');
const OLD_DATA_DIR = path.join(app.getPath('appData'), 'mnm-cooldowns');
function oldCopyRunning() {
  try {
    // Chromium's lock is a symlink to "<host>-<pid>"; a crash can leave a stale one behind.
    const pid = Number(fs.readlinkSync(path.join(OLD_DATA_DIR, 'SingletonLock')).split('-').pop());
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}
function dataDir() {
  if (fs.existsSync(DATA_DIR) || !fs.existsSync(OLD_DATA_DIR)) return DATA_DIR;
  if (oldCopyRunning()) return OLD_DATA_DIR;
  try { fs.renameSync(OLD_DATA_DIR, DATA_DIR); } catch (error) { console.error('Could not move the data folder:', error.message); return OLD_DATA_DIR; }
  for (const name of ['settings.json', 'spells.json', 'quests.json']) {
    const file = path.join(DATA_DIR, name);
    try { fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(JSON.stringify(OLD_DATA_DIR).slice(1, -1)).join(JSON.stringify(DATA_DIR).slice(1, -1))); } catch { /* not there */ }
  }
  return DATA_DIR;
}
app.setPath('userData', dataDir());

const ICONS_DIR = path.join(__dirname, 'icons');
// MNM_KEYWATCH swaps in another watcher script, e.g. one that replays presses for testing.
const KEYWATCH = process.env.MNM_KEYWATCH || path.join(__dirname, 'keywatch.py');
const DEFAULTS = { abilities: [], layout: 'horizontal', size: 'Medium', ready: 'show', showKeys: true, gameOnly: true, repress: 'ignore', spellClass: '',
  followUps: [], followSize: 'Small', followIdle: 'hide', stack: false, showFrames: 'flash',
  clock: false, clockSize: 'Medium', clockDate: true, clockHideWhileLoading: true,
  counters: [], counterSize: 'Small', counterIdle: 'dim', autoProfile: true, hideWhileLoading: true,
  quests: { zone: '', title: '', view: 'full', done: {} }, questOnTop: true, questDialogue: false, questClassOnly: false, questBounds: null,
  character: { cls: '', race: '', level: 1 },
  minimap: false, minimapShape: 'round', minimapOpacity: 0.9, useKey: null, minimapZoomInKey: null, minimapZoomOutKey: null, minimapFollowZone: true, minimapHideWhileLoading: true, minimapMouse: true,
  minimapBounds: null, minimapMap: 'world', minimapViews: {}, atlasMap: '', atlasViews: {}, atlasBounds: null,
  atlasFollowZone: true, minimapSource: 'atlas', mapsSource: 'atlas', wikiMap: '', wikiViews: {}, wikiZoneMaps: {},
  questOverlay: false, questOpacity: 0.85, questTextScale: 1, questOverlayBounds: null,
  wikiHelperWatch: false, wikiHelperFolder: '', wikiHelperBounds: null };

let overlay, followWin, counterWin, clockWin, framesWin, settingsWin, questsWin, minimapWin, mapsWin, wikiHelperWin, tray, settings, watcherChild, moving = false;
let watcher = { status: 'starting', message: 'Starting the key watcher…' };
let profileStamp = 0, loggedIn = null; // profileStamp tells the settings window to reload after a switch
let recording = null; // {resolve, timer} while the settings window waits for a key
const cooldowns = new core.Cooldowns();
const followUps = new core.FollowUps();
const counters = new core.Counters();

// ---- Settings ----
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settingsProblem = null; // what loadSettings had to do with an unreadable settings.json, told once the tray is up
function loadSettings() {
  const { data, problem, broken } = store.loadJson(settingsFile());
  if (problem === 'restored') settingsProblem = `settings.json couldn't be read, so the backup from the last start was loaded.${broken ? ` The broken file was kept as ${path.basename(broken)}.` : ''}`;
  if (problem === 'lost') settingsProblem = `settings.json and its backup couldn't be read, so the settings start from blank.${broken ? ` The broken file was kept as ${path.basename(broken)}.` : ''}`;
  return core.withProfiles({ ...DEFAULTS, ...(data || {}) });
}
function saveSettings() {
  settings = core.storeProfile(settings);
  try { store.writeAtomic(settingsFile(), JSON.stringify(settings, null, 2)); } catch (error) { console.error('Could not save settings:', error.message); }
}

function publicState() {
  return {
    settings,
    labels: { ...Object.fromEntries([...settings.abilities, ...settings.followUps, ...settings.counters].map((a) => [a.id, core.bindingLabel(a.key)])),
      ...Object.fromEntries(settings.counters.filter((c) => c.clearKey).map((c) => [c.id + ':clear', core.bindingLabel(c.clearKey)])),
      ...Object.fromEntries(MAP_KEYS.map((k) => [k, core.bindingLabel(settings[k])])) },
    watcher,
    moving,
    counterLayout: core.counterLayout(settings.counters, settings),
    profileStamp,
    loggedIn,
    playerLog: playerLog(),
  };
}

function broadcast() {
  const state = publicState();
  for (const w of [overlay, followWin, counterWin, clockWin, framesWin, settingsWin, questsWin, minimapWin]) if (w && !w.isDestroyed()) w.webContents.send('state', state);
}

// ---- Overlay window ----
// Saved position if it still lands on a screen, otherwise near the top centre of the primary display.
function overlayBounds() {
  const { width, height } = core.overlaySize(settings.abilities.length, settings);
  const { x, y } = settings;
  const onScreen = typeof x === 'number' && screen.getAllDisplays().some(({ bounds: b }) =>
    x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y);
  if (onScreen) return { x, y, width, height };
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + 120, width, height };
}

// A transparent, click-through, always-on-top window that never takes focus from the game.
function overlayWindow(bounds, title, webPreferences = {}) {
  const win = new BrowserWindow({
    ...bounds,
    title,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, ...webPreferences },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true);
  return win;
}

function createOverlay() {
  overlay = overlayWindow(overlayBounds(), 'MnM Cooldowns');
  overlay.webContents.on('did-finish-load', () => { broadcast(); sendCooldowns(); refreshOverlay(); });
  overlay.loadFile('renderer/overlay.html', { query: { icons: pathToFileURL(ICONS_DIR).href } });
}

// Resize to fit the abilities (keeping the top-left corner) and hide it when there is nothing to show.
function refreshOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  const { x, y } = overlay.getBounds();
  const { width, height } = core.overlaySize(settings.abilities.length, settings);
  // setBounds with the full size: setPosition alone lets fractional display scaling grow the window.
  overlay.setBounds({ x, y, width, height });
  overlay.webContents.send('loading', hiddenForLoading());
  if ((settings.abilities.length || moving)) overlay.showInactive();
  else overlay.hide();
}

// ---- Follow-up pop-up window ----
// Saved position if it still lands on a screen, otherwise below the cooldown bar's default spot.
function followBounds() {
  const side = core.FOLLOW_SIZES[settings.followSize] || core.FOLLOW_SIZES.Small;
  const { fx: x, fy: y } = settings;
  const onScreen = typeof x === 'number' && screen.getAllDisplays().some(({ bounds: b }) =>
    x < b.x + b.width && x + side > b.x && y < b.y + b.height && y + side > b.y);
  if (onScreen) return { x, y, width: side, height: side };
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(area.x + (area.width - side) / 2), y: area.y + 220, width: side, height: side };
}

function createFollowWindow() {
  followWin = overlayWindow(followBounds(), 'MnM Follow-up');
  followWin.webContents.on('did-finish-load', () => { broadcast(); refreshFollow(); });
  followWin.loadFile('renderer/follow.html', { query: { icons: pathToFileURL(ICONS_DIR).href } });
}

// The pop-up stays mapped (it fades itself out when idle) whenever there are follow-ups to show.
function refreshFollow() {
  if (!followWin || followWin.isDestroyed()) return;
  const side = core.FOLLOW_SIZES[settings.followSize] || core.FOLLOW_SIZES.Small;
  const { x, y } = followWin.getBounds();
  followWin.setBounds({ x, y, width: side, height: side });
  followWin.webContents.send('loading', hiddenForLoading());
  if ((settings.followUps.length || moving)) followWin.showInactive();
  else followWin.hide();
}

function sendFollow(message) {
  if (followWin && !followWin.isDestroyed()) followWin.webContents.send('follow', message);
}

function sendCooldowns() {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('cooldowns', cooldowns.state());
}

// ---- Counter window ----
// Saved position if it still lands on a screen, otherwise below the follow-up pop-up's default spot.
function counterBounds() {
  const { width, height } = core.counterSize(settings.counters, settings);
  const { kx: x, ky: y } = settings;
  const onScreen = typeof x === 'number' && screen.getAllDisplays().some(({ bounds: b }) =>
    x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y);
  if (onScreen) return { x, y, width, height };
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + 360, width, height };
}

function createCounterWindow() {
  counterWin = overlayWindow(counterBounds(), 'MnM Counters');
  counterWin.webContents.on('did-finish-load', () => { broadcast(); sendCounters(); refreshCounters(); });
  counterWin.loadFile('renderer/counter.html', { query: { icons: pathToFileURL(ICONS_DIR).href } });
}

function refreshCounters() {
  if (!counterWin || counterWin.isDestroyed()) return;
  const { x, y } = counterWin.getBounds();
  counterWin.setBounds({ x, y, ...core.counterSize(settings.counters, settings) });
  counterWin.webContents.send('loading', hiddenForLoading());
  if (settings.counters.length) counterWin.showInactive();
  else counterWin.hide();
}

function sendCounters() {
  if (counterWin && !counterWin.isDestroyed()) counterWin.webContents.send('counters', counters.state());
}

// ---- Game clock window ----
// Saved position if it still lands on a screen, otherwise at the top right of the primary display.
function clockBounds() {
  const { width, height } = core.clockSize(settings);
  const { cx: x, cy: y } = settings;
  const onScreen = typeof x === 'number' && screen.getAllDisplays().some(({ bounds: b }) =>
    x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y);
  if (onScreen) return { x, y, width, height };
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - width - 40, y: area.y + 40, width, height };
}

function createClockWindow() {
  clockWin = overlayWindow(clockBounds(), 'MnM Game Clock');
  clockWin.webContents.on('did-finish-load', () => { broadcast(); refreshClock(); });
  clockWin.loadFile('renderer/clock.html');
}

function refreshClock() {
  if (!clockWin || clockWin.isDestroyed()) return;
  const { x, y } = clockWin.getBounds();
  clockWin.setBounds({ x, y, ...core.clockSize(settings) });
  clockWin.webContents.send('loading', loadingScreen && settings.clockHideWhileLoading && !moving);
  if (settings.clock) clockWin.showInactive();
  else clockWin.hide();
}

function setClock(on) {
  settings.clock = on;
  saveSettings();
  refreshClock();
  broadcast();
  updateTray();
}

// ---- Framed buttons ----
// Frames are stored in Electron's screen coordinates (DIPs). The watcher reports clicks in X11 pixels, and on X11
// Electron uses one scale factor for every screen (Xft.dpi), so DIPs = pixels / that factor.
const allFrames = () => [...settings.abilities, ...settings.followUps, ...settings.counters].map((item) => item.frame).filter(Boolean);
const FRAME_PAD = 16; // room for the click flash's glow
let frameEdit = null; // {resolve} while the editor is open

function createFramesWindow() {
  framesWin = overlayWindow(core.framesBounds(allFrames(), FRAME_PAD) || { x: 0, y: 0, width: 1, height: 1 }, 'MnM Frames');
  framesWin.webContents.on('did-finish-load', () => { broadcast(); refreshFrames(); });
  framesWin.loadFile('renderer/frames.html');
}

// Outside the editor the window only covers the frames, and is hidden when there are none or they are turned off.
function refreshFrames() {
  if (!framesWin || framesWin.isDestroyed() || frameEdit) return;
  const bounds = core.framesBounds(allFrames(), FRAME_PAD);
  if (!bounds || settings.showFrames === 'hide') return framesWin.hide();
  framesWin.setBounds(bounds);
  framesWin.webContents.send('frames', { type: 'show', origin: { x: bounds.x, y: bounds.y } });
  framesWin.showInactive();
}

// Opens the editor over every screen to draw `item`'s frame. Resolves {frame} (null frame = remove) or null.
ipcMain.handle('edit-frame', (event, { id, name, frame }) => {
  endFrameEdit(null);
  const displays = screen.getAllDisplays();
  const all = core.framesBounds(displays.map((d) => d.bounds));
  // Instructions go at the top of the screen the pointer is on.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  framesWin.setBounds(all);
  framesWin.setIgnoreMouseEvents(false);
  framesWin.setFocusable(true);
  framesWin.webContents.send('frames', { type: 'edit', id, name, frame, origin: { x: all.x, y: all.y },
    banner: { x: area.x - all.x, y: area.y - all.y, width: area.width, height: area.height } });
  framesWin.show();
  framesWin.focus();
  return new Promise((resolve) => { frameEdit = { resolve }; });
});
ipcMain.on('frame-done', (event, result) => endFrameEdit(result));

function endFrameEdit(result) {
  if (!frameEdit) return;
  const { resolve } = frameEdit;
  frameEdit = null;
  framesWin.setIgnoreMouseEvents(true);
  framesWin.setFocusable(false);
  refreshFrames();
  settingsWin?.focus();
  resolve(result);
}

function onClick(message) {
  if (frameEdit || (settings.gameOnly && !message.game)) return;
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  const click = { ...message, x: message.x / scale, y: message.y / scale };
  const hit = [...settings.abilities, ...settings.followUps, ...settings.counters].filter((item) => core.triggers(item, click)).map((item) => item.id);
  if (!hit.length) return;
  if (framesWin && !framesWin.isDestroyed()) framesWin.webContents.send('frames', { type: 'hit', ids: hit });
  onInput(click);
}

// Dragging is done here rather than with a CSS drag region, which doesn't work on a non-focusable X11 window.
let dragFrom = null;
ipcMain.on('drag-start', (event, x, y, mode) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // The minimap and quest overlay can be moved while in use, as well as in move mode.
  const inUse = using && ((questOverlayOpen() && win === questsWin) || (settings.minimap && win === minimapWin));
  if ((moving || inUse) && win) dragFrom = { win, x, y, bounds: win.getBounds(), resize: mode === 'resize', square: win === minimapWin };
});
ipcMain.on('drag-move', (event, x, y) => {
  if (!dragFrom) return;
  const { win, bounds } = dragFrom;
  const dx = Math.round(x - dragFrom.x), dy = Math.round(y - dragFrom.y);
  if (dragFrom.resize && dragFrom.square) {
    // The minimap stays square so a round one stays round.
    const side = Math.max(MINIMAP_MIN, Math.max(bounds.width + dx, bounds.height + dy));
    win.setBounds({ x: bounds.x, y: bounds.y, width: side, height: side });
  } else if (dragFrom.resize) {
    win.setBounds({ x: bounds.x, y: bounds.y, width: Math.max(QUEST_MIN.width, bounds.width + dx), height: Math.max(QUEST_MIN.height, bounds.height + dy) });
  } else win.setBounds({ x: bounds.x + dx, y: bounds.y + dy, width: bounds.width, height: bounds.height });
});
ipcMain.on('drag-end', () => {
  if (!dragFrom) return;
  if (dragFrom.win === minimapWin || dragFrom.win === questsWin) {
    settings[dragFrom.win === minimapWin ? 'minimapBounds' : 'questOverlayBounds'] = dragFrom.win.getBounds();
    dragFrom = null;
    return saveSettings();
  }
  const { x, y } = dragFrom.win.getBounds();
  const keys = { [followWin.id]: ['fx', 'fy'], [counterWin.id]: ['kx', 'ky'], [clockWin.id]: ['cx', 'cy'] }[dragFrom.win.id] || ['x', 'y'];
  Object.assign(settings, { [keys[0]]: x, [keys[1]]: y });
  dragFrom = null;
  saveSettings();
});

// Move mode makes the overlay visible and draggable; otherwise clicks pass straight through to the game.
function setMoving(on) {
  moving = on;
  for (const win of [overlay, followWin, counterWin, clockWin]) {
    win.setIgnoreMouseEvents(!on);
    win.setFocusable(on);
  }
  if (on) using = false;
  refreshMinimap();
  refreshQuestOverlay();
  refreshOverlay();
  refreshFollow();
  refreshCounters();
  refreshClock();
  broadcast();
  updateTray();
}

// ---- MnM Atlas: the full map window and the minimap ----
// Both show mnmatlas.com live (its maps aren't copied) in their own browser profile, which keeps the atlas's
// personal notes. The game doesn't log where you are, so the minimap follows the zone and you pan it yourself.
const ATLAS_PARTITION = 'persist:mnmatlas';
const MINIMAP_MIN = 120;
const MAP_KEYS = ['useKey', 'minimapZoomInKey', 'minimapZoomOutKey'];
const QUEST_MIN = { width: 150, height: 70 }; // small enough for just the next step or two
const BUNDLED_ATLAS_MAPS = path.join(__dirname, 'data', 'atlas-maps.json');
const userAtlasMapsFile = () => path.join(app.getPath('userData'), 'atlas-maps.json');
// Signing in to the atlas goes through Discord and Supabase, so the atlas window may visit those too.
const SIGN_IN_HOSTS = /(^|\.)(discord\.com|supabase\.co)$/;
let atlasMaps = [], using = false, minimapShownMap = null, minimapNote = '', currentZone = null;
// The minimap hides the atlas's title box and frame, and its toolbar too unless you are using it. The credit line stays.
const MINIMAP_CSS = '.map-title, .frame-border { display: none !important; }';
const MINIMAP_LOCKED_CSS = '.map-tools, .level-controls { display: none !important; }';
let minimapGuest = null, lockedCss = null;
// The atlas's one-map view only zooms with the wheel after the map is pressed (so a host page can scroll past
// it). The minimap has no page to scroll, so the pointer coming over the map counts as that press.
const WHEEL_ZOOM_JS = `(() => {
  const box = document.getElementById('map');
  if (box) box.addEventListener('pointerenter', () => box.dispatchEvent(new PointerEvent('pointerdown')));
})()`;

let saveTimer = null;
function saveSettingsSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSettings, 1000); }

// The map list (ids and titles) comes from the atlas, with the bundled copy until it answers.
function setUpAtlas() {
  atlasMaps = (readJson(userAtlasMapsFile()) || readJson(BUNDLED_ATLAS_MAPS) || { maps: [] }).maps;
  session.fromPartition(ATLAS_PARTITION).fetch(core.ATLAS + '/data/maps.json').then((r) => r.json()).then((data) => {
    const maps = (data.maps || []).filter((m) => /^[a-z0-9-]+$/.test(m.id) && typeof m.title === 'string').map(({ id, title }) => ({ id, title }));
    if (!maps.length) return;
    atlasMaps = maps;
    fs.writeFileSync(userAtlasMapsFile(), JSON.stringify({ fetchedAt: new Date().toISOString(), maps }));
    updateTray();
  }).catch((error) => console.error('Could not fetch the atlas map list:', error.message));
}

// Keeps atlas pages on the atlas: other links open in the default browser, atlas links in the atlas window.
// `onView` hears the map and view each time the atlas updates its address (it does after every pan and zoom).
function guardAtlas(contents, onView, { signIn = false } = {}) {
  const allowed = (url) => {
    if (core.isAtlasUrl(url)) return true;
    try { return signIn && SIGN_IN_HOSTS.test(new URL(url).hostname); } catch { return false; }
  };
  const external = (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); };
  contents.setWindowOpenHandler(({ url }) => {
    if (core.isAtlasUrl(url)) openAtlas(url);
    else external(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!allowed(url)) { event.preventDefault(); external(url); } });
  const track = (url) => { const found = core.atlasView(url); if (found) onView(found); };
  contents.on('did-navigate', (event, url) => track(url));
  contents.on('did-navigate-in-page', (event, url, isMainFrame) => { if (isMainFrame) track(url); });
}

// The map for the zone you are in, if the atlas has one.
const zoneMap = () => currentZone && core.atlasMapForZone(currentZone, atlasMaps.map((m) => m.id));


// ---- Wiki maps: zone maps players drew for the M&M wiki ----
// Plain pictures, shown from the wiki's file server (not copied) with a credit line, as CC BY-SA asks.
// The list of maps is bundled (data/wiki-maps.json) and refreshed from the wiki once a day.
const BUNDLED_WIKI_MAPS = path.join(__dirname, 'data', 'wiki-maps.json');
const userWikiMapsFile = () => path.join(app.getPath('userData'), 'wiki-maps.json');
const WIKI_MAPS_MAX_AGE = 24 * 60 * 60 * 1000;
let wikiMapList = [];

function setUpWikiMaps() {
  const bundled = readJson(BUNDLED_WIKI_MAPS), user = readJson(userWikiMapsFile());
  const list = user && (!bundled || user.generatedAt > bundled.generatedAt) ? user : bundled;
  wikiMapList = list?.maps || [];
  if (list && Date.now() - Date.parse(list.generatedAt) < WIKI_MAPS_MAX_AGE) return;
  wikiMaps.updateMaps().then((data) => {
    if (!data.maps.length) return;
    wikiMapList = data.maps;
    fs.writeFileSync(userWikiMapsFile(), JSON.stringify(data));
    updateTray();
  }).catch((error) => console.error('Could not refresh the wiki map list:', error.message));
}

const wikiMap = (id) => wikiMapList.find((m) => m.id === id) || null;
// The wiki map for the zone you are in: the one you last picked for it, or the zone's usual one.
function wikiZoneMap() {
  const found = currentZone ? wikiMaps.mapsForZone(currentZone, wikiMapList, core.ZONE_ALIASES) : [];
  if (!found.length) return null;
  const chosen = settings.wikiZoneMaps[wikiMaps.compact(found[0].zone)];
  return (found.find((m) => m.id === chosen) || found[0]).id;
}
// Picking a map of a zone makes it that zone's map from then on.
function rememberZoneMap(id) {
  const map = wikiMap(id);
  if (map?.zone) settings.wikiZoneMaps = { ...settings.wikiZoneMaps, [wikiMaps.compact(map.zone)]: id };
}


ipcMain.handle('open-wiki-page', (event, url) => {
  if (wikiMapList.some((m) => m.page === url)) shell.openExternal(url);
});
// Where a wiki map was left, by the window or the minimap.
ipcMain.on('map-view', (event, id, view) => {
  if (!wikiMap(id) || !view || !['x', 'y', 'z'].every((k) => Number.isFinite(view[k]))) return;
  const clean = { x: view.x, y: view.y, z: view.z };
  if (minimapWin && event.sender === minimapWin.webContents) settings.minimapViews = { ...settings.minimapViews, [id]: clean };
  else if (mapsWin && event.sender === mapsWin.webContents) settings.wikiViews = { ...settings.wikiViews, [id]: clean };
  else return;
  saveSettingsSoon();
});

// ---- The map window: MnM Atlas or the wiki's maps, picked with the tabs at its top ----
// The atlas runs in a <webview> in the atlas profile (search, notes and sign-in work as on the site); a wiki map
// is a picture the page pans and zooms itself. settings.mapsSource is the one last shown; both keep their map.
let mapsGuest = null;
const mapsOpen = () => !!(mapsWin && !mapsWin.isDestroyed());
const atlasGuestMap = () => (mapsGuest && !mapsGuest.isDestroyed() ? core.atlasView(mapsGuest.getURL())?.map : null);
function atlasStartUrl() {
  const map = zoneMap() || settings.atlasMap || (wikiMaps.isWikiMap(settings.minimapMap) ? null : settings.minimapMap) || 'world';
  return core.atlasUrl(map, settings.atlasViews[map]);
}
function wikiStartMap() {
  // The zone you are in wins over the last map you looked at when the window follows the zone.
  const zone = settings.atlasFollowZone && wikiZoneMap();
  return zone || [settings.wikiMap, settings.minimapMap].find((id) => wikiMap(id)) || wikiMapList[0]?.id || null;
}

// Opens the map window, or brings it up: on `source` ('atlas' or 'wiki') if given, at an atlas address `url`
// or wiki map `id` if given.
let pendingAtlasUrl = null;
function openMaps({ source, url, id } = {}) {
  if (source === 'atlas' || source === 'wiki') settings.mapsSource = source;
  const atlasUrl = url && core.isAtlasUrl(url) ? url : null;
  const wikiId = wikiMap(id) ? id : null;
  if (wikiId) settings.wikiMap = wikiId;
  saveSettingsSoon();
  if (mapsOpen()) {
    mapsWin.webContents.send('maps-show', { source: settings.mapsSource, url: atlasUrl, wiki: wikiId && { id: wikiId, view: settings.wikiViews[wikiId] } });
    return mapsWin.show(), mapsWin.focus();
  }
  pendingAtlasUrl = atlasUrl;
  const saved = settings.atlasBounds; // (the map window's place; it was the atlas window's)
  const onScreen = saved && screen.getAllDisplays().some(({ bounds: b }) =>
    saved.x < b.x + b.width && saved.x + saved.width > b.x && saved.y < b.y + b.height && saved.y + saved.height > b.y);
  mapsWin = new BrowserWindow({
    ...(onScreen ? saved : { width: 1280, height: 900 }), minWidth: 480, minHeight: 360,
    title: 'MnM Tools — Maps',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#16120e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webviewTag: true },
  });
  mapsWin.setMenuBarVisibility(false);
  const remember = () => { if (mapsOpen()) { settings.atlasBounds = mapsWin.getBounds(); saveSettings(); } };
  let timer = null;
  for (const e of ['move', 'resize']) mapsWin.on(e, () => { clearTimeout(timer); timer = setTimeout(remember, 500); });
  mapsWin.on('close', remember);
  mapsWin.on('closed', () => { mapsWin = null; mapsGuest = null; });
  const contents = mapsWin.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  // The page's only webview shows the atlas, without Node or a preload, in the atlas profile.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    Object.assign(webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true });
    params.partition = ATLAS_PARTITION;
    if (params.src && !core.isAtlasUrl(params.src)) event.preventDefault();
  });
  contents.on('did-attach-webview', (event, guest) => {
    mapsGuest = guest;
    guardAtlas(guest, ({ map: mapId, view }) => {
      settings.atlasMap = mapId;
      if (view) settings.atlasViews = { ...settings.atlasViews, [mapId]: view };
      saveSettingsSoon();
    }, { signIn: true });
    // Browser keys: Alt+Left/Right for back and forward (the atlas uses them between maps), F5 or Ctrl+R to reload.
    guest.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const history = guest.navigationHistory;
      if (input.alt && input.key === 'ArrowLeft' && history.canGoBack()) history.goBack();
      else if (input.alt && input.key === 'ArrowRight' && history.canGoForward()) history.goForward();
      else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) guest.reload();
      else return;
      e.preventDefault();
    });
  });
  mapsWin.loadFile('renderer/maps.html');
}
// Atlas links (from the minimap, say) open in the map window's atlas.
const openAtlas = (url) => openMaps({ source: 'atlas', url });
ipcMain.handle('open-maps', () => openMaps());

ipcMain.handle('maps-init', () => {
  const url = pendingAtlasUrl || atlasStartUrl();
  pendingAtlasUrl = null;
  return { source: settings.mapsSource, atlasUrl: url, maps: wikiMapList, current: wikiStartMap(), views: settings.wikiViews };
});
ipcMain.handle('maps-source', (event, source) => {
  if (source !== 'atlas' && source !== 'wiki') return;
  settings.mapsSource = source;
  saveSettingsSoon();
});
ipcMain.handle('show-wiki-map', (event, id) => {
  if (!wikiMap(id)) return;
  settings.wikiMap = id;
  rememberZoneMap(id);
  saveSettingsSoon();
});
// "Show on minimap": the map the window shows, at the same spot.
ipcMain.handle('maps-to-minimap', (event, source, id) => {
  let view = null;
  if (source === 'wiki') {
    if (!wikiMap(id)) return;
    rememberZoneMap(id);
    view = settings.wikiViews[id];
  } else {
    const found = mapsGuest && !mapsGuest.isDestroyed() ? core.atlasView(mapsGuest.getURL()) : null;
    if (!found) return;
    ({ map: id, view } = found);
  }
  if (view) settings.minimapViews = { ...settings.minimapViews, [id]: view };
  minimapShownMap = null; // reload even if it is already the minimap's map, to move to the spot
  if (!settings.minimap) setMinimap(true);
  showMinimapMap(id);
});

// Saved position if it still lands on a screen, otherwise under the game clock's default spot.
function minimapBounds() {
  const saved = settings.minimapBounds;
  const onScreen = saved && screen.getAllDisplays().some(({ bounds: b }) =>
    saved.x < b.x + b.width && saved.x + saved.width > b.x && saved.y < b.y + b.height && saved.y + saved.height > b.y);
  if (onScreen) return saved;
  const area = screen.getPrimaryDisplay().workArea, side = 280;
  return { x: area.x + area.width - side - 40, y: area.y + 200, width: side, height: side };
}

function createMinimapWindow() {
  minimapWin = overlayWindow(minimapBounds(), 'MnM Minimap', { webviewTag: true });
  const contents = minimapWin.webContents;
  // The page's only webview shows the atlas, without Node or a preload, in the atlas profile.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    Object.assign(webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true });
    params.partition = ATLAS_PARTITION;
    if (params.src && !core.isAtlasUrl(params.src)) event.preventDefault();
  });
  contents.on('did-attach-webview', (event, guest) => {
    minimapGuest = guest;
    guardAtlas(guest, ({ map, view }) => {
      if (!view || map !== settings.minimapMap) return;
      settings.minimapViews = { ...settings.minimapViews, [map]: view };
      saveSettingsSoon();
    });
    guest.on('dom-ready', () => {
      lockedCss = null;
      guest.insertCSS(MINIMAP_CSS);
      styleMinimap();
      guest.executeJavaScript(WHEEL_ZOOM_JS).catch(() => {});
    });
  });
  contents.on('did-finish-load', () => { minimapShownMap = null; broadcast(); refreshMinimap(); });
  minimapWin.loadFile('renderer/minimap.html');
}

// Locked (the usual) the minimap is click-through and see-through; while you use it or move it, it takes clicks.
function refreshMinimap() {
  if (!minimapWin || minimapWin.isDestroyed()) return;
  if (!settings.minimap && !questOverlayOpen()) using = false;
  const active = (using && settings.minimap) || moving;
  // minimapMouse: drag and scroll the map any time. The window still never takes the keyboard focus from the
  // game unless it is in use; clicks on it just don't reach the game.
  minimapWin.setIgnoreMouseEvents(!active && !settings.minimapMouse);
  minimapWin.setFocusable(active);
  minimapWin.setOpacity(active ? 1 : Math.min(1, Math.max(0.2, Number(settings.minimapOpacity) || 1)));
  let map = settings.minimapMap || 'world';
  if (wikiMaps.isWikiMap(map) && !wikiMap(map)) map = 'world'; // a wiki map that has gone from the list
  // Only a new map reloads the page: the atlas (or the wiki map) keeps its own view as you pan, and we only save it.
  let url = null, wiki = null;
  if (map !== minimapShownMap) {
    const { id, src, title, user } = wikiMap(map) || {};
    if (id) wiki = { id, src, title, user, view: settings.minimapViews[id] };
    else url = core.atlasUrl(map, settings.minimapViews[map], { embed: true });
    minimapShownMap = map;
  }
  minimapWin.webContents.send('minimap', { url, wiki, note: minimapNote, interact: using, round: settings.minimapShape === 'round' });
  minimapNote = '';
  minimapWin.webContents.send('loading', loadingScreen && settings.minimapHideWhileLoading && !active);
  styleMinimap();
  if (settings.minimap) minimapWin.showInactive();
  else minimapWin.hide();
}

async function styleMinimap() {
  const guest = minimapGuest;
  if (!guest || guest.isDestroyed() || lockedCss === 'pending') return;
  if (using && lockedCss) {
    const key = lockedCss;
    lockedCss = null;
    await guest.removeInsertedCSS(key).catch(() => {});
  } else if (!using && !lockedCss) {
    lockedCss = 'pending';
    lockedCss = await guest.insertCSS(MINIMAP_LOCKED_CSS).catch(() => null);
    if (using) styleMinimap(); // unlocked while the style went in
  }
}

// Presses the atlas's own zoom buttons (hidden while locked, but still there), keeping the centre.
function zoomMinimap(direction) {
  if (wikiMaps.isWikiMap(minimapShownMap)) return minimapWin?.webContents.send('minimap-zoom', direction);
  if (!minimapGuest || minimapGuest.isDestroyed()) return;
  const id = direction > 0 ? 'zoom-in' : 'zoom-out';
  minimapGuest.executeJavaScript(`document.getElementById('${id}')?.click()`).catch(() => {});
}

function setMinimap(on) {
  settings.minimap = on;
  saveSettings();
  refreshMinimap();
  broadcast();
  updateTray();
}

// "Using" unlocks the minimap and the quest log overlay together: they take clicks until you lock them again.
const questOverlayOpen = () => !!(settings.questOverlay && questsWin && !questsWin.isDestroyed());
function setUsing(on) {
  using = !!on && (settings.minimap || questOverlayOpen()) && !moving;
  refreshMinimap();
  refreshQuestOverlay();
  if (using) (questOverlayOpen() ? questsWin : minimapWin).focus();
  updateTray();
}

function setMinimapSource(source) {
  settings.minimapSource = source;
  saveSettings();
  if (currentZone) onZone(currentZone);
  broadcast();
  updateTray();
}

function showMinimapMap(id) {
  settings.minimapMap = id;
  saveSettings();
  refreshMinimap();
  updateTray();
}

// Zoning into a zone with a map switches the minimap to it: the atlas's or the wiki's, whichever you prefer
// (setting minimapSource), or the other one when that has none.
// The open atlas and wiki map windows follow too (setting atlasFollowZone), at the view you last left the map at.
function onZone(zone) {
  currentZone = zone;
  const id = zoneMap(), wikiId = wikiZoneMap();
  if (settings.atlasFollowZone && mapsOpen()) {
    // Both of the window's maps move to the zone, the one you aren't looking at too, for when you switch.
    const url = id && atlasGuestMap() !== id ? core.atlasUrl(id, settings.atlasViews[id]) : null;
    const wiki = wikiId && settings.wikiMap !== wikiId ? { id: wikiId, view: settings.wikiViews[wikiId] } : null;
    if (wiki) settings.wikiMap = wikiId;
    if (url || wiki) mapsWin.webContents.send('maps-show', { url, wiki });
  }
  if (!settings.minimapFollowZone) return;
  const wikiFirst = settings.minimapSource === 'wiki';
  const [first, second] = wikiFirst ? [wikiId, id] : [id, wikiId];
  const pick = first || second;
  if (!pick) minimapNote = `No map of ${zone} on the atlas or the wiki yet`;
  else if (!first) minimapNote = `The ${wikiFirst ? 'wiki' : 'atlas'} has no map of ${zone}: showing the ${wikiFirst ? "atlas's" : "wiki's"}`;
  if (pick && pick !== settings.minimapMap) showMinimapMap(pick);
  else if (minimapNote) refreshMinimap();
}

// ---- Settings window ----
function openSettings(openImport = false) {
  const andImport = () => { if (openImport === true) settingsWin.webContents.send('open-import'); };
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.show(), settingsWin.focus(), andImport();
  settingsWin = new BrowserWindow({
    width: 760, height: 720, minWidth: 600, minHeight: 480,
    title: 'MnM Tools — Settings',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#1b1a16',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.on('closed', () => { settingsWin = null; cancelRecording(); });
  settingsWin.webContents.on('did-finish-load', () => { broadcast(); setTimeout(andImport, 300); });
  settingsWin.loadFile('renderer/settings.html', { query: { icons: pathToFileURL(ICONS_DIR).href } });
}

ipcMain.handle('catalog', () => [...gameIcons(), ...catalogIcons()]);

ipcMain.handle('save-settings', (event, patch) => {
  const sizeChanged = ['abilities', 'layout', 'size'].some((k) => k in patch);
  settings = { ...settings, ...patch };
  saveSettings();
  if (sizeChanged) refreshOverlay();
  if ('followUps' in patch || 'followSize' in patch) refreshFollow();
  if ('counters' in patch || 'counterSize' in patch) refreshCounters();
  if (['clock', 'clockSize', 'clockDate', 'clockHideWhileLoading'].some((k) => k in patch)) refreshClock();
  if ('hideWhileLoading' in patch) refreshCombatOverlays();
  if (Object.keys(patch).some((k) => k.startsWith('minimap'))) refreshMinimap();
  if ((patch.minimapFollowZone || patch.atlasFollowZone || 'minimapSource' in patch) && currentZone) onZone(currentZone);
  if ('clock' in patch || 'autoProfile' in patch || 'minimap' in patch) updateTray();
  if ('questOnTop' in patch && questsWin && !questsWin.isDestroyed() && !settings.questOverlay) questsWin.setAlwaysOnTop(settings.questOnTop);
  if (patch.autoProfile && loggedIn) onLogin(loggedIn);
  if (['abilities', 'followUps', 'counters', 'showFrames'].some((k) => k in patch)) refreshFrames();
  broadcast();
  sendCooldowns();
  sendCounters();
  return true;
});

// Waits for the next non-modifier key from the watcher. Esc cancels; resolves null after 15 s.
ipcMain.handle('record-key', () => {
  cancelRecording();
  return new Promise((resolve) => {
    recording = { resolve, timer: setTimeout(() => cancelRecording(), 15000) };
  });
});
ipcMain.handle('cancel-record', () => cancelRecording());
function cancelRecording(result = null) {
  if (!recording) return;
  clearTimeout(recording.timer);
  recording.resolve(result);
  recording = null;
}

// Custom icons are copied into the app's data folder so the original can be moved or deleted.
ipcMain.handle('choose-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWin, {
    title: 'Choose an icon image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const dir = path.join(app.getPath('userData'), 'icons');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, Date.now() + '-' + path.basename(filePaths[0]));
  fs.copyFileSync(filePaths[0], dest);
  return dest;
});

// ---- Icons grabbed from a framed button ----
// grab.py reads the pixels under the frame from the game window. Frames are in DIPs and X11 uses pixels (see onClick).
const GRAB = path.join(__dirname, 'grab.py');
ipcMain.handle('grab-frame', (event, frame) => new Promise((resolve) => {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  const args = [frame.x, frame.y, frame.width, frame.height].map((v) => String(Math.round(v * scale)));
  const child = spawn('python3', [GRAB, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.setEncoding('utf8').on('data', (text) => { out += text; });
  child.stderr.setEncoding('utf8').on('data', (text) => { err += text; });
  child.on('error', (error) => resolve({ error: 'Could not start python3: ' + error.message }));
  child.on('close', () => {
    let result;
    try { result = JSON.parse(out); } catch { return resolve({ error: err.trim().split('\n').pop() || 'The grab script gave no answer' }); }
    if (result.error) return resolve(result);
    // X11 gives blue, green, red, unused; Electron wants blue, green, red, alpha.
    const pixels = Buffer.from(result.bgrx, 'base64');
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const image = nativeImage.createFromBitmap(pixels, { width: result.width, height: result.height });
    resolve({ dataUrl: image.toDataURL() });
  });
}));

// Saves a grabbed (and maybe trimmed) icon into the data folder, like a custom image.
ipcMain.handle('save-icon', (event, dataUrl) => {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl));
  if (!match) return null;
  const dir = path.join(app.getPath('userData'), 'icons');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-grabbed.png`);
  fs.writeFileSync(dest, Buffer.from(match[1], 'base64'));
  return dest;
});

// ---- Spell list from the wiki ----
// The bundled snapshot (data/spells.json) is used until "Update from wiki" saves a newer one in the data folder.
const BUNDLED_SPELLS = path.join(__dirname, 'data', 'spells.json');
const userSpellsFile = () => path.join(app.getPath('userData'), 'spells.json');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const catalogIcons = () => JSON.parse(fs.readFileSync(path.join(ICONS_DIR, 'catalog.json'), 'utf8')).icons;

function loadSpells() {
  const bundled = readJson(BUNDLED_SPELLS), user = readJson(userSpellsFile());
  return user && (!bundled || user.generatedAt > bundled.generatedAt) ? user : bundled || { generatedAt: null, spells: [] };
}

// What the settings window and class import see: the spells with MnM Icon Creator's game icons swapped in.
function spellsWithGameIcons() {
  const data = loadSpells();
  return { ...data, spells: core.withGameIcons(data.spells, gameIcons()) };
}

ipcMain.handle('spells', () => spellsWithGameIcons());

// ---- Game icons from MnM Icon Creator ----
// It saves them the way it fills the OpenDeck plugin: custom-icons/catalog.json plus icons/custom/<name>.png.
// They show in the icon picker under "Custom" and replace the wiki icon on abilities of the same name.
const gameIconsDir = () => path.join(app.getPath('userData'), 'custom-icons');

function gameIcons() {
  const catalog = readJson(path.join(gameIconsDir(), 'catalog.json'));
  return (catalog?.icons || []).map((icon) => ({ ...icon, file: path.join(gameIconsDir(), 'icons', icon.file) }));
}

function applyGameIcons() {
  const icons = gameIcons();
  if (!icons.length) return;
  let changed = false;
  const update = (abilities = []) => {
    const out = core.withGameIcons(abilities, icons);
    if (out !== abilities) changed = true;
    return out;
  };
  settings.abilities = update(settings.abilities);
  for (const [name, profile] of Object.entries(settings.profiles || {})) {
    if (name !== settings.profile) settings.profiles[name] = { ...profile, abilities: update(profile.abilities) };
  }
  if (!changed) return;
  saveSettings();
  refreshOverlay();
  broadcast();
}

let gameIconsTimer = null;
function watchGameIcons() {
  applyGameIcons();
  try {
    fs.mkdirSync(gameIconsDir(), { recursive: true });
    // The catalog is replaced through a temporary file, so watch the folder rather than the file.
    fs.watch(gameIconsDir(), () => { clearTimeout(gameIconsTimer); gameIconsTimer = setTimeout(applyGameIcons, 500); });
  } catch (error) {
    console.error('Could not watch the game icons folder:', error.message);
  }
}

// ---- Importing abilities for a class and level ----
// Playable classes; anything else the wiki lists abilities for (Dwarf, Goblin, Halfling…) is a race.
const CLASSES = wiki.CLASSES;

ipcMain.handle('plan-import', (event, character) => {
  const { spells, generatedAt } = spellsWithGameIcons();
  const all = [...new Set(spells.flatMap((spell) => Object.keys(spell.classes)))].sort();
  const plan = character.cls ? core.planImport(spells, settings.abilities, { ...character, level: Number(character.level) || 1 }) : null;
  return { plan, generatedAt, classes: CLASSES.filter((c) => all.includes(c)), races: all.filter((c) => !CLASSES.includes(c)) };
});

// Adds the chosen spells (by wiki page) and applies the chosen upgrades (by ability id), then returns the
// new abilities list so the settings window can adopt it.
ipcMain.handle('apply-import', (event, { add = [], upgrades = [] }) => {
  const pages = new Map(spellsWithGameIcons().spells.map((spell) => [spell.page, spell]));
  const upgradeTo = new Map(upgrades.map((u) => [u.id, pages.get(u.page)]));
  const abilities = settings.abilities.map((a) => (upgradeTo.get(a.id) ? core.upgradeAbility(a, upgradeTo.get(a.id)) : a));
  for (const page of add) if (pages.has(page)) abilities.push(core.abilityFromSpell(pages.get(page), randomUUID()));
  settings.abilities = abilities;
  saveSettings();
  refreshOverlay();
  refreshFrames();
  broadcast();
  return abilities;
});

let updatingSpells = null;
ipcMain.handle('update-spells', () => {
  updatingSpells ||= wiki.updateSpells({
    catalog: catalogIcons(),
    known: loadSpells().spells,
    // Icons the bundled set lacks are saved in the data folder and referenced by absolute path.
    iconDir: path.join(app.getPath('userData'), 'spell-icons'),
    iconRef: (name) => path.join(app.getPath('userData'), 'spell-icons', name),
    onProgress: (progress) => settingsWin?.webContents.send('spells-progress', progress),
  }).then((data) => {
    fs.writeFileSync(userSpellsFile(), JSON.stringify(data));
    return { ok: true, data };
  }).catch((error) => ({ error: error.message })).finally(() => { updatingSpells = null; });
  return updatingSpells;
});

// ---- Quest tracker ----
// Walkthroughs from the wiki: the bundled snapshot (data/quests.json) until "Update from wiki" saves a newer one.
const BUNDLED_QUESTS = path.join(__dirname, 'data', 'quests.json');
const userQuestsFile = () => path.join(app.getPath('userData'), 'quests.json');

function loadQuests() {
  const bundled = readJson(BUNDLED_QUESTS), user = readJson(userQuestsFile());
  return user && (!bundled || user.generatedAt > bundled.generatedAt) ? user : bundled || { generatedAt: null, quests: [] };
}

ipcMain.handle('quests', () => loadQuests());
ipcMain.handle('copy-text', (event, text) => { clipboard.writeText(String(text)); return true; });
// Only wiki pages are opened in the browser.
ipcMain.handle('open-wiki', (event, title) => shell.openExternal(questWiki.pageUrl(String(title))));
ipcMain.handle('open-quests', () => openQuests());

let updatingQuests = null;
ipcMain.handle('update-quests', () => {
  updatingQuests ||= questWiki.updateQuests({
    onProgress: (progress) => questsWin?.webContents.send('quests-progress', progress),
  }).then((data) => {
    fs.writeFileSync(userQuestsFile(), JSON.stringify(data));
    return { ok: true, data };
  }).catch((error) => ({ error: error.message })).finally(() => { updatingQuests = null; });
  return updatingQuests;
});

// An ordinary window (it has buttons to click), kept above the game unless you unpin it.
function openQuests() {
  if (settings.questOverlay) return setUsing(true); // the overlay is up: unlock it
  if (questsWin && !questsWin.isDestroyed()) return questsWin.show(), questsWin.focus();
  const saved = settings.questBounds;
  const onScreen = saved && screen.getAllDisplays().some(({ bounds: b }) =>
    saved.x < b.x + b.width && saved.x + saved.width > b.x && saved.y < b.y + b.height && saved.y + saved.height > b.y);
  questsWin = new BrowserWindow({
    ...(onScreen ? saved : { width: 480, height: 760 }), minWidth: 360, minHeight: 320,
    title: 'MnM Tools — Quests',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#1b1a16',
    alwaysOnTop: settings.questOnTop,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  questsWin.setMenuBarVisibility(false);
  const remember = () => { if (questsWin && !questsWin.isDestroyed()) { settings.questBounds = questsWin.getBounds(); saveSettings(); } };
  let timer = null;
  for (const e of ['move', 'resize']) questsWin.on(e, () => { clearTimeout(timer); timer = setTimeout(remember, 500); });
  questsWin.on('close', remember);
  questsWin.on('closed', () => { questsWin = null; });
  questsWin.webContents.on('did-finish-load', () => broadcast());
  questsWin.loadFile('renderer/quests.html');
}

// ---- Wiki helper ----
// Reads spell window screenshots (spellshot.py runs Tesseract on them) and helps turn them into wiki edits.
// The window shows every change before it is made; Publish sends one edit under the user's own wiki account.
const SPELLSHOT = path.join(__dirname, 'spellshot.py');
const wikiClient = new wikiEdit.WikiClient();
const loginFile = () => path.join(app.getPath('userData'), 'wiki-login.bin');
let shotWatcher = null;

function openWikiHelper() {
  if (wikiHelperWin && !wikiHelperWin.isDestroyed()) return wikiHelperWin.show(), wikiHelperWin.focus();
  const saved = settings.wikiHelperBounds;
  const onScreen = saved && screen.getAllDisplays().some(({ bounds: b }) =>
    saved.x < b.x + b.width && saved.x + saved.width > b.x && saved.y < b.y + b.height && saved.y + saved.height > b.y);
  wikiHelperWin = new BrowserWindow({
    ...(onScreen ? saved : { width: 1000, height: 820 }), minWidth: 640, minHeight: 420,
    title: 'MnM Tools — Wiki helper',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#1b1a16',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  wikiHelperWin.setMenuBarVisibility(false);
  const remember = () => { if (wikiHelperWin && !wikiHelperWin.isDestroyed()) { settings.wikiHelperBounds = wikiHelperWin.getBounds(); saveSettings(); } };
  let timer = null;
  for (const e of ['move', 'resize']) wikiHelperWin.on(e, () => { clearTimeout(timer); timer = setTimeout(remember, 500); });
  wikiHelperWin.on('close', remember);
  wikiHelperWin.on('closed', () => { wikiHelperWin = null; watchShots(false); });
  wikiHelperWin.loadFile('renderer/wikihelper.html', { query: { icons: pathToFileURL(ICONS_DIR).href } });
}

const shotFolder = () => settings.wikiHelperFolder || path.join(app.getPath('pictures'), 'Screenshots');

// New screenshots in the folder are offered to the window as they appear (the window skips ones that
// aren't spell windows). Only while the window is open.
function watchShots(on) {
  if (shotWatcher) { shotWatcher.close(); shotWatcher = null; }
  if (!on) return null;
  const folder = shotFolder();
  try {
    const seen = new Set(fs.readdirSync(folder));
    const pending = new Map();
    shotWatcher = fs.watch(folder, (type, name) => {
      if (!name || !/\.(png|jpe?g|webp)$/i.test(name) || seen.has(name)) return;
      clearTimeout(pending.get(name));
      pending.set(name, setTimeout(() => { // wait until the screenshot tool has finished writing it
        pending.delete(name);
        const file = path.join(folder, name);
        if (!fs.existsSync(file)) return;
        seen.add(name);
        wikiHelperWin?.webContents.send('wh-files', [file]);
      }, 800));
    });
    return null;
  } catch (error) {
    return error.message;
  }
}

function readShots(files) {
  return new Promise((resolve) => {
    const child = spawn('python3', [SPELLSHOT, '--icons', ICONS_DIR, ...files], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8').on('data', (text) => { out += text; });
    child.stderr.setEncoding('utf8').on('data', (text) => { err += text; });
    child.on('error', (error) => resolve({ error: 'Could not start python3: ' + error.message }));
    child.on('close', () => {
      const results = out.trim().split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
      resolve(results.length ? { results } : { error: err.trim().split('\n').pop() || 'Could not read the screenshots' });
    });
  });
}

// Passwords are only kept when the desktop's keyring encrypts them (not Electron's plain-text fallback).
const canKeepLogin = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

function savedLogin() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(loginFile())) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(loginFile())));
  } catch { return null; }
}

async function ensureLogin() {
  if (wikiClient.user) return wikiClient.user;
  const login = savedLogin();
  if (!login) throw new Error('Log in to the wiki first');
  return wikiClient.login(login.name, login.password);
}

ipcMain.handle('wh-init', () => {
  const { spells } = loadSpells();
  return {
    names: [...new Set(spells.map((s) => s.name))],
    spells: spells.map(({ name, page, icon, iconFile, description, classPageOnly }) => ({ name, page, icon, iconFile, description, classPageOnly })),
    icons: catalogIcons().filter((i) => i.wikiName),
    classes: wiki.CLASSES,
    cls: settings.character?.cls || '',
    watch: settings.wikiHelperWatch, folder: shotFolder(),
    user: wikiClient.user, savedLogin: !!savedLogin()?.name, canKeepLogin: canKeepLogin(),
  };
});
ipcMain.handle('wh-choose', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(wikiHelperWin, {
    title: 'Spell window screenshots', defaultPath: shotFolder(), properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  return canceled ? [] : filePaths;
});
ipcMain.handle('wh-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(wikiHelperWin, { title: 'Screenshots folder', defaultPath: shotFolder(), properties: ['openDirectory'] });
  if (canceled || !filePaths[0]) return null;
  settings.wikiHelperFolder = filePaths[0];
  saveSettings();
  if (settings.wikiHelperWatch) watchShots(true);
  return filePaths[0];
});
ipcMain.handle('wh-watch', (event, on) => {
  settings.wikiHelperWatch = !!on;
  saveSettings();
  return { error: watchShots(!!on) };
});
// The helper's logic (spellshot.js) runs here; the window calls it by name.
const SHOT_CALLS = new Set(['joinParts', 'readSpell', 'spellFields', 'compareFields', 'pageFields', 'setFields', 'withClass', 'newSpellPage',
  'classCategory', 'classStatus', 'classRow', 'addClassRow', 'spellName', 'likelyPage']);
ipcMain.handle('wh-shot', (event, name, ...args) => {
  if (!SHOT_CALLS.has(name)) return { error: 'Unknown call' };
  try { return { value: spellshot[name](...args) }; } catch (error) { return { error: error.message }; }
});
ipcMain.handle('wh-read', (event, files) => readShots(files.map(String).filter((f) => fs.existsSync(f))));
ipcMain.handle('wh-page', (event, title) => wikiClient.page(String(title)).catch((error) => ({ error: error.message })));
ipcMain.handle('wh-login', async (event, { name, password, remember }) => {
  try {
    const user = await wikiClient.login(String(name), String(password));
    if (remember && canKeepLogin()) store.writeAtomic(loginFile(), safeStorage.encryptString(JSON.stringify({ name, password })));
    return { user };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('wh-logout', () => {
  wikiClient.user = null;
  wikiClient.cookies.clear();
  fs.rmSync(loginFile(), { force: true });
  return true;
});
ipcMain.handle('wh-publish', async (event, edit) => {
  try {
    await ensureLogin();
    return await wikiClient.edit({ title: String(edit.title), text: String(edit.text), summary: String(edit.summary), base: edit.base });
  } catch (error) { return { error: error.message }; }
});
// Saves a spellbook icon as a PNG, for uploading to the wiki by hand.
ipcMain.handle('wh-save-icon', async (event, name, base64) => {
  const { canceled, filePath } = await dialog.showSaveDialog(wikiHelperWin, {
    title: 'Save the icon', defaultPath: path.join(app.getPath('pictures'), String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.png'),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(String(base64), 'base64'));
  return filePath;
});
ipcMain.handle('wh-upload', async (event, { filename, base64 }) => {
  try {
    await ensureLogin();
    const name = String(filename).trim();
    if (!/\.png$/i.test(name)) throw new Error('The file name must end in .png');
    return await wikiClient.upload({ filename: name, data: Buffer.from(String(base64), 'base64'), text: '[[Category:Spell Icons]]',
      comment: 'Spell icon from the in-game spellbook (MnM Tools Wiki helper)' });
  } catch (error) { return { error: error.message }; }
});
// Only wiki pages open from this window.
ipcMain.handle('wh-open', (event, title, editing) => shell.openExternal(editing ? wikiEdit.editUrl(String(title)) : wikiEdit.pageUrl(String(title))));
ipcMain.handle('open-wiki-helper', () => openWikiHelper());
ipcMain.on('wh-ready', () => { if (settings.wikiHelperWatch) { const error = watchShots(true); if (error) wikiHelperWin?.webContents.send('wh-watch-error', error); } });

// ---- Quest log overlay ----
// The same tracker as a see-through, click-through panel over the game. Use the minimap key (or the tray) to
// click it: tick steps, copy lines, change quest, drag or resize it. Locked again, only the steps show.
function questOverlayBounds() {
  const saved = settings.questOverlayBounds;
  const onScreen = saved && screen.getAllDisplays().some(({ bounds: b }) =>
    saved.x < b.x + b.width && saved.x + saved.width > b.x && saved.y < b.y + b.height && saved.y + saved.height > b.y);
  if (onScreen) return saved;
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + 40, y: area.y + 200, width: 380, height: 520 };
}

function openQuestOverlay() {
  if (questsWin && !questsWin.isDestroyed()) return refreshQuestOverlay();
  questsWin = overlayWindow(questOverlayBounds(), 'MnM Quests');
  questsWin.on('closed', () => { questsWin = null; if (using) setUsing(using); updateTray(); });
  questsWin.webContents.on('did-finish-load', () => { broadcast(); refreshQuestOverlay(); });
  questsWin.loadFile('renderer/quests.html', { query: { overlay: '1' } });
  updateTray();
}

function refreshQuestOverlay() {
  if (!questOverlayOpen()) return;
  const active = using || moving;
  questsWin.setIgnoreMouseEvents(!active);
  questsWin.setFocusable(active);
  questsWin.webContents.send('quest-overlay', { using: active });
  questsWin.webContents.send('loading', hiddenForLoading() && !active);
  questsWin.showInactive();
}

// Turns the overlay on or off. Switching between the window and the overlay needs a new window, since a window
// can't drop its frame later; `openWindow` opens the ordinary window in the overlay's place.
function setQuestOverlay(on, { openWindow = false } = {}) {
  settings.questOverlay = on;
  saveSettings();
  const next = () => {
    if (on) openQuestOverlay();
    else if (openWindow) openQuests();
    broadcast();
    updateTray();
  };
  if (!questsWin || questsWin.isDestroyed()) return next();
  questsWin.once('closed', () => { questsWin = null; next(); });
  questsWin.close();
}
ipcMain.handle('quest-overlay', (event, on, openWindow) => setQuestOverlay(!!on, { openWindow: !!openWindow }));

// ---- Key watcher ----
function setWatcher(status, message) {
  if (watcher.status === status && watcher.message === message) return;
  watcher = { status, message };
  broadcast();
  updateTray();
}

function startWatcher(retryMs = 2000) {
  const child = watcherChild = spawn('python3', [KEYWATCH], { stdio: ['ignore', 'pipe', 'pipe'] });
  let lastError = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', core.lineParser(onWatcherMessage));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => { lastError = text.trim().split('\n').pop(); console.error('[keywatch]', text.trim()); });
  child.on('error', (error) => setWatcher('error', 'Could not start python3: ' + error.message));
  child.on('exit', () => {
    if (app.isQuitting) return;
    if (watcher.status !== 'error') setWatcher('error', 'Key watcher stopped' + (lastError ? ': ' + lastError : ''));
    setTimeout(() => startWatcher(Math.min(retryMs * 2, 30000)), retryMs);
  });

  function onWatcherMessage(message) {
    if (message.error) return setWatcher('error', message.error);
    if (message.ready) return setWatcher('ok', 'Watching your keys');
    if (typeof message.button === 'number') return onClick(message);
    if (typeof message.code !== 'number' || core.isModifier(message)) return;
    if (recording) {
      return cancelRecording(message.key === 'Escape' ? null : { binding: core.bindingFromPress(message), label: core.bindingLabel(message) });
    }
    // The minimap key works in the game and while the minimap has the focus (to lock it again).
    if ((settings.minimap || questOverlayOpen()) && core.matches(settings.useKey, message) && (message.game || using)) setUsing(!using);
    // Zoom keys work in game, locked or not.
    if (settings.minimap && (message.game || using)) {
      if (core.matches(settings.minimapZoomInKey, message)) zoomMinimap(1);
      else if (core.matches(settings.minimapZoomOutKey, message)) zoomMinimap(-1);
    }
    onInput(message);
  }
}

// A key press, or a click already converted to DIPs: start cooldowns and follow-ups, and count counters.
function onInput(input) {
  if (cooldowns.press(settings.abilities, input, settings).length) sendCooldowns();
  if (counters.press(settings.counters, input, settings).length) sendCounters();
  const follow = followUps.press(settings.followUps, settings.abilities, input, settings);
  if (follow?.type === 'start') {
    const next = settings.abilities.find((a) => a.id === follow.followUp.next);
    sendFollow({ type: 'start', ms: follow.ms, endsAt: follow.endsAt, icon: next?.icon || '', name: next?.name || '' });
  } else if (follow) sendFollow(follow);
}

// ---- Profiles ----
// Switching profiles swaps the abilities, follow-ups and counters, so running timers are cleared.
function applyProfiles(next) {
  settings = next;
  saveSettings();
  cooldowns.reset();
  counters.reset();
  followUps.cancel();
  sendFollow({ type: 'cancel' });
  sendCooldowns();
  sendCounters();
  refreshOverlay();
  refreshFollow();
  refreshCounters();
  refreshFrames();
  profileStamp++;
  broadcast();
  updateTray();
}

ipcMain.handle('profile', (event, { action, name, to }) => {
  name = String(name || '').trim();
  to = String(to || '').trim();
  if (action === 'switch' && settings.profiles[name]) applyProfiles(core.switchProfile(settings, name));
  if ((action === 'new' || action === 'copy') && name && !settings.profiles[name]) {
    applyProfiles(core.switchProfile(settings, name, action === 'copy' ? { copyFrom: settings.profile } : {}));
  }
  if (action === 'rename') applyProfiles(core.renameProfile(settings, name, to));
  if (action === 'delete') applyProfiles(core.deleteProfile(settings, name));
  return true;
});

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: 'MnM Tools', body, silent: true, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
}

// A character logged in: switch to their profile, making one the first time.
function onLogin(name) {
  loggedIn = name;
  broadcast();
  if (!settings.autoProfile) return;
  const step = core.profileForLogin(settings, name);
  if (!step) return;
  if (step.action === 'switch') {
    applyProfiles(core.switchProfile(settings, name));
    notify(`Switched to ${name}'s profile.`);
  } else if (step.action === 'rename') {
    applyProfiles(core.renameProfile(settings, step.from, name));
    notify(`Your setup is now ${name}'s profile. Other characters get their own profile when they log in.`);
  } else {
    applyProfiles(core.switchProfile(settings, name));
    notify(`${name} logged in for the first time, so they have a new, empty profile. Set up their keys in Settings, or copy another profile there.`);
  }
}

// ---- Game log (which character is logged in) ----
// MNM_PLAYER_LOG overrides where the game's log is looked for.
const GAME_DATA = 'drive_c/users/steamuser/AppData/LocalLow/Niche Worlds Cult/Monsters and Memories/Player.log';
const playerLog = () => process.env.MNM_PLAYER_LOG || path.join(os.homedir(), '.local/share/mnm/mnm/pfx', GAME_DATA);
const LOG_TAIL = 8 * 1024 * 1024; // how much of an existing log to read at start-up
const LOG_POLL_MS = 500; // often enough to catch a loading screen as it starts
const LOADING_MAX_MS = 5 * 60 * 1000; // show the overlays again if a loading screen never seems to end

// While the game shows a loading screen, the cooldown bar, follow-up pop-up and counters are hidden (setting
// hideWhileLoading), and so is the game clock (clockHideWhileLoading). Move overlays still shows them. Timers keep running underneath. The windows stay mapped and
// hide their own content: on X11, showInactive() after hide() left them unmapped for good.
let loadingScreen = false, loadingTimer = null;
const hiddenForLoading = () => loadingScreen && settings.hideWhileLoading && !moving;
function refreshCombatOverlays() { refreshOverlay(); refreshFollow(); refreshCounters(); }
function setLoadingScreen(on) {
  clearTimeout(loadingTimer);
  if (on) loadingTimer = setTimeout(() => setLoadingScreen(false), LOADING_MAX_MS);
  if (on === loadingScreen) return;
  loadingScreen = on;
  refreshCombatOverlays();
  refreshClock();
  refreshMinimap();
  refreshQuestOverlay();
}

// Polls the log for new lines. The game starts a fresh Player.log each launch, which shows up as a smaller file.
function watchLog() {
  const logins = new core.LoginWatcher(), loading = new core.LoadingWatcher();
  let offset = null, rest = '';
  const read = (from, to) => {
    const fd = fs.openSync(playerLog(), 'r');
    try {
      const buffer = Buffer.alloc(to - from);
      fs.readSync(fd, buffer, 0, buffer.length, from);
      return buffer.toString('utf8');
    } finally { fs.closeSync(fd); }
  };
  const poll = () => {
    let size;
    try { size = fs.statSync(playerLog()).size; } catch { return; }
    // At start-up only the last character to log in matters, so read the end of the log without acting on each line.
    if (offset === null) {
      offset = Math.max(0, size - LOG_TAIL);
      const lines = read(offset, size).split('\n');
      rest = lines.pop();
      for (const line of lines) { logins.line(line); loading.line(line); }
      offset = size;
      if (logins.current) onLogin(logins.current);
      if (loading.zone) onZone(loading.zone);
      setLoadingScreen(loading.loading);
      return;
    }
    if (size < offset) { offset = 0; rest = ''; loading.loading = false; setLoadingScreen(false); }
    if (size === offset) return;
    const to = Math.min(size, offset + LOG_TAIL);
    const lines = (rest + read(offset, to)).split('\n');
    offset = to;
    rest = lines.pop();
    for (const line of lines) {
      const name = logins.line(line);
      if (name) onLogin(name);
      const zone = loading.zone;
      loading.line(line);
      if (loading.zone !== zone) onZone(loading.zone);
    }
    // A loading screen that started and finished between two polls is skipped rather than flashed.
    if (loading.loading !== loadingScreen) setLoadingScreen(loading.loading);
  };
  const tick = () => { try { poll(); } catch (error) { console.error('Could not read the game log:', error.message); } };
  tick();
  setInterval(tick, LOG_POLL_MS);
}

// ---- Tray ----
function updateTray() {
  if (!tray) return;
  const status = watcher.status === 'ok' ? 'Watching your keys' : watcher.message;
  tray.setToolTip(`MnM Tools\n${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { label: `Profile: ${settings?.profile || ''}`, submenu: [
      ...Object.keys(settings?.profiles || {}).map((name) => ({ label: name + (name === loggedIn ? ' (logged in)' : ''), type: 'radio', checked: name === settings.profile,
        click: () => { if (name !== settings.profile) applyProfiles(core.switchProfile(settings, name)); } })),
      { type: 'separator' },
      { label: 'Switch automatically when a character logs in', type: 'checkbox', checked: !!settings?.autoProfile,
        click: (item) => { settings.autoProfile = item.checked; saveSettings(); broadcast(); updateTray(); if (item.checked && loggedIn) onLogin(loggedIn); } },
    ] },
    { label: 'Check for new abilities…', click: () => openSettings(true) },
    { label: 'Quest tracker…', click: () => openQuests() },
    { label: 'Wiki helper (spell screenshots)…', click: () => openWikiHelper() },
    { label: 'Move overlays (drag them, then untick)', type: 'checkbox', checked: moving, click: (item) => setMoving(item.checked) },
    { label: 'Show game clock', type: 'checkbox', checked: !!settings?.clock, click: (item) => setClock(item.checked) },
    { type: 'separator' },
    { label: 'Maps (atlas and wiki)…', click: () => openMaps() },
    { label: 'Show minimap', type: 'checkbox', checked: !!settings?.minimap, click: (item) => setMinimap(item.checked) },
    { label: 'Quest log as an overlay', type: 'checkbox', checked: !!settings?.questOverlay, click: (item) => setQuestOverlay(item.checked) },
    { label: 'Use the minimap and quest log (click them)' + (settings?.useKey ? `  [${core.bindingLabel(settings.useKey)}]` : ''), type: 'checkbox',
      checked: using, enabled: !!(settings?.minimap || questOverlayOpen()) && !moving, click: (item) => setUsing(item.checked) },
    { label: 'Minimap map', enabled: !!settings?.minimap, submenu: [
      { label: 'Minimap follows the zone I am in', type: 'checkbox', checked: !!settings?.minimapFollowZone,
        click: (item) => { settings.minimapFollowZone = item.checked; saveSettings(); if (item.checked && currentZone) onZone(currentZone); broadcast(); updateTray(); } },
      { label: 'Map window follows the zone I am in', type: 'checkbox', checked: !!settings?.atlasFollowZone,
        click: (item) => { settings.atlasFollowZone = item.checked; saveSettings(); if (item.checked && currentZone) onZone(currentZone); broadcast(); updateTray(); } },
      { type: 'separator' },
      { label: 'Zoom in' + (settings?.minimapZoomInKey ? `  [${core.bindingLabel(settings.minimapZoomInKey)}]` : ''), click: () => zoomMinimap(1) },
      { label: 'Zoom out' + (settings?.minimapZoomOutKey ? `  [${core.bindingLabel(settings.minimapZoomOutKey)}]` : ''), click: () => zoomMinimap(-1) },
      { type: 'separator' },
      { label: 'Prefer atlas maps', type: 'radio', checked: settings?.minimapSource !== 'wiki', click: () => setMinimapSource('atlas') },
      { label: 'Prefer wiki maps', type: 'radio', checked: settings?.minimapSource === 'wiki', click: () => setMinimapSource('wiki') },
      { type: 'separator' },
      { label: 'MnM Atlas', submenu: atlasMaps.map((m) => ({ label: m.title, type: 'radio', checked: m.id === settings?.minimapMap, click: () => showMinimapMap(m.id) })) },
      { label: 'Wiki', enabled: wikiMapList.length > 0, submenu: wikiMapList.map((m) => ({ label: m.zone && m.title !== m.zone && !m.title.startsWith(m.zone) ? `${m.zone}: ${m.title}` : m.title,
        type: 'radio', checked: m.id === settings?.minimapMap, click: () => { rememberZoneMap(m.id); showMinimapMap(m.id); } })) },
    ] },
    { type: 'separator' },
    { label: 'Reset all cooldowns and counters', click: () => {
      cooldowns.reset(); sendCooldowns(); followUps.cancel(); sendFollow({ type: 'cancel' }); counters.reset(); sendCounters();
    } },
    { type: 'separator' },
    // Relaunches with the same arguments, which also picks up code changes.
    { label: 'Restart', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('before-quit', () => { app.isQuitting = true; watcherChild?.kill(); });
  // Closing the settings window leaves the overlay running in the tray.
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    settings = loadSettings();
    watchGameIcons();
    createOverlay();
    createFollowWindow();
    createCounterWindow();
    createClockWindow();
    createFramesWindow();
    setUpAtlas();
    setUpWikiMaps();
    createMinimapWindow();
    if (settings.questOverlay) openQuestOverlay();
    tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
    tray.on('click', () => openSettings());
    if (settingsProblem) dialog.showMessageBox({ type: 'warning', title: 'MnM Tools', message: 'Settings problem', detail: `${settingsProblem}\n\nFolder: ${app.getPath('userData')}` });
    updateTray();
    startWatcher();
    watchLog();
    if (!settings.abilities.length && !settings.followUps.length && !settings.counters.length) openSettings();
  });
  // Starting it a second time opens the settings, so it is easy to find again.
  app.on('second-instance', () => openSettings());
}
