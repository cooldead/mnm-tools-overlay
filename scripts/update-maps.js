// Refreshes the bundled list of wiki zone maps (data/wiki-maps.json). Run with: npm run update-maps
const fs = require('fs');
const path = require('path');
const { updateMaps } = require('../wikimaps');

updateMaps({
  onProgress: ({ step, done, total }) => process.stdout.write(`\r${step} ${total ? `${done}/${total}` : ''}        `),
}).then((data) => {
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'wiki-maps.json'), JSON.stringify(data, null, 1));
  const zones = new Set(data.maps.filter((m) => m.zone).map((m) => m.zone));
  console.log(`\nWrote ${data.maps.length} maps for ${zones.size} zones (+ ${data.maps.filter((m) => !m.zone).length} world maps).`);
}).catch((error) => { console.error('\n' + error.message); process.exit(1); });
