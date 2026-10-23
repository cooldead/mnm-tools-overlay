// Pure logic shared by the main process and tests: key bindings, cooldown timing and overlay sizing.

const MODIFIER_KEYS = new Set(['Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R', 'Meta_L', 'Meta_R',
  'Super_L', 'Super_R', 'Hyper_L', 'Hyper_R', 'ISO_Level3_Shift', 'Caps_Lock', 'Num_Lock', 'Scroll_Lock']);

// Keypad keys report their Num Lock-off name; show them as Num 0-9 regardless.
const KEYPAD = { KP_Insert: '0', KP_End: '1', KP_Down: '2', KP_Next: '3', KP_Left: '4', KP_Begin: '5', KP_Right: '6',
  KP_Home: '7', KP_Up: '8', KP_Prior: '9', KP_Delete: '.', KP_Add: '+', KP_Subtract: '-', KP_Multiply: '*',
  KP_Divide: '/', KP_Enter: 'Enter' };
const NAMES = { minus: '-', equal: '=', grave: '`', bracketleft: '[', bracketright: ']', semicolon: ';',
  apostrophe: "'", comma: ',', period: '.', slash: '/', backslash: '\\', space: 'Space', Return: 'Enter',
  Prior: 'Page Up', Next: 'Page Down', Escape: 'Esc' };

const isModifier = (press) => MODIFIER_KEYS.has(press.key);

// Turns a key-watcher press into a stored binding.
function bindingFromPress(press) {
  return { code: press.code, key: press.key, shift: !!press.shift, ctrl: !!press.ctrl, alt: !!press.alt };
}

function keyName(key) {
  if (KEYPAD[key]) return 'Num ' + KEYPAD[key];
  if (/^KP_\d$/.test(key)) return 'Num ' + key.slice(3);
  if (NAMES[key]) return NAMES[key];
  return key.length === 1 ? key.toUpperCase() : key.replace(/_/g, ' ');
}

// "Ctrl+Shift+2", or '' when nothing is bound yet.
function bindingLabel(binding) {
  if (!binding) return '';
  return [binding.ctrl && 'Ctrl', binding.alt && 'Alt', binding.shift && 'Shift', keyName(binding.key)].filter(Boolean).join('+');
}

// Matches the physical key and the exact modifiers, so 2 and Shift+2 can be different abilities.
function matches(binding, press) {
  return !!binding && binding.code === press.code && !!binding.shift === !!press.shift &&
    !!binding.ctrl === !!press.ctrl && !!binding.alt === !!press.alt;
}

// ---- Framed buttons (mouse clicks) ----
// A frame is a rectangle drawn around a button in the game's UI, in screen coordinates (Electron DIPs).
// A left click inside it counts like pressing the item's key.
const LEFT_BUTTON = 1;
function inFrame(frame, click) {
  return !!frame && click.x >= frame.x && click.x < frame.x + frame.width && click.y >= frame.y && click.y < frame.y + frame.height;
}

// Whether a watcher event (a key press, or a click with {button, x, y}) sets off an ability or follow-up.
function triggers(item, input) {
  if (input.button !== undefined) return input.button === LEFT_BUTTON && inFrame(item.frame, input);
  return matches(item.key, input);
}

// Smallest rectangle around all frames, grown by `pad` on each side, or null when there are none.
function framesBounds(frames, pad = 0) {
  if (!frames.length) return null;
  const x = Math.min(...frames.map((f) => f.x)) - pad, y = Math.min(...frames.map((f) => f.y)) - pad;
  const right = Math.max(...frames.map((f) => f.x + f.width)) + pad, bottom = Math.max(...frames.map((f) => f.y + f.height)) + pad;
  return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(right - x), height: Math.ceil(bottom - y) };
}

// Tracks when each ability comes off cooldown. `repress` is 'ignore' (like the game, a press during a
// cooldown does nothing) or 'restart'. Returns the ids that started, so callers know whether to redraw.
class Cooldowns {
  constructor() { this.ends = new Map(); }

  press(abilities, press, { now = Date.now(), repress = 'ignore', gameOnly = true } = {}) {
    if (gameOnly && !press.game) return [];
    const started = [];
    for (const ability of abilities) {
      const ms = Math.round((Number(ability.seconds) || 0) * 1000);
      if (ms <= 0 || !triggers(ability, press)) continue;
      if (repress === 'ignore' && (this.ends.get(ability.id)?.endsAt || 0) > now) continue;
      this.ends.set(ability.id, { endsAt: now + ms, ms });
      started.push(ability.id);
    }
    return started;
  }

