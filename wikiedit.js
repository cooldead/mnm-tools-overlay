// Reading and editing wiki pages for the Wiki helper, through the MediaWiki API.
// Edits are made under the user's own account with a bot password (Special:BotPasswords), one at a time and
// only when the user presses Publish for that edit. Each edit says which version of the page it was made
// from, so if someone else changed the page in the meantime the wiki refuses it instead of overwriting.

const API = 'https://monstersandmemories.miraheze.org/w/api.php';
const USER_AGENT = 'mnm-tools/0.1 (personal game overlay; Wiki helper; https://monstersandmemories.miraheze.org)';

class WikiClient {
  constructor({ api = API, fetchImpl = fetch } = {}) {
    this.api = api;
    this.fetch = (...args) => fetchImpl(...args); // called on its own, as fetch must be
    this.cookies = new Map();
    this.user = null;
  }

  // `file` ({name, data: Buffer, type}) sends the request as multipart form data, for uploads.
  async call(params, { post = false, file = null } = {}) {
    const body = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
    const headers = { 'User-Agent': USER_AGENT };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let response;
    if (file) {
      const form = new FormData();
      for (const [k, v] of body) form.append(k, v);
      form.append('file', new Blob([file.data], { type: file.type || 'image/png' }), file.name);
      response = await this.fetch(this.api, { method: 'POST', headers, body: form });
    } else {
      response = post
        ? await this.fetch(this.api, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body })
        : await this.fetch(this.api + '?' + body, { headers });
    }
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (!response.ok) throw new Error(`The wiki answered HTTP ${response.status}`);
    const json = await response.json();
    if (json.error) throw new Error(json.error.info || json.error.code);
    return json;
  }

  // The page's wikitext and the timestamp of that version; {exists: false} for a page that isn't there yet.
  async page(title) {
    const j = await this.call({ action: 'query', prop: 'revisions', rvprop: 'content|timestamp', rvslots: 'main', titles: title, redirects: '1', curtimestamp: '1' });
    const page = j.query?.pages?.[0];
    const rev = page?.revisions?.[0];
    if (!page || page.missing || !rev) return { title: page?.title || title, exists: false, text: '', timestamp: null, fetchedAt: j.curtimestamp };
    return { title: page.title, exists: true, text: rev.slots.main.content, timestamp: rev.timestamp, fetchedAt: j.curtimestamp };
  }

  // A bot password's user name looks like "Name@helper".
  async login(name, password) {
    const token = (await this.call({ action: 'query', meta: 'tokens', type: 'login' })).query.tokens.logintoken;
    const j = await this.call({ action: 'login', lgname: name, lgpassword: password, lgtoken: token }, { post: true });
    if (j.login?.result !== 'Success') throw new Error(j.login?.reason || 'The wiki did not accept that name and password');
    this.user = j.login.lgusername;
    return this.user;
  }

  // Saves a page. `base` is the page as it was read ({exists, timestamp, fetchedAt}): an existing page must
  // still be that version, and a new page must still not exist.
  async edit({ title, text, summary, base }) {
    if (!this.user) throw new Error('Log in to the wiki first');
    const token = (await this.call({ action: 'query', meta: 'tokens' })).query.tokens.csrftoken;
    const params = { action: 'edit', title, text, summary, token, assert: 'user' };
    if (base?.exists) Object.assign(params, { basetimestamp: base.timestamp, starttimestamp: base.fetchedAt, nocreate: '1' });
    else Object.assign(params, { createonly: '1', ...(base?.fetchedAt ? { starttimestamp: base.fetchedAt } : {}) });
    const j = await this.call(params, { post: true });
    if (j.edit?.result !== 'Success') throw new Error(j.edit?.info || 'The wiki did not save the edit');
    return { title: j.edit.title, revision: j.edit.newrevid || null, nochange: !!j.edit.nochange };
  }
}

// Uploads an image as File:<filename>. Nothing is replaced: if the name is taken, or the same picture is already
// on the wiki under another name, the wiki's warning comes back ({warning, duplicate}) and nothing is uploaded.
WikiClient.prototype.upload = async function upload({ filename, data, text, comment }) {
  if (!this.user) throw new Error('Log in to the wiki first');
  const token = (await this.call({ action: 'query', meta: 'tokens' })).query.tokens.csrftoken;
  const j = await this.call({ action: 'upload', filename, text, comment, token, assert: 'user' }, { file: { name: filename, data } });
  const up = j.upload || {};
  if (up.result === 'Success') return { filename: up.filename || filename };
  if (up.result === 'Warning') {
    const w = up.warnings || {};
    const duplicate = [].concat(w.duplicate || [])[0] || null;
    const warning = w.exists ? `A file named ${filename} is already on the wiki.`
      : duplicate ? `This picture is already on the wiki as File:${duplicate}.`
      : w['was-deleted'] ? `A file named ${filename} was deleted from the wiki before.`
      : w.badfilename ? `The wiki would rename it to ${w.badfilename}.`
      : 'The wiki warned: ' + Object.keys(w).join(', ');
    return { warning, duplicate };
  }
  throw new Error('The wiki did not take the upload');
};

const pageUrl = (title) => API.replace('/w/api.php', '/wiki/') + encodeURIComponent(String(title).replace(/ /g, '_'));
const editUrl = (title) => API.replace('/api.php', '/index.php') + '?action=edit&title=' + encodeURIComponent(String(title).replace(/ /g, '_'));

module.exports = { WikiClient, pageUrl, editUrl };
