const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mnm-store-'));

test('first run: nothing to load, no problem', () => {
  const file = path.join(tmp(), 'settings.json');
  assert.deepStrictEqual(store.loadJson(file), { data: null });
});

test('a clean load backs the file up', () => {
  const file = path.join(tmp(), 'settings.json');
  store.writeAtomic(file, '{"a":1}');
  assert.deepStrictEqual(store.loadJson(file), { data: { a: 1 } });
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{"a":1}');
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('an empty or cut-off file loads the backup and is kept aside', () => {
  for (const bad of ['', '{"abilities": [', 'null', '[]']) {
    const dir = tmp(), file = path.join(dir, 'settings.json');
    fs.writeFileSync(`${file}.bak`, '{"a":1}');
    fs.writeFileSync(file, bad);
    const out = store.loadJson(file);
    assert.strictEqual(out.problem, 'restored');
    assert.deepStrictEqual(out.data, { a: 1 });
    assert.ok(!fs.existsSync(file));
    assert.strictEqual(fs.readFileSync(out.broken, 'utf8'), bad);
    assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{"a":1}', 'backup must not be replaced by the broken file');
  }
});

test('a missing file with a backup loads the backup', () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(`${file}.bak`, '{"a":1}');
  assert.deepStrictEqual(store.loadJson(file), { data: { a: 1 }, problem: 'restored', broken: null });
});

test('broken file and broken backup: lost', () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(file, '{');
  fs.writeFileSync(`${file}.bak`, '');
  const out = store.loadJson(file);
  assert.strictEqual(out.problem, 'lost');
  assert.strictEqual(out.data, null);
  assert.ok(fs.existsSync(out.broken));
});
