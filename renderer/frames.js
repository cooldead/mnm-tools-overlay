// Framed buttons. Normally a click-through window just big enough for the frames, which flashes a frame when it
// is clicked (or always shows them). While editing it covers every screen and lets you drag a box for one item.
const framesBox = document.getElementById('frames'), draftEl = document.getElementById('draft'), banner = document.getElementById('banner');
const MIN_SIDE = 4;
let state = null, mode = { type: 'show', origin: { x: 0, y: 0 } }, draft = null, drag = null;
const nodes = new Map(); // item id -> frame element

// Abilities and follow-ups that have a frame, with a name to label them by while editing.
function framedItems() {
  const { settings, labels } = state;
  return [
    ...settings.abilities.map((a) => ({ id: a.id, frame: a.frame, name: a.name || 'Unnamed ability' })),
    ...settings.followUps.map((f) => ({ id: f.id, frame: f.frame, name: 'Follow-up' + (labels[f.id] ? ` (${labels[f.id]})` : '') })),
  ].filter((item) => item.frame);
}

function place(el, frame) {
  const { origin } = mode;
  Object.assign(el.style, { left: frame.x - origin.x + 'px', top: frame.y - origin.y + 'px', width: frame.width + 'px', height: frame.height + 'px' });
}

function render() {
  if (!state) return;
  const editing = mode.type === 'edit';
  document.body.className = editing ? 'editing' : state.settings.showFrames === 'always' ? 'show-always' : '';
  framesBox.replaceChildren();
  nodes.clear();
  for (const item of framedItems()) {
    if (editing && item.id === mode.id) continue;
    const el = document.createElement('div');
    el.className = 'frame';
    el.innerHTML = '<span></span>';
    el.firstChild.textContent = item.name;
    place(el, item.frame);
    framesBox.append(el);
    nodes.set(item.id, el);
  }
  banner.hidden = !editing;
  draftEl.hidden = !(editing && draft);
  if (editing && draft) place(draftEl, draft);
}

// ---- Editing ----
function startEdit(message) {
  mode = message;
  draft = message.frame ? { ...message.frame } : null;
  document.getElementById('target').textContent = message.name;
  document.getElementById('remove').disabled = !message.frame;
  const { banner: area } = message;
  Object.assign(banner.style, { left: area.x + area.width / 2 + 'px', top: area.y + 24 + 'px' });
  render();
}

function finish(result) {
  if (mode.type !== 'edit') return;
  mode = { type: 'show', origin: mode.origin };
  draft = drag = null;
  render();
  window.mnm.frameDone(result);
}
const save = () => (draft ? finish({ frame: roundFrame(draft) }) : finish(null));

function roundFrame(f) {
  return { x: Math.round(f.x), y: Math.round(f.y), width: Math.max(MIN_SIDE, Math.round(f.width)), height: Math.max(MIN_SIDE, Math.round(f.height)) };
}

// Screen position (DIPs) of a pointer event.
const at = (event) => ({ x: mode.origin.x + event.clientX, y: mode.origin.y + event.clientY });

document.addEventListener('pointerdown', (event) => {
  if (mode.type !== 'edit' || event.button !== 0 || banner.contains(event.target)) return;
  const p = at(event);
  // Inside the current box moves it; anywhere else draws a new one.
  // No pointer capture needed: while editing the window covers every screen.
  drag = draft && event.target === draftEl ? { type: 'move', from: p, start: { ...draft } } : { type: 'draw', from: p, start: draft };
});
document.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const p = at(event), { from } = drag;
  if (drag.type === 'move') draft = { ...drag.start, x: drag.start.x + p.x - from.x, y: drag.start.y + p.y - from.y };
  else draft = { x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), width: Math.abs(p.x - from.x), height: Math.abs(p.y - from.y) };
  render();
});
document.addEventListener('pointerup', () => {
  if (!drag) return;
  // A plain click (no real box) keeps the box you had.
  if (drag.type === 'draw' && (!draft || draft.width < MIN_SIDE || draft.height < MIN_SIDE)) draft = drag.start;
  drag = null;
  render();
});

document.addEventListener('keydown', (event) => {
  if (mode.type !== 'edit') return;
  if (event.key === 'Escape') return finish(null);
  if (event.key === 'Enter') return save();
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!step || !draft) return;
  event.preventDefault();
  if (event.shiftKey) draft = { ...draft, width: Math.max(MIN_SIDE, draft.width + step[0]), height: Math.max(MIN_SIDE, draft.height + step[1]) };
  else draft = { ...draft, x: draft.x + step[0], y: draft.y + step[1] };
  render();
});

document.getElementById('save').addEventListener('click', save);
document.getElementById('cancel').addEventListener('click', () => finish(null));
document.getElementById('remove').addEventListener('click', () => finish({ frame: null }));

// ---- Messages from the main process ----
window.mnm.onState((next) => { state = next; render(); });
window.mnm.onFrames((message) => {
  if (message.type === 'edit') return startEdit(message);
  if (message.type === 'show') { mode = message; return render(); }
  if (message.type === 'hit') {
    for (const id of message.ids) {
      const el = nodes.get(id);
      if (!el) continue;
      el.classList.remove('hit');
      void el.offsetWidth; // restart the flash on a quick second click
      el.classList.add('hit');
    }
  }
});
