const test = require('node:test');
const assert = require('node:assert/strict');
const { planImport, abilityFromSpell, upgradeAbility } = require('../core');

const spell = (page, classes, extra = {}) => ({ name: page, page, classes, recast: 0, icon: page + '.png', ...extra });
const spells = [
  spell('Barbed Arrow I', { Archer: 2 }, { recast: 6 }),
  spell('Barbed Arrow II', { Archer: 12 }, { recast: 6 }),
  spell('Barbed Arrow III', { Archer: 22 }, { recast: 6 }),
  spell('Volley', { Archer: 5 }),
  spell('Anticipate', { Archer: 30 }, { recast: 900 }),
  spell('Heal', { Cleric: 1 }, { recast: 0 }),
  spell('Stout', { Dwarf: 1 }, { recast: 300 }),
  { name: 'Ancestral Wisdom', page: 'Ancestral Wisdom II', classes: { Archer: 10 }, recast: 0 },
];

test('only the best rank of each line up to your level is offered, recast spells recommended', () => {
  const plan = planImport(spells, [], { cls: 'Archer', level: 15 });
  assert.deepEqual(plan.add.map((a) => [a.spell.page, a.level, a.recommended]), [
    ['Volley', 5, false], ['Ancestral Wisdom II', 10, false], ['Barbed Arrow II', 12, true],
  ]);
  assert.deepEqual(plan.upgrades, []);
  assert.equal(plan.have, 0);
});

test('racial abilities come with the race', () => {
  const plan = planImport(spells, [], { cls: 'Archer', race: 'Dwarf', level: 1 });
  assert.deepEqual(plan.add.map((a) => a.spell.page), ['Stout']);
});

test('abilities you have are skipped, and a better rank after levelling up is an upgrade', () => {
  const mine = abilityFromSpell(spells[0], 'x');
  mine.key = { code: 10 };
  const atTwo = planImport(spells, [mine], { cls: 'Archer', level: 4 });
  assert.equal(atTwo.have, 1);
  assert.equal(atTwo.add.length, 0);
  const atThirty = planImport(spells, [mine], { cls: 'Archer', level: 30 });
  assert.deepEqual(atThirty.upgrades.map((u) => [u.ability.id, u.spell.page]), [['x', 'Barbed Arrow III']]);
  assert.ok(atThirty.add.some((a) => a.spell.page === 'Anticipate'));
});

test('imported abilities use the rank in their name; upgrades keep the key and a typed cooldown', () => {
  assert.deepEqual(abilityFromSpell(spells[7], 'w'), { id: 'w', name: 'Ancestral Wisdom II', icon: '', key: null, seconds: 0, wiki: 'Ancestral Wisdom II' });
  const typed = { id: 'w', name: 'Ancestral Wisdom II', key: { code: 5 }, seconds: 12, icon: 'a.png', wiki: 'Ancestral Wisdom II' };
  const up = upgradeAbility(typed, { name: 'Ancestral Wisdom', page: 'Ancestral Wisdom III', recast: 0, icon: 'b.png' });
  assert.deepEqual(up, { id: 'w', name: 'Ancestral Wisdom III', key: { code: 5 }, seconds: 12, icon: 'b.png', wiki: 'Ancestral Wisdom III' });
});

test('game icons replace wiki icons by name, but not pictures you chose', () => {
  const { withGameIcons } = require('../core');
  const icons = [{ name: 'Uppercut', file: '/data/custom-icons/icons/custom/uppercut.png' }, { name: 'Ancestral Wisdom II', file: '/g/aw.png' }];
  const abilities = [
    { id: 'a', name: 'Uppercut', icon: 'wiki/spellicon032a.png' },
    { id: 'b', name: 'uppercut ', icon: '/home/me/grabbed.png' },
    { id: 'c', name: 'Kick', icon: 'wiki/kick.png' },
  ];
  const out = withGameIcons(abilities, icons);
  assert.equal(out[0].icon, '/data/custom-icons/icons/custom/uppercut.png');
  assert.equal(out[1].icon, '/home/me/grabbed.png');
  assert.equal(out[2], abilities[2]);
  assert.equal(withGameIcons(out, icons), out, 'nothing left to change');
  assert.equal(withGameIcons(spells, icons)[7].icon, '/g/aw.png', 'matched by the rank page name');
});
