// Settings window. Keeps its own copy of the abilities (so typing isn't interrupted by redraws) and saves
// every change straight away.
const $ = (sel) => document.querySelector(sel);
const list = $('#abilities'), rowTemplate = $('#row');
const MAX_SECONDS = 86400;
let settings = null, profileStamp = -1, labels = {}, catalog = null, pickingFor = null, recordingButton = null;

function save(patch) {
  Object.assign(settings, patch);
  return window.mnm.saveSettings(patch);
}
const saveAbilities = () => save({ abilities: settings.abilities });

// ---- Abilities list ----
function renderAbilities() {
  if (settings.followUps) renderFollowUps(); // their "next ability" lists name these abilities
  list.replaceChildren();
  $('#empty').hidden = settings.abilities.length > 0;
  renderSummaries();
  settings.abilities.forEach((ability, index) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('.icon img').src = iconUrl(ability.icon);
    row.querySelector('.icon').addEventListener('click', () => openPicker(ability));

    const name = row.querySelector('.name');
    name.value = ability.name || '';
    name.addEventListener('change', () => { ability.name = name.value.trim(); saveAbilities(); renderFollowUps(); });

    const key = row.querySelector('.key');
    key.textContent = labels[ability.id] || 'Set key';
    key.classList.toggle('unset', !ability.key);
    key.addEventListener('click', () => record(ability, key));

    showFrame(row.querySelector('.frame'), ability);

    const secs = row.querySelector('.secs input');
    // Blank until set: a wiki spell with no listed recast doesn't count down until you enter its cooldown.
    secs.value = ability.seconds || '';
    secs.classList.toggle('unset', !ability.seconds);
    secs.addEventListener('change', () => {
      const value = secs.value === '' ? 0 : Math.min(MAX_SECONDS, Math.max(0.5, Number(secs.value) || 0));
      ability.seconds = value;
      secs.value = value || '';
      secs.classList.toggle('unset', !value);
      saveAbilities();
    });

    const move = (delta) => {
      const [item] = settings.abilities.splice(index, 1);
      settings.abilities.splice(index + delta, 0, item);
      saveAbilities();
      renderAbilities();
    };
    row.querySelector('.up').disabled = index === 0;
    row.querySelector('.down').disabled = index === settings.abilities.length - 1;
    row.querySelector('.up').addEventListener('click', () => move(-1));
    row.querySelector('.down').addEventListener('click', () => move(1));
    row.querySelector('.remove').addEventListener('click', () => {
      if (!confirm(`Remove ${ability.name || 'this ability'}?`)) return;
      settings.abilities.splice(index, 1);
      saveAbilities();
      renderAbilities();
    });
    list.append(row);
  });
}

$('#add').addEventListener('click', () => {
  settings.abilities.push({ id: crypto.randomUUID(), name: '', icon: '', key: null, seconds: 10 });
  saveAbilities();
  renderAbilities();
  list.lastElementChild.querySelector('.name').focus();
});

// Waits for the key watcher to see the next key. The settings window runs through XWayland too,
// so the key pressed here is captured exactly the way it will be in game.
// `field` is the binding to set: an item's key, or a counter's clearKey (its label is under id + ':clear').
async function record(ability, button, field = 'key', labelId = ability.id, unset = 'Set key') {
  if (recordingButton) {
    const same = recordingButton === button;
    await window.mnm.cancelRecord();
    if (same) return;
  }
  recordingButton = button;
  button.textContent = 'Press a key… (Esc cancels)';
  button.classList.add('recording');
  const result = await window.mnm.recordKey();
  button.classList.remove('recording');
  if (recordingButton === button) recordingButton = null;
  if (result) {
    ability[field] = result.binding;
    labels[labelId] = result.label;
    saveListOf(ability);
  }
  button.textContent = labels[labelId] ? (field === 'key' ? labels[labelId] : `Clear: ${labels[labelId]}`) : unset;
  button.classList.toggle('unset', !ability[field]);
}

// ---- Framed buttons ----
// Opens the frame editor over the screens; saving puts the box on the item, Remove takes it off.
function showFrame(button, item, name) {
  const draw = () => {
    button.textContent = item.frame ? 'Framed ✓' : 'Frame';
    button.classList.toggle('set', !!item.frame);
  };
  draw();
  button.addEventListener('click', async () => {
    const result = await window.mnm.editFrame({ id: item.id, name: name || item.name || 'Unnamed ability', frame: item.frame || null });
    if (!result) return;
    if (result.frame) item.frame = result.frame;
    else delete item.frame;
    saveListOf(item);
    draw();
  });
}

