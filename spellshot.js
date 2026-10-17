// Wiki helper logic: turns the text read from spell window screenshots (spellshot.py) into wiki edits.
// A spell window often needs scrolling, so one spell can be several screenshots; their lines are joined where
// they overlap. The game's lines are then read into {{Spellpagesmart}} fields, compared with the wiki page,
// and turned into wikitext (a whole new page, changed fields of an existing page, or a class page row).
// Nothing here edits the wiki; it only builds text for the user to check, copy or publish.

const { templateParams, parseClassPage } = require('./wiki');

// ---- Fuzzy text ----
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}
// 1 = the same text, 0 = nothing alike. Case and spacing don't count.
function similarity(a, b) {
  a = String(a).toLowerCase().replace(/\s+/g, ' ').trim();
  b = String(b).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!a && !b) return 1;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

// ---- Joining screenshots ----
const SAME = 0.75; // lines this alike are the same line read twice
const EDGE = 80; // a line read with less confidence than this may be cut off at the window's edge

// How many lines at the end of `a` are the first lines of `b`. The last line of `a` and the first of `b` may be
// cut in half by the window edge, so those only need to be roughly alike when they were read badly.
function overlap(a, b) {
  for (let n = Math.min(a.length, b.length); n >= 1; n--) {
    const start = a.length - n;
    let strong = 0, ok = true;
    for (let k = 0; k < n && ok; k++) {
      const x = a[start + k], y = b[k], sim = similarity(x.text, y.text);
      const edge = (k === 0 || k === n - 1) && Math.min(x.conf, y.conf) < EDGE;
      if (sim >= SAME) strong++;
      else if (!(edge && sim >= 0.3)) ok = false;
    }
    if (ok && strong >= Math.min(2, n)) return n;
  }
  return 0;
}

// Joins the screenshots of one spell into one list of lines, in whichever order they were taken. Where two
// screenshots show the same line, the better reading is kept. `gaps` counts joins where nothing overlapped,
// so a line or more may be missing between them.
function joinParts(parts) {
  let pieces = parts.filter((p) => p.length).map((p) => p.map((line) => ({ ...line })));
  let gaps = 0;
  while (pieces.length > 1) {
    let best = null;
    for (let i = 0; i < pieces.length; i++) {
      for (let j = 0; j < pieces.length; j++) {
        if (i === j) continue;
        const n = overlap(pieces[i], pieces[j]);
        if (!best || n > best.n) best = { i, j, n };
      }
    }
    let { i, j, n } = best;
    if (!n) { // nothing overlaps: the one starting with the description goes first
      gaps++;
      [i, j] = isLabelled(pieces[0][0]?.text) && !isLabelled(pieces[1][0]?.text) ? [1, 0] : [0, 1];
    }
    const a = pieces[i], b = pieces[j], start = a.length - n;
    const joined = [...a.slice(0, start), ...b.slice(0, n).map((y, k) => (a[start + k].conf >= y.conf ? a[start + k] : y)), ...b.slice(n)];
    pieces = pieces.filter((_, k) => k !== i && k !== j);
    pieces.unshift(joined);
  }
  return { lines: pieces[0] || [], gaps };
}

// ---- Reading the spell window ----
// "Label: value" lines, and lines that are a statement on their own. Lines are matched loosely, since the text
// is read from a picture ("AQOE Type" is "AOE Type").
const LABELS = ['Mana Cost', 'Cast Time', 'Cooldown', 'Range', 'Required Level', 'Resist Element', 'AOE Type', 'AOE Radius',
  'Duration', 'Fizzle Time', 'Target', 'Target Type'];
const STATEMENTS = {
  'Innate': 'innate',
  'Triggers Spell Global Cooldown': 'gcd',
  'Triggers Melee Global Cooldown': 'gcd',
  'Triggers Global Cooldown': 'gcd',
  'Does Not Trigger Global Cooldown': 'noGcd',
  'Requires Line of Sight': 'note',
  'Cannot Fizzle': 'noFizzle',
  'Can Cast While Moving': 'note',
  'You cannot cast this.': 'ignore', // about the character looking, not the spell
};
const SKILLS = ['Abjuration', 'Acrobatics', 'Alteration', 'Brass Instruments', 'Channeling', 'Conjuration', 'Divination',
  'Evocation', 'Martial', 'Might', 'Percussion', 'Singing', 'Stringed Instruments', 'Subterfuge', 'Valor', 'Wind Instruments'];
