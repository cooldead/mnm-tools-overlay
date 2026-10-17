// Wiki helper: spell window screenshots -> wiki edits. Each spell gets a card showing what the screenshots say,
// what the wiki page says, and the exact text that would be published. The reading and wikitext work happens in
// the main process (spellshot.js); this window only shows it and sends what the user approves.
const $ = (sel, el = document) => el.querySelector(sel);
const api = window.mnm.wikiHelper;
const SUMMARY = 'Spell details from the in-game spell window (MnM Tools Wiki helper)';
const WEAK = 80; // read with less confidence than this: worth a look
let init = null, user = null;
const cards = [];
const bookIcons = new Map(); // spell name (lower case) -> {name, icon, match, matches} from spellbook screenshots
const classPages = {}; // class -> the class page as last read

async function call(name, ...args) {
  const result = await api.call(name, ...args);
  if (result.error) throw new Error(result.error);
  return result.value;
}
const fileName = (p) => p.split('/').pop();
const plain = (s) => String(s || '').replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').trim();
const lineOf = (name) => name.toLowerCase().replace(/\s+([ivx]+|\d+)$/, '').trim();

let noticeTimer = null;
function notice(text, ms = 6000) {
  const el = $('#notice');
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noticeTimer);
  if (text && ms) noticeTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---- Screenshots in ----
async function addFiles(paths, { fromWatch = false } = {}) {
  const fresh = paths.filter((p) => !cards.some((c) => c.parts.some((x) => x.path === p)));
  if (!fresh.length) return;
  notice(`Reading ${fresh.length === 1 ? fileName(fresh[0]) : fresh.length + ' screenshots'}…`, 0);
  const read = await api.read(fresh);
  notice('');
  if (read.error) return notice(read.error);
  const touched = new Set();
  for (const shot of read.results) {
    const skip = (why) => { if (!fromWatch) notice(`${fileName(shot.path)}: ${why}`); };
    if (shot.error) { skip(shot.error); continue; }
    if (shot.bookError && !fromWatch) notice(shot.bookError);
    if (shot.book?.length) {
      await addBook(shot.book);
      for (const card of cards) if (bookIcons.has(card.name.toLowerCase())) touched.add(card);
      const spell = shot.lines?.length ? await call('readSpell', shot.lines) : null;
      if (!spell || (!spell.skill && !Object.keys(spell.values).length)) continue; // only a spellbook page
    }
    if (!shot.lines?.length) { skip('no text found'); continue; }
    const spell = await call('readSpell', shot.lines);
    if (!spell.skill && !Object.keys(spell.values).length && !Object.keys(spell.flags).length) { skip("doesn't look like a spell window"); continue; }
    const name = await call('spellName', shot.title, init.names);
    let card = cards.find((c) => c.name.toLowerCase() === name.toLowerCase() && !c.done);
    if (!card) card = newCard(name);
    card.parts.push({ path: shot.path, lines: shot.lines, icon: shot.icon });
    touched.add(card);
  }
  for (const card of touched) await analyse(card, { reload: true });
}

// Spellbook pages show each icon on its own background, like the wiki's icon files, so their icons are
// matched with the wiki's. Labels are read from the picture too: stray marks are dropped and the name is
// matched loosely with the spells the app knows.
async function addBook(entries) {
  let known = 0;
  for (const entry of entries) {
    const words = entry.label.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9':-]/g, '')).filter((w) => /[A-Za-z]{2,}|^[IVX]+$/.test(w));
    if (!words.length) continue;
    const name = await call('spellName', words.join(' '), init.names);
    bookIcons.set(name.toLowerCase(), { name, icon: entry.icon, match: entry.match, matches: entry.matches || [] });
    if (entry.match) known++;
  }
  renderBook();
  notice(`Spellbook: ${entries.length} icons read; ${known} ${known === 1 ? 'is a wiki icon' : 'are wiki icons'}, the others aren't on the wiki yet.`);
}