// Saves whichever list (abilities, follow-ups or counters) the item belongs to.
function saveListOf(item) {
  if (settings.followUps.includes(item)) saveFollowUps();
  else if (settings.counters.includes(item)) saveCounters();
  else saveAbilities();
}

// ---- Follow-ups ----
const saveFollowUps = () => save({ followUps: settings.followUps });

function renderFollowUps() {
  const box = $('#followUps');
  box.replaceChildren();
  $('#followEmpty').hidden = settings.followUps.length > 0;
  renderSummaries();
  settings.followUps.forEach((followUp, index) => {
    const row = $('#followRow').content.firstElementChild.cloneNode(true);

    const key = row.querySelector('.key');
    key.textContent = labels[followUp.id] || 'Set key';
    key.classList.toggle('unset', !followUp.key);
    key.addEventListener('click', () => record(followUp, key));
    showFrame(row.querySelector('.frame'), followUp, 'Follow-up' + (labels[followUp.id] ? ` (${labels[followUp.id]})` : ''));

    const secs = row.querySelector('.secs input');
    secs.value = followUp.seconds || '';
    secs.classList.toggle('unset', !followUp.seconds);
    secs.addEventListener('change', () => {
      const value = secs.value === '' ? 0 : Math.min(600, Math.max(0.5, Number(secs.value) || 0));
      followUp.seconds = value;
      secs.value = value || '';
      secs.classList.toggle('unset', !value);
      saveFollowUps();
    });

    // The next ability supplies the pop-up's icon, and its key dismisses the pop-up early.
    const next = row.querySelector('.next');
    next.append(new Option('my next ability (just a countdown)', ''));
    for (const ability of settings.abilities) next.append(new Option(ability.name || 'Unnamed ability', ability.id));
    next.value = settings.abilities.some((a) => a.id === followUp.next) ? followUp.next : '';
    next.addEventListener('change', () => { followUp.next = next.value; saveFollowUps(); });

    row.querySelector('.remove').addEventListener('click', () => {
      settings.followUps.splice(index, 1);
      saveFollowUps();
      renderFollowUps();
    });
    box.append(row);
  });
}

$('#addFollow').addEventListener('click', () => {
  settings.followUps.push({ id: crypto.randomUUID(), key: null, seconds: 3, next: '' });
  saveFollowUps();
  renderFollowUps();
});

// ---- Counters ----
const saveCounters = () => save({ counters: settings.counters });

function renderCounters() {
  const box = $('#counters');
  box.replaceChildren();
  $('#counterEmpty').hidden = settings.counters.length > 0;
  renderSummaries();
  settings.counters.forEach((counter, index) => {
    const row = $('#counterRow').content.firstElementChild.cloneNode(true);
    row.querySelector('.icon img').src = iconUrl(counter.icon);
    row.querySelector('.icon').addEventListener('click', () => openPicker(counter));

    const name = row.querySelector('.name');
    name.value = counter.name || '';
    name.addEventListener('change', () => { counter.name = name.value.trim(); saveCounters(); });

    const key = row.querySelector('.key');
    key.textContent = labels[counter.id] || 'Set key';
    key.classList.toggle('unset', !counter.key);
    key.addEventListener('click', () => record(counter, key));
    showFrame(row.querySelector('.frame'), counter, counter.name || 'Counter');

    const clear = row.querySelector('.clear-key'), clearId = counter.id + ':clear';
    clear.textContent = counter.clearKey && labels[clearId] ? `Clear: ${labels[clearId]}` : 'Clear key';
    clear.classList.toggle('unset', !counter.clearKey);
    clear.addEventListener('click', () => record(counter, clear, 'clearKey', clearId, 'Clear key'));
    clear.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      delete counter.clearKey;
      delete labels[clearId];
      clear.textContent = 'Clear key';
      clear.classList.add('unset');
      saveCounters();
    });

    const secs = row.querySelector('.secs input');
    secs.value = counter.seconds || '';
    secs.classList.toggle('unset', !counter.seconds);
    secs.addEventListener('change', () => {
      const value = secs.value === '' ? 0 : Math.min(MAX_SECONDS, Math.max(0.5, Number(secs.value) || 0));
      counter.seconds = value;
      secs.value = value || '';
      secs.classList.toggle('unset', !value);
      saveCounters();
    });

    const from = row.querySelector('.reset-from');
    from.value = ['first', 'each'].includes(counter.resetFrom) ? counter.resetFrom : 'last';
    const gap = row.querySelector('.min-gap'), gapInput = gap.querySelector('input');
    gap.hidden = from.value !== 'each';
    gapInput.value = counter.minGap || '';
    gapInput.addEventListener('change', () => {
      const value = Math.min(3600, Math.max(0, Number(gapInput.value) || 0));
      if (value) counter.minGap = value; else delete counter.minGap;
      gapInput.value = value || '';
      saveCounters();
    });
    from.addEventListener('change', () => { counter.resetFrom = from.value; gap.hidden = from.value !== 'each'; saveCounters(); });

    row.querySelector('.remove').addEventListener('click', () => {
      if (!confirm(`Remove ${counter.name || 'this counter'}?`)) return;
      settings.counters.splice(index, 1);
      saveCounters();
      renderCounters();
    });
    box.append(row);
  });
}