const KINDS = { ability: 'Ability', spell: 'Spell', song: 'Song' };

function bestMatch(text, options, min) {
  let best = null, score = min;
  for (const option of options) {
    const s = similarity(text, option);
    if (s >= score) { best = option; score = s; }
  }
  return best;
}

function labelled(text) {
  const m = String(text).match(/^([^:]{2,24}):\s*(.*)$/);
  const label = m && bestMatch(m[1], LABELS, 0.7);
  return label ? { label, value: m[2].trim() } : null;
}
const isLabelled = (text) => !!(labelled(text) || bestMatch(text, Object.keys(STATEMENTS), 0.8) || schoolLine(text));

// "Alteration Ability" -> {skill: 'Alteration', kind: 'Ability'}
function schoolLine(text) {
  const m = String(text).trim().match(/^(.+?)\s+(\S+)$/);
  if (!m) return null;
  const kind = KINDS[bestMatch(m[2].toLowerCase(), Object.keys(KINDS), 0.6)];
  const skill = kind && bestMatch(m[1], SKILLS, 0.7);
  return skill ? { skill, kind } : null;
}

// "10.0 seconds" -> "10 seconds", "1 seconds" -> "1 second", the way the wiki writes times.
function tidyTime(value) {
  return String(value).trim()
    .replace(/(\d+)\.0\b/g, '$1')
    .replace(/^1 seconds$/i, '1 second').replace(/^1 minutes$/i, '1 minute').replace(/^1 hours$/i, '1 hour');
}

// The lines of one spell window -> what it says. Lines the reader doesn't know are kept in `unknown` so
// nothing on screen is silently dropped.
function readSpell(lines) {
  const out = { description: '', skill: '', kind: '', notes: [], unknown: [], values: {}, flags: {}, weak: [] };
  const description = [];
  let pastDescription = false;
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    if (line.conf < EDGE) out.weak.push(text);
    const school = schoolLine(text);
    if (school && !out.skill) { Object.assign(out, school); pastDescription = true; continue; }
    const field = labelled(text);
    if (field) { out.values[field.label] = field.value; pastDescription = true; continue; }
    const statement = bestMatch(text, Object.keys(STATEMENTS), 0.8);
    if (statement) {
      const what = STATEMENTS[statement];
      if (what === 'note') out.notes.push(statement);
      else if (what !== 'ignore') out.flags[what] = true;
      pastDescription = true;
      continue;
    }
    if (!pastDescription) description.push(text);
    else out.unknown.push(text);
  }
  // Tesseract sometimes splits a capital off its word ("W alk"); "A" and "I" are words of their own.
  out.description = description.join(' ').replace(/\s+/g, ' ').trim().replace(/(^|[.!?] )([B-HJ-Z]) ([a-z]{2,})/g, '$1$2$3');
  return out;
}

// What the game shows -> {{Spellpagesmart}} fields. `soft` fields are only offered where the wiki has nothing,
// because the game's wording doesn't line up exactly with the wiki's field (the game's "AOE Type: Single
// Target" is not quite the wiki's target type, and notes are written many ways).
const SOFT = new Set(['target_type', 'aoe_radius', 'other']);
function spellFields(spell) {
  const v = spell.values, f = {};
  if (spell.description) f.description = `''${spell.description}''`;
  if (spell.skill) f.skill = `[[Skill ${spell.skill}|${spell.skill}]]`;
  if (v['Mana Cost']) f.mana = v['Mana Cost'];
  else if (spell.flags.innate) f.mana = 'Innate';
  if (v['Cast Time']) f.casting_time = tidyTime(v['Cast Time']);
  if (v.Cooldown) f.recast_time = tidyTime(v.Cooldown);
  if (spell.flags.gcd) f.triggers_gcd = 'Yes';
  if (spell.flags.noGcd) f.triggers_gcd = 'No';
  if (v.Range) f.range = v.Range;
  if (v.Duration) f.duration = tidyTime(v.Duration);
  if (v['Resist Element']) f.resist = v['Resist Element'];
  if (spell.flags.noFizzle) f.fizzle_time = 'Cannot fizzle';
  else if (v['Fizzle Time']) f.fizzle_time = tidyTime(v['Fizzle Time']);
  const aoe = v['AOE Type'];
  if (aoe && /^single/i.test(aoe)) f.target_type = 'Single';
  else if (aoe) f.aoe_radius = v['AOE Radius'] ? `${aoe}, ${v['AOE Radius']}` : aoe;
  if (spell.notes.length) f.other = spell.notes.join('<br>');
  return f;
}