  // Running cooldowns only, as {id: {endsAt, ms}}; expired entries are dropped.
  state(now = Date.now()) {
    const out = {};
    for (const [id, cd] of this.ends) {
      if (cd.endsAt > now) out[id] = cd;
      else this.ends.delete(id);
    }
    return out;
  }

  reset() { this.ends.clear(); }
}

// The follow-up pop-up: press a trigger key, count down to the next ability, show GO, then fade.
// Only one runs at a time; a new trigger replaces it, and pressing the next ability's key dismisses it.
const GO_MS = 800;
class FollowUps {
  constructor() { this.active = null; }

  // Returns {type: 'start', followUp, endsAt, ms}, {type: 'cancel'} or null.
  press(followUps, abilities, press, { now = Date.now(), gameOnly = true } = {}) {
    if (gameOnly && !press.game) return null;
    if (this.active && now >= this.active.endsAt + GO_MS) this.active = null;
    // Starting takes precedence, so in a chain A -> B -> C pressing B starts B's countdown.
    const followUp = followUps.find((f) => Number(f.seconds) > 0 && triggers(f, press));
    if (followUp) {
      const ms = Math.round(Number(followUp.seconds) * 1000);
      this.active = { id: followUp.id, next: followUp.next, endsAt: now + ms, ms };
      return { type: 'start', followUp, endsAt: now + ms, ms };
    }
    const next = this.active && abilities.find((a) => a.id === this.active.next);
    if (next && triggers(next, press)) {
      this.active = null;
      return { type: 'cancel' };
    }
    return null;
  }

  cancel() { this.active = null; }
}

// Counters: each press (or click on its frame) adds one, and the count goes back to 0 once `seconds` pass
// without another press, or, with resetFrom 'first', once `seconds` pass after the press that started the count.
// Returns the ids that changed, so callers know whether to redraw.
class Counters {
  constructor() { this.counts = new Map(); }

  press(counters, press, { now = Date.now(), gameOnly = true } = {}) {
    if (gameOnly && !press.game) return [];
    const changed = [];
    for (const counter of counters) {
      // The counter's clear key (keyboard only) sets it back to 0 before its time is up.
      if (press.button === undefined && matches(counter.clearKey, press)) {
        if (this.counts.delete(counter.id)) changed.push(counter.id);
        continue;
      }
      const ms = Math.round((Number(counter.seconds) || 0) * 1000);
      if (ms <= 0 || !triggers(counter, press)) continue;
      const current = this.counts.get(counter.id);
      // "Each press separately": every press is a stack with its own reset time; the count is how many are left.
      // A press within `minGap` seconds of the last press that added a timer adds none (a double press).
      if (counter.resetFrom === 'each') {
        const gap = Math.max(0, Number(counter.minGap) || 0) * 1000;
        if (current?.lastAt !== undefined && now - current.lastAt < gap) continue;
        const stacks = [...(current?.stacks || []).filter((t) => t > now), now + ms];
        this.counts.set(counter.id, { count: stacks.length, resetAt: Math.max(...stacks), ms, stacks, lastAt: now });
        changed.push(counter.id);
        continue;
      }
      const running = current && current.resetAt > now;
      const resetAt = running && counter.resetFrom === 'first' ? current.resetAt : now + ms;
      this.counts.set(counter.id, { count: running ? current.count + 1 : 1, resetAt, ms });
      changed.push(counter.id);
    }
    return changed;
  }

  // Counts that haven't reset yet, as {id: {count, resetAt, ms}} (plus `stacks`, each press's reset time, for a
  // counter that times each press separately); reset ones are dropped.
  state(now = Date.now()) {
    const out = {};
    for (const [id, c] of this.counts) {
      if (c.stacks) c.stacks = c.stacks.filter((t) => t > now), c.count = c.stacks.length;
      if (c.resetAt > now) out[id] = c;
      else this.counts.delete(id);
    }
    return out;
  }

  reset() { this.counts.clear(); }
}

// Counter window: one square tile per counter (sized like the follow-up pop-up) in a row.
// Tile size, and room for the stack behind a tile whose presses are timed separately: up to STACK_LAYERS
// tiles peek out behind it, each `offset` px further down and right.
const STACK_LAYERS = 4;
function counterLayout(counters, { counterSize: size = 'Small' } = {}) {
  const side = FOLLOW_SIZES[size] || FOLLOW_SIZES.Small;
  const offset = Math.max(3, Math.round(side * 0.05));
  const room = STACK_LAYERS * offset;
  const list = Array.isArray(counters) ? counters : Array.from({ length: counters });
  const stacked = (c) => c?.resetFrom === 'each';
  const n = Math.max(1, list.length);
  const width = list.reduce((sum, c) => sum + side + (stacked(c) ? room : 0), 0) + (n - 1) * GAP || side;
  return { side, offset, room, layers: STACK_LAYERS, width, height: side + (list.some(stacked) ? room : 0) };
}
// The counter window's size for `counters` (a list, or how many).
function counterSize(counters, settings) {
  const { width, height } = counterLayout(counters, settings);
  return { width, height };
}

