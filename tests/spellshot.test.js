const test = require('node:test');
const assert = require('node:assert/strict');
const shot = require('../spellshot');
// Text Tesseract read from real spell window screenshots: each spell's top and scrolled-down halves.
const [sneakTop, sneakBottom, bondTop, bondBottom, guardTop, guardBottom] = require('./fixtures/spell-windows.json');

test('two screenshots of one spell window join where they overlap, in either order', () => {
  for (const parts of [[bondTop.lines, bondBottom.lines], [bondBottom.lines, bondTop.lines]]) {
    const { lines, gaps } = shot.joinParts(parts);
    assert.equal(gaps, 0);
    assert.deepEqual(lines.map((l) => l.text), [
      'Appeal to the senses of a target beast, bonding it to your side.', 'Alteration Ability', 'Innate', 'Mana Cost: 25',
      'Cast Time: Instant', 'Cooldown: 10.0 seconds', 'Triggers Spell Global Cooldown', 'Range: 5 meters', 'Requires Line of Sight',
      'Required Level: 1', 'Cannot Fizzle', 'Can Cast While Moving', 'Resist Element: Magic', 'AQOE Type: Single Target']);
  }
  const sneak = shot.joinParts([sneakTop.lines, sneakBottom.lines]).lines.map((l) => l.text);
  assert.ok(sneak.includes('Can Cast While Moving') && !sneak.some((t) => /Cact/.test(t)), 'a line cut by the edge loses to the clean reading');
  assert.ok(sneak.includes('Subterfuge Ability') && !sneak.includes('Subtertuge Ability'));
  const apart = shot.joinParts([[{ text: 'Description.', conf: 90 }], [{ text: 'Range: 5 meters', conf: 90 }]]);
  assert.equal(apart.gaps, 1, 'screenshots with nothing in common are joined, and the gap is reported');
});

test('a spell window is read into wiki fields', () => {
  const spell = shot.readSpell(shot.joinParts([sneakTop.lines, sneakBottom.lines]).lines);
  assert.equal(spell.description, 'Walk silently, rendering you undetectable to targets while behind them.');
  assert.deepEqual([spell.skill, spell.kind, spell.values['Required Level']], ['Subterfuge', 'Ability', undefined]);
  assert.deepEqual(shot.spellFields(spell), {
    description: "''Walk silently, rendering you undetectable to targets while behind them.''",
    skill: '[[Skill Subterfuge|Subterfuge]]', mana: 'Innate', casting_time: 'Instant', recast_time: '10 seconds',
    triggers_gcd: 'No', resist: 'None', fizzle_time: 'Cannot fizzle', target_type: 'Single', other: 'Can Cast While Moving',
  });
  const guard = shot.readSpell(shot.joinParts([guardTop.lines, guardBottom.lines]).lines);
  assert.equal(guard.values['Required Level'], '4');
  assert.equal(shot.spellFields(guard).mana, '10', 'a mana cost wins over "Innate"');
  assert.equal(shot.spellFields(guard).recast_time, undefined, 'no cooldown line, no recast');
  const odd = shot.readSpell([{ text: 'Desc.', conf: 90 }, { text: 'Evocation Spell', conf: 90 }, { text: 'Something New: 3', conf: 90 }]);
  assert.deepEqual([odd.kind, odd.unknown], ['Spell', ['Something New: 3']], 'unknown lines are kept, not dropped');
});

test('the title bar becomes the wiki name', () => {
  assert.equal(shot.spellName('BESTIAL BOND', ['Bestial Bond', 'Sneak']), 'Bestial Bond');
  assert.equal(shot.spellName('CALL OF THE FAITHFUL IV'), 'Call of the Faithful IV');
  assert.equal(shot.spellName('ENRAGING STRIKE', ['Enraging Strike I', 'Enraging Strike V']), 'Enraging Strike', 'a spell line is not snapped to one rank');
  assert.equal(shot.spellName('fevive Companion', ['Revive Companion', 'Revive Companion II']), 'Revive Companion');
  assert.equal(shot.tidyTime('10.0 seconds'), '10 seconds');
  assert.equal(shot.tidyTime('1 seconds'), '1 second');
});

const SNEAK_PAGE = `{{Spellpagesmart|

| spellname = Sneak
| description = ''Walk silently, rendering you undetectable to targets while behind them.''
| classes = 
* [[Rogue]] - Level 1

| skill = [[Skill Subterfuge|Subterfuge]]

| mana = Innate
| range = 
| casting_time = Instant
| recast_time = 
| target_type = Self
| resist = Unresistable
| triggers_gcd = Yes
| other = 

}}

[[Category:Rogue Abilities]]`;

