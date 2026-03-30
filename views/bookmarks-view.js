/**
 * bookmarks-view.js — Bookmarks & Table of Contents View
 * TOC from PDF outline, personal bookmarks in localStorage
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast } from '../components/modal.js';

const BM_KEY = 'pdfeditor_bookmarks';

export class BookmarksView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._render();
        this._bindEngine();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Bookmarks & Table of Contents</h2>
        <p>Navigate document structure or manage personal bookmarks</p>
      </div>

      <div class="tabs-header">
        <button class="tab-btn active" data-tab="toc">Table of Contents</button>
        <button class="tab-btn" data-tab="bookmarks">Personal Bookmarks</button>
      </div>

      <!-- TOC Tab -->
      <div class="tab-panel active flex-col" data-panel="toc" style="padding:0">
        <div class="action-bar" style="flex-shrink:0">
          <button class="btn primary" id="toc-load">Load TOC from PDF</button>
          <button class="btn" id="toc-expand">Expand All</button>
          <button class="btn" id="toc-collapse">Collapse All</button>
          <span id="toc-count" style="font-size:11px;color:var(--text-muted);margin-left:auto"></span>
        </div>
        <div class="toc-tree flex-1" id="toc-tree">
          <div class="toc-item" style="color:var(--text-disabled)">Load a PDF or click "Load TOC" to see the document outline</div>
        </div>
      </div>

      <!-- Bookmarks Tab -->
      <div class="tab-panel flex-col" data-panel="bookmarks" style="padding:0">
        <!-- Add Bookmark -->
        <div class="action-bar" style="flex-shrink:0;flex-wrap:wrap;gap:6px">
          <label style="font-size:12px;color:var(--text-secondary)">Page:</label>
          <input type="number" id="bm-page" value="1" min="1" style="width:60px"/>
          <label style="font-size:12px;color:var(--text-secondary)">Label:</label>
          <input type="text" id="bm-label" placeholder="Bookmark name…" style="width:200px"/>
          <button class="btn primary" id="bm-add">Add</button>
          <button class="btn danger" id="bm-delete" style="margin-left:auto">Delete Selected</button>
          <button class="btn" id="bm-export">Export JSON</button>
        </div>

        <div class="list-widget flex-1" id="bm-list" style="max-height:none;flex:1;border-radius:0;border:none;border-top:1px solid var(--border)">
          <div class="list-item" style="color:var(--text-disabled)">No bookmarks yet</div>
        </div>
      </div>
    `;

        this._bindTabs();
        this._bindActions();
        this._loadBookmarks();
    }

    _bindTabs() {
        this._el.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._el.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                this._el.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                this._el.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.add('active');
            });
        });
    }

    _bindEngine() {
        pdfEngine.addEventListener('doc-opened', () => this._autoLoadToc());
    }

    async _autoLoadToc() {
        await this._loadToc();
        // Set bookmark page max
        const bmp = this._el.querySelector('#bm-page');
        if (bmp) bmp.max = pdfEngine.pageCount;
    }

    async _loadToc() {
        if (!pdfEngine.isOpen()) return;
        const tree = this._el.querySelector('#toc-tree');
        const count = this._el.querySelector('#toc-count');
        tree.innerHTML = '';
        try {
            const outline = await pdfEngine.getOutline();
            if (!outline || !outline.length) {
                tree.innerHTML = '<div class="toc-item" style="color:var(--text-disabled)">This document has no table of contents</div>';
                count.textContent = '';
                return;
            }
            let total = 0;
            const addItems = async (items, level = 1) => {
                for (const item of items) {
                    total++;
                    const div = document.createElement('div');
                    div.className = `toc-item level-${Math.min(level, 3)}`;
                    div.style.paddingLeft = (8 + (level - 1) * 16) + 'px';
                    div.innerHTML = `<span>${item.title}</span>`;
                    // Resolve destination
                    div.addEventListener('click', async () => {
                        const pageNum = await pdfEngine.resolveDestination(item.dest);
                        if (pageNum) {
                            this._app.switchView('editor');
                            this._app.editorView?._goPage(pageNum);
                            toast(`Navigating to page ${pageNum}`, 'info');
                        }
                    });
                    tree.appendChild(div);
                    if (item.items?.length) await addItems(item.items, level + 1);
                }
            };
            await addItems(outline);
            count.textContent = `${total} entries`;
        } catch (e) {
            tree.innerHTML = `<div class="toc-item" style="color:var(--text-disabled)">Could not load outline: ${e.message}</div>`;
        }
    }

    _bindActions() {
        const el = this._el;
        el.querySelector('#toc-load').addEventListener('click', () => {
            if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
            this._loadToc();
        });
        el.querySelector('#toc-expand').addEventListener('click', () => {
            el.querySelectorAll('.toc-item').forEach(i => i.style.display = 'flex');
        });
        el.querySelector('#toc-collapse').addEventListener('click', () => {
            el.querySelectorAll('.toc-item.level-2,.toc-item.level-3').forEach(i => i.style.display = 'none');
        });

        // Bookmark add
        el.querySelector('#bm-add').addEventListener('click', () => {
            const page = parseInt(el.querySelector('#bm-page').value);
            const label = el.querySelector('#bm-label').value.trim() || `Bookmark — Page ${page}`;
            this._addBookmark(page, label);
            el.querySelector('#bm-label').value = '';
        });
        el.querySelector('#bm-label').addEventListener('keydown', e => {
            if (e.key === 'Enter') el.querySelector('#bm-add').click();
        });

        // Delete selected
        el.querySelector('#bm-delete').addEventListener('click', () => {
            const sel = el.querySelector('#bm-list .list-item.selected');
            if (!sel) { toast('Select a bookmark first', 'info'); return; }
            const idx = parseInt(sel.dataset.idx);
            let bms = this._getBookmarks();
            bms.splice(idx, 1);
            localStorage.setItem(BM_KEY, JSON.stringify(bms));
            this._loadBookmarks();
            toast('Bookmark deleted', 'success');
        });

        // Export
        el.querySelector('#bm-export').addEventListener('click', () => {
            const data = this._getBookmarks();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'bookmarks.json'; a.click();
            toast('Bookmarks exported', 'success');
        });
    }

    _addBookmark(page, label) {
        const bms = this._getBookmarks();
        bms.push({ page, label, ts: Date.now() });
        localStorage.setItem(BM_KEY, JSON.stringify(bms));
        this._loadBookmarks();
        toast(`Bookmark added: ${label}`, 'success');
    }

    _getBookmarks() {
        try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]'); }
        catch { return []; }
    }

    _loadBookmarks() {
        const list = this._el.querySelector('#bm-list');
        const bms = this._getBookmarks();
        if (!bms.length) {
            list.innerHTML = '<div class="list-item" style="color:var(--text-disabled)">No bookmarks yet — add one above</div>';
            return;
        }
        list.innerHTML = '';
        bms.forEach((bm, i) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.dataset.idx = i;
            const date = new Date(bm.ts).toLocaleDateString();
            item.innerHTML = `
        <span class="nav-icon" style="font-size:12px;color:var(--copper)">◉</span>
        <span style="flex:1;font-weight:500">${bm.label}</span>
        <span style="font-size:10px;color:var(--copper);font-weight:600">p.${bm.page}</span>
        <span style="font-size:10px;color:var(--text-disabled);margin-left:8px">${date}</span>
      `;
            item.addEventListener('click', () => {
                list.querySelectorAll('.list-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            });
            item.addEventListener('dblclick', () => {
                this._app.switchView('editor');
                this._app.editorView?._goPage(bm.page);
                toast(`Navigating to page ${bm.page}`, 'info');
            });
            list.appendChild(item);
        });
    }

    onViewActivated() { this._loadBookmarks(); }
}