// ---- Profiles (one per character) ----
// A profile holds what differs between characters. The live copy is kept at the top of the settings, as before,
// and copied into settings.profiles[settings.profile] whenever the settings are saved.
const PROFILE_KEYS = ['abilities', 'followUps', 'counters', 'character', 'spellClass', 'quests'];
const DEFAULT_PROFILE = 'Default';
// quests: the quest tracker's chosen zone and quest, and which steps are ticked off ({ 'Quest|view': [step indexes] }).
const emptyProfile = () => ({ abilities: [], followUps: [], counters: [], character: { cls: '', race: '', level: 1 }, spellClass: '',
  quests: { zone: '', title: '', view: 'full', done: {} } });
const pickProfile = (settings) => structuredClone(Object.fromEntries(PROFILE_KEYS.map((k) => [k, settings[k] ?? emptyProfile()[k]])));

// Older settings without profiles: the current setup becomes the Default profile.
function withProfiles(settings) {
  const out = { ...settings, profiles: { ...(settings.profiles || {}) } };
  if (!out.profile || !out.profiles[out.profile]) {
    out.profile = Object.keys(out.profiles)[0] || DEFAULT_PROFILE;
    out.profiles[out.profile] ||= pickProfile(out);
  }
  return { ...out, ...structuredClone(out.profiles[out.profile]) };
}

// Saves the live copy into the current profile.
function storeProfile(settings) {
  return { ...settings, profiles: { ...settings.profiles, [settings.profile]: pickProfile(settings) } };
}

// Switches to `name`, creating an empty profile (or a copy of `copyFrom`) when it doesn't exist yet.
function switchProfile(settings, name, { copyFrom } = {}) {
  const stored = storeProfile(settings);
  if (!stored.profiles[name]) stored.profiles[name] = copyFrom && stored.profiles[copyFrom] ? structuredClone(stored.profiles[copyFrom]) : emptyProfile();
  return { ...stored, profile: name, ...structuredClone(stored.profiles[name]) };
}

function renameProfile(settings, from, to) {
  const stored = storeProfile(settings);
  if (!stored.profiles[from] || stored.profiles[to] || !to) return stored;
  stored.profiles = Object.fromEntries(Object.entries(stored.profiles).map(([k, v]) => [k === from ? to : k, v]));
  return { ...stored, profile: stored.profile === from ? to : stored.profile };
}

// Deleting the current profile switches to another one; the last profile can't be deleted.
function deleteProfile(settings, name) {
  const stored = storeProfile(settings);
  if (!stored.profiles[name] || Object.keys(stored.profiles).length < 2) return stored;
  delete stored.profiles[name];
  if (stored.profile !== name) return stored;
  const next = Object.keys(stored.profiles)[0];
  return { ...stored, profile: next, ...structuredClone(stored.profiles[next]) };
}

// What to do when `name` logs in: switch to their profile, or make one. The first character seen while the
// only profile is still the unnamed Default takes it over, since that setup was most likely made for them.
function profileForLogin(settings, name) {
  if (settings.profiles[name]) return settings.profile === name ? null : { action: 'switch', name };
  const names = Object.keys(settings.profiles);
  if (names.length === 1 && names[0] === DEFAULT_PROFILE) return { action: 'rename', from: DEFAULT_PROFILE, name };
  return { action: 'create', name };
}

// Reads the game's Player.log for the character that is logged in. The log names the character on every zone
// change, so only a different name (or the same one after going back to character select) counts as a login.
const LOGIN_LINES = [/\[LEDGER MIGRATION\] Migration complete for (\S+)/, /^client (\S+) \d+ received pet ids/];
const CHARACTER_SELECT = /^Received CharactersList/;
class LoginWatcher {
  constructor() { this.current = null; }

  // Returns the character's name when a login is seen, otherwise null.
  line(text) {
    if (CHARACTER_SELECT.test(text)) { this.current = null; return null; }
    for (const re of LOGIN_LINES) {
      const m = text.match(re);
      if (m && m[1] !== this.current) return (this.current = m[1]);
    }
    return null;
  }
}

