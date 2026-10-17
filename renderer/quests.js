// Quest tracker: pick a zone and a quest that starts there, then follow its steps. Things to say and commands
// copy to the clipboard with one click; hand-ins are highlighted, since those are done in game by hand.
// The chosen quest and ticked-off steps belong to the profile, so each character keeps their own progress.
const $ = (sel) => document.querySelector(sel);
let settings = null, data = { quests: [] }, rendered = '';
// Overlay mode (see-through over the game) is the same page with ?overlay=1; `using` means it takes clicks.
const overlay = new URLSearchParams(location.search).has('overlay');
let using = false;
document.documentElement.classList.toggle('overlay', overlay);

const TICKED = new Set(['step', 'give', 'say', 'cmd']); // steps you do, which can be ticked off
const DIALOGUE = new Set(['npc', 'emote', 'quote']);
const anyClass = (q) => !q.classes.length || q.classes.some((c) => /^all\b/i.test(c));
const state = () => settings.quests || { zone: '', title: '', view: 'full', done: {} };

function save(patch) {
  Object.assign(settings, patch);
  return window.mnm.saveSettings(patch);
}
const saveQuests = (patch) => save({ quests: { ...state(), ...patch } });

// ---- Pickers ----
function myClass() { return settings.character?.cls || ''; }
function questsIn(zone) {
  const cls = myClass();
  return data.quests.filter((q) => q.zone === zone && (!settings.questClassOnly || !cls || anyClass(q) || q.classes.includes(cls)));
}

function renderPickers() {
  const zones = [...new Set(data.quests.map((q) => q.zone).filter(Boolean))].sort();
  const { zone, title } = state();
  const zoneSel = $('#zone');
  zoneSel.replaceChildren(new Option('Choose a zone…', ''), ...zones.map((z) => new Option(`${z} (${questsIn(z).length})`, z)));
  zoneSel.value = zones.includes(zone) ? zone : '';
  const questSel = $('#quest');
  const quests = zoneSel.value ? questsIn(zoneSel.value) : [];
  questSel.replaceChildren(new Option(zoneSel.value ? 'Choose a quest…' : '—', ''),
    ...quests.map((q) => new Option(q.title + (anyClass(q) ? '' : ` — ${q.classes.join(', ')}`), q.title)));
  questSel.value = quests.some((q) => q.title === title) ? title : '';
  questSel.disabled = !zoneSel.value;
  const cls = myClass();
  $('#classOnly').checked = !!settings.questClassOnly;
  $('#classOnly').disabled = !cls;
  $('#classOnlyLabel').textContent = cls ? `${cls} quests only` : 'My class only (set a class in Settings → Abilities → Import)';
  $('#dialogue').checked = !!settings.questDialogue;
  $('#onTop').checked = settings.questOnTop !== false;
  if (!sliding) {
    $('#questOpacity').value = String(settings.questOpacity ?? 0.85);
    $('#questTextScale').value = String(settings.questTextScale ?? 1);
  }
  applyLook();
}

$('#zone').addEventListener('change', (e) => { saveQuests({ zone: e.target.value, title: '' }); render(); });
$('#quest').addEventListener('change', (e) => { saveQuests({ title: e.target.value }); render(); });
$('#classOnly').addEventListener('change', (e) => { save({ questClassOnly: e.target.checked }); render(); });
$('#dialogue').addEventListener('change', (e) => { save({ questDialogue: e.target.checked }); render(); });
$('#onTop').addEventListener('change', (e) => save({ questOnTop: e.target.checked }));
// Overlay look: the sliders change it live and save when let go.
let sliding = false;
function applyLook() {
  const bg = Number($('#questOpacity').value), scale = Number($('#questTextScale').value);
  document.documentElement.style.setProperty('--bg-alpha', bg);
  document.documentElement.style.setProperty('--scale', scale);
  $('#questOpacityOut').textContent = Math.round(bg * 100) + '%';
  $('#questTextScaleOut').textContent = Math.round(scale * 100) + '%';
}
for (const id of ['questOpacity', 'questTextScale']) {
  $('#' + id).addEventListener('input', () => { sliding = true; applyLook(); });
  $('#' + id).addEventListener('change', (e) => { sliding = false; save({ [id]: Number(e.target.value) }); });
}
$('#toOverlay').addEventListener('click', () => window.mnm.setQuestOverlay(true));
$('#toWindow').addEventListener('click', () => window.mnm.setQuestOverlay(false, true));
$('#closeOverlay').addEventListener('click', () => window.mnm.setQuestOverlay(false));

// ---- Overlay: in use or locked, moving and resizing ----
// Locked, the overlay can't be scrolled, so it keeps the next step to do in view.
function showNextStep() {
  if (!overlay || using) return;
  const next = document.querySelector('#steps .step:not(.done):not(.heading) .tick')?.closest('.step');
  if (next) next.scrollIntoView({ block: 'center' });
}
window.mnm.onQuestOverlay((message) => {
  using = message.using;
  document.documentElement.classList.toggle('using', using);
  showNextStep();
});
window.mnm.onLoading((on) => document.documentElement.classList.toggle('loading', on));
function dragWith(el, mode) {
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
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
dragWith($('#bar'), 'move');
dragWith($('#grip'), 'resize');

// ---- Steps ----
function chip(kind, shown, copy) {
  const b = document.createElement('button');
  b.className = 'chip ' + kind;
  b.title = `Copy “${copy}”`;
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = kind === 'say' ? `“${shown}”` : shown;
  const tag = document.createElement('span');
  tag.className = 'copy';
  tag.textContent = 'COPY';
  b.append(text, tag);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.mnm.copyText(copy);
    b.classList.add('copied');
    tag.textContent = 'COPIED';
    setTimeout(() => { b.classList.remove('copied'); tag.textContent = 'COPY'; }, 1200);
  });
  return b;
}

