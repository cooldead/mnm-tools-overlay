const test = require('node:test');
const assert = require('node:assert/strict');
const { gameTime, ordinal } = require('../renderer/game-time');

test('20 game days pass per UTC day, starting at UTC midnight', () => {
  assert.equal(gameTime(new Date('2026-10-03T00:00:00Z')).time, '12:00 AM');
  assert.equal(gameTime(new Date('2026-10-03T00:00:00Z')).dayOf20, 1);
  // One real minute is 20 game minutes, one game day is 72 real minutes.
  assert.equal(gameTime(new Date('2026-10-03T00:01:00Z')).time, '12:20 AM');
  assert.equal(gameTime(new Date('2026-10-03T00:36:00Z')).time, '12:00 PM');
  assert.equal(gameTime(new Date('2026-10-03T01:12:00Z')).time, '12:00 AM');
  assert.equal(gameTime(new Date('2026-10-03T01:12:00Z')).dayOf20, 2);
  assert.equal(gameTime(new Date('2026-10-03T23:59:59Z')).dayOf20, 20);
  assert.equal(gameTime(new Date('2026-10-03T00:42:30Z')).time, '2:10 PM');
});

test('the date is the UTC date with game names', () => {
  // 3 Oct 2026 is a Saturday.
  const t = gameTime(new Date('2026-10-03T12:00:00Z'));
  assert.deepEqual([t.weekday, t.day, t.month], ['Matsden', '3rd', 'Sheafall']);
  assert.equal(gameTime(new Date('2026-01-01T00:00:00Z')).month, 'Sundawn');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
});