// Reads the game's Player.log for loading screens: zoning starts at "Received Preparing Zone" (about 2.5 s before
// "Start zoning process", which also counts) and ends when the game hides its loading panel. A disconnect, character select or a fresh log also ends it, since those never finish loading.
const LOADING_START = /^(Received Preparing Zone|\[Client\]\[ZONE\] Start zoning process)/;
const LOADING_END = [/^\[Client\]\[ZONE\] Done waiting, hide LoadingPanel/, /^\[Net\] Disconnected from server/, CHARACTER_SELECT];
const ZONE_LINE = /^\[Client\]\[ZONE\] Start zoning process to (\S+)/;
class LoadingWatcher {
  constructor() { this.loading = false; this.zone = null; }

  // `zone` is the game's name for the zone being loaded, such as keepersbight.
  line(text) {
    const zone = ZONE_LINE.exec(text);
    if (zone) this.zone = zone[1].toLowerCase();
    if (LOADING_START.test(text)) this.loading = true;
    else if (this.loading && LOADING_END.some((re) => re.test(text))) this.loading = false;
    return this.loading;
  }
}

// ---- MnM Atlas maps (mnmatlas.com) ----
const ATLAS = 'https://www.mnmatlas.com';
// Game zone names that don't spell out an atlas map id.
const ZONE_ALIASES = { nightharbore: 'night-harbor', nightharborw: 'night-harbor', evergrove: 'evershade-weald' };
const compact = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

// The atlas map for a game zone (keepersbight -> keepers-bight), or null if the atlas has none.
function atlasMapForZone(zone, ids) {
  const name = compact(zone);
  if (!name) return null;
  const alias = ZONE_ALIASES[name];
  if (alias) return ids.includes(alias) ? alias : null;
  return ids.find((id) => compact(id) === name) || null;
}

// Address of a map, at a saved view {x, y, z} if there is one. embed=map is the atlas's own one-map view.
function atlasUrl(id, view, { embed = false } = {}) {
  const url = new URL(`/${encodeURIComponent(id)}/`, ATLAS);
  if (embed) url.searchParams.set('embed', 'map');
  for (const k of ['x', 'y', 'z']) if (Number.isFinite(view?.[k])) url.searchParams.set(k, String(view[k]));
  return url.href;
}

const isAtlasUrl = (href) => { try { return new URL(href).origin === ATLAS; } catch { return false; } };

// {map, view} from an atlas address; the atlas keeps it up to date as you pan and zoom.
function atlasView(href) {
  if (!isAtlasUrl(href)) return null;
  const url = new URL(href);
  const map = decodeURIComponent(url.pathname.split('/')[1] || '');
  if (!map || map === 'embed') return null;
  const nums = ['x', 'y', 'z'].map((k) => Number(url.searchParams.get(k)));
  const view = url.searchParams.has('x') && nums.every(Number.isFinite) ? { x: nums[0], y: nums[1], z: nums[2] } : null;
  return { map, view };
}

// ---- Importing a class's abilities from the wiki spell list ----
// Spell lines with ranks ("Barbed Arrow I" ... "V") share a base name; only the best rank you can use is offered.
const RANK = /\s+([IVX]+|\d+)$/;
const ROMAN = { I: 1, V: 5, X: 10 };
const lineKey = (spell) => (spell.page || spell.name).replace(RANK, '').trim().toLowerCase();
function rankOf(spell) {
  const m = (spell.page || spell.name).match(RANK);
  if (!m) return 0;
  if (/^\d+$/.test(m[1])) return +m[1];
  return [...m[1]].reduce((sum, c, i, all) => sum + (ROMAN[all[i + 1]] > ROMAN[c] ? -ROMAN[c] : ROMAN[c]), 0);
}
// A rank's page title says which rank it is when the spell name doesn't ("Ancestral Wisdom" on page "... II").
const displayName = (spell) => (spell.page && RANK.test(spell.page) && spell.page.replace(RANK, '').trim() === spell.name ? spell.page : spell.name);

