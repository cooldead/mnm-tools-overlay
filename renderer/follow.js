// Follow-up pop-up: whole seconds with a draining bar over the next ability's icon, then GO, then fades out.
const GO_MS = 800;
const face = document.getElementById('face'), value = document.getElementById('value'), fill = document.getElementById('fill');
const icon = document.getElementById('icon');
let current = null, frame = 0, fade = 0, moving = false;

function draw(text, fraction, go) {
  face.classList.toggle('go', go);
  value.textContent = text;
  fill.style.transform = `scaleX(${fraction})`;
}

function show(text, fraction, go) {
  clearTimeout(fade);
  document.body.classList.remove('idle');
  draw(text, fraction, go);
}

function setIcon(src, name) {
  icon.hidden = !src;
  if (src) icon.src = src;
  face.title = name || '';
}

function idle() {
  current = null;
  cancelAnimationFrame(frame);
  if (moving) return show('3', 0.6, false);
  document.body.classList.add('idle');
  // Keep GO on screen while it fades, then reset to the blank idle face.
  clearTimeout(fade);
  fade = setTimeout(() => { draw('–', 0, false); setIcon(''); }, 700);
}

function tick() {
  const left = current.endsAt - Date.now();
  if (left <= -GO_MS) return idle();
  if (left > 0) show(String(Math.ceil(left / 1000)), Math.min(1, left / current.ms), false);
  else show('GO', 1, true);
  frame = requestAnimationFrame(tick);
}

window.mnm.onFollow((message) => {
  if (message.type === 'cancel') return idle();
  if (message.type !== 'start' || !(message.ms > 0)) return;
  cancelAnimationFrame(frame);
  setIcon(message.icon ? iconUrl(message.icon) : '', message.name);
  current = { ms: message.ms, endsAt: message.endsAt };
  tick();
});

window.mnm.onState((state) => {
  document.body.classList.toggle('dim', state.settings.followIdle === 'dim');
  // While moving, show a sample face so there is something to drag.
  if (state.moving !== moving) {
    moving = state.moving;
    document.body.classList.toggle('moving', moving);
    if (!current) idle();
  }
});

// Drag with pointer capture so the window keeps following even when the cursor outruns it.
face.addEventListener('pointerdown', (event) => {
  if (!moving || event.button !== 0) return;
  face.setPointerCapture(event.pointerId);
  window.mnm.dragStart(event.screenX, event.screenY);
});
face.addEventListener('pointermove', (event) => {
  if (face.hasPointerCapture(event.pointerId)) window.mnm.dragMove(event.screenX, event.screenY);
});
const endDrag = (event) => { if (face.hasPointerCapture(event.pointerId)) { face.releasePointerCapture(event.pointerId); window.mnm.dragEnd(); } };
face.addEventListener('pointerup', endDrag);
face.addEventListener('pointercancel', endDrag);

window.mnm.onLoading((on) => document.documentElement.classList.toggle('loading', on));
