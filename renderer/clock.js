// Game clock: the in-game time and date, recalculated every second.
const face = document.getElementById('face');
const timeEl = document.getElementById('time'), cycleEl = document.getElementById('cycle'), dateEl = document.getElementById('date');
let moving = false;

function update() {
  const t = gameTime();
  timeEl.textContent = t.time;
  cycleEl.textContent = `Day ${t.dayOf20} of 20`;
  dateEl.textContent = `${t.weekday}, the ${t.day} of ${t.month}`;
}
update();
setInterval(update, 1000);

window.mnm.onState((state) => {
  document.body.classList.toggle('no-date', !state.settings.clockDate);
  moving = state.moving;
  document.body.classList.toggle('moving', moving);
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