function renderBook() {
  const list = $('#book');
  list.hidden = !bookIcons.size;
  $('#empty').hidden = cards.length > 0 || bookIcons.size > 0;
  $('#bookIcons').replaceChildren(...[...bookIcons.values()].map((b) => {
    const item = document.createElement('div');
    item.className = 'book-icon';
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,' + b.icon;
    img.alt = '';
    const text = document.createElement('div');
    const strong = document.createElement('b');
    strong.textContent = b.name;
    const note = document.createElement('span');
    note.className = b.match ? 'ok' : 'muted';
    note.textContent = b.match ? `wiki icon ${b.match}` : 'not on the wiki yet';
    text.append(strong, document.createElement('br'), note);
    const save = document.createElement('button');
    save.className = 'small';
    save.textContent = 'Save image…';
    save.title = 'Save this icon as a PNG, to upload to the wiki';
    save.addEventListener('click', async () => { const file = await api.saveIcon(b.name, b.icon); if (file) notice('Saved ' + file); });
    item.append(img, text, save);
    return item;
  }));
}

function newCard(name) {
  const el = $('#card').content.firstElementChild.cloneNode(true);
  const card = { id: crypto.randomUUID(), name, parts: [], edits: {}, ticks: {}, icon: null, hand: false, el };
  cards.unshift(card);
  $('#spells').prepend(el);
  $('#empty').hidden = true;
  wire(card);
  return card;
}

// Joins the screenshots, reads the spell and (when asked) reads its wiki page again.
async function analyse(card, { reload = false } = {}) {
  if (!card.parts.length) return removeCard(card);
  const { lines, gaps } = await call('joinParts', card.parts.map((p) => p.lines));
  card.lines = lines;
  card.gaps = gaps;
  card.spell = await call('readSpell', lines);
  card.game = await call('spellFields', card.spell);
  card.level = Number(card.spell.values['Required Level']) || null;
  if (!card.nameChecked) { // a misread title must not become a second page for a spell the wiki has
    card.nameChecked = true;
    const likely = await call('likelyPage', card.name, card.spell.description, init.spells);
    if (likely.page && likely.page !== card.name) { card.readAs = card.name; card.name = likely.page; reload = true; }
    card.suggestions = likely.suggestions.filter((s) => s !== card.name);
  }
  if (reload || !card.page) await loadPage(card);
  await refresh(card);
}

async function loadPage(card) {
  const page = await api.page(card.name);
  card.page = page.error ? null : page;
  card.pageError = page.error || '';
  card.template = page.exists ? await call('pageFields', page.text) : null;
}

async function classPage(cls, { reload = false } = {}) {
  if (!cls) return null;
  if (!classPages[cls] || reload) {
    const page = await api.page(cls);
    classPages[cls] = page.error || !page.exists ? null : page;
  }
  return classPages[cls];
}

// ---- Building the edits ----
const gameValues = (card) => ({ ...card.game, ...card.edits });

async function refresh(card) {
  const page = card.page, exists = !!page?.exists, editable = exists && !!card.template;
  const values = gameValues(card);
  let rows = await call('compareFields', values, editable ? page.text : '');
  const cls = $('#cls').value;
  if (cls && card.level) {
    if (editable) {
      const change = await call('withClass', page.text, cls, card.level);
      if (change) rows.push({ field: 'classes', wiki: change.wiki, game: change.game.replace(/\n$/, ''), same: false, soft: false, apply: true });
    }
  }
  card.book = bookIcons.get(card.name.toLowerCase()) || null;
  const icon = chosenIcon(card);
  if (icon && editable && icon.toLowerCase() !== String(card.template.spellicon || '').toLowerCase()) {
    rows.push({ field: 'spellicon', wiki: card.template.spellicon || '', game: icon, same: false, soft: false, apply: true });
  }
  if (!exists) { // things the spell window doesn't show, to type in if you know them
    for (const field of MANUAL) if (!(field in values)) rows.push({ field, wiki: '', game: '', same: false, soft: false, apply: false, manual: true });
  }
  rows = rows.map((r) => ({ ...r, apply: r.same ? false : (card.ticks[r.field] ?? r.apply) }));
  card.rows = rows;

  if (!card.hand) {
    if (editable) {
      const changes = Object.fromEntries(rows.filter((r) => r.apply).map((r) => [r.field, r.game]));
      card.text = Object.keys(changes).length ? await call('setFields', page.text, changes) : page.text;
    } else if (!exists && !card.pageError) {
      const classCategory = {};
      if (cls) classCategory[cls] = await call('classCategory', (await classPage(cls))?.text || '');
      const chosen = Object.fromEntries(rows.filter((r) => r.apply).map((r) => [r.field, r.game]));
      card.text = await call('newSpellPage', { name: card.name, icon: chosenIcon(card) || suggestedIcon(card)?.wikiName || '', fields: chosen,
        kind: card.spell.kind || 'Spell', skill: card.spell.skill, classes: cls && card.level ? { [cls]: card.level } : {}, classCategory });
    } else card.text = '';
  }

  // Class page row
  card.classText = null;
  card.classNote = '';
  const cp = await classPage(cls);
  if (!cls) card.classNote = 'choose your class at the top';
  else if (!cp) card.classNote = `couldn't read the ${cls} page`;
  else if (!card.level) card.classNote = 'the screenshots don’t show “Required Level”';
  else {
    const { listed } = await call('classStatus', cp.text, card.name);
    if (listed === card.level) card.classNote = `listed on the ${cls} page at level ${listed} ✓`;
    else if (listed) card.classNote = `the ${cls} page lists it at level ${listed}; the game says ${card.level}. Fix that row by hand.`;
    else {
      card.classNote = `not on the ${cls} page yet (level ${card.level})`;
      card.row = await call('classRow', cp.text, { name: card.name, description: plain(values.description).replace(/^''|''$/g, ''),
        skill: card.spell.skill, mana: values.mana, cast: values.casting_time });
      card.classText = await call('addClassRow', cp.text, card.level, card.row);
    }
  }
  render(card);
}