function stepBody(step) {
  const body = document.createElement('div');
  body.className = 'body';
  if (step.kind === 'give') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'IN GAME';
    badge.title = 'Do this in game: hand the items over';
    body.append(badge);
  }
  for (const part of step.parts) {
    if (part.say != null) body.append(chip('say', part.say, `/say ${part.say}`));
    else if (part.cmd != null) body.append(chip('cmd', part.cmd, part.cmd));
    else if (step.kind === 'npc' && part.text.includes(': ')) {
      const i = part.text.indexOf(': ');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = part.text.slice(0, i + 1) + ' ';
      body.append(who, part.text.slice(i + 2));
    } else body.append(part.text);
  }
  return body;
}

function render() {
  if (!settings) return;
  renderPickers();
  const { title, view } = state();
  const quest = data.quests.find((q) => q.title === title && q.zone === $('#zone').value);
  $('#none').hidden = !!quest;
  $('#quest-view').hidden = !quest;
  if (!quest) return;
  const useQuick = view === 'quick' && quest.quick;
  for (const b of document.querySelectorAll('#view button')) {
    b.classList.toggle('on', b.dataset.value === (useQuick ? 'quick' : 'full'));
    if (b.dataset.value === 'quick') { b.disabled = !quest.quick; b.title = quest.quick ? 'The wiki\'s condensed checklist' : 'This quest has no quick guide on the wiki'; }
  }
  $('#title').textContent = quest.title;
  const meta = $('#meta');
  meta.replaceChildren();
  const add = (label, value) => { if (!value) return; const s = document.createElement('span'); const b = document.createElement('b'); b.textContent = value; s.append(label + ' ', b); meta.append(s); };
  add('Starts with', quest.giver);
  add('Level', quest.level);
  add('Classes', anyClass(quest) ? '' : quest.classes.join(', '));
  add('Rewards', quest.rewards.join(', '));

  const steps = useQuick ? quest.quick : quest.steps;
  const key = `${quest.title}|${useQuick ? 'quick' : 'full'}`;
  const done = new Set(state().done?.[key] || []);
  const list = $('#steps');
  list.replaceChildren();
  let total = 0, ticked = 0;
  steps.forEach((step, i) => {
    if (DIALOGUE.has(step.kind) && !settings.questDialogue) return;
    const li = document.createElement('li');
    li.className = 'step ' + step.kind;
    if (TICKED.has(step.kind)) {
      total++;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'tick';
      box.checked = done.has(i);
      if (box.checked) { ticked++; li.classList.add('done'); }
      box.addEventListener('change', () => toggle(key, i, box.checked));
      li.append(box);
      // Clicking the text (not a copy button) ticks the step too.
      li.addEventListener('click', (e) => { if (e.target === li || e.target.closest('.body') && !e.target.closest('.chip')) { box.checked = !box.checked; toggle(key, i, box.checked); } });
    } else if (step.kind !== 'heading') {
      const pad = document.createElement('span');
      pad.className = 'no-tick';
      li.append(pad);
    }
    li.append(stepBody(step));
    list.append(li);
  });
  $('#progress').textContent = total ? `${ticked} of ${total} steps done` : '';
  $('#reset').disabled = !ticked;
  showNextStep();
}

function toggle(key, index, on) {
  const all = { ...(state().done || {}) };
  const set = new Set(all[key] || []);
  if (on) set.add(index); else set.delete(index);
  if (set.size) all[key] = [...set].sort((a, b) => a - b); else delete all[key];
  saveQuests({ done: all });
  render();
}

for (const b of document.querySelectorAll('#view button')) b.addEventListener('click', () => { saveQuests({ view: b.dataset.value }); render(); });
$('#reset').addEventListener('click', () => {
  const quest = state().title;
  if (!quest || !confirm(`Untick every step of ${quest}?`)) return;
  const all = { ...(state().done || {}) };
  for (const k of Object.keys(all)) if (k.startsWith(quest + '|')) delete all[k];
  saveQuests({ done: all });
  render();
});
$('#wiki').addEventListener('click', () => { if (state().title) window.mnm.openWiki(state().title); });

// ---- Data ----
function renderDataInfo() {
  const when = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString() : 'never';
  $('#dataInfo').textContent = `${data.quests.length} quests from the wiki, updated ${when}.`;
}

$('#update').addEventListener('click', async () => {
  const button = $('#update');
  button.disabled = true;
  const result = await window.mnm.updateQuests();
  button.disabled = false;
  if (result.error) { $('#dataInfo').textContent = `Couldn't update: ${result.error}`; return; }
  data = result.data;
  renderDataInfo();
  render();
});
window.mnm.onQuestsProgress(({ step, done, total }) => { $('#dataInfo').textContent = `${step} ${total ? `${done}/${total}` : ''}`; });

// Only redraw when something the tracker shows has changed, so other settings changes don't reset the scroll.
window.mnm.onState((next) => {
  settings = next.settings;
  const key = JSON.stringify([settings.profile, settings.quests, settings.questClassOnly, settings.questDialogue, settings.questOnTop, settings.questOpacity, settings.questTextScale, settings.character]);
  if (key !== rendered) { rendered = key; render(); }
});

window.mnm.quests().then((d) => { data = d || data; renderDataInfo(); rendered = ''; render(); });