$('#addCounter').addEventListener('click', () => {
  settings.counters.push({ id: crypto.randomUUID(), name: '', icon: '', key: null, seconds: 10 });
  saveCounters();
  renderCounters();
  $('#counters').lastElementChild.querySelector('.name').focus();
});

// ---- Icon picker ----
const iconPath = (icon) => icon.file || icon.id + '.png';

async function openPicker(ability) {
  pickingFor = ability;
  if (!catalog) {
    catalog = await window.mnm.catalog();
    const categories = [...new Set(catalog.flatMap((icon) => icon.categories || []))].sort();
    for (const category of categories) $('#category').append(new Option(category, category));
  }
  $('#search').value = ability.name || '';
  $('#grabFrame').disabled = !ability.frame;
  $('#grabFrame').title = ability.frame ? 'Copy the picture under this frame in the game' : 'Frame its button in game first (the Frame button on its row)';
  renderIcons();
  $('#picker').showModal();
  $('#search').select();
}

function renderIcons() {
  const words = $('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const category = $('#category').value;
  let found = catalog.filter((icon) => (!category || icon.categories?.includes(category)) &&
    words.every((w) => icon.name.toLowerCase().includes(w) || (icon.wikiName || '').toLowerCase().includes(w)));
  // A search that finds nothing by name falls back to everything, so the grid is never empty.
  if (!found.length && words.length) found = catalog.filter((icon) => !category || icon.categories?.includes(category));
  const shown = found.slice(0, 240);
  const grid = $('#icons');
  grid.replaceChildren(...shown.map((icon) => {
    const button = document.createElement('button');
    button.title = icon.name;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = iconUrl(iconPath(icon));
    button.append(img);
    button.addEventListener('click', () => pickIcon(iconPath(icon), icon.name));
    return button;
  }));
  $('#count').textContent = found.length > shown.length ? `Showing ${shown.length} of ${found.length}. Search to narrow it down.` : `${found.length} icons`;
}

function pickIcon(icon, iconName) {
  pickingFor.icon = icon;
  // Name an unnamed ability after its icon, since wiki icons are named after the spell.
  if (!pickingFor.name && iconName) pickingFor.name = iconName;
  saveListOf(pickingFor);
  if (settings.counters.includes(pickingFor)) renderCounters();
  else renderAbilities();
  $('#picker').close();
}

let searchTimer = 0;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderIcons, 120); });
$('#search').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
$('#category').addEventListener('change', renderIcons);
$('#custom').addEventListener('click', async () => {
  const file = await window.mnm.chooseImage();
  if (file) pickIcon(file, '');
});

// ---- Icon grabbed from the frame ----
// Shows what's under the frame, lets you trim the slot's border, and saves the result as a custom image.
let grabbed = null; // the captured picture, as an Image
const grabError = (text) => { $('#grabError').hidden = !text; $('#grabError').textContent = text || ''; $('#grabUse').disabled = !!text || !grabbed; };

async function grab() {
  grabbed = null;
  grabError('');
  $('#grabUse').disabled = true;
  const result = await window.mnm.grabFrame(pickingFor.frame);
  if (result.error) return grabError(result.error);
  const image = new Image();
  image.src = result.dataUrl;
  await image.decode();
  grabbed = image;
  drawGrab();
}

