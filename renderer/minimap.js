// Minimap: the atlas's one-map view of the current zone, or a wiki map. The main process picks the map and
// keeps the view (the atlas reports its own view; a wiki map's view is sent back from here).
const map = document.getElementById('map'), wikiBox = document.getElementById('wikimap'), credit = document.getElementById('credit'), cover = document.getElementById('cover'), grip = document.getElementById('grip'), badge = document.getElementById('badge');
let badgeTimer = null;

function showBadge(text, ms = 0) {
  clearTimeout(badgeTimer);
  badge.textContent = text;
  badge.hidden = !text;
  if (text && ms) badgeTimer = setTimeout(() => { badge.hidden = true; }, ms);
}

let wikiId = null;
const wikiView = new MapView(wikiBox, {
  onView: (view) => { if (wikiId) window.mnm.mapView(wikiId, view); },
  onError: () => showBadge('Could not load the map from the wiki', 6000),
});

window.mnm.onMinimap(({ url, wiki, note, interact, round }) => {
  if (url && map.getAttribute('src') !== url) map.setAttribute('src', url);
  if (url) { wikiId = null; document.body.classList.remove('wiki'); wikiBox.hidden = credit.hidden = true; }
  if (wiki) {
    wikiId = wiki.id;
    document.body.classList.add('wiki');
    wikiBox.hidden = credit.hidden = false;
    wikiView.show(wiki.src, wiki.view);
    credit.textContent = `${wiki.title} · map by ${wiki.user}, M&M Wiki (CC BY-SA)`;
    if (!note && !interact) note = credit.textContent;
  }
  document.body.classList.toggle('interact', !!interact);
  document.body.classList.toggle('round', !!round);
  if (interact) showBadge(note || 'Drag to pan, scroll to zoom. Lock it again when done.', 4000);
  else showBadge(note || '', 5000);
});

window.mnm.onState((state) => document.body.classList.toggle('moving', state.moving));

// Move mode: drag the cover to move the window, or the corner grip to resize it.
function dragWith(el, mode) {
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    el.setPointerCapture(event.pointerId);
    window.mnm.dragStart(event.screenX, event.screenY, mode);
  });
  el.addEventListener('pointermove', (event) => {
    if (el.hasPointerCapture(event.pointerId)) window.mnm.dragMove(event.screenX, event.screenY);
  });
  const end = (event) => { if (el.hasPointerCapture(event.pointerId)) { el.releasePointerCapture(event.pointerId); window.mnm.dragEnd(); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
dragWith(cover, 'move');
dragWith(document.getElementById('handle'), 'move');
dragWith(grip, 'resize');

// Zoom keys, for a wiki map (the atlas zooms with its own buttons).
window.mnm.onMinimapZoom((direction) => { if (wikiId) wikiView.zoom(direction); });

window.mnm.onLoading((on) => document.documentElement.classList.toggle('loading', on));
