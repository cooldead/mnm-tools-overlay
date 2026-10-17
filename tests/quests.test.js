const test = require('node:test');
const assert = require('node:assert/strict');
const { inlineParts, linesToSteps, parseQuest } = require('../quests');

const show = (parts) => parts.map((p) => (p.say != null ? `[say:${p.say}]` : p.cmd != null ? `[cmd:${p.cmd}]` : p.text)).join('');

test('things to say are found however the wiki writes them', () => {
  assert.equal(show(inlineParts('You say, "What things?"')), '[say:What things?]');
  assert.equal(show(inlineParts("You say, 'I do.'")), '[say:I do.]');
  assert.equal(show(inlineParts('/say "Your brother?" to Guard Pippi Pinecone.')), '[say:Your brother?] to Guard Pippi Pinecone.');
  assert.equal(show(inlineParts('Target Eraeldor Lowmist and /say direction')), 'Target Eraeldor Lowmist and [say:direction]');
  assert.equal(show(inlineParts('Essays are fun')), 'Essays are fun');
});

test('commands keep their object but not the rest of the sentence', () => {
  assert.equal(show(inlineParts('/Look at the base of the tower for the message,')), '[cmd:/look] at the base of the tower for the message,');
  assert.equal(show(inlineParts('While holding the grappling hook "/throw wall"')), 'While holding the grappling hook [cmd:/throw wall]');
  assert.equal(show(inlineParts('/Rub shirt/robe')), '[cmd:/rub shirt]/robe');
  assert.equal(show(inlineParts('You say, "/take book"')), '[cmd:/take book]');
  assert.equal(show(inlineParts('and /pour it on the /orc.')), 'and [cmd:/pour] it on the /orc.');
  assert.equal(show(inlineParts('There may be undiscovered /mud command responses')), 'There may be undiscovered /mud command responses');
});

test('templates and old-style lines become the right kinds of step', () => {
  const steps = linesToSteps([
    "'''Give Torn Note to [[Sinastin Aspenleaf]].'''",
    '{{exp}}',
    ': Sinastin Aspenleaf says, "Ah yes... welcome."',
    ':<span style="font-weight:bold;color:#ff7933;">Sinastin Aspenleaf examines the note.</span>',
    "''<span>You receive [[Sinastin's List of Names]].</span>''",
    '{{Chat|say|What task?}}',
    '{{Chat|Tig Pebblebank|Hello there.}}',
    '{{Chat|mud|/take Rope}}',
    '{{QuestNote|Hand these items to [[Hult Beetlewrangler]].}}',
    '{{QuestInfo|Note that you skill up in [[Stone Cutting]].}}',
    "Pick up the key and type ''/insert key''<br>Type ''/inspect paper''",
  ].join('\n'));
  assert.deepEqual(steps.map((s) => `${s.kind} ${show(s.parts)}`), [
    'give Give Torn Note to Sinastin Aspenleaf.',
    'receive You gain experience.',
    'npc Sinastin Aspenleaf: Ah yes... welcome.',
    'emote Sinastin Aspenleaf examines the note.',
    "receive You receive Sinastin's List of Names.",
    'say [say:What task?]',
    'npc Tig Pebblebank: Hello there.',
    'cmd [cmd:/take Rope]',
    'give Hand these items to Hult Beetlewrangler.',
    'note Note that you skill up in Stone Cutting.',
    'step Pick up the key and type [cmd:/insert key]',
    'step Type [cmd:/inspect paper]',
  ]);
});

test('a quest page gives its start zone and only the walkthrough steps', () => {
  const page = `{{Quest
|Start Zone = [[Night Harbor]]
|Quest Giver = [[Sinastin Aspenleaf]]
|Minimum Level = 1
|Classes = [[Rogue]]
}}
== Reward ==
* [[Irfan's Dagger]]
== Walkthrough ==
'''Give Torn Note to [[Sinastin Aspenleaf]].'''
== Video Overview ==
{{#ev:youtube|https://youtu.be/x}}
[[Category:Quests]]`;
  const q = parseQuest('Rogue Starter Quest (Night Harbor)', page);
  assert.equal(q.zone, 'Night Harbor');
  assert.equal(q.giver, 'Sinastin Aspenleaf');
  assert.deepEqual(q.classes, ['Rogue']);
  assert.deepEqual(q.rewards, ["Irfan's Dagger"]);
  assert.deepEqual(q.steps.map((s) => show(s.parts)), ['Give Torn Note to Sinastin Aspenleaf.']);
});