const MANUAL = ['spell_type', 'duration', 'notes'];
const MANUAL_HINT = { spell_type: 'Beneficial or Detrimental', duration: 'e.g. 1 hour (not in the spell window)', notes: 'anything worth knowing' };

// The icon to use: the one picked by hand, else the wiki icon the spellbook screenshot matched.
const chosenIcon = (card) => card.icon || card.book?.match || null;

// An icon for a new page: one the wiki already uses for another rank of the same spell line.
function suggestedIcon(card) {
  const line = lineOf(card.name);
  const spell = init.spells.find((s) => s.iconFile && lineOf(s.page) === line);
  return spell && init.icons.find((i) => i.wikiName.toLowerCase() === spell.iconFile);
}
const iconSrc = (entry) => (!entry ? '' : entry.src || window.mnm.iconsBase + '/' + entry.file);
const iconByName = (name) => init.icons.find((i) => i.wikiName.toLowerCase() === String(name || '').toLowerCase());

// ---- Showing a card ----
function render(card) {
  const el = card.el, page = card.page, exists = !!page?.exists, editable = exists && !!card.template;
  $('.name', el).value = card.name;
  const note = $('.name-note', el);
  note.replaceChildren();
  if (card.readAs) note.append(`The title was read as “${card.readAs}”; the wiki's ${card.name} has the same description.`);
  else if (!card.page?.exists && card.suggestions?.length) {
    note.append('No wiki page has this name. Did you mean ');
    card.suggestions.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'small link';
      b.textContent = s;
      b.addEventListener('click', async () => { card.name = s; card.suggestions = []; card.hand = false; await loadPage(card); refresh(card); });
      note.append(i ? ' or ' : '', b);
    });
    note.append('?');
  }
  note.hidden = !note.childNodes.length;
  const shotIcon = card.book?.icon || card.parts.find((p) => p.icon)?.icon;
  for (const img of el.querySelectorAll('.shot-icon')) img.src = shotIcon ? 'data:image/png;base64,' + shotIcon : '';
  $('.shot-icon.big', el).title = card.book ? 'In the spellbook' : 'In the spell window (add a spellbook screenshot for the icon on its background)';

  $('.parts', el).replaceChildren(...card.parts.map((part, i) => {
    const chip = document.createElement('span');
    chip.className = 'part';
    chip.textContent = fileName(part.path);
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Leave this screenshot out';
    x.addEventListener('click', () => { card.parts.splice(i, 1); card.hand = false; analyse(card); });
    chip.append(x);
    return chip;
  }));
  $('.gap', el).hidden = !card.gaps;
  $('.lines ol', el).replaceChildren(...card.lines.map((line) => {
    const li = document.createElement('li');
    li.textContent = line.text;
    if (line.conf < WEAK) { li.className = 'weak'; li.title = `Read with ${line.conf}% confidence`; }
    return li;
  }));

  $('.page-status', el).textContent = card.pageError ? `couldn't read the wiki: ${card.pageError}`
    : !exists ? '— no page yet; this makes a new one'
    : !card.template ? '— the page has no spell template; copy what you need by hand'
    : `— last edited ${new Date(page.timestamp).toLocaleString()}`;
  $('.open-page', el).hidden = !exists;
  $('.reread', el).hidden = !card.pageError;

  // Icon: always shown for a new page, and for an existing one so a wrong wiki icon can be spotted.
  const pick = $('.icon-pick', el);
  pick.hidden = !(editable || !exists);
  const chosen = iconByName(chosenIcon(card)) || (editable ? iconByName(card.template.spellicon) : suggestedIcon(card));
  $('.pick-icon', el).src = iconSrc(chosen);
  $('.pick-icon', el).hidden = !chosen;
  $('.pick-name', el).textContent = chosen ? chosen.wikiName : 'no icon chosen';
  const iconNote = $('.icon-note', el);
  iconNote.textContent = !card.book ? 'Add a spellbook screenshot to match the icon automatically.'
    : card.book.match ? (card.icon && card.icon !== card.book.match ? `The spellbook icon is ${card.book.match}.` : 'Matched from the spellbook.')
    : "This icon isn't on the wiki yet: upload it below (or save it as a PNG)." + (editable && card.template.spellicon ? ` The wiki's ${card.template.spellicon} doesn't look like it.` : '');
  $('.save-icon', el).hidden = !card.book || !!card.book.match;
  $('.upload', el).hidden = !card.book || !!card.book.match;
  const uploadName = $('.upload-name', el);
  if (!uploadName.value) uploadName.value = `${card.name} icon.png`;

  const weakValues = new Set(card.spell.weak);
  $('.fields tbody', el).replaceChildren(...card.rows.map((row) => {
    const tr = document.createElement('tr');
    tr.className = (row.same ? 'same' : row.apply ? 'change' : '') + (row.soft ? ' soft' : '');
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = row.apply;
    tick.disabled = row.same;
    tick.title = row.same ? 'The wiki already says this' : row.soft ? 'The game words this differently from the wiki; check before using it' : '';
    tick.addEventListener('change', () => { card.ticks[row.field] = tick.checked; card.hand = false; refresh(card); });
    const value = document.createElement('input');
    value.value = row.game;
    if (row.manual) value.placeholder = MANUAL_HINT[row.field];
    if (row.field === 'spell_type') value.setAttribute('list', 'spellTypes');
    value.spellcheck = false;
    if ([...weakValues].some((w) => plain(row.game).includes(w.split(':').pop().trim()))) value.classList.add('weak-value');
    value.readOnly = row.field === 'classes' || row.field === 'spellicon';
    value.addEventListener('change', () => { card.edits[row.field] = value.value; card.hand = false; refresh(card); });
    const cells = [tick, row.field, row.wiki || '—', value].map((content, i) => {
      const td = document.createElement('td');
      td.className = ['', 'key', 'wiki', 'game'][i];
      td.append(content);
      return td;
    });
    tr.append(...cells);
    return tr;
  }));
  const unknown = $('.unknown', el);
  unknown.hidden = !card.spell.unknown.length;
  unknown.textContent = card.spell.unknown.length ? 'Not used (no wiki field for these yet): ' + card.spell.unknown.join(' · ') : '';

  const text = $('.page-text', el);
  if (document.activeElement !== text) text.value = card.text;
  $('.hand', el).hidden = !card.hand;
  $('.rebuild', el).hidden = !card.hand;
  const changed = card.text && (!exists || card.text !== page.text);
  for (const sel of ['.copy-page', '.publish-page']) $(sel, el).disabled = !changed;
  $('.edit-page', el).disabled = !card.text;
  $('.publish-page', el).textContent = exists ? 'Publish changes' : 'Create the page';
  if (!changed && editable && !$('.result', el).dataset.keep) $('.result', el).textContent = 'Nothing to change.';

  $('.class-status', el).textContent = '— ' + card.classNote;
  $('.class-row', el).hidden = !card.classText;
  if (card.row) $('.row-text', el).value = card.row;
}

