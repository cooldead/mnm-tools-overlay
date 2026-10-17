// Spell and ability data from the Monsters & Memories community wiki (monstersandmemories.miraheze.org).
// Every spell page uses the {{Spellpagesmart}} template, so the fields can be read straight from its wikitext.
// Used by scripts/update-spells.js (bundled snapshot) and by the app's "Update from wiki" button.

const fs = require('fs');
const path = require('path');

const API = 'https://monstersandmemories.miraheze.org/w/api.php';
const CATEGORY = 'Category:Spells & Abilities';
const USER_AGENT = 'mnm-tools/0.1 (personal game overlay; https://monstersandmemories.miraheze.org)';
const BATCH = 50; // MediaWiki's limit for titles per query
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= 3) throw new Error(`Wiki request failed: ${error.message}`);
      await sleep(1000 * attempt);
    }
  }
}

// ---- Wikitext parsing ----

// Template fields. `=[ \t]*` (not `\s*`) so an empty field doesn't swallow the next line.
function templateParams(body) {
  const params = {};
  const re = /\|\s*([a-z0-9_]+)\s*=[ \t]*([\s\S]*?)(?=\n\s*\|\s*[a-z0-9_]+\s*=|\n\}\}|$)/gi;
  let match;
  while ((match = re.exec(body))) params[match[1].toLowerCase()] = match[2].trim();
  return params;
}

