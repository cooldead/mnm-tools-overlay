// Refreshes the bundled quest walkthroughs (data/quests.json) from the wiki. Run with: npm run update-quests
const fs = require('fs');
const path = require('path');
const { updateQuests } = require('../quests');

updateQuests({
  onProgress: ({ step, done, total }) => process.stdout.write(`\r${step} ${total ? `${done}/${total}` : ''}        `),
}).then((data) => {
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'quests.json'), JSON.stringify(data));
  const q = data.quests;
  console.log(`\nWrote ${q.length} quests in ${new Set(q.map((x) => x.zone)).size} zones, ${q.filter((x) => x.quick).length} with a quick guide.`);
}).catch((error) => { console.error('\n' + error.message); process.exit(1); });
