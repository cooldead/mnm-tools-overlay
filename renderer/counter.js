// Counter tiles: each shows its count over its icon, with a bar draining until the count resets to 0.
// A counter that times each press separately counts the presses still running; one tile per further press
// peeks out behind it, and its bar drains toward the next press running out.
const box = document.getElementById('tiles'), template = document.getElementById('tile');
let list = [], counts = {}, tiles = new Map(), frame = 0, moving = false, layout = { layers: 4 };

// One tile per counter, rebuilt when the counters change in the settings.
function build() {
  box.replaceChildren();
  tiles = new Map();
  for (const counter of list) {
    const slot = template.content.firstElementChild.cloneNode(true);
    const face = slot.querySelector('.face');
    face.querySelector('.icon').src = iconUrl(counter.icon);
    slot.title = counter.name || '';
    const layers = [];
    if (counter.resetFrom === 'each') {
      slot.classList.add('stacked');
      for (let n = 1; n <= layout.layers; n++) {
        const layer = document.createElement('div');
        layer.className = 'layer';
        layer.style.setProperty('--n', n);
        layer.style.zIndex = 10 - n;
        layers.push(layer);
      }
      slot.querySelector('.layers').append(...layers);
    }
    box.append(slot);
    tiles.set(counter.id, { face, layers, value: face.querySelector('.value'), fill: face.querySelector('.fill'), shown: -1 });
  }
}

function tick() {
  const now = Date.now();
  let running = false;
  for (const [id, tile] of tiles) {
    const c = counts[id];
    const stacks = c?.stacks?.filter((t) => t > now);
    const live = c && c.resetAt > now;
    const count = !live ? 0 : stacks ? stacks.length : c.count;
    // The bar: until the count resets, or for stacks until the next one runs out.
    const until = stacks?.length ? Math.min(...stacks) : c?.resetAt;
    if (count !== tile.shown) {
      // Replay the bump on every increase.
      if (count > tile.shown && count > 0) { tile.face.classList.remove('bump'); void tile.face.offsetWidth; tile.face.classList.add('bump'); }
      tile.shown = count;
      tile.value.textContent = String(count);
      tile.face.classList.toggle('zero', count === 0);
      tile.layers.forEach((layer, i) => layer.classList.toggle('on', i < count - 1));
    }
    tile.fill.style.transform = `scaleX(${live ? Math.min(1, (until - now) / c.ms) : 0})`;
    running ||= live;
  }
  frame = running ? requestAnimationFrame(tick) : 0;
}

const redraw = () => { cancelAnimationFrame(frame); tick(); };

window.mnm.onCounters((state) => { counts = state; redraw(); });

window.mnm.onState((state) => {
  const { counters = [], counterIdle = 'dim' } = state.settings;
  document.body.className = 'idle-' + counterIdle;
  moving = state.moving;
  document.body.classList.toggle('moving', moving);
  layout = state.counterLayout || layout;
  for (const k of ['side', 'offset', 'room']) document.body.style.setProperty('--' + k, (layout[k] || 0) + 'px');
  const shape = (all) => JSON.stringify(all.map((c) => [c.id, c.icon, c.name, c.resetFrom === 'each']));
  if (shape(counters) !== shape(list)) {
    list = counters;
    build();
  }
  redraw();
});

// Drag with pointer capture so the window keeps following even when the cursor outruns it.
box.addEventListener('pointerdown', (event) => {
  if (!moving || event.button !== 0) return;
  box.setPointerCapture(event.pointerId);
  window.mnm.dragStart(event.screenX, event.screenY);
});
box.addEventListener('pointermove', (event) => {
  if (box.hasPointerCapture(event.pointerId)) window.mnm.dragMove(event.screenX, event.screenY);
});
const endDrag = (event) => { if (box.hasPointerCapture(event.pointerId)) { box.releasePointerCapture(event.pointerId); window.mnm.dragEnd(); } };
box.addEventListener('pointerup', endDrag);
box.addEventListener('pointercancel', endDrag);

window.mnm.onLoading((on) => document.documentElement.classList.toggle('loading', on));