function drawGrab() {
  const trim = Number($('#grabTrim').value) / 100;
  $('#grabTrimValue').textContent = Math.round(trim * 100) + '%';
  const full = $('#grabFull'), result = $('#grabResult');
  if (!grabbed) { full.width = full.height = result.width = result.height = 1; return; }
  const { width, height } = grabbed;
  full.width = width; full.height = height;
  const fullCtx = full.getContext('2d');
  fullCtx.drawImage(grabbed, 0, 0);
  // The trimmed area, outlined on the full picture.
  const dx = Math.round(width * trim), dy = Math.round(height * trim);
  const w = Math.max(1, width - dx * 2), h = Math.max(1, height - dy * 2);
  fullCtx.strokeStyle = '#e8c66a';
  fullCtx.lineWidth = Math.max(1, width / 80);
  fullCtx.strokeRect(dx + 0.5, dy + 0.5, w - 1, h - 1);
  result.width = w; result.height = h;
  result.getContext('2d').drawImage(grabbed, dx, dy, w, h, 0, 0, w, h);
  $('#grabUse').disabled = false;
}

$('#grabFrame').addEventListener('click', () => {
  if (!pickingFor?.frame) return;
  $('#picker').close();
  $('#grabTrim').value = 0;
  drawGrab();
  $('#grabDialog').returnValue = ''; // Esc keeps the last value, which mustn't be a past "ok"
  $('#grabDialog').showModal();
  grab();
});
$('#grabAgain').addEventListener('click', grab);
$('#grabTrim').addEventListener('input', drawGrab);
$('#grabDialog').addEventListener('close', async () => {
  if ($('#grabDialog').returnValue !== 'ok' || !grabbed) return;
  const file = await window.mnm.saveIcon($('#grabResult').toDataURL('image/png'));
  if (file) pickIcon(file, '');
});

// ---- Add from wiki ----
let spellData = null;

