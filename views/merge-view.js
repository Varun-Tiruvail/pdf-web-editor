/**
 * merge-view.js — Merge PDFs (Simple + Header-Based)
 * Ported from OLDPDFEditor merge_simple + merge_with_headers
 * Uses pdf-lib client-side for actual merging.
 */
import { toast, showAlert } from '../components/modal.js';

export class MergeView {
    constructor(container, app) {
        this._el = container;
        this._app = app;

        // Simple merge state
        this._simplePdfs = [];        // [{file, name, bytes, pageCount}]
        this._simplePageOrder = [];   // [{pdfIdx, pageIdx, thumbCanvas}]

        // Header-based merge state
        this._basePdf = null;         // {file, name, bytes, pageCount}
        this._headerMarks = [];       // [{pageIdx, label}]
        this._headerInserts = {};     // {pageIdx: [bytes]}
        this._headerStep = 1;

        this._render();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Merge PDFs</h2>
        <p>Combine multiple PDFs — simple page rearranging or header-based insertion</p>
      </div>

      <div class="tabs-header">
        <button class="tab-btn active" data-tab="simple-merge">Simple Merge</button>
        <button class="tab-btn" data-tab="header-merge">Header-Based Merge</button>
      </div>

      <!-- ─── SIMPLE MERGE ──────────────────────────────────────────── -->
      <div class="tab-panel active merge-body" data-panel="simple-merge">
        <div class="merge-layout">
          <div class="merge-left-panel">
            <div class="group-box">
              <div class="group-box-title">1. Add PDFs</div>
              <div id="simple-pdf-list" class="merge-file-list"></div>
              <div style="display:flex;gap:6px;margin-top:8px">
                <button class="btn primary" id="simple-add-btn">+ Add PDFs</button>
                <button class="btn" id="simple-load-pages">Load Pages →</button>
              </div>
              <input type="file" id="simple-file-input" accept=".pdf" multiple style="display:none"/>
            </div>
          </div>
          <div class="merge-right-panel">
            <div class="group-box">
              <div class="group-box-title">2. Arrange Pages</div>
              <div id="simple-page-grid" class="merge-thumb-grid"></div>
              <div style="display:flex;gap:6px;margin-top:8px">
                <button class="btn" id="simple-move-up">▲ Up</button>
                <button class="btn" id="simple-move-down">▼ Down</button>
                <button class="btn primary" id="simple-merge-btn" style="margin-left:auto">⬇ Merge & Download</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── HEADER-BASED MERGE ────────────────────────────────────── -->
      <div class="tab-panel merge-body" data-panel="header-merge">
        <div class="merge-wizard">
          <!-- Step indicators -->
          <div class="merge-steps-bar">
            <div class="merge-step-dot active" data-step="1">1</div>
            <div class="merge-step-line"></div>
            <div class="merge-step-dot" data-step="2">2</div>
            <div class="merge-step-line"></div>
            <div class="merge-step-dot" data-step="3">3</div>
          </div>

          <div id="hm-step-1" class="hm-step">
            <div class="group-box">
              <div class="group-box-title">Step 1: Select Base PDF</div>
              <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
                This PDF contains the header/section divider pages.
              </p>
              <div id="hm-base-label" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">No PDF selected</div>
              <button class="btn primary" id="hm-select-base">Browse…</button>
              <input type="file" id="hm-base-input" accept=".pdf" style="display:none"/>
            </div>
          </div>

          <div id="hm-step-2" class="hm-step" style="display:none">
            <div class="group-box">
              <div class="group-box-title">Step 2: Mark Header Pages</div>
              <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
                Click on page thumbnails to mark them as headers. Name each header section.
              </p>
              <div id="hm-page-grid" class="merge-thumb-grid"></div>
            </div>
          </div>

          <div id="hm-step-3" class="hm-step" style="display:none">
            <div class="group-box">
              <div class="group-box-title">Step 3: Insert PDFs After Headers</div>
              <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
                For each header, add the PDFs that should follow it.
              </p>
              <div id="hm-insert-sections"></div>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn" id="hm-back" style="display:none">◀ Back</button>
            <button class="btn primary" id="hm-next">Next ▶</button>
            <button class="btn primary" id="hm-merge-btn" style="display:none;margin-left:auto">✓ Merge & Download</button>
          </div>
        </div>
      </div>
    `;

        this._bindTabs();
        this._bindSimpleMerge();
        this._bindHeaderMerge();
    }

    /* ── Tab switching ──────────────────────────────────────────────────── */
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

    /* ── Helper ──────────────────────────────────────────────────────────── */
    _downloadBlob(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    async _renderThumb(pdfBytes, pageIdx, targetWidth = 90) {
        const task = window.pdfjsLib.getDocument({ data: pdfBytes.slice() });
        const doc = await task.promise;
        const page = await doc.getPage(pageIdx + 1);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = targetWidth / vp0.width;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        doc.destroy();
        return canvas;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       SIMPLE MERGE
    ═══════════════════════════════════════════════════════════════════════ */
    _bindSimpleMerge() {
        const fileInput = this._el.querySelector('#simple-file-input');
        this._el.querySelector('#simple-add-btn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                const bytes = await file.arrayBuffer();
                const task = window.pdfjsLib.getDocument({ data: bytes.slice() });
                const doc = await task.promise;
                this._simplePdfs.push({ file, name: file.name, bytes, pageCount: doc.numPages });
                doc.destroy();
            }
            fileInput.value = '';
            this._renderSimplePdfList();
        });

        this._el.querySelector('#simple-load-pages').addEventListener('click', () => this._loadSimplePages());
        this._el.querySelector('#simple-move-up').addEventListener('click', () => this._moveSimplePage(-1));
        this._el.querySelector('#simple-move-down').addEventListener('click', () => this._moveSimplePage(1));
        this._el.querySelector('#simple-merge-btn').addEventListener('click', () => this._doSimpleMerge());
    }

    _renderSimplePdfList() {
        const list = this._el.querySelector('#simple-pdf-list');
        list.innerHTML = '';
        this._simplePdfs.forEach((pdf, i) => {
            const item = document.createElement('div');
            item.className = 'merge-file-item';
            item.innerHTML = `
                <span class="merge-file-name">${pdf.name}</span>
                <span class="merge-file-pages">${pdf.pageCount} pg</span>
                <button class="btn sm merge-file-remove" data-idx="${i}">✕</button>
            `;
            item.querySelector('.merge-file-remove').addEventListener('click', () => {
                this._simplePdfs.splice(i, 1);
                this._renderSimplePdfList();
            });
            list.appendChild(item);
        });
    }

    async _loadSimplePages() {
        if (!this._simplePdfs.length) { toast('Add PDFs first', 'info'); return; }
        toast('Loading page thumbnails…', 'info', 3000);

        this._simplePageOrder = [];
        const grid = this._el.querySelector('#simple-page-grid');
        grid.innerHTML = '';

        for (let pi = 0; pi < this._simplePdfs.length; pi++) {
            const pdf = this._simplePdfs[pi];
            for (let pg = 0; pg < pdf.pageCount; pg++) {
                const entry = { pdfIdx: pi, pageIdx: pg };
                this._simplePageOrder.push(entry);

                const card = document.createElement('div');
                card.className = 'merge-thumb-card';
                card.dataset.orderIdx = this._simplePageOrder.length - 1;
                card.innerHTML = `<div class="merge-thumb-label">${pdf.name}<br>P${pg + 1}</div>`;
                card.addEventListener('click', () => {
                    grid.querySelectorAll('.merge-thumb-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    this._selectedSimpleIdx = parseInt(card.dataset.orderIdx);
                });
                grid.appendChild(card);

                // Render thumbnail asynchronously
                this._renderThumb(pdf.bytes, pg, 80).then(canvas => {
                    canvas.className = 'merge-thumb-canvas';
                    card.insertBefore(canvas, card.firstChild);
                }).catch(() => { });
            }
        }
        toast(`${this._simplePageOrder.length} pages loaded`, 'success');
    }

    _moveSimplePage(dir) {
        if (this._selectedSimpleIdx == null) { toast('Select a page thumbnail first', 'info'); return; }
        const idx = this._selectedSimpleIdx;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= this._simplePageOrder.length) return;

        const tmp = this._simplePageOrder[idx];
        this._simplePageOrder[idx] = this._simplePageOrder[newIdx];
        this._simplePageOrder[newIdx] = tmp;

        // Re-render grid preserving selection
        this._selectedSimpleIdx = newIdx;
        this._rebuildSimpleGrid();
        toast('Page moved', 'success');
    }

    _rebuildSimpleGrid() {
        const grid = this._el.querySelector('#simple-page-grid');
        const cards = [...grid.children];
        // resort cards by _simplePageOrder
        grid.innerHTML = '';
        this._simplePageOrder.forEach((entry, i) => {
            const pdf = this._simplePdfs[entry.pdfIdx];
            const card = document.createElement('div');
            card.className = 'merge-thumb-card' + (i === this._selectedSimpleIdx ? ' selected' : '');
            card.dataset.orderIdx = i;
            card.innerHTML = `<div class="merge-thumb-label">${pdf.name}<br>P${entry.pageIdx + 1}</div>`;
            card.addEventListener('click', () => {
                grid.querySelectorAll('.merge-thumb-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this._selectedSimpleIdx = i;
            });
            grid.appendChild(card);

            this._renderThumb(pdf.bytes, entry.pageIdx, 80).then(canvas => {
                canvas.className = 'merge-thumb-canvas';
                card.insertBefore(canvas, card.firstChild);
            }).catch(() => { });
        });
    }

    async _doSimpleMerge() {
        if (!this._simplePageOrder.length) { toast('Load pages first', 'info'); return; }
        try {
            toast('Merging PDF…', 'info', 3000);
            const { PDFDocument } = window.PDFLib;
            const newDoc = await PDFDocument.create();
            const srcDocs = [];

            for (const pdf of this._simplePdfs) {
                srcDocs.push(await PDFDocument.load(pdf.bytes, { ignoreEncryption: true }));
            }

            for (const entry of this._simplePageOrder) {
                const [page] = await newDoc.copyPages(srcDocs[entry.pdfIdx], [entry.pageIdx]);
                newDoc.addPage(page);
            }

            const bytes = await newDoc.save();
            this._downloadBlob(bytes, 'merged.pdf');
            toast(`✅ Merged ${this._simplePageOrder.length} pages`, 'success');
        } catch (err) {
            showAlert('Merge Failed', err.message);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       HEADER-BASED MERGE (3-step wizard)
    ═══════════════════════════════════════════════════════════════════════ */
    _bindHeaderMerge() {
        const baseInput = this._el.querySelector('#hm-base-input');
        this._el.querySelector('#hm-select-base').addEventListener('click', () => baseInput.click());
        baseInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const bytes = await file.arrayBuffer();
            const task = window.pdfjsLib.getDocument({ data: bytes.slice() });
            const doc = await task.promise;
            this._basePdf = { file, name: file.name, bytes, pageCount: doc.numPages };
            doc.destroy();
            this._el.querySelector('#hm-base-label').textContent = `Selected: ${file.name} (${this._basePdf.pageCount} pages)`;
            baseInput.value = '';
        });

        this._el.querySelector('#hm-next').addEventListener('click', () => this._hmNext());
        this._el.querySelector('#hm-back').addEventListener('click', () => this._hmBack());
        this._el.querySelector('#hm-merge-btn').addEventListener('click', () => this._doHeaderMerge());
    }

    _hmSetStep(step) {
        this._headerStep = step;
        [1, 2, 3].forEach(s => {
            this._el.querySelector(`#hm-step-${s}`).style.display = s === step ? '' : 'none';
            const dot = this._el.querySelector(`.merge-step-dot[data-step="${s}"]`);
            dot.classList.toggle('active', s <= step);
        });
        this._el.querySelector('#hm-back').style.display = step > 1 ? '' : 'none';
        this._el.querySelector('#hm-next').style.display = step < 3 ? '' : 'none';
        this._el.querySelector('#hm-merge-btn').style.display = step === 3 ? '' : 'none';
    }

    async _hmNext() {
        if (this._headerStep === 1) {
            if (!this._basePdf) { toast('Select a base PDF first', 'info'); return; }
            // Build page grid for step 2
            const grid = this._el.querySelector('#hm-page-grid');
            grid.innerHTML = '';
            this._headerMarks = [];

            for (let i = 0; i < this._basePdf.pageCount; i++) {
                const card = document.createElement('div');
                card.className = 'merge-thumb-card hm-page-card';
                card.dataset.pageIdx = i;

                const labelInput = document.createElement('input');
                labelInput.type = 'text';
                labelInput.placeholder = `Header label…`;
                labelInput.className = 'hm-label-input';
                labelInput.style.display = 'none';

                const badge = document.createElement('div');
                badge.className = 'hm-header-badge';
                badge.style.display = 'none';
                badge.textContent = '📌';

                card.innerHTML = `<div class="merge-thumb-label">Page ${i + 1}</div>`;
                card.insertBefore(badge, card.firstChild);
                card.appendChild(labelInput);

                card.addEventListener('click', () => {
                    card.classList.toggle('header-marked');
                    const isMarked = card.classList.contains('header-marked');
                    badge.style.display = isMarked ? '' : 'none';
                    labelInput.style.display = isMarked ? '' : 'none';
                    if (isMarked) labelInput.focus();
                });

                grid.appendChild(card);

                // Thumbnail async
                this._renderThumb(this._basePdf.bytes, i, 80).then(canvas => {
                    canvas.className = 'merge-thumb-canvas';
                    card.insertBefore(canvas, card.querySelector('.merge-thumb-label'));
                }).catch(() => { });
            }

            this._hmSetStep(2);
        } else if (this._headerStep === 2) {
            // Collect marked headers
            this._headerMarks = [];
            this._el.querySelectorAll('.hm-page-card.header-marked').forEach(card => {
                const pageIdx = parseInt(card.dataset.pageIdx);
                const labelInput = card.querySelector('.hm-label-input');
                const label = labelInput.value.trim() || `Header ${this._headerMarks.length + 1}`;
                this._headerMarks.push({ pageIdx, label });
            });

            if (!this._headerMarks.length) { toast('Mark at least one header page', 'info'); return; }
            this._headerMarks.sort((a, b) => a.pageIdx - b.pageIdx);

            // Build step 3 — insert sections
            const sections = this._el.querySelector('#hm-insert-sections');
            sections.innerHTML = '';
            this._headerInserts = {};

            for (const hdr of this._headerMarks) {
                this._headerInserts[hdr.pageIdx] = [];

                const section = document.createElement('div');
                section.className = 'hm-insert-section';
                section.innerHTML = `
                    <div class="group-box" style="margin-bottom:10px">
                      <div class="group-box-title">📌 After "${hdr.label}" (Page ${hdr.pageIdx + 1})</div>
                      <div class="hm-insert-list" data-page="${hdr.pageIdx}"></div>
                      <button class="btn sm hm-add-pdfs" data-page="${hdr.pageIdx}" style="margin-top:6px">+ Add PDFs</button>
                      <input type="file" class="hm-insert-input" data-page="${hdr.pageIdx}" accept=".pdf" multiple style="display:none"/>
                    </div>
                `;

                const fileInput = section.querySelector('.hm-insert-input');
                const addBtn = section.querySelector('.hm-add-pdfs');
                const list = section.querySelector('.hm-insert-list');

                addBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', async (e) => {
                    for (const file of e.target.files) {
                        const bytes = await file.arrayBuffer();
                        this._headerInserts[hdr.pageIdx].push({ name: file.name, bytes });
                        const item = document.createElement('div');
                        item.className = 'merge-file-item';
                        item.textContent = file.name;
                        list.appendChild(item);
                    }
                    fileInput.value = '';
                });

                sections.appendChild(section);
            }

            this._hmSetStep(3);
        }
    }

    _hmBack() {
        if (this._headerStep === 2) this._hmSetStep(1);
        else if (this._headerStep === 3) this._hmSetStep(2);
    }

    async _doHeaderMerge() {
        try {
            toast('Merging with headers…', 'info', 3000);
            const { PDFDocument } = window.PDFLib;
            const baseSrc = await PDFDocument.load(this._basePdf.bytes, { ignoreEncryption: true });
            const merged = await PDFDocument.create();

            for (let i = 0; i < baseSrc.getPageCount(); i++) {
                // Copy this base page
                const [page] = await merged.copyPages(baseSrc, [i]);
                merged.addPage(page);

                // Insert PDFs after this page if it's a header
                if (this._headerInserts[i] && this._headerInserts[i].length) {
                    for (const insert of this._headerInserts[i]) {
                        const insertDoc = await PDFDocument.load(insert.bytes, { ignoreEncryption: true });
                        const indices = Array.from({ length: insertDoc.getPageCount() }, (_, j) => j);
                        const pages = await merged.copyPages(insertDoc, indices);
                        pages.forEach(p => merged.addPage(p));
                    }
                }
            }

            const bytes = await merged.save();
            this._downloadBlob(bytes, 'merged-headers.pdf');
            toast(`✅ Header-based merge complete!`, 'success');
        } catch (err) {
            showAlert('Header Merge Failed', err.message);
        }
    }

    onViewActivated() { }
}