function removeCard(card) {
  cards.splice(cards.indexOf(card), 1);
  card.el.remove();
  $('#empty').hidden = cards.length > 0 || bookIcons.size > 0;
}

// ---- Card buttons ----
function wire(card) {
  const el = card.el;
  $('.remove', el).addEventListener('click', () => removeCard(card));
  $('.name', el).addEventListener('change', async (e) => {
    card.name = e.target.value.trim() || card.name;
    card.readAs = null;
    card.suggestions = [];
    card.hand = false;
    await loadPage(card);
    refresh(card);
  });
  $('.open-page', el).addEventListener('click', () => api.open(card.name, false));
  $('.reread', el).addEventListener('click', async () => { await loadPage(card); card.hand = false; refresh(card); });
  $('.page-text', el).addEventListener('input', (e) => { card.text = e.target.value; card.hand = true; $('.hand', el).hidden = false; $('.rebuild', el).hidden = false; });
  $('.rebuild', el).addEventListener('click', () => { card.hand = false; refresh(card); });
  $('.copy-page', el).addEventListener('click', async () => { await window.mnm.copyText(card.text); notice('Page text copied.'); });
  $('.edit-page', el).addEventListener('click', async () => {
    await window.mnm.copyText(card.text);
    api.open(card.name, true);
    notice('Page text copied: paste it over the text in the editor, check the preview, then save.');
  });
  $('.publish-page', el).addEventListener('click', () => publishPage(card));

  const search = $('.icon-search', el), grid = $('.icon-grid', el);
  search.addEventListener('input', () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const found = words.length ? init.icons.filter((i) => words.every((w) => (i.name + ' ' + i.wikiName).toLowerCase().includes(w))).slice(0, 48) : [];
    grid.replaceChildren(...found.map((icon) => {
      const b = document.createElement('button');
      b.title = `${icon.name} (${icon.wikiName})`;
      b.classList.toggle('on', icon.wikiName === card.icon);
      const img = document.createElement('img');
      img.src = iconSrc(icon);
      img.alt = icon.name;
      b.append(img);
      b.addEventListener('click', () => { card.icon = icon.wikiName; card.hand = false; grid.replaceChildren(); search.value = ''; refresh(card); });
      return b;
    }));
  });

  $('.do-upload', el).addEventListener('click', () => uploadIcon(card));
  $('.save-icon', el).addEventListener('click', async () => { const file = await api.saveIcon(card.name, card.book.icon); if (file) notice('Saved ' + file); });
  $('.copy-row', el).addEventListener('click', async () => { await window.mnm.copyText($('.row-text', el).value); notice('Row copied.'); });
  $('.edit-class', el).addEventListener('click', async () => {
    await window.mnm.copyText($('.row-text', el).value);
    api.open($('#cls').value, true);
    notice(`Row copied: paste it into the “Level ${card.level}” section of the class page.`);
  });
  $('.row-text', el).addEventListener('input', (e) => { card.row = e.target.value; });
  $('.publish-class', el).addEventListener('click', () => publishClassRow(card));
}