// 6 -> "6s", 90 -> "1m 30s", 1800 -> "30m", 3600 -> "1h"
function formatTime(sec) {
  if (sec < 60) return +sec.toFixed(1) + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm' + (sec % 60 ? ' ' + Math.round(sec % 60) + 's' : '');
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

async function openWiki() {
  if (!spellData) {
    spellData = await window.mnm.spells();
    const classes = [...new Set(spellData.spells.flatMap((spell) => Object.keys(spell.classes)))].sort();
    for (const c of classes) $('#spellClass').append(new Option(c, c));
    $('#spellClass').value = classes.includes(settings.spellClass) ? settings.spellClass : '';
  }
  showWikiInfo();
  renderSpells();
  $('#wiki').showModal();
  $('#spellSearch').focus();
}

function showWikiInfo(text) {
  if (!spellData) return;
  const when = spellData.generatedAt ? new Date(spellData.generatedAt).toLocaleDateString() : 'never';
  $('#wikiInfo').textContent = text || `${spellData.spells.length} spells from the Monsters & Memories wiki, updated ${when}.`;
}

function renderSpells() {
  const words = $('#spellSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
  const cls = $('#spellClass').value;
  let found = spellData.spells.filter((spell) => (!cls || cls in spell.classes) && words.every((w) => (spell.name + ' ' + (spell.page || '')).toLowerCase().includes(w)));
  if (cls) found = [...found].sort((a, b) => a.classes[cls] - b.classes[cls] || a.name.localeCompare(b.name));
  const shown = found.slice(0, 150);
  const added = new Set(settings.abilities.map((a) => a.wiki).filter(Boolean));
  $('#spellList').replaceChildren(...shown.map((spell) => spellRow(spell, added.has(spell.page))));
  if (!found.length) $('#spellList').textContent = 'No spells match.';
  else if (found.length > shown.length) $('#spellList').append(Object.assign(document.createElement('p'), { className: 'hint', textContent: `Showing ${shown.length} of ${found.length}. Search or pick a class to narrow it down.` }));
}

function spellRow(spell, alreadyAdded) {
  const row = $('#spellRow').content.firstElementChild.cloneNode(true);
  row.querySelector('img').src = iconUrl(spell.icon);
  // Some spells have more than one wiki page (e.g. per class); the page title tells them apart.
  row.querySelector('.spell-name').textContent = spell.name + (spell.page && spell.page !== spell.name ? ` (${spell.page})` : '');
  row.title = spell.description || '';
  // With a class picked, show just that class's level and how many others share it.
  const cls = $('#spellClass').value, all = Object.entries(spell.classes);
  const others = all.length - 1;
  const classes = cls && cls in spell.classes
    ? `${cls} ${spell.classes[cls]}` + (others ? ` (+${others} other class${others > 1 ? 'es' : ''})` : '')
    : all.map(([c, level]) => `${c} ${level}`).join(', ');
  const recast = spell.recast > 0 ? 'Recast ' + formatTime(spell.recast)
    : spell.recastText && spell.recast == null ? `Recast "${spell.recastText}"` : 'No recast listed';
  const parts = [classes, spell.cast > 0 ? 'Cast ' + formatTime(spell.cast) : spell.cast === 0 ? 'Instant' : '', recast,
    spell.duration > 0 ? 'Lasts ' + formatTime(spell.duration) : spell.durationText && spell.duration == null ? `Lasts "${spell.durationText}"` : ''];
  row.querySelector('.spell-meta').textContent = parts.filter(Boolean).join(' · ');

  const actions = row.querySelector('.spell-actions');
  const add = (label, seconds, tip) => {
    const button = document.createElement('button');
    button.textContent = alreadyAdded ? 'Added ✓' : label;
    button.title = tip;
    button.disabled = alreadyAdded;
    button.addEventListener('click', () => {
      settings.abilities.push({ id: crypto.randomUUID(), name: spell.name, icon: spell.icon, key: null, seconds, wiki: spell.page });
      saveAbilities();
      renderAbilities();
      for (const b of actions.querySelectorAll('button')) { b.disabled = true; }
      button.textContent = 'Added ✓';
    });
    actions.append(button);
  };
  if (spell.recast > 0) add('Add · ' + formatTime(spell.recast), spell.recast, 'Count down its recast (cooldown)');
  if (spell.duration > 0) add('Buff timer · ' + formatTime(spell.duration), spell.duration, 'Count down how long it lasts');
  if (!(spell.recast > 0)) add('Add', 0, 'The wiki lists no recast; enter the cooldown yourself');
  if (alreadyAdded) { actions.replaceChildren(); add('', 0, 'Already in your list'); }
  return row;
}

let spellTimer = 0;
$('#addWiki').addEventListener('click', openWiki);
$('#spellSearch').addEventListener('input', () => { clearTimeout(spellTimer); spellTimer = setTimeout(renderSpells, 120); });
$('#spellSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
$('#spellClass').addEventListener('change', () => { save({ spellClass: $('#spellClass').value }); renderSpells(); });

$('#updateWiki').addEventListener('click', async () => {
  const button = $('#updateWiki');
  button.disabled = true;
  button.textContent = 'Updating…';
  const result = await window.mnm.updateSpells();
  button.disabled = false;
  button.textContent = 'Update from wiki';
  if (result.error) return showWikiInfo('Update failed: ' + result.error);
  spellData = result.data;
  const s = spellData.spells;
  showWikiInfo(`Updated: ${s.length} spells, ${s.filter((x) => x.recast > 0).length} with a recast` +
    (spellData.iconsDownloaded ? `, ${spellData.iconsDownloaded} new icons downloaded` : '') + '.');
  renderSpells();
});
window.mnm.onSpellsProgress(({ step, done, total }) => {
  const text = step + (total ? ` ${done}/${total}` : '');
  if ($('#import').open) $('#importInfo').textContent = text;
  else showWikiInfo(text);
});

// ---- Import for my class ----
// Lists what your class (and race) learns up to your level: new abilities to tick, rank upgrades for ones you
// have, and how many you already have. Nothing changes until "Add selected".
let importPlan = null;

async function openImport() {
  const character = settings.character || { cls: '', race: '', level: 1 };
  const result = await window.mnm.planImport(character);
  if (!$('#impClass').options[1]) {
    for (const c of result.classes) $('#impClass').append(new Option(c, c));
    for (const r of result.races) $('#impRace').append(new Option(r, r));
  }
  $('#impClass').value = character.cls;
  $('#impRace').value = character.race;
  $('#impLevel').value = character.level;
  showImport(result);
  if (!$('#import').open) $('#import').showModal();
}

async function refreshImport() {
  const character = { cls: $('#impClass').value, race: $('#impRace').value, level: Math.max(1, Math.round(Number($('#impLevel').value) || 1)) };
  save({ character });
  showImport(await window.mnm.planImport(character));
}

function importRow(spell, meta, checked, data) {
  const row = $('#spellRow').content.firstElementChild.cloneNode(true);
  row.classList.add('pick');
  row.querySelector('img').src = iconUrl(spell.icon);
  row.querySelector('.spell-name').textContent = spell.page || spell.name;
  row.querySelector('.spell-meta').textContent = meta;
  row.title = spell.description || '';
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  Object.assign(box.dataset, data);
  box.addEventListener('change', countSelected);
  row.querySelector('.spell-actions').append(box);
  row.addEventListener('click', (event) => { if (event.target !== box) { box.checked = !box.checked; countSelected(); } });
  return row;
}

function heading(text) {
  return Object.assign(document.createElement('h3'), { className: 'import-heading', textContent: text });
}

function showImport({ plan, generatedAt }) {
  importPlan = plan;
  const body = $('#importBody');
  body.replaceChildren();
  const when = generatedAt ? new Date(generatedAt).toLocaleDateString() : 'never';
  $('#importInfo').textContent = `Wiki spell list from ${when}.`;
  if (!plan) {
    body.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Choose your class and level to see the abilities you should have.' }));
    return countSelected();
  }
  if (plan.upgrades.length) {
    body.append(heading(`Upgrades (${plan.upgrades.length}) — a better rank you can use now; your key stays the same`));
    for (const { ability, spell, level } of plan.upgrades) {
      const recast = spell.recast > 0 ? ' · recast ' + formatTime(spell.recast) : '';
      body.append(importRow(spell, `Replaces ${ability.name} · level ${level}${recast}`, true, { upgrade: ability.id, page: spell.page }));
    }
  }
  const withRecast = plan.add.filter((a) => a.recommended), without = plan.add.filter((a) => !a.recommended);
  if (withRecast.length) {
    body.append(heading(`New abilities with a cooldown (${withRecast.length})`));
    for (const { spell, level } of withRecast) body.append(importRow(spell, `Level ${level} · recast ${formatTime(spell.recast)}`, true, { page: spell.page }));
  }
  if (without.length) {
    body.append(heading(`No recast listed on the wiki (${without.length}) — unticked; you'd enter the cooldown yourself`));
    for (const { spell, level } of without) {
      const extra = spell.duration > 0 ? ' · lasts ' + formatTime(spell.duration) : '';
      body.append(importRow(spell, `Level ${level}${extra}`, false, { page: spell.page }));
    }
  }
  if (!plan.add.length && !plan.upgrades.length) body.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Nothing new: you have every ability for this class and level.' }));
  if (plan.have) body.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: `${plan.have} already in your list.` }));
  countSelected();
}

