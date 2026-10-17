const test = require('node:test');
const assert = require('node:assert/strict');
const { bindingLabel, matches, Cooldowns, overlaySize, lineParser, isModifier, bindingFromPress } = require('../core');

const press = (code, extra = {}) => ({ code, key: 'x', shift: false, ctrl: false, alt: false, game: true, ...extra });

test('labels read like the game shows them', () => {
  assert.equal(bindingLabel({ key: '2', shift: true, ctrl: true }), 'Ctrl+Shift+2');
  assert.equal(bindingLabel({ key: 'KP_End' }), 'Num 1');
  assert.equal(bindingLabel({ key: 'KP_7' }), 'Num 7');
  assert.equal(bindingLabel({ key: 'q', alt: true }), 'Alt+Q');
  assert.equal(bindingLabel({ key: 'F5' }), 'F5');
  assert.equal(bindingLabel({ key: 'minus' }), '-');
  assert.equal(bindingLabel(null), '');
});

test('bindings match the physical key and exact modifiers', () => {
  const two = bindingFromPress(press(11, { key: '2' }));
  assert.ok(matches(two, press(11)));
  assert.ok(!matches(two, press(11, { shift: true })), 'Shift+2 is a different binding');
  assert.ok(!matches(two, press(12)));
  assert.ok(!matches(null, press(11)));
  assert.ok(isModifier({ key: 'Shift_L' }) && !isModifier({ key: '2' }));
});

test('a press starts every matching ability and ignores repeats during the cooldown', () => {
  const key = { code: 11, shift: false, ctrl: false, alt: false };
  const abilities = [{ id: 'a', key, seconds: 10 }, { id: 'b', key, seconds: 2.5 }, { id: 'c', key: { ...key, code: 12 }, seconds: 5 }];
  const cd = new Cooldowns();
  assert.deepEqual(cd.press(abilities, press(11), { now: 0 }), ['a', 'b']);
  assert.deepEqual(cd.state(1000), { a: { endsAt: 10000, ms: 10000 }, b: { endsAt: 2500, ms: 2500 } });
  assert.deepEqual(cd.press(abilities, press(11), { now: 3000 }), ['b'], 'only b is ready again');
  assert.deepEqual(Object.keys(cd.state(11000)), [], 'everything has expired by 11 s');
});

test('restart mode restarts a running cooldown', () => {
  const abilities = [{ id: 'a', key: { code: 11 }, seconds: 10 }];
  const cd = new Cooldowns();
  cd.press(abilities, press(11), { now: 0, repress: 'restart' });
  cd.press(abilities, press(11), { now: 4000, repress: 'restart' });
  assert.equal(cd.state(5000).a.endsAt, 14000);
});

test('game-only mode ignores keys pressed in other windows', () => {
  const abilities = [{ id: 'a', key: { code: 11 }, seconds: 10 }];
  const cd = new Cooldowns();
  assert.deepEqual(cd.press(abilities, press(11, { game: false }), { now: 0 }), []);
  assert.deepEqual(cd.press(abilities, press(11, { game: false }), { now: 0, gameOnly: false }), ['a']);
});

test('abilities without a key or a cooldown never start', () => {
  const cd = new Cooldowns();
  assert.deepEqual(cd.press([{ id: 'a', key: null, seconds: 5 }, { id: 'b', key: { code: 11 }, seconds: 0 }], press(11), { now: 0 }), []);
});

test('the overlay is sized for its tiles in either direction', () => {
  // Medium tiles are 56 px with a 4 px gap and 6 px padding on each side.
  assert.deepEqual(overlaySize(3, { layout: 'horizontal', size: 'Medium' }), { width: 3 * 56 + 2 * 4 + 12, height: 68 });
  assert.deepEqual(overlaySize(3, { layout: 'vertical', size: 'Medium' }), { width: 68, height: 188 });
  assert.deepEqual(overlaySize(0, { size: 'Small' }), { width: 52, height: 52 }, 'room for one tile while empty');
});

test('watcher output is split into JSON lines across chunks', () => {
  const seen = [];
  const feed = lineParser((m) => seen.push(m));
  feed('{"ready": true}\n{"code": 1');
  feed('1, "key": "2"}\nnot json\n\n');
  assert.deepEqual(seen, [{ ready: true }, { code: 11, key: '2' }]);
});