async function needLogin() {
  if (user || init.savedLogin) return true;
  showLogin(true);
  notice('Log in to the wiki first (or use Copy and paste it yourself).');
  return false;
}

async function publishPage(card) {
  if (!(await needLogin())) return;
  const exists = !!card.page?.exists;
  const changes = card.rows.filter((r) => r.apply).map((r) => r.field);
  const what = exists ? (card.hand ? 'your edited text' : changes.join(', '))
    : `a NEW page. No page called “${card.name}” exists yet: check the spelling of the name.` + (card.suggestions?.length ? `\nSimilar pages: ${card.suggestions.join(', ')}` : '');
  if (!confirm(`Publish to “${card.name}” on the wiki${user ? ` as ${user}` : ''}?\n\n${what}`)) return;
  const result = await api.publish({ title: card.name, text: card.text, summary: SUMMARY, base: card.page });
  const out = $('.result', card.el);
  if (result.error) {
    out.textContent = 'Not published: ' + result.error;
    if (/conflict|exists|changed/i.test(result.error)) { await loadPage(card); card.hand = false; await refresh(card); out.textContent += ' The page was read again; check the changes.'; }
    return;
  }
  out.dataset.keep = '1';
  out.textContent = result.nochange ? 'The wiki already had this.' : `Published${result.revision ? ` (revision ${result.revision})` : ''}.`;
  card.ticks = {};
  card.edits = {};
  card.hand = false;
  await loadPage(card);
  await refresh(card);
  setTimeout(() => { delete out.dataset.keep; }, 100);
}