// ---- Comparing with the wiki ----
const bare = (s) => String(s || '').replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/<br\s*\/?>/gi, ' ')
  .replace(/\s+/g, ' ').trim().toLowerCase().replace(/^(\?\?|\?)$/, '').replace(/(\d+)\.0\b/g, '$1').replace(/\.$/, '');
// The wiki and the game word some values differently: the game's resist "None" is the wiki's "Unresistable".
const ALIKE = [['none', 'unresistable', 'cannot be resisted']];
const sameValue = (a, b) => {
  const x = bare(a), y = bare(b);
  return x === y || x.replace(/s$/, '') === y.replace(/s$/, '') || ALIKE.some((set) => set.includes(x) && set.includes(y));
};

// The page's {{Spellpagesmart}} fields, or null when the page has none.
function pageFields(text) {
  const m = String(text || '').match(/\{\{\s*Spellpagesmart\s*\|?([\s\S]*?)\n\}\}/i);
  return m ? templateParams(m[1]) : null;
}

// One row per field the game shows: what the wiki has, what the game says, and whether to change it.
// Different values are ticked; soft fields only when the wiki is blank.
function compareFields(fields, text) {
  const wiki = pageFields(text) || {};
  return Object.entries(fields).map(([field, game]) => {
    const now = wiki[field] ?? '';
    const same = sameValue(now, game), blank = !bare(now);
    const soft = SOFT.has(field);
    return { field, wiki: now, game, same, soft, apply: !same && (!soft || blank) };
  });
}

// Puts new values into the page's {{Spellpagesmart}}, leaving everything else as it was. A field the template
// doesn't have yet is added at its end.
function setFields(text, changes) {
  const m = String(text).match(/\{\{\s*Spellpagesmart\s*\|?[\s\S]*?\n\}\}/i);
  if (!m) throw new Error('The page has no {{Spellpagesmart}} template');
  let block = m[0];
  for (const [field, value] of Object.entries(changes)) {
    const re = new RegExp(`(\\|\\s*${field}\\s*=)[ \\t]*([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-z0-9_]+\\s*=|\\n\\s*\\|\\s*\\n|\\n\\}\\}|\\n\\n)`, 'i');
    if (re.test(block)) block = block.replace(re, (all, head) => `${head} ${value}`);
    else block = block.replace(/\n\}\}$/, `\n| ${field} = ${value}\n}}`);
  }
  return text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
}

// The page's classes list with `cls` at `level`, or null when it already says so. Other lines stay as written.
function withClass(text, cls, level) {
  const now = pageFields(text)?.classes ?? '';
  const lines = now.split('\n').map((l) => l.trim()).filter(Boolean);
  const re = new RegExp(`\\[\\[${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^\\]]*)?\\]\\]\\s*[-–]\\s*Level\\s*(\\d+)`, 'i');
  const at = lines.findIndex((l) => re.test(l));
  if (at >= 0 && +lines[at].match(re)[1] === level) return null;
  const line = `* [[${cls}]] - Level ${level}`;
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  return { wiki: now, game: '\n' + lines.join('\n') + '\n' };
}

// ---- New pages ----
const KIND_PLURAL = { Ability: 'Abilities', Spell: 'Spells', Song: 'Songs' };
const SKILL_CATEGORY = { 'Stringed Instruments': 'String', 'Brass Instruments': 'Brass' };

