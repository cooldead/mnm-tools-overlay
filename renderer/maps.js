// Map window: MnM Atlas or the wiki's zone maps, picked with the tabs at the top. The atlas loads the first
// time you look at it; both follow the zone you enter (the main process sends the maps). On a wiki map:
// drag to pan, scroll or +/− to zoom, 0 to fit.
const atlas = document.getElementById('atlas'), pick = document.getElementById('pick');
const status = document.getElementById('status'), credit = document.getElementById('credit');
const tabs = [...document.querySelectorAll('.sources button')];
let source = 'atlas', atlasUrl = null, maps = [], views = {}, current = null;

const view = new MapView(document.getElementById('view'), {
  onView: (v) => { if (current) { views[current.id] = v; window.mnm.mapView(current.id, v); } },
  onLoad: () => { status.textContent = ''; },
  onError: () => { status.textContent = 'Could not load this map from the wiki. Check your connection and pick it again.'; },
});

function setSource(next, save = false) {
  source = next === 'wiki' && maps.length ? 'wiki' : 'atlas';
  document.body.classList.toggle('wiki', source === 'wiki');
  for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.source === source));
  if (source === 'atlas' && atlasUrl && !atlas.getAttribute('src')) atlas.setAttribute('src', atlasUrl);
  document.title = source === 'wiki' && current ? `${current.title} — Wiki maps` : 'MnM Atlas — Maps';
  if (save) window.mnm.setMapsSource(source);
}

// The atlas at an address: now if it is loaded, otherwise when you first switch to it.
function showAtlas(url) {
  atlasUrl = url;
  if (atlas.getAttribute('src')) atlas.loadURL(url).catch(() => {});
}

function showWiki(id, saved) {
  const map = maps.find((m) => m.id === id) || maps[0];
  if (!map) return;
  current = map;
  pick.value = map.id;
  if (saved) views[map.id] = saved;
  status.textContent = 'Loading the map from the wiki…';
  view.show(map.src, views[map.id]);
  credit.textContent = `${map.title}: map by ${map.user} (uploaded ${map.uploaded}), Monsters & Memories Wiki, CC BY-SA 4.0`;
  if (source === 'wiki') document.title = `${map.title} — Wiki maps`;
}

function fill() {
  pick.replaceChildren();
  const groups = new Map();
  for (const m of maps) {
    const name = m.zone || 'World';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(m);
  }
  for (const [name, list] of groups) {
    const group = document.createElement('optgroup');
    group.label = name;
    for (const m of list) group.append(new Option(m.title, m.id));
    pick.append(group);
  }
}

for (const tab of tabs) tab.addEventListener('click', () => setSource(tab.dataset.source, true));
document.getElementById('srcWiki').disabled = true; // until the list is in
pick.addEventListener('change', () => { showWiki(pick.value); window.mnm.showWikiMap(pick.value); });
document.getElementById('zoomIn').addEventListener('click', () => view.zoom(1));
document.getElementById('zoomOut').addEventListener('click', () => view.zoom(-1));
const fit = () => { view.set({ x: 0.5, y: 0.5, z: 1 }); view.changed(); };
document.getElementById('fit').addEventListener('click', fit);
document.getElementById('toMinimap').addEventListener('click', () => window.mnm.mapsToMinimap(source, current?.id));
document.getElementById('wikiPage').addEventListener('click', () => current && window.mnm.openWikiPage(current.page));
document.addEventListener('keydown', (event) => {
  if (source !== 'wiki' || event.target === pick || event.ctrlKey || event.altKey) return;
  if (event.key === '+' || event.key === '=') view.zoom(1);
  else if (event.key === '-') view.zoom(-1);
  else if (event.key === '0') fit();
});

window.mnm.onMapsShow(({ source: next, url, wiki }) => {
  if (url) showAtlas(url);
  if (wiki) showWiki(wiki.id, wiki.view);
  if (next) setSource(next);
});
window.mnm.mapsInit().then((data) => {
  atlasUrl = data.atlasUrl;
  maps = data.maps;
  views = { ...data.views };
  document.getElementById('srcWiki').disabled = !maps.length;
  fill();
  if (maps.length) showWiki(data.current);
  setSource(data.source);
});