// Uploads the spellbook icon as a new wiki file (63 x 63 PNG in Category:Spell Icons) and uses it on the page.
// The wiki refuses a name that's taken; if the same picture is already there, that file is used instead.
async function uploadIcon(card) {
  if (!(await needLogin())) return;
  let filename = $('.upload-name', card.el).value.trim();
  if (!/\.png$/i.test(filename)) filename += '.png';
  const out = $('.upload-result', card.el);
  if (!confirm(`Upload this icon to the wiki as File:${filename}${user ? ` as ${user}` : ''}?\n\nIt goes in Category:Spell Icons, and the spell page will use it.`)) return;
  out.textContent = 'Uploading…';
  const result = await api.upload({ filename, base64: card.book.icon });
  if (result.error) { out.textContent = 'Not uploaded: ' + result.error; return; }
  if (result.warning && !result.duplicate) { out.textContent = 'Not uploaded: ' + result.warning + ' Choose another name.'; return; }
  const file = (result.duplicate || result.filename).replace(/_/g, ' ');
  const wikiName = file.replace(/\.png$/i, '');
  out.textContent = result.duplicate ? result.warning + ' Using that file.' : `Uploaded File:${file}.`;
  if (!iconByName(wikiName)) init.icons.push({ wikiName, name: card.name, src: 'data:image/png;base64,' + card.book.icon });
  card.book.match = wikiName; // the spellbook entry is shared, so other cards and the list see it too
  card.icon = wikiName;
  card.hand = false;
  renderBook();
  await refresh(card);
}

async function publishClassRow(card) {
  if (!(await needLogin())) return;
  const cls = $('#cls').value;
  const fresh = await classPage(cls, { reload: true }); // the newest version, so nobody's edit is lost
  if (!fresh) return notice(`Couldn't read the ${cls} page.`);
  const { listed } = await call('classStatus', fresh.text, card.name);
  if (listed) { await refresh(card); return notice(`The ${cls} page already lists ${card.name}.`); }
  const text = await call('addClassRow', fresh.text, card.level, card.row);
  if (!confirm(`Add ${card.name} to the ${cls} page under Level ${card.level}${user ? ` as ${user}` : ''}?\n\n${card.row}`)) return;
  const result = await api.publish({ title: fresh.title, text, summary: `Add ${card.name} (level ${card.level}) from the in-game spell window (MnM Tools Wiki helper)`, base: fresh });
  $('.class-result', card.el).textContent = result.error ? 'Not published: ' + result.error : 'Added to the class page.';
  await classPage(cls, { reload: true });
  await refresh(card);
}

// ---- Window ----
function showLogin(on) {
  $('#loginForm').hidden = !on;
  if (on) $('#loginName').focus();
}
function showUser() {
  $('#who').textContent = user ? `Logged in to the wiki as ${user}.` : init.savedLogin ? 'Wiki login saved; it is used when you publish.' : 'Not logged in to the wiki: you can copy edits and paste them yourself.';
  $('#loginOpen').hidden = !!user || init.savedLogin;
  $('#logout').hidden = !user && !init.savedLogin;
}

async function start() {
  init = await api.init();
  user = init.user;
  const cls = $('#cls');
  cls.append(new Option('—', ''), ...init.classes.map((c) => new Option(c, c)));
  cls.value = init.cls;
  cls.addEventListener('change', () => { for (const card of cards) { card.hand = false; refresh(card); } });
  $('#watch').checked = init.watch;
  $('#folder').textContent = init.folder;
  $('#rememberWrap').hidden = !init.canKeepLogin;
  showUser();

  $('#add').addEventListener('click', async () => addFiles(await api.choose()));
  $('#folder').addEventListener('click', async () => { const folder = await api.chooseFolder(); if (folder) $('#folder').textContent = folder; });
  $('#watch').addEventListener('change', async (e) => { const { error } = await api.watch(e.target.checked); if (error) { notice(error); e.target.checked = false; } });
  api.onFiles((files) => addFiles(files, { fromWatch: true }));
  api.onWatchError((error) => { notice(error); $('#watch').checked = false; });

  $('#loginOpen').addEventListener('click', () => showLogin(true));
  $('#loginCancel').addEventListener('click', () => showLogin(false));
  $('#logout').addEventListener('click', async () => { await api.logout(); user = null; init.savedLogin = false; showUser(); });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await api.login({ name: $('#loginName').value.trim(), password: $('#loginPassword').value, remember: $('#remember').checked && init.canKeepLogin });
    $('#loginError').hidden = !result.error;
    $('#loginError').textContent = result.error || '';
    if (result.error) return;
    user = result.user;
    init.savedLogin = $('#remember').checked && init.canKeepLogin;
    $('#loginPassword').value = '';
    showLogin(false);
    showUser();
  });

  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    addFiles([...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean));
  });
  api.ready();
}

start().catch((error) => notice('Wiki helper failed to start: ' + error.message, 0));
