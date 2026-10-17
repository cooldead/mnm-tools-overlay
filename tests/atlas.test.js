const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadingWatcher, atlasMapForZone, atlasUrl, atlasView, isAtlasUrl } = require('../core');

const IDS = ['world', 'night-harbor', 'underdocks', 'ail-vorith', 'evershade-weald', 'sungreet-strand', 'shaded-dunes', 'wyrmsbane-tomb', 'keepers-bight'];

test('the loading watcher remembers the zone being loaded', () => {
  const w = new LoadingWatcher();
  assert.equal(w.zone, null);
  w.line('[Client][ZONE] Start zoning process to keepersbight\r');
  assert.equal(w.zone, 'keepersbight');
  w.line('[Client][ZONE] Done waiting, hide LoadingPanel');
  assert.equal(w.zone, 'keepersbight', 'kept after the loading screen ends');
});

test('game zone names find their atlas map', () => {
  assert.equal(atlasMapForZone('keepersbight', IDS), 'keepers-bight');
  assert.equal(atlasMapForZone('shadeddunes', IDS), 'shaded-dunes');
  assert.equal(atlasMapForZone('wyrmsbanetomb', IDS), 'wyrmsbane-tomb');
  assert.equal(atlasMapForZone('nightharbore', IDS), 'night-harbor');
  assert.equal(atlasMapForZone('nightharborw', IDS), 'night-harbor');
  assert.equal(atlasMapForZone('nightharbor', IDS), 'night-harbor');
  assert.equal(atlasMapForZone('evergrove', IDS), 'evershade-weald', 'the game calls Evershade Weald evergrove');
  assert.equal(atlasMapForZone('shallowshoals', IDS), null, 'zones without a map give null');
  assert.equal(atlasMapForZone('', IDS), null);
  assert.equal(atlasMapForZone('nightharbore', ['world']), null, 'an alias only counts if the atlas has that map');
});

test('atlas addresses carry the view and the one-map embed', () => {
  assert.equal(atlasUrl('keepers-bight'), 'https://www.mnmatlas.com/keepers-bight/');
  assert.equal(atlasUrl('keepers-bight', { x: 3270.47, y: 4032, z: 2.44 }, { embed: true }),
    'https://www.mnmatlas.com/keepers-bight/?embed=map&x=3270.47&y=4032&z=2.44');
  assert.equal(atlasUrl('world', { x: NaN, y: 1, z: 1 }), 'https://www.mnmatlas.com/world/?y=1&z=1');
});

test('the map and view are read back from an atlas address', () => {
  assert.deepEqual(atlasView('https://www.mnmatlas.com/keepers-bight/?x=3270.47&y=4032&z=2.44'),
    { map: 'keepers-bight', view: { x: 3270.47, y: 4032, z: 2.44 } });
  assert.deepEqual(atlasView('https://www.mnmatlas.com/world/?embed=map'), { map: 'world', view: null });
  assert.equal(atlasView('https://www.mnmatlas.com/'), null);
  assert.equal(atlasView('https://www.mnmatlas.com/embed/'), null);
  assert.equal(atlasView('https://evil.example/keepers-bight/?x=1&y=1&z=1'), null);
  assert.equal(isAtlasUrl('https://www.mnmatlas.com.evil.example/'), false);
  assert.equal(isAtlasUrl('not a url'), false);
});