function countSelected() {
  const n = document.querySelectorAll('#importBody input:checked').length;
  $('#importApply').disabled = !n;
  $('#importApply').textContent = n ? `Add selected (${n})` : 'Add selected';
}

$('#openImport').addEventListener('click', openImport);
window.mnm.onOpenImport(() => { if (settings) { showTab('abilities'); openImport(); } });
for (const id of ['impClass', 'impRace', 'impLevel']) $('#' + id).addEventListener('change', refreshImport);
$('#impLevel').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); refreshImport(); } });

$('#importApply').addEventListener('click', async () => {
  const picked = [...document.querySelectorAll('#importBody input:checked')];
  const add = picked.filter((b) => !b.dataset.upgrade).map((b) => b.dataset.page);
  const upgrades = picked.filter((b) => b.dataset.upgrade).map((b) => ({ id: b.dataset.upgrade, page: b.dataset.page }));
  settings.abilities = await window.mnm.applyImport({ add, upgrades });
  renderAbilities();
  spellData = null; // the wiki dialog's "Added" marks need a fresh look
  await refreshImport();
  $('#importInfo').textContent = `Added ${add.length} and upgraded ${upgrades.length}. Set each new ability's key in the list.`;
});

$('#importUpdate').addEventListener('click', async () => {
  const button = $('#importUpdate');
  button.disabled = true;
  button.textContent = 'Updating…';
  const result = await window.mnm.updateSpells();
  button.disabled = false;
  button.textContent = 'Update from wiki';
  if (result.error) return ($('#importInfo').textContent = 'Update failed: ' + result.error);
  spellData = null;
  await refreshImport();
  $('#importInfo').textContent = `Updated from the wiki: ${result.data.spells.length} spells.`;
});

