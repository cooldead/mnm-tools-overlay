const test = require('node:test');
const assert = require('node:assert/strict');
const { withProfiles, storeProfile, switchProfile, renameProfile, deleteProfile, profileForLogin, LoginWatcher } = require('../core');

const old = { abilities: [{ id: 'a' }], followUps: [{ id: 'f' }], counters: [], character: { cls: 'Ranger', race: '', level: 12 }, spellClass: 'Ranger', layout: 'vertical' };

test('settings from before profiles become the Default profile', () => {
  const s = withProfiles(old);
  assert.equal(s.profile, 'Default');
  assert.deepEqual(s.profiles.Default.abilities, [{ id: 'a' }]);
  assert.equal(s.profiles.Default.layout, undefined, 'layout stays shared');
  assert.deepEqual(withProfiles({ ...old, counters: undefined }).profiles.Default.counters, [], 'missing lists start empty');
});

test('switching keeps each profile\'s abilities, and shared settings stay put', () => {
  let s = withProfiles(old);
  s = switchProfile(s, 'Tilda');
  assert.deepEqual([s.profile, s.abilities, s.character.cls, s.layout], ['Tilda', [], '', 'vertical']);
  s = { ...s, abilities: [{ id: 'x' }] };
  s = switchProfile(s, 'Default');
  assert.deepEqual(s.abilities, [{ id: 'a' }]);
  assert.deepEqual(s.profiles.Tilda.abilities, [{ id: 'x' }], 'unsaved edits were stored before switching');
  s = switchProfile(s, 'Copy', { copyFrom: 'Default' });
  s.abilities.push({ id: 'new' });
  assert.equal(storeProfile(s).profiles.Default.abilities.length, 1, 'a copy is independent');
});

test('rename and delete', () => {
  let s = switchProfile(withProfiles(old), 'Tilda');
  assert.equal(renameProfile(s, 'Tilda', 'Default').profile, 'Tilda', 'cannot rename onto another profile');
  s = renameProfile(s, 'Tilda', 'Quorra');
  assert.deepEqual([s.profile, Object.keys(s.profiles)], ['Quorra', ['Default', 'Quorra']]);
  s = deleteProfile(s, 'Quorra');
  assert.deepEqual([s.profile, s.abilities, Object.keys(s.profiles)], ['Default', [{ id: 'a' }], ['Default']]);
  assert.deepEqual(Object.keys(deleteProfile(s, 'Default').profiles), ['Default'], 'the last profile stays');
});

test('a login switches, takes over the unnamed Default, or makes a new profile', () => {
  const s = withProfiles(old);
  assert.deepEqual(profileForLogin(s, 'Brannoc'), { action: 'rename', from: 'Default', name: 'Brannoc' });
  const named = renameProfile(s, 'Default', 'Brannoc');
  assert.equal(profileForLogin(named, 'Brannoc'), null, 'already on it');
  assert.deepEqual(profileForLogin(named, 'Tilda'), { action: 'create', name: 'Tilda' });
  assert.deepEqual(profileForLogin(switchProfile(named, 'Tilda'), 'Brannoc'), { action: 'switch', name: 'Brannoc' });
});

test('the game log marks loading screens from zoning start until the loading panel hides', () => {
  const { LoadingWatcher } = require('../core');
  const w = new LoadingWatcher();
  const seen = [
    'party updated',
    'Received Preparing Zone\r',
    'Received EnterZone',
    '[Client][ZONE] Start zoning process to nightharborw',
    '[Client][ZONE] Done loading zone',
    '[LEDGER MIGRATION] Migration complete for Brannoc',
    '[Client][ZONE] Done waiting, hide LoadingPanel',
    '[Client][ZONE] Done loading',
    '[Client][ZONE] Start zoning process to wyrmsbanetomb',
    '[Net] Disconnected from server',
    '[Client][ZONE] Start zoning process to shadeddunes',
    'Received CharactersList',
  ].map((line) => w.line(line));
  assert.deepEqual(seen, [false, true, true, true, true, true, false, false, true, false, true, false]);
});

test('the game log reports a login once, not on every zone change', () => {
  const w = new LoginWatcher();
  const seen = [
    'client Brannoc 10001 received pet ids .',
    '[Client][ZONE] Start zoning process to nightharborw',
    '[LEDGER MIGRATION] Migration complete for Brannoc',
    '[LEDGER MIGRATION] Migration complete for Brannoc',
    'Received CharactersList',
    '[LEDGER MIGRATION] Migration complete for Brannoc',
    '[LEDGER MIGRATION] Migration complete for Tilda',
  ].map((line) => w.line(line));
  assert.deepEqual(seen, ['Brannoc', null, null, null, null, 'Brannoc', 'Tilda']);
});
