// An ability's icon is either a path relative to the bundled icons folder ("wiki/x.png", "fire.png")
// or an absolute path to a custom image copied into the app's data folder.
function iconUrl(icon) {
  if (!icon) return window.mnm.iconsBase + '/timer.svg';
  if (icon.startsWith('/')) return 'file://' + icon.split('/').map(encodeURIComponent).join('/');
  return window.mnm.iconsBase + '/' + icon.split('/').map(encodeURIComponent).join('/');
}
