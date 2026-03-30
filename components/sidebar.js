/**
 * sidebar.js — Collapsible animated sidebar with tooltip support
 */
export class Sidebar extends EventTarget {
    constructor(el, toggleEl) {
        super();
        this._el = el;
        this._toggle = toggleEl;
        this._expanded = true;
        this._activeKey = 'home';

        this._toggle.addEventListener('click', () => this.toggle());

        // Nav item clicks
        el.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                const key = item.dataset.view;
                this.navigateTo(key);
                this.dispatchEvent(new CustomEvent('page-change', { detail: { key } }));
            });
        });
    }

    toggle() {
        this._expanded = !this._expanded;
        this._el.classList.toggle('collapsed', !this._expanded);
        this._el.classList.toggle('expanded', this._expanded);
    }

    expand() { this._expanded = true; this._el.classList.remove('collapsed'); this._el.classList.add('expanded'); }
    collapse() { this._expanded = false; this._el.classList.add('collapsed'); this._el.classList.remove('expanded'); }

    navigateTo(key) {
        this._activeKey = key;
        this._el.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === key);
        });
    }
}