// ---- Profiles ----
// Asks for a name in a small dialog (Electron has no prompt()). Resolves the trimmed name, or null.
let nameAllowed = ''; // the name being renamed may be kept
function askName(label, value = '') {
  const dialog = $('#nameDialog'), input = $('#nameInput');
  $('#nameLabel').textContent = label;
  input.value = nameAllowed = value;
  checkName();
  dialog.showModal();
  input.select();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value.trim() || null : null), { once: true });
  });
}
function checkName() {
  const name = $('#nameInput').value.trim();
  const taken = !!name && !!settings.profiles[name] && name !== nameAllowed;
  $('#nameHint').textContent = taken ? 'There is already a profile with that name.' : '';
  $('#nameOk').disabled = taken || !name;
}
$('#nameInput').addEventListener('input', checkName);

function renderProfiles(state) {
  const select = $('#profile');
  select.replaceChildren(...Object.keys(settings.profiles).map((name) =>
    new Option(name + (name === state.loggedIn ? ' (logged in)' : ''), name)));
  select.value = settings.profile;
  $('#profileDelete').disabled = Object.keys(settings.profiles).length < 2;
  $('#autoProfile').checked = settings.autoProfile;
  renderSummaries();
  $('#loginInfo').textContent = state.loggedIn
    ? `${state.loggedIn} is logged in, according to the game's log.`
    : `No character is logged in according to the game's log (${state.playerLog}).`;
}

$('#profile').addEventListener('change', (e) => window.mnm.profile({ action: 'switch', name: e.target.value }));
$('#profileNew').addEventListener('click', async () => {
  const name = await askName('Name for the new, empty profile (use the character\'s name to have it switch automatically)');
  if (name && !settings.profiles[name]) window.mnm.profile({ action: 'new', name });
});
$('#profileCopy').addEventListener('click', async () => {
  const name = await askName(`Copy ${settings.profile} to a new profile named`);
  if (name && !settings.profiles[name]) window.mnm.profile({ action: 'copy', name });
});
$('#profileRename').addEventListener('click', async () => {
  const to = await askName(`Rename ${settings.profile} to`, settings.profile);
  if (to && to !== settings.profile && !settings.profiles[to]) window.mnm.profile({ action: 'rename', name: settings.profile, to });
});
$('#profileDelete').addEventListener('click', () => {
  if (confirm(`Delete the ${settings.profile} profile and its abilities, follow-ups and counters?`)) window.mnm.profile({ action: 'delete', name: settings.profile });
});
$('#autoProfile').addEventListener('change', (e) => save({ autoProfile: e.target.checked }));

// ---- Overlay and behaviour options ----
function renderOptions() {
  for (const b of document.querySelectorAll('#layout button')) b.classList.toggle('on', b.dataset.value === settings.layout);
  $('#size').value = settings.size;
  $('#ready').value = settings.ready;
  $('#showKeys').checked = settings.showKeys;
  $('#stack').checked = settings.stack;
  // Stacking already hides ready abilities, so the ready style doesn't apply.
  $('#ready').disabled = settings.stack;
  $('#gameOnly').checked = settings.gameOnly;
  $('#repress').value = settings.repress;
  $('#showFrames').value = settings.showFrames;
  $('#followSize').value = settings.followSize;
  $('#followIdle').value = settings.followIdle;
  $('#counterSize').value = settings.counterSize;
  $('#counterIdle').value = settings.counterIdle;
  $('#clock').checked = settings.clock;
  $('#clockDate').checked = settings.clockDate;
  $('#hideWhileLoading').checked = settings.hideWhileLoading;
  $('#clockHideWhileLoading').checked = settings.clockHideWhileLoading;
  $('#clockSize').value = settings.clockSize;
  $('#minimap').checked = settings.minimap;
  $('#minimapFollowZone').checked = settings.minimapFollowZone;
  $('#atlasFollowZone').checked = settings.atlasFollowZone;
  $('#minimapMouse').checked = settings.minimapMouse;
  $('#minimapHideWhileLoading').checked = settings.minimapHideWhileLoading;
  $('#minimapShape').value = settings.minimapShape;
  $('#minimapSource').value = settings.minimapSource;
  $('#minimapOpacity').value = String(settings.minimapOpacity);
  for (const id of MAP_KEYS) {
    $('#' + id).textContent = labels[id] || 'Set key';
    $('#' + id).classList.toggle('unset', !settings[id]);
  }
  renderSummaries();
}