// Wikitext to plain text: [[a|b]] -> b, [[a]] -> a, no bold/italics, tags or templates.
const plain = (s) => String(s || '')
  .replace(/'''?/g, '').replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();

const UNITS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };

// "6 seconds", "12.0 Seconds", "5 minutes", "1 min 30 sec", "8 sec" -> seconds. "Instant" -> 0.
// Blank, "??" or anything unrecognised -> null (unknown), so nothing is ever guessed.
// Only the leading time is read, so "6 seconds (3 with X)" is 6. A bare number is only trusted when the
// caller says which unit the field uses (recasts are listed in seconds; a bare duration could be either).
function parseSeconds(text, { bare = null } = {}) {
  const s = plain(text).toLowerCase();
  if (!s) return null;
  if (/^instant/.test(s)) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s) === 0 ? 0 : bare ? parseFloat(s) * UNITS[bare] : null;
  const re = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\b\s*(?:and\s+|,\s*)?/;
  let rest = s, total = 0, found = false, match;
  while ((match = re.exec(rest)) && UNITS[match[2]]) {
    total += parseFloat(match[1]) * UNITS[match[2]];
    found = true;
    rest = rest.slice(match[0].length);
  }
  return found ? Math.round(total * 10) / 10 : null;
}

function parseSpell(wikitext) {
  const m = String(wikitext).match(/\{\{\s*Spellpagesmart([\s\S]*?)\n\}\}/i);
  if (!m) return null;
  const p = templateParams(m[1]);
  const name = plain(p.spellname);
  if (!name) return null;
  // "*[[Necromancer]] - Level 4" -> { Necromancer: 4 }
  const classes = {};
  for (const c of (p.classes || '').matchAll(/\[\[([^\]|]+)[^\]]*\]\]\s*[-–]\s*Level\s*(\d+)/gi)) classes[plain(c[1])] = +c[2];
  const gcd = /^yes/i.test(plain(p.triggers_gcd)) ? true : /^no/i.test(plain(p.triggers_gcd)) ? false : null;
  return {
    name,
    classes,
    description: plain(p.description).slice(0, 300),
    type: plain(p.spell_type),
    cast: parseSeconds(p.casting_time),
    recast: parseSeconds(p.recast_time, { bare: 's' }),
    recastText: plain(p.recast_time),
    duration: parseSeconds(p.duration),
    durationText: plain(p.duration),
    gcd,
  };
}

// "Blast_of_water.png" -> "blast of water", the key used to match the bundled icon catalog's wikiName.
const fileKey = (file) => file.replace(/^File:/i, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ').trim().toLowerCase();

function slug(file) {
  return fileKey(file).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'icon';
}

// ---- Fetching ----

async function listPages() {
  const titles = [];
  let cont = {};
  do {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: CATEGORY, cmlimit: 'max', cmtype: 'page', ...cont });
    for (const member of j.query?.categorymembers || []) titles.push(member.title);
    cont = j.continue ? { cmcontinue: j.continue.cmcontinue } : null;
    await sleep(200);
  } while (cont);
  return titles;
}

// Wikitext and the images each page uses, for one batch of titles.
async function fetchBatch(titles) {
  const j = await api({ action: 'query', prop: 'revisions|images', rvprop: 'content', rvslots: 'main', imlimit: 'max', titles: titles.join('|') });
  const pages = {};
  for (const page of j.query?.pages || []) {
    pages[page.title] = {
      text: page.revisions?.[0]?.slots?.main?.content || '',
      images: (page.images || []).map((i) => i.title),
    };
  }
  return pages;
}

// The page's icon: the image whose name matches its spellicon field, else its only image.
function pickIcon(wikitext, images) {
  const field = (String(wikitext).match(/\|\s*spellicon\s*=[ \t]*([^\n|]*)/i) || [])[1] || '';
  const want = fileKey(field);
  return images.find((f) => want && fileKey(f) === want) || (images.length === 1 ? images[0] : null);
}

async function imageUrls(files) {
  const urls = {};
  for (let i = 0; i < files.length; i += BATCH) {
    const j = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url', titles: files.slice(i, i + BATCH).join('|') });
    // Titles come back normalised ("File:Blast_of_water.png" -> "File:Blast of water.png"), so key by fileKey.
    for (const page of j.query?.pages || []) if (page.imageinfo?.[0]?.url) urls[fileKey(page.title)] = page.imageinfo[0].url;
    await sleep(200);
  }
  return urls;
}

async function download(url, dest) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

// Builds the spell list. Icons already in the bundled catalog are reused; the rest are downloaded into
// `iconDir`, and `iconRef(fileName)` turns a downloaded file name into what an ability stores as its icon.
// `known` (spells from an earlier list) lets icons downloaded before be reused instead of fetched again.
async function updateSpells({ catalog = [], known = [], iconDir, iconRef, onProgress = () => {} }) {
  const bundled = new Map(catalog.filter((i) => i.wikiName).map((i) => [i.wikiName.toLowerCase(), i.file || i.id + '.png']));
  for (const spell of known) if (spell.iconFile && spell.icon && !bundled.has(spell.iconFile)) bundled.set(spell.iconFile, spell.icon);
  onProgress({ step: 'Listing spells…' });
  const titles = await listPages();
  const spells = [], wanted = new Map(); // fileKey -> spells needing that icon

  for (let i = 0; i < titles.length; i += BATCH) {
    onProgress({ step: 'Reading spell pages…', done: Math.min(i + BATCH, titles.length), total: titles.length });
    const pages = await fetchBatch(titles.slice(i, i + BATCH));
    for (const [title, page] of Object.entries(pages)) {
      const spell = parseSpell(page.text);
      if (!spell) continue;
      spell.page = title;
      const file = pickIcon(page.text, page.images);
      spell.icon = '';
      if (file) {
        const key = spell.iconFile = fileKey(file);
        if (bundled.has(key)) spell.icon = bundled.get(key);
        else (wanted.get(key) || wanted.set(key, { file, spells: [] }).get(key)).spells.push(spell);
      }
      spells.push(spell);
    }
    await sleep(300);
  }

  // Download icons the bundled catalog doesn't have.
  let downloaded = 0, failed = 0;
  if (wanted.size) {
    fs.mkdirSync(iconDir, { recursive: true });
    const urls = await imageUrls([...wanted.values()].map((w) => w.file));
    let n = 0;
    for (const [key, { file, spells: users }] of wanted) {
      onProgress({ step: 'Downloading missing icons…', done: ++n, total: wanted.size });
      const url = urls[key];
      if (!url) { failed++; continue; }
      const name = slug(file) + (path.extname(new URL(url).pathname).toLowerCase() || '.png');
      const dest = path.join(iconDir, name);
      try {
        if (!fs.existsSync(dest)) { await download(url, dest); await sleep(150); }
        for (const spell of users) spell.icon = iconRef(name);
        downloaded++;
      } catch { failed++; }
    }
  }

  spells.sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: new Date().toISOString(), source: API.replace('/w/api.php', ''), iconsDownloaded: downloaded, iconsFailed: failed, spells };
}

module.exports = { updateSpells, parseSpell, parseSeconds, templateParams, fileKey, pickIcon };
