// Zone maps from the Monsters & Memories community wiki (monstersandmemories.miraheze.org), CC BY-SA 4.0.
// The wiki has no map category, so maps are found by file name: every file with "map" in its name that a zone
// page shows, or whose name spells out a zone ("Glass_Flats_Map.png"). Placeholders and NPC "where to find
// me" crops are left out. The images themselves aren't copied: the app shows them from the wiki's file server.
// Used by scripts/update-maps.js (bundled list) and by the app, which refreshes the list now and then.

const API = 'https://monstersandmemories.miraheze.org/w/api.php';
const WIKI = API.replace('/w/api.php', '');
const USER_AGENT = 'mnm-tools/0.1 (personal game overlay; https://monstersandmemories.miraheze.org)';
const BATCH = 50;
// Longest side of the image the app loads; bigger maps come as a wiki thumbnail of this size.
const MAX_SIDE = 6144;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Files that say "map" but aren't one (or aren't a zone's), by file name with underscores.
const SKIP = new Set(['Map.png', 'Phformaps.png', 'Telekirmap0.png', 'Listener_Maplebloom.png']);
// Maps no zone page shows and whose name doesn't say the zone. zone: null is a whole-world map.
const EXTRA = {
  'Mm-map.png': { zone: 'Night Harbor' },
  'WNH-Map-v05.png': { zone: 'Night Harbor', title: 'West Night Harbor' },
  'Deep_Dunes_Map.png': { zone: 'Deep Dunes' },
  'AêthorilMap.png': { zone: null, title: 'Aêthoril' },
  'Zone_Connection_Map.png': { zone: null, title: 'Zone connections' },
};

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

const compact = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
const fileKey = (name) => name.replace(/^File:/, '').replace(/ /g, '_');

// The maps among the wiki's files. `files` [{name, width, height, size, user, timestamp}] (name with
// underscores), `zones` the zone page titles, `usage` {file name: [page titles that show it]}.
// Returns the maps with their zone (null for world maps), grouped by zone, the one a zone page shows first,
// then the newest.
function pickMaps(files, zones, usage) {
  const byLength = [...zones].sort((a, b) => b.length - a.length);
  const picked = [];
  for (const file of files) {
    const name = fileKey(file.name);
    if (!/map/i.test(name) || SKIP.has(name) || !/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const pages = (usage[name] || []).filter((page) => zones.includes(page));
    const extra = EXTRA[name];
    const base = compact(name.replace(/\.[^.]+$/, ''));
    const zone = extra ? extra.zone : pages[0] || byLength.find((z) => base.includes(compact(z)));
    if (zone === undefined) continue;
    picked.push({ ...file, name, zone, title: extra?.title || null, shown: pages.length > 0 });
  }
  // The same map uploaded twice under two names (same zone, uploader and size): keep the one a page shows.
  const kept = picked.filter((m, i) => !picked.some((o, j) => j !== i && o.zone === m.zone && o.user === m.user
    && o.width === m.width && o.height === m.height && (o.shown > m.shown || (o.shown === m.shown && j < i))));
  const zoneOrder = (m) => (m.zone === null ? '' : m.zone);
  kept.sort((a, b) => zoneOrder(a).localeCompare(zoneOrder(b)) || b.shown - a.shown || b.timestamp.localeCompare(a.timestamp));
  const perZone = {};
  for (const m of kept) perZone[m.zone] = (perZone[m.zone] || 0) + 1;
  return kept.map((m) => ({
    id: 'wiki:' + m.name,
    file: m.name,
    zone: m.zone,
    title: m.title || (m.zone === null ? m.name.replace(/[_-]?map\.[^.]+$/i, '') : perZone[m.zone] > 1 ? `${m.zone} (${m.user}, ${m.timestamp.slice(0, 4)})` : m.zone),
    user: m.user,
    uploaded: m.timestamp.slice(0, 10),
    width: m.width,
    height: m.height,
  }));
}

async function allImages() {
  const files = [];
  let from = null;
  do {
    const data = await api({ action: 'query', list: 'allimages', ailimit: 500, aiprop: 'size|user|timestamp', ...(from ? { aicontinue: from } : {}) });
    files.push(...data.query.allimages.map(({ name, width, height, size, user, timestamp }) => ({ name, width, height, size, user, timestamp })));
    from = data.continue?.aicontinue;
  } while (from);
  return files;
}

async function zonePages() {
  const data = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Zones', cmlimit: 500, cmnamespace: 0 });
  return data.query.categorymembers.map((p) => p.title);
}

async function fileUsage(names) {
  const usage = {};
  for (let i = 0; i < names.length; i += BATCH) {
    const data = await api({ action: 'query', prop: 'fileusage', fulimit: 500, funamespace: 0, titles: names.slice(i, i + BATCH).map((n) => 'File:' + n).join('|') });
    for (const page of data.query.pages) usage[fileKey(page.title)] = (page.fileusage || []).map((p) => p.title);
  }
  return usage;
}

// The address of each map's image, as a thumbnail when it is bigger than MAX_SIDE.
async function addSources(maps, onProgress) {
  for (const [i, map] of maps.entries()) {
    onProgress({ step: 'Finding the images…', done: i, total: maps.length });
    const scale = Math.min(1, MAX_SIDE / Math.max(map.width, map.height));
    const data = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url', iiurlwidth: Math.round(map.width * scale), titles: 'File:' + map.file });
    const info = data.query.pages[0]?.imageinfo?.[0];
    if (!info) continue;
    map.src = scale < 1 && info.thumburl ? info.thumburl : info.url;
    map.page = info.descriptionurl;
  }
  return maps.filter((m) => m.src);
}

async function updateMaps({ onProgress = () => {} } = {}) {
  onProgress({ step: 'Listing files…' });
  const [files, zones] = await Promise.all([allImages(), zonePages()]);
  const candidates = files.filter((f) => /map/i.test(f.name));
  onProgress({ step: 'Checking which pages show them…' });
  const usage = await fileUsage(candidates.map((f) => fileKey(f.name)));
  const maps = await addSources(pickMaps(candidates, zones, usage), onProgress);
  return { generatedAt: new Date().toISOString(), source: WIKI, license: 'CC BY-SA 4.0', maps };
}

// The maps for a game zone (nightharbore, keepersbight, ...), the zone's usual map first. `aliases` maps
// compact game names to wiki zone names that differ ({nightharbore: 'night-harbor'}).
function mapsForZone(zone, maps, aliases = {}) {
  const name = compact(zone);
  if (!name) return [];
  const wanted = compact(aliases[name] || name);
  return maps.filter((m) => m.zone !== null && compact(m.zone) === wanted);
}

const isWikiMap = (id) => typeof id === 'string' && id.startsWith('wiki:');

module.exports = { updateMaps, pickMaps, mapsForZone, isWikiMap, compact, WIKI, SKIP, EXTRA };