// What the character can learn: for each spell line, the highest rank available to `cls` (or `race`) at
// `level`. Returns {add: [{spell, recommended}], upgrades: [{ability, spell}], have: n}.
// Abilities already in the list (matched by their wiki page's spell line) are not added again; if a better
// rank is now available they are offered as an upgrade, which keeps the ability's key.
function planImport(spells, abilities, { cls, race = '', level }) {
  const best = new Map(); // line -> {spell, level}
  for (const spell of spells) {
    const lvl = Math.min(...[cls, race].filter(Boolean).map((c) => spell.classes?.[c] ?? Infinity));
    if (!(lvl <= level)) continue;
    const key = lineKey(spell), current = best.get(key);
    if (!current || lvl > current.level || (lvl === current.level && rankOf(spell) > rankOf(current.spell))) best.set(key, { spell, level: lvl });
  }
  const pages = new Map(spells.map((spell) => [spell.page, spell]));
  const owned = new Map(); // line -> ability
  for (const ability of abilities) {
    const spell = pages.get(ability.wiki);
    if (spell) owned.set(lineKey(spell), { ability, spell });
  }
  const add = [], upgrades = [];
  let have = 0;
  for (const [key, { spell, level: lvl }] of best) {
    const mine = owned.get(key);
    if (!mine) add.push({ spell, level: lvl, recommended: spell.recast > 0 });
    else if (mine.spell.page !== spell.page && rankOf(spell) > rankOf(mine.spell)) upgrades.push({ ability: mine.ability, spell, level: lvl });
    else have++;
  }
  add.sort((a, b) => a.level - b.level || a.spell.name.localeCompare(b.spell.name));
  return { add, upgrades, have };
}

// The ability a wiki spell becomes. Spells without a listed recast start with no cooldown for you to fill in.
function abilityFromSpell(spell, id) {
  return { id, name: displayName(spell), icon: spell.icon || '', key: null, seconds: spell.recast > 0 ? spell.recast : 0, wiki: spell.page };
}

// Upgrading keeps the ability's id and key; a cooldown you typed in is kept unless the new rank lists one.
function upgradeAbility(ability, spell) {
  return { ...ability, name: displayName(spell), icon: spell.icon || ability.icon, seconds: spell.recast > 0 ? spell.recast : ability.seconds, wiki: spell.page };
}

// Game icons saved by MnM Icon Creator ({ name, file }) take the place of the bundled wiki icon on spells and
// abilities with the same name. An absolute icon path is a picture you chose (grabbed, custom or already a game
// icon), so it is kept. Returns the same array when nothing changes.
function withGameIcons(items, icons) {
  const byName = new Map(icons.map((icon) => [icon.name.trim().toLowerCase(), icon.file]));
  let changed = false;
  const out = items.map((item) => {
    if (item.icon?.startsWith('/')) return item;
    const file = [displayName(item), item.name].map((n) => byName.get((n || '').trim().toLowerCase())).find(Boolean);
    if (!file) return item;
    changed = true;
    return { ...item, icon: file };
  });
  return changed ? out : items;
}

const FOLLOW_SIZES = { 'Extra small': 72, Small: 96, Medium: 128, Large: 170 };

// Game clock window: width per size, and a shorter window without the date line.
const CLOCK_SIZES = { Small: 150, Medium: 190, Large: 240 };
function clockSize({ clockSize: size = 'Medium', clockDate = true } = {}) {
  const width = CLOCK_SIZES[size] || CLOCK_SIZES.Medium;
  return { width, height: Math.round(width * (clockDate ? 0.5 : 0.34)) };
}

const SIZES = { Small: 40, Medium: 56, Large: 72, 'Extra large': 96 };
const GAP = 4;
const PAD = 6; // room for the move-mode outline and the ready glow

// Overlay window size for n tiles in a row or column.
function overlaySize(count, { layout = 'horizontal', size = 'Medium' } = {}) {
  const tile = SIZES[size] || SIZES.Medium;
  const n = Math.max(1, count);
  const long = n * tile + (n - 1) * GAP + PAD * 2, short = tile + PAD * 2;
  return layout === 'vertical' ? { width: short, height: long } : { width: long, height: short };
}

// Splits the watcher's stdout into parsed JSON lines. Returns a function to feed chunks to.
function lineParser(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch { /* ignore stray output */ }
    }
  };
}

module.exports = { counterLayout, ATLAS, ZONE_ALIASES, atlasMapForZone, atlasUrl, atlasView, isAtlasUrl, PROFILE_KEYS, DEFAULT_PROFILE, emptyProfile, withProfiles, storeProfile, switchProfile, renameProfile, deleteProfile, profileForLogin, LoginWatcher, LoadingWatcher, Counters, counterSize, inFrame, triggers, framesBounds, planImport, abilityFromSpell, upgradeAbility, displayName, withGameIcons, FollowUps, FOLLOW_SIZES, CLOCK_SIZES, clockSize, GO_MS, isModifier, bindingFromPress, bindingLabel, keyName, matches, Cooldowns, overlaySize, lineParser, SIZES, GAP, PAD };
