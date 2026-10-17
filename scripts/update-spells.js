// Refreshes the bundled spell list (data/spells.json) and downloads any spell icons the bundled catalog
// lacks into icons/spells/. Run with: npm run update-spells
const fs = require('fs');
const path = require('path');
const { updateSpells } = require('../wiki');

const root = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'icons', 'catalog.json'), 'utf8')).icons;

updateSpells({
  catalog,
  iconDir: path.join(root, 'icons', 'spells'),
  iconRef: (name) => 'spells/' + name,
  onProgress: ({ step, done, total }) => process.stdout.write(`\r${step} ${total ? `${done}/${total}` : ''}        `),
}).then((data) => {
  fs.writeFileSync(path.join(root, 'data', 'spells.json'), JSON.stringify(data, null, 1));
  const s = data.spells;
  console.log(`\nWrote ${s.length} spells: ${s.filter((x) => x.recast > 0).length} with a recast, ` +
    `${s.filter((x) => x.icon).length} with an icon (${data.iconsDownloaded} downloaded, ${data.iconsFailed} failed).`);
}).catch((error) => { console.error('\n' + error.message); process.exit(1); });
