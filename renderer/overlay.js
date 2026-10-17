// Draws one tile per ability: icon, a dark sweep for the time left, whole seconds, and a glow when ready.
const bar = document.getElementById('bar');
const READY_FLASH_MS = 900;
let state = null, running = {}, tiles = new Map(), frame = 0, layoutKey = '', stackSeq = 0;

function build() {
  const { settings, labels } = state;
  const key = JSON.stringify([settings.abilities.map((a) => [a.id, a.icon]), settings.layout, settings.size]);
  document.body.className = [settings.layout === 'vertical' ? 'vertical' : 'horizontal', 'size-' + settings.size.replace(' ', '-'),
    'ready-' + settings.ready, settings.stack ? 'stack' : '', settings.showKeys ? 'keys' : '', state.moving ? 'moving' : ''].join(' ');
  if (key !== layoutKey) {
    layoutKey = key;
    bar.replaceChildren();
    tiles.clear();
    for (const ability of settings.abilities) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = '<img alt=""><div class="sweep"></div><span class="time"></span><span class="key"></span>';
      tile.querySelector('img').src = iconUrl(ability.icon);
      bar.append(tile);
      tiles.set(ability.id, { el: tile, sweep: tile.querySelector('.sweep'), time: tile.querySelector('.time'), key: tile.querySelector('.key'), was: false, endsAt: 0 });
    }
  }
  for (const ability of settings.abilities) {
    const tile = tiles.get(ability.id);
    tile.el.title = ability.name || '';
    tile.key.textContent = labels[ability.id] || '';
  }
  draw();
}

function formatLeft(ms) {
  const s = Math.ceil(ms / 1000);
  if (s >= 60) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  return String(s);
}

function draw() {
  cancelAnimationFrame(frame);
  if (!state) return;
  const now = Date.now();
  let busy = false;
  for (const [id, tile] of tiles) {
    const cd = running[id];
    const left = cd ? cd.endsAt - now : 0;
    if (left > 0) {
      busy = true;
      // Stacking: a cooldown that just started goes to the end of the stack (CSS order; the rest keep theirs).
      if (cd.endsAt !== tile.endsAt) { tile.endsAt = cd.endsAt; tile.el.style.order = ++stackSeq; }
      tile.el.classList.add('cooling');
      tile.el.classList.remove('flash');
      // Sweep covers the remaining fraction, draining clockwise like the game's hotbar.
      tile.sweep.style.setProperty('--left', (left / cd.ms * 360).toFixed(1) + 'deg');
      tile.time.textContent = formatLeft(left);
      tile.was = true;
    } else {
      if (tile.was) {
        // Just came off cooldown: glow briefly.
        tile.was = false;
        tile.el.classList.remove('flash');
        void tile.el.offsetWidth; // restart the animation if it flashed recently
        tile.el.classList.add('flash');
        setTimeout(() => tile.el.classList.remove('flash'), READY_FLASH_MS);
      }
      tile.el.classList.remove('cooling');
      tile.time.textContent = '';
    }
  }
  if (busy) frame = requestAnimationFrame(draw);
}

window.mnm.onState((next) => { state = next; build(); });
window.mnm.onCooldowns((next) => { running = next; draw(); });

// Drag with pointer capture so the window keeps following even when the cursor outruns it.
bar.addEventListener('pointerdown', (event) => {
  if (!state?.moving || event.button !== 0) return;
  bar.setPointerCapture(event.pointerId);
  window.mnm.dragStart(event.screenX, event.screenY);
});
bar.addEventListener('pointermove', (event) => {
  if (bar.hasPointerCapture(event.pointerId)) window.mnm.dragMove(event.screenX, event.screenY);
});
const endDrag = (event) => { if (bar.hasPointerCapture(event.pointerId)) { bar.releasePointerCapture(event.pointerId); window.mnm.dragEnd(); } };
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('pointercancel', endDrag);

window.mnm.onLoading((on) => document.documentElement.classList.toggle('loading', on));
