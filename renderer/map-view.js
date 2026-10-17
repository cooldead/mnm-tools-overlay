// A picture map you can drag to pan and scroll to zoom (wiki maps are plain images, not a map site).
// The view is {x, y, z}: the point in the middle as a fraction of the image (0-1), and the zoom, where 1 fits
// the whole map in the box. Fractions keep a saved view right when the wiki's image changes size.
// eslint-disable-next-line no-unused-vars
class MapView {
  constructor(box, { onView = () => {}, onLoad = () => {}, onError = () => {} } = {}) {
    this.box = box;
    this.onView = onView;
    this.view = { x: 0.5, y: 0.5, z: 1 };
    this.img = document.createElement('img');
    this.img.className = 'map-image';
    this.img.draggable = false;
    this.img.alt = '';
    this.img.addEventListener('load', () => { this.loaded = true; this.view = this.clamp(this.view); this.draw(); onLoad(); });
    this.img.addEventListener('error', () => onError());
    box.appendChild(this.img);
    new ResizeObserver(() => this.draw()).observe(box);

    let drag = null;
    box.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !this.loaded) return;
      box.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...this.view } };
      box.classList.add('dragging');
    });
    box.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const s = this.scale();
      this.set({ ...drag.view, x: drag.view.x - (event.clientX - drag.x) / (s * this.w()), y: drag.view.y - (event.clientY - drag.y) / (s * this.h()) });
    });
    const end = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      box.classList.remove('dragging');
      this.changed();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      this.zoom(event.deltaY < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    box.addEventListener('dblclick', (event) => {
      const rect = box.getBoundingClientRect();
      this.zoom(event.shiftKey ? -1 : 1, event.clientX - rect.left, event.clientY - rect.top);
    });
  }

  // Shows `src` at `view` (or the whole map). The same picture again just moves to the view.
  show(src, view) {
    this.view = this.clamp({ x: 0.5, y: 0.5, z: 1, ...(view || {}) });
    if (this.img.getAttribute('src') !== src) {
      this.loaded = false;
      this.img.style.visibility = 'hidden';
      this.img.src = src;
    } else this.draw();
  }

  w() { return this.img.naturalWidth || 1; }
  h() { return this.img.naturalHeight || 1; }
  fit() { return Math.min(this.box.clientWidth / this.w(), this.box.clientHeight / this.h()) || 1; }
  scale() { return this.fit() * this.view.z; }
  // Closest zoom: the whole map in view. Furthest: two screen pixels per image pixel.
  maxZ() { return Math.max(1, 2 / this.fit()); }

  clamp(view) {
    const z = Math.min(this.loaded ? this.maxZ() : 64, Math.max(1, Number(view.z) || 1));
    const at = (n) => Math.min(1, Math.max(0, Number.isFinite(Number(n)) ? Number(n) : 0.5));
    return { x: at(view.x), y: at(view.y), z };
  }

  set(view) { this.view = this.clamp(view); this.draw(); }

  // One step in (1) or out (-1) around a point in the box (its middle when not given).
  zoom(direction, px = this.box.clientWidth / 2, py = this.box.clientHeight / 2) {
    if (!this.loaded) return;
    const before = this.scale();
    const z = this.clamp({ ...this.view, z: this.view.z * (direction > 0 ? 1.25 : 0.8) }).z;
    const after = this.fit() * z;
    // Keep the image point under the pointer where it is.
    const dx = px - this.box.clientWidth / 2, dy = py - this.box.clientHeight / 2;
    const x = this.view.x + dx / (before * this.w()) - dx / (after * this.w());
    const y = this.view.y + dy / (before * this.h()) - dy / (after * this.h());
    this.set({ x, y, z });
    this.changed();
  }

  draw() {
    if (!this.loaded) return;
    const s = this.scale();
    const left = this.box.clientWidth / 2 - this.view.x * this.w() * s;
    const top = this.box.clientHeight / 2 - this.view.y * this.h() * s;
    this.img.style.transform = `translate(${left}px, ${top}px) scale(${s})`;
    this.img.style.visibility = '';
  }

  changed() {
    const round = (n) => Math.round(n * 10000) / 10000;
    this.onView({ x: round(this.view.x), y: round(this.view.y), z: round(this.view.z) });
  }
}