// A whole new spell page, laid out like the wiki's existing ones. `classes` is {Class: level}; `classCategory`
// gives each class's category (the heading of its class page's abilities section, "Rogue Abilities").
const NO_ICON = 'Itemicon0000AA'; // the wiki's "no icon yet" picture, used on hundreds of pages
function newSpellPage({ name, icon = '', fields, kind = 'Spell', skill = '', classes = {}, classCategory = {} }) {
  const f = (key) => fields[key] ?? '';
  const classLines = Object.entries(classes).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([cls, level]) => `* [[${cls}]] - Level ${level}`).join('\n');
  const plural = KIND_PLURAL[kind] || 'Spells';
  const categories = [`All ${plural}`, skill && `${SKILL_CATEGORY[skill] || skill} ${plural}`,
    ...Object.keys(classes).map((cls) => classCategory[cls]).filter(Boolean)];
  return `{{Spellpagesmart|

| spellname = ${name}
| spellicon = ${icon || NO_ICON}
| description = ${f('description')}
| notes = ${f('notes')}
| classes =
${classLines}

| slots =

| skill = ${f('skill')}

| mana = ${f('mana')}
| range = ${f('range')}
| casting_time = ${f('casting_time')}
| fizzle_time = ${f('fizzle_time')}
| recast_time = ${f('recast_time')}
| duration = ${f('duration')}
| target_type = ${f('target_type')}
| spell_type = ${f('spell_type')}
| resist = ${f('resist')}
| aoe_radius = ${f('aoe_radius')}
| triggers_gcd = ${f('triggers_gcd')}
| other = ${f('other')}

| msg_cast_on_you =
| msg_cast_on_other =
| msg_wears_off =

| items_with_effect =

}}

= Where to Obtain =
{| class="wikitable sortable" cellpadding=5 style="border:1px solid #BBB; text-align: center; width:500px;"
! Zone !! NPC Name !! Location !! Cost
|-
| || || || 
|}

${[...new Set(categories)].map((c) => `[[Category:${c}]]`).join('\n')}
`;
}