test('a follow-up starts on its trigger, restarts on a new trigger and is dismissed by the next ability', () => {
  const { FollowUps } = require('../core');
  const keyA = { code: 10 }, keyB = { code: 11 };
  const abilities = [{ id: 'b', key: keyB, seconds: 0 }];
  const followUps = [{ id: 'f', key: keyA, seconds: 3, next: 'b' }];
  const f = new FollowUps();
  assert.deepEqual(f.press(followUps, abilities, press(12), { now: 0 }), null, 'unrelated key');
  assert.deepEqual(f.press(followUps, abilities, press(10), { now: 0 }), { type: 'start', followUp: followUps[0], endsAt: 3000, ms: 3000 });
  assert.equal(f.press(followUps, abilities, press(10), { now: 1000 }).endsAt, 4000, 'pressing the trigger again restarts it');
  assert.deepEqual(f.press(followUps, abilities, press(11), { now: 2000 }), { type: 'cancel' });
  assert.equal(f.press(followUps, abilities, press(11), { now: 2100 }), null, 'nothing left to dismiss');
});

test('in a chain the next key starts its own follow-up, and other windows are ignored', () => {
  const { FollowUps } = require('../core');
  const abilities = [{ id: 'b', key: { code: 11 } }];
  const followUps = [{ id: 'ab', key: { code: 10 }, seconds: 2, next: 'b' }, { id: 'bc', key: { code: 11 }, seconds: 4, next: '' }];
  const f = new FollowUps();
  f.press(followUps, abilities, press(10), { now: 0 });
  assert.equal(f.press(followUps, abilities, press(11), { now: 2500 }).followUp.id, 'bc');
  assert.equal(f.press(followUps, abilities, press(10, { game: false }), { now: 3000 }), null);
  assert.equal(f.press(followUps, abilities, press(10, { game: false }), { now: 3000, gameOnly: false }).type, 'start');
});

test('a left click inside a framed button counts like its key', () => {
  const { triggers, inFrame } = require('../core');
  const ability = { id: 'a', key: { code: 11 }, frame: { x: 100, y: 200, width: 40, height: 40 }, seconds: 10 };
  const click = (x, y, extra = {}) => ({ button: 1, x, y, shift: false, ctrl: false, alt: false, game: true, ...extra });
  assert.ok(triggers(ability, click(100, 200)), 'top-left corner is inside');
  assert.ok(triggers(ability, click(139.5, 239.5)));
  assert.ok(!triggers(ability, click(140, 220)), 'the right edge is outside');
  assert.ok(!triggers(ability, click(120, 220, { button: 3 })), 'right clicks do not count');
  assert.ok(!triggers({ id: 'b', key: { code: 11 } }, click(120, 220)), 'no frame, no click trigger');
  assert.ok(triggers(ability, press(11)), 'the key still works');
  assert.ok(!inFrame(null, click(0, 0)));

  const cd = new Cooldowns();
  assert.deepEqual(cd.press([ability], click(120, 220), { now: 0 }), ['a']);
  assert.deepEqual(cd.press([ability], click(120, 220, { game: false }), { now: 20000 }), [], 'game-only applies to clicks');
});

test('clicking the next ability\'s frame dismisses a follow-up', () => {
  const { FollowUps } = require('../core');
  const abilities = [{ id: 'n', key: { code: 12 }, frame: { x: 0, y: 0, width: 10, height: 10 } }];
  const f = new FollowUps();
  const start = f.press([{ id: 'f', key: null, frame: { x: 50, y: 50, width: 10, height: 10 }, seconds: 3, next: 'n' }], abilities,
    { button: 1, x: 55, y: 55, game: true }, { now: 0 });
  assert.equal(start.type, 'start', 'a framed follow-up starts on a click');
  assert.deepEqual(f.press([], abilities, { button: 1, x: 5, y: 5, game: true }, { now: 1000 }), { type: 'cancel' });
});

test('the frames window covers every frame plus padding', () => {
  const { framesBounds } = require('../core');
  assert.equal(framesBounds([]), null);
  assert.deepEqual(framesBounds([{ x: 100, y: 50, width: 40, height: 40 }, { x: 300, y: 80, width: 40, height: 40 }], 10),
    { x: 90, y: 40, width: 260, height: 90 });
});

test('a counter adds one per press and resets once its time passes without a press', () => {
  const { Counters } = require('../core');
  const counters = [{ id: 'c', key: { code: 11 }, seconds: 5 }, { id: 'off', key: { code: 11 }, seconds: 0 }];
  const c = new Counters();
  assert.deepEqual(c.press(counters, press(12), { now: 0 }), [], 'unrelated key');
  assert.deepEqual(c.press(counters, press(11), { now: 0 }), ['c'], 'a counter with no reset time never counts');
  c.press(counters, press(11), { now: 4000 });
  c.press(counters, press(11), { now: 8000 });
  assert.deepEqual(c.state(8000), { c: { count: 3, resetAt: 13000, ms: 5000 } }, 'each press pushes the reset back');
  assert.deepEqual(c.state(13000), {}, 'reset after 5 s without a press');
  c.press(counters, press(11), { now: 13000 });
  assert.equal(c.state(13000).c.count, 1, 'starts again from 1');
  assert.deepEqual(c.press(counters, press(11, { game: false }), { now: 14000 }), [], 'game-only applies');
  c.reset();
  assert.deepEqual(c.state(14000), {});
});

