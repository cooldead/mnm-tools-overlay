// Quest walkthroughs from the Monsters & Memories community wiki (monstersandmemories.miraheze.org).
// Every page in Category:Quests has a {{Quest}} box (start zone, quest giver, ...) and a hand-written walkthrough.
// The walkthrough is turned into steps: things to say and MUD commands get copy buttons, hand-ins are marked
// so they stand out, and NPC dialogue is kept but shown only on request. Some quests also have a
// "<quest>/Quick_Guide" subpage with a short checklist, which is used as well when present.
// Used by scripts/update-quests.js (bundled snapshot) and by the quest tracker's "Update from wiki" button.

const API = 'https://monstersandmemories.miraheze.org/w/api.php';
const CATEGORY = 'Category:Quests';
const USER_AGENT = 'mnm-tools/0.1 (personal game overlay; https://monstersandmemories.miraheze.org)';
const BATCH = 50;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= 3) throw new Error(`Wiki request failed: ${error.message}`);
      await sleep(1000 * attempt);
    }
  }
}

// ---- Wikitext helpers ----

// Top-level {{templates}} in `text`, with balanced braces: [{start, end, name, args: [...]}].
function templates(text) {
  const found = [];
  let i = 0;
  while ((i = text.indexOf('{{', i)) !== -1) {
    let depth = 0, j = i;
    for (; j < text.length - 1; j++) {
      if (text[j] === '{' && text[j + 1] === '{') { depth++; j++; } else if (text[j] === '}' && text[j + 1] === '}') { depth--; j++; if (!depth) break; }
    }
    if (depth) break; // unclosed: leave the rest alone
    const inner = text.slice(i + 2, j - 1);
    const args = splitArgs(inner);
    found.push({ start: i, end: j + 1, name: args.shift().trim(), args });
    i = j + 1;
  }
  return found;
}

// Splits on | that isn't inside [[links]] or nested {{templates}}.
function splitArgs(inner) {
  const out = [];
  let depth = 0, from = 0;
  for (let k = 0; k < inner.length; k++) {
    const two = inner.slice(k, k + 2);
    if (two === '{{' || two === '[[') { depth++; k++; } else if (two === '}}' || two === ']]') { depth--; k++; } else if (inner[k] === '|' && !depth) { out.push(inner.slice(from, k)); from = k + 1; }
  }
  out.push(inner.slice(from));
  return out;
}

const decode = (s) => s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'");