for (const b of document.querySelectorAll('#layout button')) {
  b.addEventListener('click', () => { save({ layout: b.dataset.value }); renderOptions(); });
}
for (const id of ['size', 'ready', 'repress', 'showFrames', 'followSize', 'followIdle', 'counterSize', 'counterIdle', 'clockSize']) $('#' + id).addEventListener('change', (e) => save({ [id]: e.target.value }));
for (const id of ['showKeys', 'gameOnly', 'stack', 'clock', 'clockDate', 'hideWhileLoading', 'clockHideWhileLoading', 'minimap', 'minimapFollowZone', 'atlasFollowZone', 'minimapHideWhileLoading', 'minimapMouse']) $('#' + id).addEventListener('change', (e) => { save({ [id]: e.target.checked }); renderOptions(); });

$('#minimapShape').addEventListener('change', (e) => save({ minimapShape: e.target.value }));
$('#minimapSource').addEventListener('change', (e) => save({ minimapSource: e.target.value }));
$('#minimapOpacity').addEventListener('change', (e) => save({ minimapOpacity: Number(e.target.value) }));
$('#openMaps').addEventListener('click', () => window.mnm.openMaps());
// The map keys are recorded like an ability's: the next key the watcher sees. Right-click clears one.
const MAP_KEYS = ['useKey', 'minimapZoomInKey', 'minimapZoomOutKey'];
for (const id of MAP_KEYS) $('#' + id).addEventListener('contextmenu', (event) => {
  event.preventDefault();
  labels[id] = '';
  save({ [id]: null });
  renderOptions();
});
for (const id of MAP_KEYS) $('#' + id).addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (recordingButton) {
    const same = recordingButton === button;
    await window.mnm.cancelRecord();
    if (same) return;
  }
  recordingButton = button;
  button.textContent = 'Press a key… (Esc cancels)';
  button.classList.add('recording');
  const result = await window.mnm.recordKey();
  button.classList.remove('recording');
  if (recordingButton === button) recordingButton = null;
  if (result) {
    labels[id] = result.label;
    save({ [id]: result.binding });
  }
  renderOptions();
});

window.mnm.onState((state) => {
  const status = $('#status');
  status.textContent = state.watcher.status === 'ok' ? 'Watching your keys' : state.watcher.message;
  status.className = 'status ' + state.watcher.status;
  // The tray can toggle the clock and auto-switching too, so keep those boxes in step. A profile change
  // (switch, rename, delete) reloads everything.
  if (settings && state.profileStamp === profileStamp) {
    settings.clock = state.settings.clock;
    settings.autoProfile = state.settings.autoProfile;
    settings.minimap = state.settings.minimap;
    settings.minimapFollowZone = state.settings.minimapFollowZone;
    settings.atlasFollowZone = state.settings.atlasFollowZone;
    $('#atlasFollowZone').checked = settings.atlasFollowZone;
    settings.minimapSource = state.settings.minimapSource;
    $('#minimapSource').value = settings.minimapSource;
    $('#clock').checked = settings.clock;
    $('#minimap').checked = settings.minimap;
    $('#minimapFollowZone').checked = settings.minimapFollowZone;
    $('#info-minimap').textContent = settings.minimap ? '' : 'off';
    renderProfiles(state);
    return;
  }
  profileStamp = state.profileStamp;
  settings = structuredClone(state.settings);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  labels = { ...state.labels };
  renderAbilities();
  renderCounters();
  renderOptions();
  renderProfiles(state);
});

$('#openQuests').addEventListener('click', () => window.mnm.openQuests());

// ---- Tabs ----
// One section at a time; the last tab you looked at is remembered.
const TAB_KEY = 'settingsTab';
function showTab(name) {
  if (!document.querySelector(`.section[data-section="${name}"]`)) name = 'abilities';
  for (const el of document.querySelectorAll('.tab, .section')) el.classList.toggle('on', el.dataset.section === name);
  for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', tab.dataset.section === name);
  try { localStorage.setItem(TAB_KEY, name); } catch {}
  window.scrollTo(0, 0);
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.section));
let savedTab = null;
try { savedTab = localStorage.getItem(TAB_KEY); } catch {}
showTab(savedTab || 'abilities');

// What each tab shows next to its name.
function renderSummaries() {
  $('#info-abilities').textContent = settings.abilities.length;
  $('#info-followUps').textContent = settings.followUps.length;
  $('#info-counters').textContent = settings.counters.length;
  $('#info-clock').textContent = settings.clock ? '' : 'off';
  $('#info-minimap').textContent = settings.minimap ? '' : 'off';
}
