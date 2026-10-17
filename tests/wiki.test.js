const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSeconds, parseSpell, fileKey, pickIcon } = require('../wiki');

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
