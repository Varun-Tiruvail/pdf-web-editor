/**
 * organize-view.js v2.1 — Drag-drop page organizer
 * NOW: "Save Reordered PDF" uses pdf-lib to produce a real downloadable PDF
 * with current order, rotations, and deleted pages applied.
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showConfirm, showAlert } from '../components/modal.js';

export class OrganizeView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._pages = [];
        this._selected = new Set();
        this._dragSrc = null;
        this._render();
        this._bindEngine();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Organize Pages</h2>
        <p>Drag thumbnails to reorder · Click to select · Ctrl+click for multi-select</p>
      </div>

      <!-- Action Bar -->
      <div class="action-bar">
        <button class="btn" id="org-rotate-l" title="Rotate 90° left">↺ Rotate L</button>
        <button class="btn" id="org-rotate-r" title="Rotate 90° right">↻ Rotate R</button>
        <button class="btn danger" id="org-delete" title="Delete selected pages">Delete</button>
        <button class="btn" id="org-insert" title="Insert blank page after selection">+ Blank</button>
        <button class="btn" id="org-duplicate" title="Duplicate selected page">⊕ Duplicate</button>
        <button class="btn" id="org-extract" title="Extract selected pages as PDF">Extract PDF</button>
        <div class="divider-v"></div>
        <label style="font-size:11px;color:var(--text-muted)">Move to:</label>
        <input type="number" id="org-move-to" value="1" min="1"
               style="width:54px" placeholder="Page #"/>
        <button class="btn sm" id="org-go">Go</button>
        <div class="divider-v"></div>
        <button class="btn primary" id="org-save-pdf" title="Download reordered PDF (pdf-lib)" style="gap:4px">
          ⬇ Save PDF
        </button>
        <div style="margin-left:auto;font-size:11px;color:var(--text-muted)" id="org-status">
          Open a PDF to organise pages
        </div>
      </div>

      <!-- Page Grid -->
      <div class="organize-pages-grid" id="org-grid"></div>
    `;

        this._bindActions();
    }

    _bindActions() {
        const el = this._el;
        el.querySelector('#org-rotate-l').addEventListener('click', () => this._rotateSelected(-90));
        el.querySelector('#org-rotate-r').addEventListener('click', () => this._rotateSelected(90));
        el.querySelector('#org-delete').addEventListener('click', () => this._deleteSelected());
        el.querySelector('#org-insert').addEventListener('click', () => this._insertBlank());
        el.querySelector('#org-duplicate').addEventListener('click', () => this._duplicate());
        el.querySelector('#org-extract').addEventListener('click', () => this._extractSelected());
        el.querySelector('#org-save-pdf').addEventListener('click', () => this._savePDF());
        el.querySelector('#org-go').addEventListener('click', () => {
            const target = parseInt(el.querySelector('#org-move-to').value);
            this._moveTo(target);
        });
    }

    _bindEngine() {
        pdfEngine.addEventListener('doc-opened', () => this._loadPages());
        pdfEngine.addEventListener('doc-closed', () => this._clearPages());
    }

    async _loadPages() {
        if (!pdfEngine.isOpen()) return;
        this._pages = Array.from({ length: pdfEngine.pageCount }, (_, i) => ({ num: i + 1, rotation: 0 }));
        this._selected.clear();
        this._el.querySelector('#org-move-to').max = pdfEngine.pageCount;
        await this._renderGrid();
        this._setStatus(`${pdfEngine.pageCount} pages`);
    }

    _clearPages() {
        this._pages = [];
        this._selected.clear();
        this._el.querySelector('#org-grid').innerHTML = '';
        this._setStatus('Open a PDF to organise pages');
    }

    async _renderGrid() {
        const grid = this._el.querySelector('#org-grid');
        grid.innerHTML = '';

        for (let i = 0; i < this._pages.length; i++) {
            const p = this._pages[i];
            const card = document.createElement('div');
            card.className = 'org-page-card';
            card.draggable = true;
            card.dataset.idx = i;
            card.innerHTML = `
        <div class="org-page-badge">✓</div>
        <canvas class="org-thumb" width="90" height="126"></canvas>
        <div class="org-page-num">Page ${i + 1}</div>
      `;
            if (this._selected.has(i)) card.classList.add('selected');

            // Thumbnail
            const canvas = card.querySelector('.org-thumb');
            pdfEngine.renderThumbnail(p.num, 90).then(th => {
                if (!th) return;
                const ctx = canvas.getContext('2d');
                canvas.width = th.width;
                canvas.height = th.height;
                // Apply rotation
                const deg = p.rotation;
                if (deg !== 0) {
                    ctx.save();
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate(deg * Math.PI / 180);
                    ctx.drawImage(th, -th.width / 2, -th.height / 2);
                    ctx.restore();
                } else {
                    ctx.drawImage(th, 0, 0);
                }
                // Resize visual
                canvas.style.width = '90px';
                canvas.style.height = Math.round(th.height * 90 / th.width) + 'px';
            });

            // Select
            card.addEventListener('click', e => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) this._selected.clear();
                if (this._selected.has(i)) this._selected.delete(i);
                else this._selected.add(i);
                this._refreshSelection();
            });

            // Right-click context
            card.addEventListener('contextmenu', e => {
                e.preventDefault();
                if (!this._selected.has(i)) { this._selected.clear(); this._selected.add(i); this._refreshSelection(); }
                this._showContextMenu(e.clientX, e.clientY);
            });

            // Drag-to-reorder
            card.addEventListener('dragstart', e => {
                this._dragSrc = i;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
            card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
            card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
            card.addEventListener('drop', e => {
                e.preventDefault();
                card.classList.remove('drag-over');
                if (this._dragSrc === null || this._dragSrc === i) return;
                const moved = this._pages.splice(this._dragSrc, 1)[0];
                this._pages.splice(i, 0, moved);
                this._dragSrc = null;
                this._selected.clear();
                this._renderGrid();
                toast('Page reordered', 'success');
            });

            grid.appendChild(card);
        }
    }

    _refreshSelection() {
        this._el.querySelectorAll('.org-page-card').forEach((c, i) => {
            c.classList.toggle('selected', this._selected.has(i));
        });
    }

    _rotateSelected(deg) {
        if (!this._selected.size) { toast('Select one or more pages first', 'info'); return; }
        this._selected.forEach(i => { this._pages[i].rotation = (this._pages[i].rotation + deg + 360) % 360; });
        this._renderGrid();
        toast(`Rotated ${this._selected.size} page(s) ${deg > 0 ? 'right' : 'left'}`, 'success');
    }

    _deleteSelected() {
        if (!this._selected.size) { toast('Select pages to delete', 'info'); return; }
        showConfirm('Delete Pages',
            `Permanently delete ${this._selected.size} page(s) from this session?`,
            () => {
                const keep = this._pages.filter((_, i) => !this._selected.has(i));
                this._pages = keep;
                this._selected.clear();
                this._renderGrid();
                this._setStatus(`${this._pages.length} pages`);
                toast(`${keep.length} pages remain`, 'success');
            });
    }

    _insertBlank() {
        const after = this._selected.size ? Math.max(...this._selected) : this._pages.length - 1;
        this._pages.splice(after + 1, 0, { num: 0, rotation: 0, blank: true });
        this._selected.clear();
        this._renderGrid();
        toast('Blank page inserted', 'success');
    }

    _duplicate() {
        if (!this._selected.size) { toast('Select a page to duplicate', 'info'); return; }
        const idx = Math.max(...this._selected);
        const copy = { ...this._pages[idx] };
        this._pages.splice(idx + 1, 0, copy);
        this._renderGrid();
        toast('Page duplicated', 'success');
    }

    async _extractSelected() {
        if (!this._selected.size) { toast('Select pages to extract', 'info'); return; }
        const rawBytes = pdfEngine._rawBytes;
        if (!rawBytes) { toast('Re-open the PDF to enable PDF extraction', 'info'); return; }
        try {
            const { PDFDocument } = window.PDFLib;
            const src    = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
            const newDoc = await PDFDocument.create();
            const selIndices = [...this._selected]
                .map(i => this._pages[i])
                .filter(p => p && !p.blank)
                .map(p => p.num - 1);
            const pages = await newDoc.copyPages(src, selIndices);
            pages.forEach(p => newDoc.addPage(p));
            const bytes = await newDoc.save();
            const blob  = new Blob([bytes], { type: 'application/pdf' });
            const url   = URL.createObjectURL(blob);
            const a     = document.createElement('a');
            a.href     = url;
            a.download = `${pdfEngine.fileName.replace('.pdf','')}-extracted-${this._selected.size}pages.pdf`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            toast(`✅ ${this._selected.size} page(s) extracted as PDF`, 'success');
        } catch (err) {
            showAlert('Extract Failed', err.message);
        }
    }

    _moveTo(target) {
        if (!this._selected.size) { toast('Select a page to move', 'info'); return; }
        const from = Math.min(...this._selected);
        const to = Math.max(0, Math.min(this._pages.length - 1, target - 1));
        const moved = this._pages.splice(from, 1)[0];
        this._pages.splice(to, 0, moved);
        this._selected.clear();
        this._selected.add(to);
        this._renderGrid();
        this._refreshSelection();
        toast(`Page moved to position ${target}`, 'success');
    }

    // ── Save reordered PDF using pdf-lib ───────────────────────────────────
    async _savePDF() {
        if (!pdfEngine.isOpen()) { toast('No PDF open', 'info'); return; }
        const rawBytes = pdfEngine._rawBytes;
        if (!rawBytes) { toast('Re-open the PDF to enable save', 'info'); return; }
        if (!window.PDFLib) { showAlert('Error', 'pdf-lib not loaded — check your internet connection'); return; }
        try {
            toast('Building reordered PDF…', 'info', 4000);
            const { PDFDocument, degrees } = window.PDFLib;
            const src    = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
            const newDoc = await PDFDocument.create();
            const realPages = this._pages.filter(p => !p.blank);
            if (!realPages.length) { toast('No pages left to save', 'info'); return; }
            const srcIndices = realPages.map(p => p.num - 1);
            const copied = await newDoc.copyPages(src, srcIndices);
            copied.forEach((page, i) => {
                newDoc.addPage(page);
                const rot = realPages[i].rotation;
                if (rot !== 0) page.setRotation(degrees(rot));
            });
            const bytes = await newDoc.save();
            const blob  = new Blob([bytes], { type: 'application/pdf' });
            const url   = URL.createObjectURL(blob);
            const a     = document.createElement('a');
            a.href     = url;
            a.download = pdfEngine.fileName.replace('.pdf', '') + '-reordered.pdf';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            toast(`✅ ${realPages.length}-page PDF saved!`, 'success');
        } catch (err) {
            showAlert('Save Failed', err.message);
        }
    }

    _showContextMenu(x, y) {
        const cm = document.getElementById('context-menu');
        cm.innerHTML = `
      <li class="ctx-item" data-action="rotate-l">↺ Rotate Left</li>
      <li class="ctx-item" data-action="rotate-r">↻ Rotate Right</li>
      <li class="ctx-sep"></li>
      <li class="ctx-item" data-action="duplicate">⊕ Duplicate</li>
      <li class="ctx-item" data-action="insert">+ Insert Blank After</li>
      <li class="ctx-sep"></li>
      <li class="ctx-item danger" data-action="delete">🗑 Delete Page</li>
    `;
        cm.style.left = x + 'px'; cm.style.top = y + 'px';
        cm.classList.remove('hidden');
        const actions = {
            'rotate-l': () => this._rotateSelected(-90),
            'rotate-r': () => this._rotateSelected(90),
            'duplicate': () => this._duplicate(),
            'insert': () => this._insertBlank(),
            'delete': () => this._deleteSelected()
        };
        cm.querySelectorAll('[data-action]').forEach(item => {
            item.addEventListener('click', () => { actions[item.dataset.action]?.(); cm.classList.add('hidden'); });
        });
        setTimeout(() => document.addEventListener('click', () => cm.classList.add('hidden'), { once: true }), 0);
    }

    _setStatus(msg) {
        const s = this._el.querySelector('#org-status');
        if (s) s.textContent = msg;
    }

    onViewActivated() {
        if (pdfEngine.isOpen() && !this._pages.length) this._loadPages();
    }
}
