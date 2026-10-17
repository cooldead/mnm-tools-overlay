const test = require('node:test');
const assert = require('node:assert/strict');
const { pickMaps, mapsForZone, isWikiMap } = require('../wikimaps');
const { ZONE_ALIASES } = require('../core');

const ZONES = ['Night Harbor', 'Night Harbor Sewers', 'Glass Flats', 'Shaded Dunes', 'Shallow Shoals', 'Glinting Hollow'];
const file = (name, extra = {}) => ({ name, width: 1000, height: 800, size: 1234, user: 'Someone', timestamp: '2025-01-01T00:00:00Z', ...extra });

test('maps are found by the zone page that shows them or by a zone in the file name', () => {
  const maps = pickMaps([
    file('Glass_Flats_Map.png'),
    file('BadShallowShoalMap.png'), // name doesn't spell the zone, but the zone page shows it
    file('NightHarborMapInquisitorSpikes.jpg', { user: 'Grenmark', timestamp: '2026-07-07T00:00:00Z' }),
    file('Mm-map.png', { user: 'Revchumley', timestamp: '2023-12-09T00:00:00Z' }), // known extra
    file('Phformaps.png'), // placeholder on several zone pages
    file('Cordellius_Hollmion_Map_Location.png'), // an NPC's whereabouts
    file('Map_notes.txt'),
  ], ZONES, { 'BadShallowShoalMap.png': ['Shallow Shoals'], 'Phformaps.png': ['Glinting Hollow', 'Night Harbor Sewers'] });
  assert.deepEqual(maps.map((m) => [m.zone, m.title]), [
    ['Glass Flats', 'Glass Flats'],
    ['Night Harbor', 'Night Harbor (Grenmark, 2026)'],
    ['Night Harbor', 'Night Harbor (Revchumley, 2023)'],
    ['Shallow Shoals', 'Shallow Shoals'],
  ]);
  assert.equal(maps[0].id, 'wiki:Glass_Flats_Map.png');
  assert.equal(maps[0].uploaded, '2025-01-01');
});

test('the longest zone name in a file name wins', () => {
  const [map] = pickMaps([file('Night_Harbor_Sewers_map.png')], ZONES, {});
  assert.equal(map.zone, 'Night Harbor Sewers');
});

test('the map a zone page shows comes first, and a double upload is kept once', () => {
  const maps = pickMaps([
    file('Shaded_Dunes_map.jpg', { size: 999, timestamp: '2025-06-01T00:00:00Z' }),
    file('Shaded_Dunes_Map.jpg', { timestamp: '2025-05-01T00:00:00Z' }),
    file('Mnm_shadeddunes_map.png', { user: 'Other', width: 3837, timestamp: '2026-01-01T00:00:00Z' }),
  ], ZONES, { 'Shaded_Dunes_Map.jpg': ['Shaded Dunes'] });
  assert.deepEqual(maps.map((m) => m.file), ['Shaded_Dunes_Map.jpg', 'Mnm_shadeddunes_map.png']);
});

test('world maps have no zone and sort first', () => {
  const maps = pickMaps([file('Glass_Flats_Map.png'), file('Zone_Connection_Map.png')], ZONES, {});
  assert.deepEqual(maps.map((m) => [m.zone, m.title]), [[null, 'Zone connections'], ['Glass Flats', 'Glass Flats']]);
});

test('game zone names find their wiki maps', () => {
  const maps = [
    { id: 'wiki:a', zone: 'Night Harbor' }, { id: 'wiki:b', zone: 'Night Harbor' }, { id: 'wiki:c', zone: 'Evershade Weald' },
    { id: 'wiki:d', zone: 'Shallow Shoals' }, { id: 'wiki:w', zone: null },
  ];
  assert.deepEqual(mapsForZone('nightharbore', maps, ZONE_ALIASES).map((m) => m.id), ['wiki:a', 'wiki:b']);
  assert.deepEqual(mapsForZone('nightharborw', maps, ZONE_ALIASES).map((m) => m.id), ['wiki:a', 'wiki:b']);
  assert.deepEqual(mapsForZone('evergrove', maps, ZONE_ALIASES).map((m) => m.id), ['wiki:c']);
  assert.deepEqual(mapsForZone('shallowshoals', maps, ZONE_ALIASES).map((m) => m.id), ['wiki:d']);
  assert.deepEqual(mapsForZone('keepersbight', maps, ZONE_ALIASES), []);
  assert.deepEqual(mapsForZone('', maps, ZONE_ALIASES), []);
});

test('wiki map ids are told apart from atlas ids', () => {
  assert.equal(isWikiMap('wiki:Glass_Flats_Map.png'), true);
  assert.equal(isWikiMap('glass-flats'), false);
  assert.equal(isWikiMap(undefined), false);
});

test('the bundled list has maps with an image and a page', () => {
  const { maps } = require('../data/wiki-maps.json');
  assert.ok(maps.length > 10);
  for (const m of maps) {
    assert.match(m.src, /^https:\/\/static\.wikitide\.net\//);
    assert.match(m.page, /^https:\/\/monstersandmemories\.miraheze\.org\/wiki\/File:/);
    assert.ok(isWikiMap(m.id) && m.title && m.user);
  }
});
