/**
 * search-view.js — Full-text search across all PDF pages (EXTRA FEATURE)
 * Real-time search with highlighted results, click-to-navigate
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast } from '../components/modal.js';

export class SearchView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._results = [];
        this._searchTimer = null;
        this._render();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Search in Document</h2>
        <p>Find text across all pages — click a result to navigate</p>
      </div>

      <div class="action-bar">
        <input type="text" id="search-input" placeholder="Search text… (Ctrl+F)" style="flex:1;max-width:400px"/>
        <select id="search-case" style="width:130px">
          <option value="insensitive">Case Insensitive</option>
          <option value="sensitive">Case Sensitive</option>
        </select>
        <button class="btn primary" id="search-go">Search</button>
        <button class="btn" id="search-clear">Clear</button>
        <span id="search-count" style="font-size:11px;color:var(--text-muted);margin-left:8px"></span>
      </div>

      <!-- Progress -->
      <div id="search-progress" class="hidden" style="padding:8px 16px">
        <div style="height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden">
          <div id="search-prog-bar" style="height:100%;background:var(--copper);width:0%;transition:width 200ms"></div>
        </div>
      </div>

      <!-- Results -->
      <div id="search-results" class="search-body flex-1" style="display:flex;flex-direction:column;gap:0">
        <div style="color:var(--text-disabled);text-align:center;padding:40px">
          Enter a search query above
        </div>
      </div>
    `;

        this._bindEvents();
    }

    _bindEvents() {
        const el = this._el;
        const input = el.querySelector('#search-input');

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') this._search();
        });
        input.addEventListener('input', () => {
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(() => {
                if (input.value.length >= 2) this._search();
            }, 600);
        });
        el.querySelector('#search-go').addEventListener('click', () => this._search());
        el.querySelector('#search-clear').addEventListener('click', () => {
            input.value = '';
            this._results = [];
            el.querySelector('#search-results').innerHTML = '<div style="color:var(--text-disabled);text-align:center;padding:40px">Enter a search query above</div>';
            el.querySelector('#search-count').textContent = '';
        });
    }

    async _search() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const query = this._el.querySelector('#search-input').value.trim();
        if (!query) return;

        const results = this._el.querySelector('#search-results');
        const prog = this._el.querySelector('#search-progress');
        const count = this._el.querySelector('#search-count');
        const bar = this._el.querySelector('#search-prog-bar');

        results.innerHTML = '<div class="list-item" style="color:var(--text-secondary)">Searching…</div>';
        prog.classList.remove('hidden');
        count.textContent = '';

        // Use pdf-engine search with progress
        const found = [];
        const q = this._el.querySelector('#search-case').value === 'sensitive' ? query : query;
        const isCS = this._el.querySelector('#search-case').value === 'sensitive';
        const totalPages = pdfEngine.pageCount;

        for (let p = 1; p <= totalPages; p++) {
            bar.style.width = Math.round(p / totalPages * 100) + '%';
            try {
                const content = await pdfEngine.getTextContent(p);
                const pageText = content.items.map(it => it.str).join(' ');
                const lower = isCS ? pageText : pageText.toLowerCase();
                const qLower = isCS ? query : query.toLowerCase();
                let idx = 0;
                while ((idx = lower.indexOf(qLower, idx)) !== -1) {
                    const start = Math.max(0, idx - 60);
                    const end = Math.min(pageText.length, idx + qLower.length + 60);
                    found.push({ page: p, matchStart: idx - start, matchEnd: idx - start + qLower.length, context: pageText.substring(start, end) });
                    idx += qLower.length;
                    if (found.length >= 300) break;
                }
            } catch { /* page error */ }
        }

        prog.classList.add('hidden');
        bar.style.width = '0%';
        this._results = found;

        if (!found.length) {
            results.innerHTML = `<div style="color:var(--text-disabled);text-align:center;padding:40px">No results for "<strong>${query}</strong>"</div>`;
            count.textContent = 'No results';
            return;
        }

        count.textContent = `${found.length} result(s)${found.length >= 300 ? ' (limited)' : ''}`;
        results.innerHTML = '';

        let lastPage = null;
        found.forEach(r => {
            if (r.page !== lastPage) {
                const pageHdr = document.createElement('div');
                pageHdr.style.cssText = 'padding:6px 14px;background:var(--bg-surface);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--copper);letter-spacing:0.8px;text-transform:uppercase';
                pageHdr.textContent = `Page ${r.page}`;
                results.appendChild(pageHdr);
                lastPage = r.page;
            }
            const item = document.createElement('div');
            item.className = 'search-result-item';
            const before = r.context.substring(0, r.matchStart);
            const match = r.context.substring(r.matchStart, r.matchEnd);
            const after = r.context.substring(r.matchEnd);
            item.innerHTML = `<div class="search-result-text">…${this._esc(before)}<mark>${this._esc(match)}</mark>${this._esc(after)}…</div>`;
            item.addEventListener('click', () => {
                this._app.switchView('editor');
                this._app.editorView?._goPage(r.page);
                toast(`Page ${r.page}`, 'info');
            });
            results.appendChild(item);
        });
    }

    _esc(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    focus() {
        setTimeout(() => this._el.querySelector('#search-input')?.focus(), 100);
    }
}