test('the game is compared with the wiki page, and only changed fields are edited', () => {
  const spell = shot.readSpell(shot.joinParts([sneakTop.lines, sneakBottom.lines]).lines);
  const rows = Object.fromEntries(shot.compareFields(shot.spellFields(spell), SNEAK_PAGE).map((r) => [r.field, r]));
  assert.equal(rows.description.same, true);
  assert.equal(rows.casting_time.same, true);
  assert.deepEqual([rows.recast_time.wiki, rows.recast_time.apply], ['', true]);
  assert.deepEqual([rows.triggers_gcd.wiki, rows.triggers_gcd.game, rows.triggers_gcd.apply], ['Yes', 'No', true]);
  assert.deepEqual([rows.target_type.soft, rows.target_type.apply], [true, false], 'a soft field never overwrites the wiki');
  assert.equal(rows.resist.same, true, "the game's resist None is the wiki's Unresistable");
  assert.equal(rows.other.apply, true, 'a soft field fills a blank');
  assert.equal(rows.fizzle_time.apply, true, 'a field the template lacks can be added');

  const edited = shot.setFields(SNEAK_PAGE, { recast_time: '10 seconds', triggers_gcd: 'No', fizzle_time: 'Cannot fizzle' });
  assert.match(edited, /\| recast_time = 10 seconds\n/);
  assert.match(edited, /\| triggers_gcd = No\n/);
  assert.match(edited, /\| fizzle_time = Cannot fizzle\n\}\}/);
  assert.equal(edited.replace(/\| recast_time = 10 seconds/, '| recast_time = ').replace('| triggers_gcd = No', '| triggers_gcd = Yes')
    .replace('\n| fizzle_time = Cannot fizzle', ''), SNEAK_PAGE, 'nothing else on the page changes');
  assert.match(shot.setFields(SNEAK_PAGE, { classes: '\n* [[Rogue]] - Level 2' }), /\| classes = \n\* \[\[Rogue\]\] - Level 2\n\n\| skill/);
  assert.throws(() => shot.setFields('no template', { mana: '1' }));
});

