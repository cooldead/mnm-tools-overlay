// Game time, worked out the same way as the wiki's sidebar clock (MediaWiki:Gadget-mnmGameTimeSidebar.js):
// 20 game days pass per real UTC day, starting at UTC midnight, and the date is today's UTC date with the
// weekday and month renamed. It is calculated, not read from the game.
const GAME_MONTHS = ['Sundawn', 'Frostmelt', 'Earthtill', 'Heartsblood', 'Springsend', 'Sunpeak', 'Midsummer', 'Meldulstand',
  'Harvesttide', 'Sheafall', 'Dyingember', 'Longwinter'];
const GAME_WEEKDAYS = ['Rellden', 'Eltinden', 'Sorophden', 'Tremden', 'Krivden', 'Tilustden', 'Matsden'];

function ordinal(n) {
  if (n > 3 && n < 21) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

function gameTime(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const ms = date.getTime() - midnight;
  const gameMinutes = (ms / 60000 * 20) % 1440;
  const hours = Math.floor(gameMinutes / 60), minutes = Math.floor(gameMinutes % 60);
  return {
    hours, minutes,
    time: `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`,
    dayOf20: Math.min(20, Math.floor(ms / 86400000 * 20) + 1),
    weekday: GAME_WEEKDAYS[date.getUTCDay()],
    day: ordinal(date.getUTCDate()),
    month: GAME_MONTHS[date.getUTCMonth()],
  };
}

if (typeof module !== 'undefined') module.exports = { gameTime, ordinal, GAME_MONTHS, GAME_WEEKDAYS };
