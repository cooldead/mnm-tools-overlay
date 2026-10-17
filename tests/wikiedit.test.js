const test = require('node:test');
const assert = require('node:assert/strict');
const { WikiClient, pageUrl, editUrl } = require('../wikiedit');

// A pretend wiki: answers the few API calls the client makes and records what it was sent.
function fakeWiki({ page = null, editResult = 'Success' } = {}) {
  const sent = [];
  const fetchImpl = async (url, options = {}) => {
    const form = options.body instanceof FormData ? options.body : null;
    const params = form ? Object.fromEntries([...form].filter(([k]) => k !== 'file'))
      : Object.fromEntries(new URLSearchParams(options.body ? String(options.body) : url.split('?')[1]));
    sent.push({ params, cookie: options.headers?.Cookie || '', file: form?.get('file') || null });
    let body;
    if (params.meta === 'tokens' && params.type === 'login') body = { query: { tokens: { logintoken: 'LT' } } };
    else if (params.meta === 'tokens') body = { query: { tokens: { csrftoken: 'CT' } } };
    else if (params.action === 'login') body = params.lgpassword === 'right' ? { login: { result: 'Success', lgusername: 'Tester' } } : { login: { result: 'Failed', reason: 'Wrong password' } };
    else if (params.action === 'edit') body = editResult === 'Success' ? { edit: { result: 'Success', title: params.title, newrevid: 7 } } : { error: { code: 'editconflict', info: 'Edit conflict.' } };
    else if (params.action === 'upload') body = { upload: params.filename === 'Taken.png' ? { result: 'Warning', warnings: { exists: params.filename } }
      : params.filename === 'Copy.png' ? { result: 'Warning', warnings: { duplicate: ['Spellicon014E.png'] } } : { result: 'Success', filename: params.filename.replace(/ /g, '_') } };
    else if (params.prop === 'revisions') body = { curtimestamp: '2026-10-17T10:00:00Z', query: { pages: [page || { title: params.titles, missing: true }] } };
    return { ok: true, status: 200, headers: { getSetCookie: () => ['session=abc; path=/; HttpOnly'] }, json: async () => body };
  };
  return { sent, fetchImpl };
}

test('pages are read with the version they were read at', async () => {
  const wiki = fakeWiki({ page: { title: 'Sneak', revisions: [{ timestamp: '2026-10-07T01:43:53Z', slots: { main: { content: 'text' } } }] } });
  const client = new WikiClient({ fetchImpl: wiki.fetchImpl });
  assert.deepEqual(await client.page('Sneak'), { title: 'Sneak', exists: true, text: 'text', timestamp: '2026-10-07T01:43:53Z', fetchedAt: '2026-10-17T10:00:00Z' });
  const missing = await new WikiClient({ fetchImpl: fakeWiki().fetchImpl }).page('New Spell');
  assert.equal(missing.exists, false);
});

test('edits need a login, keep the session cookie and refuse to overwrite newer versions', async () => {
  const wiki = fakeWiki();
  const client = new WikiClient({ fetchImpl: wiki.fetchImpl });
  await assert.rejects(client.edit({ title: 'X', text: 't', summary: 's' }), /Log in/);
  await assert.rejects(client.login('Tester@helper', 'wrong'), /Wrong password/);
  assert.equal(await client.login('Tester@helper', 'right'), 'Tester');
  const base = { exists: true, timestamp: '2026-10-07T01:43:53Z', fetchedAt: '2026-10-17T10:00:00Z' };
  assert.deepEqual(await client.edit({ title: 'Sneak', text: 'new', summary: 'From the game', base }), { title: 'Sneak', revision: 7, nochange: false });
  const edit = wiki.sent.find((s) => s.params.action === 'edit');
  assert.deepEqual([edit.params.basetimestamp, edit.params.starttimestamp, edit.params.nocreate, edit.params.token, edit.params.assert],
    ['2026-10-07T01:43:53Z', '2026-10-17T10:00:00Z', '1', 'CT', 'user']);
  assert.equal(edit.cookie, 'session=abc');
  await client.edit({ title: 'New', text: 'page', summary: 's', base: { exists: false, fetchedAt: 'T' } });
  assert.equal(wiki.sent.filter((s) => s.params.action === 'edit')[1].params.createonly, '1', 'a new page must not exist yet');
  const conflict = new WikiClient({ fetchImpl: fakeWiki({ editResult: 'conflict' }).fetchImpl });
  await conflict.login('Tester@helper', 'right');
  await assert.rejects(conflict.edit({ title: 'Sneak', text: 'x', summary: 's', base }), /Edit conflict/);
});

test('page and edit links', () => {
  assert.equal(pageUrl('Guardian Spirit'), 'https://monstersandmemories.miraheze.org/wiki/Guardian_Spirit');
  assert.equal(editUrl("Hunter's Chase"), "https://monstersandmemories.miraheze.org/w/index.php?action=edit&title=Hunter's_Chase");
});

test('icons upload as files, and a taken name or an existing copy is reported instead of replaced', async () => {
  const wiki = fakeWiki();
  const client = new WikiClient({ fetchImpl: wiki.fetchImpl });
  const data = Buffer.from('png bytes');
  await assert.rejects(client.upload({ filename: 'A.png', data, text: 't', comment: 'c' }), /Log in/);
  await client.login('Tester@helper', 'right');
  assert.deepEqual(await client.upload({ filename: 'Bestial Bond icon.png', data, text: '[[Category:Spell Icons]]', comment: 'c' }), { filename: 'Bestial_Bond_icon.png' });
  const sent = wiki.sent.find((s) => s.params.action === 'upload');
  assert.deepEqual([sent.params.text, sent.params.token, sent.params.ignorewarnings, sent.cookie], ['[[Category:Spell Icons]]', 'CT', undefined, 'session=abc']);
  assert.equal(Buffer.from(await sent.file.arrayBuffer()).toString(), 'png bytes');
  assert.match((await client.upload({ filename: 'Taken.png', data, text: '', comment: '' })).warning, /already on the wiki/);
  assert.deepEqual(await client.upload({ filename: 'Copy.png', data, text: '', comment: '' }), { warning: 'This picture is already on the wiki as File:Spellicon014E.png.', duplicate: 'Spellicon014E.png' });
});
