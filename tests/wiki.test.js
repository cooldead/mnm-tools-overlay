const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSeconds, parseSpell, fileKey, pickIcon, parseClassPage, applyClassPages } = require('../wiki');

test('wiki times become seconds, and unknowns stay unknown', () => {
  assert.equal(parseSeconds('6 seconds'), 6);
  assert.equal(parseSeconds('12.0 Seconds'), 12);
  assert.equal(parseSeconds('8 sec'), 8);
  assert.equal(parseSeconds('5 minutes'), 300);
  assert.equal(parseSeconds('1 min 30 sec'), 90);
  assert.equal(parseSeconds('1 hour'), 3600);
  assert.equal(parseSeconds('6 seconds (3 with Quickening)'), 6);
  assert.equal(parseSeconds('Instant'), 0);
  assert.equal(parseSeconds('0'), 0);
  for (const unknown of ['', '??', 'None', 'Unknown', 'Permanent', '5 (L1) to 20 (L60) minutes']) assert.equal(parseSeconds(unknown), null, unknown);
  assert.equal(parseSeconds('30'), null, 'a bare number is ambiguous unless the unit is known');
  assert.equal(parseSeconds('10', { bare: 's' }), 10);
});

test('a spell page template is read into a spell', () => {
  const page = `{{Spellpagesmart
| spellname = Abolish Magic
| spellicon = Spellicon003A
| description = ''Removes'' magic from [[Target|your target]].
| classes = *[[Cleric]] - Level 40
* [[Enchanter]] - Level 16
| casting_time = 1.5 seconds
| recast_time =
| duration = 30 minutes
| triggers_gcd = Yes
| spell_type = Single Target
}}`;
  assert.deepEqual(parseSpell(page), {
    name: 'Abolish Magic', classes: { Cleric: 40, Enchanter: 16 }, description: 'Removes magic from your target.',
    type: 'Single Target', cast: 1.5, recast: null, recastText: '', duration: 1800, durationText: '30 minutes', gcd: true,
  });
  assert.equal(parseSpell('no template here'), null);
});

test('the page icon is the image named in spellicon, ignoring placeholder images', () => {
  assert.equal(fileKey('File:Blast_of_water.png'), 'blast of water');
  const text = '| spellicon = blast_of_water\n';
  assert.equal(pickIcon(text, ['File:Itemicon0001AA.png', 'File:Blast of water.png']), 'File:Blast of water.png');
  assert.equal(pickIcon('| spellicon =\n', ['File:.png', 'File:Itemicon0001AA.png']), null, 'blank spellicon has no icon');
  assert.equal(pickIcon('| spellicon = Other\n', ['File:Only.png']), 'File:Only.png', 'a single image is the icon');
});

const CLASS_PAGE = `= Description =
| Race || Str
==Level 1==
= Rogue Abilities =

==Level 1==
<table><tr><td>Spell Name</td></tr>{{SpellRow
|name=Stab I
|description=Aggressively ''stab'' your target. <small>(Requires dagger)</small>
|school=[[Skill Might|Mit]]
|casttime=Instant
}}
{{SpellRow
|name=Sneak
|description=Begin to sneak.
}}
</table>

== Level 4 ==
{| class="wikitable"
! Spell Name !! Spell Description !! Class
|-
| Predatory Instinct || Awaken the hunter's instinct. (Formerly Pack of the Predator.) || [[Skill Alteration|Alt]]
|-
| [[Kick]] (Rank 2) || Kick your target. || Acr
|}
={{SpellRow
|name=Mana Ward
|description=A typo'd heading line is still a row.
}}

==Level 6==
{{SpellRow
|name=Sneak
|description=Listed again later.
}}
= Skills =
==Level 8==
{{SpellRow
|name=Not An Ability
}}`;

test('a class page lists its abilities by level, in both page layouts', () => {
  assert.deepEqual(parseClassPage(CLASS_PAGE), [
    { name: 'Stab I', level: 1, description: 'Aggressively stab your target. (Requires dagger)', cast: 0 },
    { name: 'Sneak', level: 1, description: 'Begin to sneak.', cast: null },
    { name: 'Mana Ward', level: 4, description: "A typo'd heading line is still a row.", cast: null },
    { name: 'Predatory Instinct', level: 4, description: "Awaken the hunter's instinct. (Formerly Pack of the Predator.)", cast: null },
    { name: 'Kick', level: 4, description: 'Kick your target.', cast: null },
  ]);
  assert.deepEqual(parseClassPage('no abilities section'), []);
});

test('class pages decide which abilities a class has; spell pages still give icons and recasts', () => {
  const spell = (page, classes, extra = {}) => ({ name: page, page, classes, description: 'old', cast: null, recast: null, icon: '', ...extra });
  const spells = [
    spell('Enraging Strike', { Beastmaster: 3 }, { icon: 'enrage.png', iconFile: 'enrage', recast: 12 }),
    spell('Haste', { Beastmaster: 16, Enchanter: 20 }),
    spell('Kick', { Rogue: 4, Beastmaster: 4 }),
    spell('Beast Speech', { Halfling: 1, Beastmaster: 30 }),
    spell('Wizard Thing', { Wizard: 5 }),
  ];
  const list = (n, extra) => [...extra, ...Array.from({ length: n }, (_, i) => ({ name: 'Filler ' + i, level: 60, description: '', cast: null }))];
  const used = applyClassPages(spells, {
    Beastmaster: list(10, [
      { name: 'Enraging Strike I', level: 1, description: 'new text', cast: 0 },
      { name: 'Enraging Strike II', level: 10, description: 'rank 2', cast: 0 },
      { name: 'kick', level: 3, description: '', cast: null },
    ]),
    Wizard: [{ name: 'Wizard Thing', level: 9, description: '', cast: null }], // too short to trust
  });
  assert.deepEqual(used, { Beastmaster: 13 });
  const by = Object.fromEntries(spells.map((s) => [s.name, s]));
  assert.deepEqual(by['Enraging Strike'].classes, { Beastmaster: 1 }, 'rank I matches the page without a numeral');
  assert.equal(by['Enraging Strike'].description, 'old', 'a spell page keeps its own description');
  assert.equal(by['Enraging Strike'].recast, 12);
  assert.deepEqual(by.Haste.classes, { Enchanter: 20 }, 'a class the class page no longer lists is dropped');
  assert.deepEqual(by.Kick.classes, { Rogue: 4, Beastmaster: 3 });
  assert.deepEqual(by['Beast Speech'].classes, { Halfling: 1 }, 'races keep what spell pages say');
  assert.deepEqual(by['Wizard Thing'].classes, { Wizard: 5 }, 'an unreadable class page leaves spell pages alone');
  const rank2 = by['Enraging Strike II'];
  assert.deepEqual([rank2.classPageOnly, rank2.page, rank2.classes, rank2.description, rank2.cast, rank2.recast, rank2.icon],
    [true, 'Enraging Strike II', { Beastmaster: 10 }, 'rank 2', 0, null, 'enrage.png'], 'a new rank borrows its line icon, never a recast');
  assert.equal(by['Filler 0'].icon, '');
});