// ---- Class pages ----
// The class page's category name: the heading of its abilities section ("=Rogue Abilities=").
function classCategory(text) {
  const m = String(text).match(/^=\s*([^={][^=]*?(?:spells|songs|abilities)[^=]*?)\s*=\s*$/im);
  return m ? m[1].trim() : '';
}

// Where an ability stands on its class page: {listed: level|null}.
function classStatus(text, name) {
  const key = name.toLowerCase();
  const entry = parseClassPage(text).find((e) => e.name.toLowerCase() === key);
  return { listed: entry ? entry.level : null };
}

// The page's own short name for a skill ("[[Skill Alteration|Alt]]"), so a new row matches its neighbours.
function skillLink(text, skill) {
  if (!skill) return '';
  const counts = {};
  for (const m of String(text).matchAll(new RegExp(`\\[\\[Skill ${skill}\\s*\\|\\s*([^\\]]+)\\]\\]`, 'g'))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const short = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || skill.slice(0, 3);
  return `[[Skill ${skill}|${short}]]`;
}

// The row for an ability, in the page's own layout ({{SpellRow}} or a wikitable row).
function classRow(text, { name, description, skill, mana, cast }) {
  const school = skillLink(text, skill);
  if (/\{\{\s*SpellRow/i.test(text)) {
    const castLine = /\|\s*casttime\s*=/i.test(text) ? `\n|casttime=${cast || ''}` : '';
    return `{{SpellRow\n|name=${name}\n|description=${description}\n|school=${school}\n|location=??\n|mana=${mana || ''}${castLine}\n}}`;
  }
  return `|-\n| ${name} || ${description} || ${school} || ?? || ${mana || ''}`;
}

// Adds a row under "==Level N==" on the class page, at the end of that level's table. A level the page doesn't
// have yet gets its own section, copied from the layout of the page's other levels, in level order.
function addClassRow(text, level, row) {
  const heading = /^==\s*Level\s*(\d+)\s*==\s*$/gim;
  const levels = [...String(text).matchAll(heading)].map((m) => ({ level: +m[1], index: m.index, end: m.index + m[0].length }));
  if (!levels.length) throw new Error('The class page has no "==Level N==" sections');
  const spellRow = row.startsWith('{{');
  const at = levels.find((l) => l.level === level);
  if (at) {
    const next = levels.find((l) => l.index > at.index);
    const sectionEnd = next ? next.index : sectionLimit(text, at.end);
    const section = text.slice(at.end, sectionEnd);
    const close = spellRow ? section.lastIndexOf('</table>') : section.lastIndexOf('|}');
    const insertAt = at.end + (close >= 0 ? close : section.trimEnd().length);
    return text.slice(0, insertAt) + (spellRow ? row + '\n' : row + '\n') + text.slice(insertAt);
  }
  // A new level section, shaped like the first one (its table opening and header row).
  const first = levels[0], firstEnd = (levels[1] || { index: sectionLimit(text, first.end) }).index;
  const sample = text.slice(first.end, firstEnd);
  const open = spellRow ? (sample.match(/<table[\s\S]*?<\/tr>/i) || [''])[0] : (sample.match(/\{\|[^\n]*\n(?:![^\n]*\n)?/) || ['{| class="wikitable sortable" style="width:100%;"\n'])[0];
  const body = spellRow ? `${open}${row}\n</table>` : `${open}${row}\n|}`;
  const section = `==Level ${level}==\n${body}\n\n`;
  const after = levels.find((l) => l.level > level);
  const insertAt = after ? after.index : sectionLimit(text, levels[levels.length - 1].end);
  return text.slice(0, insertAt) + (after ? '' : '\n') + section + text.slice(insertAt);
}
// Where the abilities section ends: the next top-level heading after `from`.
function sectionLimit(text, from) {
  const m = /^=\s*[^={][^\n]*$/m.exec(text.slice(from));
  return m ? from + m.index : text.length;
}

// The wiki page a misread title most likely means. A spell's description is a much longer text than its name,
// so the same description on a known page is strong evidence ("BESTIAT ROND" is Bestial Bond); a name that is
// only roughly like a known one is a suggestion. `spells` is [{name, page, description}].
function likelyPage(name, description, spells) {
  const lower = String(name).toLowerCase();
  if (spells.some((s) => s.page.toLowerCase() === lower)) return { page: null, suggestions: [] };
  const desc = bare(description);
  if (desc.length >= 20) {
    const same = spells.filter((s) => s.description && !s.classPageOnly && similarity(desc.slice(0, 300), bare(s.description).slice(0, 300)) >= 0.9);
    if (same.length) {
      const best = same.sort((a, b) => similarity(name, b.name) - similarity(name, a.name))[0];
      return { page: best.page, suggestions: [] };
    }
  }
  const suggestions = spells.map((s) => ({ page: s.page, score: Math.max(similarity(name, s.name), similarity(name, s.page)) }))
    .filter((s) => s.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 3).map((s) => s.page);
  return { page: null, suggestions: [...new Set(suggestions)] };
}

// "BESTIAL BOND" (the title bar is in small capitals) -> the wiki's name for it when known, else title case.
const SMALL = new Set(['of', 'the', 'and', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'vs', 'versus']);
function spellName(title, known = []) {
  const clean = String(title).replace(/[^A-Za-z0-9':,\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();
  const exact = known.find((k) => k.toLowerCase() === lower);
  if (exact) return exact;
  // "Enraging Strike" when the wiki has "Enraging Strike I"…"VI": a spell line, not a misread of one rank.
  const ranked = known.some((k) => k.toLowerCase().replace(/\s+([ivx]+|\d+)$/, '') === lower);
  const match = !ranked && known.length ? bestMatch(clean, known, 0.85) : null;
  if (match) return match;
  return clean.toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.replace(/^\w/, (c) => c.toUpperCase())))
    .join(' ').replace(/\b([IVX]+)\b/gi, (r) => r.toUpperCase());
}

module.exports = { similarity, overlap, joinParts, readSpell, spellFields, compareFields, pageFields, setFields, withClass, newSpellPage,
  classCategory, classStatus, classRow, addClassRow, spellName, likelyPage, tidyTime, NO_ICON };
