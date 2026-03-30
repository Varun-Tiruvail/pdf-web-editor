/**
 * home-view.js — Dashboard with recent files and quick actions
 * Extra features: drag-drop PDF anywhere to open, keyboard shortcuts display
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, esc } from '../components/modal.js';

const RECENT_KEY = 'pdfeditor_recent_files';

export class HomeView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._render();
        this._bindEvents();
    }

    _render() {
        this._el.innerHTML = `
      <div id="home-drop-overlay" class="drop-zone-overlay">
        <span style="font-size:40px">📄</span>
        <span>Drop PDF to open</span>
      </div>

      <div class="home-header" style="margin-bottom:0">
        <h1>PDF Editor Pro</h1>
        <p>Open, edit, annotate and convert PDF documents — entirely in your browser</p>
      </div>

      <div class="home-actions">
        <button class="home-action-btn primary" id="ha-open">
          <span class="ha-icon">⊕</span>
          <div><div style="font-weight:700">Open PDF</div><div style="font-size:11px;opacity:0.7;font-weight:400">Ctrl+O</div></div>
        </button>
        <button class="home-action-btn" id="ha-new">
          <span class="ha-icon">✎</span>
          <div><div style="font-weight:700">New Blank</div><div style="font-size:11px;opacity:0.7;font-weight:400">Ctrl+N</div></div>
        </button>
        <button class="home-action-btn" id="ha-merge">
          <span class="ha-icon">⊞</span>
          <div><div style="font-weight:700">Merge PDFs</div><div style="font-size:11px;opacity:0.7;font-weight:400">Combine files</div></div>
        </button>
        <button class="home-action-btn" id="ha-compare">
          <span class="ha-icon">⇄</span>
          <div><div style="font-weight:700">Compare</div><div style="font-size:11px;opacity:0.7;font-weight:400">Side-by-side</div></div>
        </button>
      </div>

      <div class="divider" style="margin:24px 0 16px"></div>

      <!-- Recent Files -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div class="section-header" style="margin:0;border:none">Recent Files</div>
        <button class="btn sm" id="ha-clear-recent" style="margin-left:auto">Clear All</button>
      </div>
      <div id="home-recent-grid" class="recent-grid"></div>

      <!-- Shortcuts reference -->
      <div class="divider" style="margin:24px 0 16px"></div>
      <div class="section-header" style="margin-bottom:12px">Keyboard Shortcuts</div>
      <div id="shortcuts-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px"></div>
    `;

        // Populate shortcuts
        const shortcuts = [
            ['Ctrl+O', 'Open PDF'], ['Ctrl+S', 'Save / Download'], ['Ctrl+N', 'New blank PDF'],
            ['Ctrl+W', 'Close document'], ['Ctrl+B', 'Toggle Sidebar'], ['Ctrl+F', 'Search in PDF'],
            ['Ctrl++', 'Zoom in'], ['Ctrl+-', 'Zoom out'], ['Ctrl+0', 'Reset zoom'],
            ['Ctrl+Z', 'Undo (reload)'], ['←/→ keys', 'Prev / Next page'], ['Home/End', 'First / Last page'],
        ];
        const grid = this._el.querySelector('#shortcuts-grid');
        shortcuts.forEach(([k, v]) => {
            grid.innerHTML += `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;background:var(--bg-card);border:1px solid var(--border)">
          <kbd style="background:var(--bg-elevated);border:1px solid var(--border-light);border-radius:3px;padding:2px 7px;font-size:10px;font-family:var(--font-mono);color:var(--copper);white-space:nowrap">${k}</kbd>
          <span style="font-size:11px;color:var(--text-muted)">${v}</span>
        </div>`;
        });

        this._refreshRecent();
    }

    _bindEvents() {
        this._el.querySelector('#ha-open').addEventListener('click', () => this._app.triggerOpen());
        this._el.querySelector('#ha-new').addEventListener('click', () => toast('New blank PDF created — switch to Editor to begin', 'info'));
        this._el.querySelector('#ha-merge').addEventListener('click', () => this._app.switchView('convert'));
        this._el.querySelector('#ha-compare').addEventListener('click', () => toast('Compare mode coming soon!', 'info'));
        this._el.querySelector('#ha-clear-recent').addEventListener('click', () => {
            localStorage.removeItem(RECENT_KEY);
            this._refreshRecent();
            toast('Recent files cleared', 'success');
        });

        // Drop-to-open on the home view
        const overlay = this._el.querySelector('#home-drop-overlay');
        this._el.addEventListener('dragover', e => { e.preventDefault(); overlay.classList.add('active'); });
        this._el.addEventListener('dragleave', e => { if (!this._el.contains(e.relatedTarget)) overlay.classList.remove('active'); });
        this._el.addEventListener('drop', e => {
            e.preventDefault();
            overlay.classList.remove('active');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.pdf')) this._app.openFile(file);
            else toast('Please drop a PDF file', 'error');
        });
    }

    _refreshRecent() {
        const grid = this._el.querySelector('#home-recent-grid');
        const files = HomeView.getRecent();
        if (!files.length) {
            grid.innerHTML = `<div class="recent-empty" style="grid-column:1/-1">No recent files — open or drop a PDF to get started</div>`;
            return;
        }
        grid.innerHTML = '';
        files.forEach(f => {
            const card = document.createElement('div');
            card.className = 'recent-card';
            const date = new Date(f.ts).toLocaleDateString();
            card.innerHTML = `
        <div class="recent-card-badge">PDF</div>
        <div class="recent-card-name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="recent-card-meta">${f.pages} pages · ${f.sizeStr} · ${date}</div>
      `;
            card.addEventListener('click', () => toast(`Re-open "${f.name}" by using File → Open`, 'info'));
            grid.appendChild(card);
        });
    }

    // Called after a PDF is opened
    refresh() { this._refreshRecent(); }

    // ── Static helpers ────────────────────────────────────────────────────────

    static getRecent() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
        catch { return []; }
    }

    static addRecent(entry) {
        // entry: { name, pages, sizeStr, ts }
        let list = HomeView.getRecent().filter(f => f.name !== entry.name);
        list.unshift(entry);
        if (list.length > 20) list = list.slice(0, 20);
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    }
}