test('a counter set to reset after the first press keeps that reset time', () => {
  const { Counters } = require('../core');
  const counters = [{ id: 'c', key: { code: 11 }, seconds: 5, resetFrom: 'first' }];
  const c = new Counters();
  c.press(counters, press(11), { now: 0 });
  c.press(counters, press(11), { now: 3000 });
  c.press(counters, press(11), { now: 4500 });
  assert.deepEqual(c.state(4500), { c: { count: 3, resetAt: 5000, ms: 5000 } }, 'later presses add but do not push the reset');
  assert.deepEqual(c.state(5000), {}, 'reset 5 s after the first press');
  c.press(counters, press(11), { now: 6000 });
  assert.deepEqual(c.state(6000), { c: { count: 1, resetAt: 11000, ms: 5000 } }, 'the next press starts a new count');
});

test("a counter's clear key sets it back to 0 before its time is up", () => {
  const { Counters } = require('../core');
  const counters = [{ id: 'c', key: { code: 11 }, clearKey: { code: 13 }, seconds: 30 }, { id: 'd', key: { code: 12 }, seconds: 30 }];
  const c = new Counters();
  c.press(counters, press(11), { now: 0 });
  c.press(counters, press(11), { now: 1000 });
  c.press(counters, press(12), { now: 1000 });
  assert.deepEqual(c.press(counters, press(13), { now: 2000 }), ['c'], 'the clear key reports the change');
  assert.deepEqual(Object.keys(c.state(2000)), ['d'], 'only that counter is cleared');
  assert.deepEqual(c.press(counters, press(13), { now: 2500 }), [], 'clearing an empty count changes nothing');
  assert.deepEqual(c.press(counters, press(13, { game: false }), { now: 2500 }), [], 'game-only applies');
  c.press(counters, press(11), { now: 3000 });
  assert.equal(c.state(3000).c.count, 1, 'counts from 1 again');
});

test('a framed counter counts clicks, and the window fits one tile per counter', () => {
  const { Counters, counterSize } = require('../core');
  const c = new Counters();
  c.press([{ id: 'c', key: null, frame: { x: 0, y: 0, width: 10, height: 10 }, seconds: 3 }], { button: 1, x: 5, y: 5, game: true }, { now: 0 });
  assert.equal(c.state(0).c.count, 1);
  assert.deepEqual(counterSize(0, { counterSize: 'Small' }), { width: 96, height: 96 });
  assert.deepEqual(counterSize(3, { counterSize: 'Extra small' }), { width: 3 * 72 + 2 * 4, height: 72 });
  // A counter timing each press gets room for its stack (4 layers of 5 px at 96 px).
  assert.deepEqual(counterSize([{}, { resetFrom: 'each' }], { counterSize: 'Small' }), { width: 96 + 96 + 20 + 4, height: 96 + 20 });
});

test('a counter timing each press separately counts the presses still running', () => {
  const { Counters } = require('../core');
  const counters = [{ id: 'c', key: { code: 11 }, clearKey: { code: 13 }, seconds: 12, resetFrom: 'each' }];
  const c = new Counters();
  for (const now of [0, 4000, 8000]) c.press(counters, press(11), { now });
  assert.deepEqual(c.state(8000).c, { count: 3, resetAt: 20000, ms: 12000, stacks: [12000, 16000, 20000], lastAt: 8000 });
  assert.equal(c.state(12000).c.count, 2, 'the first press ran out');
  assert.equal(c.state(16000).c.count, 1);
  c.press(counters, press(11), { now: 17000 });
  assert.deepEqual(c.state(17000).c.stacks, [20000, 29000], 'a new press adds its own timer');
  assert.deepEqual(c.state(29000), {}, 'gone once every press ran out');
  c.press(counters, press(11), { now: 30000 });
  c.press(counters, press(13), { now: 31000 });
  assert.deepEqual(c.state(31000), {}, 'the clear key clears every stack');
});

test('a stacked counter can ignore presses that come too soon after the last one', () => {
  const { Counters } = require('../core');
  const counters = [{ id: 'c', key: { code: 11 }, seconds: 12, resetFrom: 'each', minGap: 2 }];
  const c = new Counters();
  c.press(counters, press(11), { now: 0 });
  assert.deepEqual(c.press(counters, press(11), { now: 1500 }), [], 'within 2 s: no new timer');
  c.press(counters, press(11), { now: 2000 });
  assert.equal(c.state(2000).c.count, 2, '2 s after the first press: a new timer');
  c.press(counters, press(11), { now: 3000 });
  assert.equal(c.state(3000).c.count, 2, 'the gap counts from the last press that added a timer');
});