test('a new spell page is laid out like the wiki and categorised', () => {
  const page = shot.newSpellPage({ name: 'Guardian Spirit', icon: 'Spellicon015D', kind: 'Ability', skill: 'Alteration',
    fields: { mana: '10', casting_time: '2 seconds' }, classes: { Beastmaster: 4 }, classCategory: { Beastmaster: 'Beastmaster Spells & Abilities' } });
  assert.match(page, /^\{\{Spellpagesmart\|\n\n\| spellname = Guardian Spirit\n\| spellicon = Spellicon015D\n/);
  assert.match(page, /\| classes = ?\n\* \[\[Beastmaster\]\] - Level 4\n/);
  assert.match(page, /\| mana = 10\n/);
  assert.match(page, /\[\[Category:All Abilities\]\]\n\[\[Category:Alteration Abilities\]\]\n\[\[Category:Beastmaster Spells & Abilities\]\]/);
  assert.deepEqual(shot.pageFields(page).casting_time, '2 seconds', 'the new page reads back');
});

const ROGUE = `=Rogue Abilities=

==Level 1==
<table cellpadding='5'>
<tr><td>Spell Name</td></tr>{{SpellRow
|name=Sneak
|description=Begin to sneak.
|school=[[Skill Subterfuge|Sub]]
|location=Autogranted
|mana=Innate
}}

</table>

==Level 4==
<table cellpadding='5'>
<tr><td>Spell Name</td></tr>{{SpellRow
|name=Kick
|description=Kick.
|school=[[Skill Acrobatics|Acr]]
|location=Vendor
|mana=Innate
}}

</table>

= Skills =
`;
const BEAST = `= Beastmaster Spells & Abilities =

== Level 1 ==
{| class="wikitable sortable" style="width:100%;"
! Spell Name !! Spell Description !! Class !! Location !! Mana
|-
| Bestial Bond || Bond a beast. || [[Skill Conjuration|Con]] || Vendor || Innate
|}

== Level 8 ==
{| class="wikitable sortable" style="width:100%;"
! Spell Name !! Spell Description !! Class !! Location !! Mana
|-
| Patch Companion || Patch. || [[Skill Alteration|Alt]] || Vendor || 20
|}

= Skills =
`;

test('class pages get a row in their own layout, in the right level', () => {
  assert.equal(shot.classCategory(ROGUE), 'Rogue Abilities');
  assert.equal(shot.classCategory(BEAST), 'Beastmaster Spells & Abilities');
  assert.deepEqual(shot.classStatus(ROGUE, 'Kick'), { listed: 4 });
  assert.deepEqual(shot.classStatus(ROGUE, 'Stab'), { listed: null });

  const row = shot.classRow(ROGUE, { name: 'Hide', description: 'Hide.', skill: 'Subterfuge', mana: 'Innate' });
  assert.equal(row, '{{SpellRow\n|name=Hide\n|description=Hide.\n|school=[[Skill Subterfuge|Sub]]\n|location=??\n|mana=Innate\n}}');
  const same = shot.addClassRow(ROGUE, 1, row);
  assert.deepEqual(shot.classStatus(same, 'Hide'), { listed: 1 });
  assert.ok(same.indexOf('|name=Hide') < same.indexOf('==Level 4=='));
  const newLevel = shot.addClassRow(ROGUE, 2, row);
  assert.deepEqual(shot.classStatus(newLevel, 'Hide'), { listed: 2 });
  assert.ok(newLevel.indexOf('==Level 2==') > newLevel.indexOf('==Level 1==') && newLevel.indexOf('==Level 2==') < newLevel.indexOf('==Level 4=='));
  assert.match(newLevel, /==Level 2==\n<table cellpadding='5'>\n<tr><td>Spell Name<\/td><\/tr>\{\{SpellRow\n\|name=Hide/);
  const last = shot.addClassRow(ROGUE, 9, row);
  assert.ok(last.indexOf('==Level 9==') > last.indexOf('==Level 4==') && last.indexOf('==Level 9==') < last.indexOf('= Skills ='));

  const tableRow = shot.classRow(BEAST, { name: 'Guardian Spirit', description: 'Guard.', skill: 'Alteration', mana: '10' });
  assert.equal(tableRow, '|-\n| Guardian Spirit || Guard. || [[Skill Alteration|Alt]] || ?? || 10');
  assert.deepEqual(shot.classStatus(shot.addClassRow(BEAST, 8, tableRow), 'Guardian Spirit'), { listed: 8 });
  const beastNew = shot.addClassRow(BEAST, 4, tableRow);
  assert.deepEqual(shot.classStatus(beastNew, 'Guardian Spirit'), { listed: 4 });
  assert.match(beastNew, /==Level 4==\n\{\| class="wikitable sortable" style="width:100%;"\n! Spell Name !! Spell Description !! Class !! Location !! Mana\n\|-\n\| Guardian Spirit/);
});

test("a class is added to an existing page's classes list, or its level corrected", () => {
  assert.equal(shot.withClass(SNEAK_PAGE, 'Rogue', 1), null, 'already listed at that level');
  const moved = shot.withClass(SNEAK_PAGE, 'Rogue', 3);
  assert.deepEqual(moved, { wiki: '* [[Rogue]] - Level 1', game: '\n* [[Rogue]] - Level 3\n' });
  const added = shot.withClass(SNEAK_PAGE, 'Shadow Knight', 12);
  assert.equal(added.game, '\n* [[Rogue]] - Level 1\n* [[Shadow Knight]] - Level 12\n');
  const page = shot.setFields(SNEAK_PAGE, { classes: added.game.replace(/\n$/, '') });
  assert.equal(shot.withClass(page, 'Shadow Knight', 12), null);
  assert.equal(shot.withClass(page, 'Rogue', 1), null);
});

test('a misread title is matched to the existing page by its description, never made into a second page', () => {
  const spells = [
    { name: 'Bestial Bond', page: 'Bestial Bond', description: 'Appeal to the senses of a target beast, bonding it to your side.' },
    { name: 'Beast Speech', page: 'Beast Speech', description: 'Speak with beasts.' },
    { name: 'Pounce', page: 'Pounce', description: 'Appeal to the senses of a target beast, bonding it to your side.', classPageOnly: true },
  ];
  const description = 'Appeal to the senses of a target beast, bonding it to your side.';
  assert.deepEqual(shot.likelyPage('Bestiat Rond', description, spells), { page: 'Bestial Bond', suggestions: [] });
  assert.deepEqual(shot.likelyPage('Bestial Bond', description, spells), { page: null, suggestions: [] }, 'the right name is left alone');
  assert.deepEqual(shot.likelyPage('Bestial Bonds', 'Something new.', spells).suggestions, ['Bestial Bond'], 'a close name is only suggested');
  assert.equal(shot.likelyPage('Pounce II', description, [spells[2]]).page, null, 'abilities with no wiki page are not targets');
});

test('a new page has a placeholder icon and a Where to Obtain section, like the wiki’s pages', () => {
  const page = shot.newSpellPage({ name: 'X', fields: { notes: 'Tames beasts.', spell_type: 'Beneficial' } });
  assert.match(page, /\| spellicon = Itemicon0000AA\n/);
  assert.match(page, /\| notes = Tames beasts\.\n/);
  assert.match(page, /\| spell_type = Beneficial\n/);
  assert.match(page, /= Where to Obtain =\n\{\| class="wikitable sortable"/);
});
