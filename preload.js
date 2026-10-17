const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mnm', {
  iconsBase: new URLSearchParams(location.search).get('icons'),
  onState: (callback) => ipcRenderer.on('state', (event, state) => callback(state)),
  onFollow: (callback) => ipcRenderer.on('follow', (event, message) => callback(message)),
  onCounters: (callback) => ipcRenderer.on('counters', (event, counts) => callback(counts)),
  // Loading screen: the overlay windows hide their content
  onLoading: (callback) => ipcRenderer.on('loading', (event, on) => callback(on)),
  onCooldowns: (callback) => ipcRenderer.on('cooldowns', (event, cooldowns) => callback(cooldowns)),
  // Framed buttons window
  onFrames: (callback) => ipcRenderer.on('frames', (event, message) => callback(message)),
  frameDone: (result) => ipcRenderer.send('frame-done', result),
  // Overlay dragging (move mode)
  dragStart: (x, y, mode) => ipcRenderer.send('drag-start', x, y, mode),
  dragMove: (x, y) => ipcRenderer.send('drag-move', x, y),
  dragEnd: () => ipcRenderer.send('drag-end'),
  // Minimap window
  onMinimap: (callback) => ipcRenderer.on('minimap', (event, message) => callback(message)),
  onMinimapZoom: (callback) => ipcRenderer.on('minimap-zoom', (event, direction) => callback(direction)),
  // Wiki maps (minimap and map window): save where a map was left
  mapView: (id, view) => ipcRenderer.send('map-view', id, view),
  // Map window: what to show first, the source tabs, and maps the main process sends (zoning, atlas links)
  mapsInit: () => ipcRenderer.invoke('maps-init'),
  setMapsSource: (source) => ipcRenderer.invoke('maps-source', source),
  onMapsShow: (callback) => ipcRenderer.on('maps-show', (event, message) => callback(message)),
  showWikiMap: (id) => ipcRenderer.invoke('show-wiki-map', id),
  mapsToMinimap: (source, id) => ipcRenderer.invoke('maps-to-minimap', source, id),
  openWikiPage: (url) => ipcRenderer.invoke('open-wiki-page', url),
  // Settings window
  openMaps: () => ipcRenderer.invoke('open-maps'),
  catalog: () => ipcRenderer.invoke('catalog'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  profile: (request) => ipcRenderer.invoke('profile', request),
  recordKey: () => ipcRenderer.invoke('record-key'),
  cancelRecord: () => ipcRenderer.invoke('cancel-record'),
  editFrame: (item) => ipcRenderer.invoke('edit-frame', item),
  chooseImage: () => ipcRenderer.invoke('choose-image'),
  grabFrame: (frame) => ipcRenderer.invoke('grab-frame', frame),
  saveIcon: (dataUrl) => ipcRenderer.invoke('save-icon', dataUrl),
  spells: () => ipcRenderer.invoke('spells'),
  planImport: (character) => ipcRenderer.invoke('plan-import', character),
  applyImport: (choice) => ipcRenderer.invoke('apply-import', choice),
  onOpenImport: (callback) => ipcRenderer.on('open-import', () => callback()),
  updateSpells: () => ipcRenderer.invoke('update-spells'),
  // Quest tracker window
  quests: () => ipcRenderer.invoke('quests'),
  updateQuests: () => ipcRenderer.invoke('update-quests'),
  onQuestsProgress: (callback) => ipcRenderer.on('quests-progress', (event, progress) => callback(progress)),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  openWiki: (title) => ipcRenderer.invoke('open-wiki', title),
  openQuests: () => ipcRenderer.invoke('open-quests'),
  // Quest log overlay: turn it on/off (openWindow: back to the ordinary window), and hear when it's in use
  setQuestOverlay: (on, openWindow) => ipcRenderer.invoke('quest-overlay', on, openWindow),
  onQuestOverlay: (callback) => ipcRenderer.on('quest-overlay', (event, message) => callback(message)),
  onSpellsProgress: (callback) => ipcRenderer.on('spells-progress', (event, progress) => callback(progress)),
});