// Wikitext to plain text: links become their label, formatting and tags go, leftover templates are dropped.
const plain = (s) => decode(String(s || '')
  .replace(/\{\{\s*Money\s*\|([^}]*)\}\}/gi, (m, a) => money(a.split('|')))
  .replace(/\{\{[^{}]*\}\}/g, '')
  .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '')
  .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]?/g, '$1')
  .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
  .replace(/''+\s*(\/[^'\n]+?)\s*''+/g, '“$1”').replace(/<code>\s*(\/[^<]+?)\s*<\/code>/gi, '“$1”')
  .replace(/'''?/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ').trim();

function money([p = 0, g = 0, s = 0, c = 0]) {
  const parts = [[p, 'pp'], [g, 'gp'], [s, 'sp'], [c, 'cp']].filter(([n]) => +n).map(([n, u]) => `${+n}${u}`);
  return parts.join(' ') || '0cp';
}

// ---- Things to say and commands, found inside a line of text ----

// Words that end a loose command: "/look near the spire" is just /look, "/take Rope" keeps its object.
const STOP = new Set(['at', 'near', 'to', 'in', 'on', 'around', 'the', 'a', 'an', 'when', 'while', 'and', 'or', 'for', 'command',
  'with', 'from', 'by', 'then', 'again', 'if', 'until', 'it', 'you', 'that', 'this', 'there', 'here', 'into', 'onto', 'behind', 'inside',
  'as', 'so', 'once', 'after', 'before', 'twice', 'too', 'is', 'will', 'should', 'can', 'mud', 'action', 'emote', 'next', 'type',
  'does', 'did', 'not', 'reveals', 'yields', 'gives', 'shows', 'responses', 'feature', 'command', 'commands', 'it']);
// "/mud command", "the /orc": slash words that aren't commands.
const NOT_COMMANDS = new Set(['mud', 'say']);
const QUOTES = '"“”\'‘’`';

// Splits plain text into parts: {text}, {say}, {cmd}. Copy text: say -> what to say, cmd -> the whole command.
function inlineParts(text) {
  const parts = [];
  let rest = text, consumed = '';
  const push = (part) => {
    const last = parts[parts.length - 1];
    if (part.text != null && last && last.text != null) last.text += part.text; else parts.push(part);
  };
  // Earliest match of any rule wins.
  const rules = [
    // You say, "What things?"  /  /say "Your brother?"  /  say 'research'  /  You /say What sickness?
    { re: /(?:\byou\s+\/?|(?<![\w/])\/|\b)say,?:?\s*(?:''\s*)?["“'‘]([^"”’\n]{1,160}?)["”'’](?:\s*'')?/i, make: (m) => ({ say: clean(m[1]) }) },
    { re: /(?:^|\s)\/say\s+([^."“”()\n,;:]{1,80}?)(?=\s+to\s|[.,;:)!]|$)/i, make: (m) => ({ say: clean(m[1]) }), lead: true },
    // "/throw wall", ''/pull spike'', <code>/look</code>: the whole quoted command
    { re: /["“'`‘]{1,2}(\/[a-z][^"”'`’\n]{0,60}?)["”'`’]{1,2}/i, make: (m) => ({ cmd: cleanCmd(m[1]) }) },
    // a loose /command and up to two object words
    { re: /(?:^|(?<=[\s(]))\/([a-z]+)((?:\s+[A-Za-z][\w'-]*){0,2})/i, make: looseCommand },
  ];
  while (rest) {
    let best = null;
    for (const rule of rules) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) { push({ text: rest }); break; }
    let { m } = best;
    let start = m.index, made = best.rule.make(m);
    // "shirt/robe": a slash straight after a word (or after "the") isn't a new command.
    const before = consumed.slice(-20) + rest.slice(0, m.index);
    if (made?.cmd && m[0].trimStart().startsWith('/') && (/[\w/]$/.test(before) || /\b(the|a|an|or)\s+$/i.test(before))) made = null;
    if (made?.say && made.say.startsWith('/')) made = { cmd: cleanCmd(made.say) };
    if (best.rule.lead && /^\s/.test(m[0])) { start++; }
    if (!made) { push({ text: rest.slice(0, m.index + m[0].length) }); consumed += rest.slice(0, m.index + m[0].length); rest = rest.slice(m.index + m[0].length); continue; }
    const used = made.used ?? m[0].length - (start - m.index);
    delete made.used;
    if (start) push({ text: rest.slice(0, start) });
    push(made);
    consumed += rest.slice(0, start + used);
    rest = rest.slice(start + used);
  }
  return parts.filter((p) => p.text == null || p.text);
}

const clean = (s) => s.replace(/\s+/g, ' ').trim().replace(/^[''"]+|[''"]+$/g, '').trim();
const cleanCmd = (s) => { const c = clean(s).replace(/[.,;:!]+$/, ''); return c.replace(/^\/([A-Za-z]+)/, (m, v) => '/' + v.toLowerCase()); };

function looseCommand(m) {
  const verb = m[1].toLowerCase();
  if (NOT_COMMANDS.has(verb)) return null; // handled by the say rules; a bare "/say" with nothing usable stays text
  let words = m[2].trim() ? m[2].trim().split(/\s+/) : [];
  const keep = [];
  for (const w of words) { if (STOP.has(w.toLowerCase()) || !/^[A-Za-z]/.test(w)) break; keep.push(w.replace(/[.,;:!)]+$/, '')); if (/[.,;:!)]$/.test(w)) break; }
  const cmd = ['/' + verb, ...keep].join(' ');
  // Length of the original text that the command covers (up to the last kept word).
  let used = m[0].length;
  if (keep.length < words.length) {
    const lead = m[0].match(/^\s?/)[0].length;
    const re = new RegExp('^\\s?\\/' + m[1] + keep.map((w) => '\\s+' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''), 'i');
    used = (m[0].match(re) || [m[0]])[0].length - lead;
  } else used -= m[0].match(/^\s?/)[0].length;
  return { cmd, used };
}

// ---- Steps ----

const GIVE = /^(?:give|hand|turn\s+in|return|bring|deliver|show|trade)\b|\b(?:give|hand)\s+(?:the\s+|both\s+|all\s+|\d+\s*x?\s*)?\S.*\bto\b|\b(?:take|bring|return)\s+(?!a\s+(?:look|moment|breath)).{2,80}?\bto\s+[A-Z]|\bturn\s+.{2,80}?\binto\s+[A-Z]/i;
const SPEECH = /^(?:\[\[)?([^,"\]]{2,60}?)(?:\]\])?\s+(says|whispers|shouts|tells you|asks|yells|exclaims)\b[,:]?\s*(.*)$/i;
const SKIP_TEMPLATES = /^(needsinfo|hasquickguide|messagebox|#ev|quest|questquickguide|documentation|clear|toc|removedfromgame)$/i;

// One step from a line of instruction text.
function textStep(text, kind) {
  const parts = inlineParts(text);
  if (!kind) {
    kind = GIVE.test(text) ? 'give' : 'step';
    // A line that is only "You say ..." is a say step, not an instruction with a quote in it.
    if (parts.length === 1 && parts[0].say) kind = 'say';
    if (parts.length === 1 && parts[0].cmd) kind = 'cmd';
  }
  return { kind, parts };
}

function templateStep(t) {
  const name = t.name.toLowerCase();
  const arg = (i) => t.args[i] ?? '';
  if (SKIP_TEMPLATES.test(name)) return [];
  if (name === 'exp' || name === 'yougainexperience') return [{ kind: 'receive', parts: [{ text: 'You gain experience.' }] }];
  if (name === 'chat') {
    const who = plain(arg(0)).toLowerCase(), said = plain(arg(1));
    if (!said) return [];
    if (who === 'say') return [{ kind: 'say', parts: [{ say: clean(said) }] }];
    if (who === 'mud') return [{ kind: 'cmd', parts: [{ cmd: cleanCmd(said) }] }];
    return [{ kind: 'npc', parts: [{ text: `${plain(arg(0))}: ${said}` }] }];
  }
  if (name === 'emote') return [{ kind: 'emote', parts: [{ text: plain(arg(0)) }] }];
  if (name === 'receiveitem') return [{ kind: 'receive', parts: [{ text: plain(arg(0)) }] }];
  if (name === 'faction') return [{ kind: 'receive', parts: [{ text: `Faction: ${plain(arg(0))} ${plain(arg(1)) || ''}`.trim() }] }];
  if (name === 'money') return [{ kind: 'receive', parts: [{ text: money(t.args.map(plain)) }] }];
  if (name === 'questinfo') return linesToSteps(arg(0)).map((s) => (s.kind === 'step' ? { ...s, kind: 'note' } : s));
  if (name === 'questnote' || name === 'spoiler') return linesToSteps(arg(0));
  if (name === 'checklist') {
    const title = t.args.find((a) => /^\s*title\s*=/.test(a));
    const items = t.args.filter((a) => !/^\s*title\s*=/.test(a)).join('|');
    return [...(title ? [{ kind: 'heading', parts: [{ text: plain(title.replace(/^\s*title\s*=/, '')) }] }] : []), ...linesToSteps(items)];
  }
  // Anything else: keep its text if it has some.
  const text = plain(t.args.join(' '));
  return text ? [textStep(text)] : [];
}

// Wikitext -> steps. Templates are handled whole (they can span lines); everything else goes line by line.
function linesToSteps(wikitext) {
  let text = String(wikitext).replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, '\n');
  // Book and note text quoted in <pre>: one step, shown like dialogue.
  const quotes = [];
  text = text.replace(/<pre>([\s\S]*?)<\/pre>/gi, (m, body) => `\n\u0001${quotes.push(body.trim()) - 1}\n`);
  const found = templates(text), steps = [];
  let at = 0;
  const lines = (chunk) => {
    for (let raw of chunk.split('\n')) {
      const q = raw.match(/^\u0001(\d+)$/);
      if (q) { steps.push({ kind: 'quote', parts: [{ text: quotes[+q[1]] }] }); continue; }
      const h = raw.match(/^\s*(=+)\s*(.*?)\s*=+\s*$/);
      if (h) { if (h[1].length > 1) steps.push({ kind: 'heading', parts: [{ text: plain(h[2]) }] }); continue; }
      if (/^\s*(\{\||\|\}|\|-|!)/.test(raw)) continue; // table structure
      raw = raw.replace(/^\s*\|\s*/, ''); // table cell
      const orange = /color:\s*#ff7933/i.test(raw);
      const line = plain(raw.replace(/^[\s:;*#]+/, ''));
      if (!line || /^[-–—*.]+$/.test(line)) continue;
      if (orange) { steps.push({ kind: 'emote', parts: [{ text: line }] }); continue; }
      if (/^you (?:receive|have gained|gain|earned)\b|^your faction\b/i.test(line)) { steps.push({ kind: 'receive', parts: [{ text: line }] }); continue; }
      const speech = line.match(SPEECH);
      if (speech && !/^you\b/i.test(speech[1]) && /["“']/.test(speech[3])) { steps.push({ kind: 'npc', parts: [{ text: `${speech[1]}: ${speech[3].replace(/^["“']|["”']$/g, '')}` }] }); continue; }
      steps.push(textStep(line));
    }
  };
  for (const t of found) {
    lines(text.slice(at, t.start));
    // A template inside a sentence ("Give {{Money|..}} to X") stays part of that line.
    const before = text.slice(text.lastIndexOf('\n', t.start - 1) + 1, t.start), after = text.slice(t.end, (text.indexOf('\n', t.end) + 1 || text.length + 1) - 1);
    if (/money/i.test(t.name) && (before.trim() || after.trim())) { lines(plain(text.slice(t.start, t.end))); } else steps.push(...templateStep(t));
    at = t.end;
  }
  lines(text.slice(at));
  return steps;
}

// Drops runs of nothing useful: headings with no steps after them before the next heading.
function tidy(steps) {
  return steps.filter((s, i) => s.kind !== 'heading' || (steps[i + 1] && steps[i + 1].kind !== 'heading'));
}

// The part of the page with the walkthrough: from "== Walkthrough ==" (or the end of the {{Quest}} box) up to
// the sections that aren't steps (rewards, videos, notes, related quests).
const AFTER = /^==\s*(rewards?|video.*|related quests?|notes?|see also|references|gallery|trivia)\s*==\s*$/im;
const BEFORE_WALKTHROUGH = /^==\s*(rewards?|overview|summary)\s*==\s*$/i;
function walkthroughText(page) {
  const box = templates(page).find((t) => /^quest$/i.test(t.name));
  let body = box ? page.slice(box.end) : page;
  const w = body.match(/^==\s*walkthrough\s*==\s*$/im);
  if (w) body = body.slice(w.index + w[0].length);
  else {
    // No walkthrough heading: skip leading reward/overview sections.
    const sections = body.split(/(?=^==[^=].*==\s*$)/m);
    body = sections.filter((s) => !BEFORE_WALKTHROUGH.test(s.split('\n')[0].trim())).join('');
  }
  const end = body.match(AFTER);
  if (end) body = body.slice(0, end.index);
  return body.replace(/\[\[Category:[^\]]*\]\]/gi, '');
}

function infoBox(page) {
  const box = templates(page).find((t) => /^quest$/i.test(t.name));
  const fields = {};
  for (const a of box?.args || []) {
    const m = a.match(/^\s*([^=]+?)\s*=\s*([\s\S]*)$/);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  const list = (s) => plain(s).split(/\s*,\s*/).filter(Boolean);
  return {
    zone: plain(fields['start zone']),
    giver: plain(fields['quest giver']),
    level: plain(fields['minimum level']),
    classes: list(fields.classes || ''),
  };
}

function rewardsOf(page) {
  const m = page.match(/^==\s*rewards?\s*==\s*$([\s\S]*?)(?=^==[^=])/im);
  if (!m) return [];
  return [...m[1].matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((x) => plain(x[2] || x[1])).filter((x) => !/^(file|image|category):/i.test(x));
}

function parseQuest(title, page, quickGuide = null) {
  const info = infoBox(page);
  const steps = tidy(linesToSteps(walkthroughText(page)));
  let quick = null;
  if (quickGuide) {
    const body = quickGuide.replace(/\{\{\s*QuestQuickGuide[^}]*\}\}/i, '');
    quick = tidy(linesToSteps(body));
    if (!quick.length) quick = null;
  }
  return { title, ...info, rewards: rewardsOf(page), steps, quick };
}

// ---- Fetching ----

async function listPages() {
  const titles = [];
  let cont = {};
  do {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: CATEGORY, cmlimit: 'max', cmtype: 'page', cmnamespace: '0', ...cont });
    for (const member of j.query?.categorymembers || []) titles.push(member.title);
    cont = j.continue ? { cmcontinue: j.continue.cmcontinue } : null;
    await sleep(200);
  } while (cont);
  return titles;
}

async function fetchTexts(titles, onBatch = () => {}) {
  const texts = {};
  for (let i = 0; i < titles.length; i += BATCH) {
    onBatch(Math.min(i + BATCH, titles.length), titles.length);
    const j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.slice(i, i + BATCH).join('|') });
    for (const page of j.query?.pages || []) if (page.revisions) texts[page.title] = page.revisions[0].slots.main.content;
    await sleep(300);
  }
  return texts;
}

async function updateQuests({ onProgress = () => {} } = {}) {
  onProgress({ step: 'Listing quests…' });
  const titles = await listPages();
  const pages = await fetchTexts(titles, (done, total) => onProgress({ step: 'Reading quest pages…', done, total }));
  const withGuide = titles.filter((t) => /\{\{\s*HasQuickGuide/i.test(pages[t] || ''));
  onProgress({ step: 'Reading quick guides…' });
  const guides = await fetchTexts(withGuide.map((t) => t + '/Quick Guide'));
  const quests = [];
  for (const title of titles) {
    if (!pages[title]) continue;
    const quest = parseQuest(title, pages[title], guides[title + '/Quick Guide'] || null);
    if (quest.steps.length || quest.quick) quests.push(quest);
  }
  quests.sort((a, b) => a.title.localeCompare(b.title));
  return { generatedAt: new Date().toISOString(), source: API.replace('/w/api.php', ''), quests };
}

const pageUrl = (title) => API.replace('/w/api.php', '/wiki/') + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/');

module.exports = { updateQuests, parseQuest, linesToSteps, inlineParts, templates, plain, pageUrl };
