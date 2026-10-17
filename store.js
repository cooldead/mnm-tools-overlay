// Saving and loading settings.json without losing it. A write goes to a temp file that is synced and then
// renamed over the real one, so a crash or power cut mid-save leaves either the old file or the new one,
// never half of one. Each start that reads the file cleanly also copies it to <file>.bak, and a file that
// can't be read is set aside as <file>.broken-<time> and the backup loaded instead of starting from blank.
const fs = require('fs');

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readObject(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a settings object');
  return data;
}

// Returns { data, problem }. data is null when there is nothing to load (first run, or nothing could be saved).
// problem: undefined when all is well, 'restored' when the backup was loaded, 'lost' when neither could be read.
function loadJson(file) {
  const bak = `${file}.bak`;
  let broken = null;
  if (fs.existsSync(file)) {
    try {
      const data = readObject(file);
      try { writeAtomic(bak, fs.readFileSync(file, 'utf8')); } catch (error) { console.error('Could not back up settings:', error.message); }
      return { data };
    } catch (error) {
      broken = `${file}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { fs.renameSync(file, broken); } catch { broken = null; }
      console.error(`Could not read ${file} (${error.message})${broken ? `, kept it as ${broken}` : ''}`);
    }
  } else if (!fs.existsSync(bak)) {
    return { data: null }; // first run
  }
  // The file is broken, or missing although a backup exists (it was there before).
  try { return { data: readObject(bak), problem: 'restored', broken }; } catch { return { data: null, problem: 'lost', broken }; }
}

module.exports = { writeAtomic, loadJson };
