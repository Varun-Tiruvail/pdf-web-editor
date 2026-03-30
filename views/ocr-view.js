/**
 * ocr-view.js — OCR Template Trainer & Extractor
 * Ported from OLDPDFEditor/ocr_module.py — uses Tesseract.js (browser WASM)
 * 
 * Workflow:
 * 1. Load a PDF, render pages to canvas
 * 2. Draw Label (blue), Anchor (green), Value (yellow) boxes
 * 3. Anchor auto-captures text via Tesseract.js
 * 4. Save template (localStorage JSON)
 * 5. Extract: load new PDFs → find anchor text → apply offset → OCR value region
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showAlert, showModal, closeModal } from '../components/modal.js';

/* ── Box type colors ──────────────────────────────────────────────────── */
const BOX_COLORS = {
    label:  { stroke: '#4285F4', fill: 'rgba(66,133,244,0.12)',  badge: '#4285F4' },
    anchor: { stroke: '#34A853', fill: 'rgba(52,168,83,0.12)',   badge: '#34A853' },
    value:  { stroke: '#FBBC05', fill: 'rgba(251,188,5,0.15)',   badge: '#EA4335' },
};

export class OCRView {
    constructor(container, app) {
        this._el = container;
        this._app = app;

        // State
        this._mode = 'label';         // 'label' | 'anchor' | 'value'
        this._boxes = [];             // Label boxes (top-level) with children
        this._selectedBox = null;
        this._activeParent = null;    // For anchor/value — which label they belong to
        this._drawing = false;
        this._drawStart = null;
        this._drawCurrent = null;

        // PDF for template training
        this._trainDoc = null;        // pdfjsLib document
        this._trainRaw = null;        // raw ArrayBuffer
        this._trainPage = 1;
        this._trainPageCount = 0;
        this._trainFileName = '';

        // Canvas dimensions (rendered)
        this._canvasW = 0;
        this._canvasH = 0;

        // Tesseract worker (lazy)
        this._tessWorker = null;

        // Extraction results
        this._extractResults = [];

        this._render();
    }

    /* ═══════════════════════════════════════════════════════════════════════
       RENDER
    ═══════════════════════════════════════════════════════════════════════ */
    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>OCR Trainer & Extractor</h2>
        <p>Draw label/anchor/value boxes on scanned PDFs — extract data with templates</p>
      </div>

      <div class="ocr-main-layout">
        <!-- LEFT PANEL: Controls -->
        <div class="ocr-left-panel">

          <!-- PDF Load -->
          <div class="group-box" style="margin-bottom:10px">
            <div class="group-box-title">📄 Training PDF</div>
            <div id="ocr-pdf-name" style="font-size:11px;color:var(--text-muted);margin-bottom:6px">No PDF loaded</div>
            <button class="btn primary sm" id="ocr-load-pdf" style="width:100%">Browse PDF…</button>
            <input type="file" id="ocr-file-input" accept=".pdf" style="display:none"/>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
              <button class="btn icon-btn" id="ocr-prev-page">◀</button>
              <span id="ocr-page-label" style="flex:1;text-align:center;font-size:11px;color:var(--text-muted)">Page 0/0</span>
              <button class="btn icon-btn" id="ocr-next-page">▶</button>
            </div>
          </div>

          <!-- Drawing Mode -->
          <div class="group-box" style="margin-bottom:10px">
            <div class="group-box-title">✏️ Drawing Mode</div>
            <div class="ocr-mode-buttons">
              <button class="btn sm ocr-mode-btn active" data-mode="label" style="background:#4285F4;color:#fff;border-color:#4285F4">📦 Label</button>
              <button class="btn sm ocr-mode-btn" data-mode="anchor" style="background:#34A853;color:#fff;border-color:#34A853">⚓ Anchor</button>
              <button class="btn sm ocr-mode-btn" data-mode="value" style="background:#EA4335;color:#fff;border-color:#EA4335">💎 Value</button>
            </div>
            <p id="ocr-mode-hint" style="font-size:10px;color:var(--text-muted);margin-top:6px">
              Draw a label box to group anchor+value pairs.
            </p>
          </div>

          <!-- Box List -->
          <div class="group-box" style="margin-bottom:10px">
            <div class="group-box-title">📋 Boxes</div>
            <div id="ocr-box-list" class="ocr-box-list"></div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn sm" id="ocr-delete-box" style="flex:1">🗑 Delete</button>
              <button class="btn sm" id="ocr-clear-all" style="flex:1">🧹 Clear</button>
            </div>
          </div>

          <!-- Template Save/Load -->
          <div class="group-box" style="margin-bottom:10px">
            <div class="group-box-title">💾 Template</div>
            <input type="text" id="ocr-tpl-name" placeholder="Template name…" style="width:100%;margin-bottom:6px"/>
            <div style="display:flex;gap:6px;margin-bottom:8px">
              <button class="btn sm primary" id="ocr-save-tpl" style="flex:1">Save</button>
              <button class="btn sm" id="ocr-test-extract" style="flex:1;background:#FF9800;border-color:#FF9800;color:#fff">🧪 Test</button>
            </div>
            <select id="ocr-tpl-list" style="width:100%;margin-bottom:6px">
              <option value="">— select template —</option>
            </select>
            <button class="btn sm" id="ocr-load-tpl" style="width:100%;background:#9C27B0;border-color:#9C27B0;color:#fff">📂 Load Template</button>
          </div>

          <!-- Extraction -->
          <div class="group-box">
            <div class="group-box-title">▶️ Run Extraction</div>
            <button class="btn primary sm" id="ocr-run-extract" style="width:100%;margin-bottom:6px">Run OCR Extraction</button>
            <input type="file" id="ocr-extract-files" accept=".pdf" multiple style="display:none"/>
            <button class="btn sm" id="ocr-export-csv" style="width:100%">📊 Export CSV</button>
          </div>
        </div>

        <!-- CENTER: Canvas -->
        <div class="ocr-center-panel">
          <div class="ocr-canvas-wrap" id="ocr-canvas-wrap">
            <canvas id="ocr-pdf-canvas"></canvas>
            <canvas id="ocr-draw-overlay"></canvas>
          </div>
        </div>

        <!-- RIGHT: Results -->
        <div class="ocr-right-panel">
          <div class="group-box-title">📊 Extraction Results</div>
          <div id="ocr-results-table" class="ocr-results-table"></div>
        </div>
      </div>
    `;

        this._bindActions();
        this._loadTemplateList();
    }

    /* ═══════════════════════════════════════════════════════════════════════
       BIND ACTIONS
    ═══════════════════════════════════════════════════════════════════════ */
    _bindActions() {
        const el = this._el;

        // PDF load
        el.querySelector('#ocr-load-pdf').addEventListener('click', () => {
            el.querySelector('#ocr-file-input').click();
        });
        el.querySelector('#ocr-file-input').addEventListener('change', e => {
            if (e.target.files[0]) this._loadTrainPDF(e.target.files[0]);
        });

        // Page nav
        el.querySelector('#ocr-prev-page').addEventListener('click', () => this._goPage(-1));
        el.querySelector('#ocr-next-page').addEventListener('click', () => this._goPage(1));

        // Drawing mode
        el.querySelectorAll('.ocr-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('.ocr-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._mode = btn.dataset.mode;
                const hints = {
                    label: 'Draw a label box to group anchor+value pairs.',
                    anchor: 'Select a label first, then draw anchor boxes (green). Text is auto-OCRd.',
                    value: 'Select a label first, then draw value boxes (yellow).'
                };
                el.querySelector('#ocr-mode-hint').textContent = hints[this._mode];
                if (this._mode === 'label') this._activeParent = null;
            });
        });

        // Box management
        el.querySelector('#ocr-delete-box').addEventListener('click', () => this._deleteSelectedBox());
        el.querySelector('#ocr-clear-all').addEventListener('click', () => {
            this._boxes = [];
            this._selectedBox = null;
            this._activeParent = null;
            this._redrawOverlay();
            this._updateBoxList();
            toast('All boxes cleared', 'info');
        });

        // Template save/load
        el.querySelector('#ocr-save-tpl').addEventListener('click', () => this._saveTemplate());
        el.querySelector('#ocr-load-tpl').addEventListener('click', () => this._loadTemplate());
        el.querySelector('#ocr-test-extract').addEventListener('click', () => this._testExtract());

        // Extraction
        el.querySelector('#ocr-run-extract').addEventListener('click', () => {
            el.querySelector('#ocr-extract-files').click();
        });
        el.querySelector('#ocr-extract-files').addEventListener('change', e => {
            if (e.target.files.length) this._runExtraction([...e.target.files]);
        });
        el.querySelector('#ocr-export-csv').addEventListener('click', () => this._exportCSV());

        // Canvas drawing events
        this._bindCanvas();
    }

    /* ═══════════════════════════════════════════════════════════════════════
       CANVAS DRAWING
    ═══════════════════════════════════════════════════════════════════════ */
    _bindCanvas() {
        const overlay = this._el.querySelector('#ocr-draw-overlay');

        overlay.addEventListener('mousedown', e => {
            if (!this._trainDoc) return;
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check if clicking on existing box
            const hit = this._hitTest(x, y);
            if (hit) {
                this._selectedBox = hit;
                if (hit.type === 'label') this._activeParent = hit;
                this._updateBoxList();
                this._redrawOverlay();
                return;
            }

            // Validate mode
            if (this._mode !== 'label' && !this._activeParent) {
                toast('Select a label box first, then draw anchor/value inside it', 'info');
                return;
            }

            this._drawing = true;
            this._drawStart = { x, y };
            this._drawCurrent = { x, y };
        });

        overlay.addEventListener('mousemove', e => {
            if (!this._drawing) return;
            const rect = overlay.getBoundingClientRect();
            this._drawCurrent = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
            this._redrawOverlay();

            // Draw the in-progress rectangle
            const ctx = overlay.getContext('2d');
            const s = this._drawStart;
            const c = this._drawCurrent;
            const color = BOX_COLORS[this._mode];
            ctx.strokeStyle = color.stroke;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.fillStyle = color.fill;
            ctx.fillRect(s.x, s.y, c.x - s.x, c.y - s.y);
            ctx.strokeRect(s.x, s.y, c.x - s.x, c.y - s.y);
            ctx.setLineDash([]);
        });

        overlay.addEventListener('mouseup', e => {
            if (!this._drawing) return;
            this._drawing = false;
            const rect = overlay.getBoundingClientRect();
            const ex = e.clientX - rect.left;
            const ey = e.clientY - rect.top;
            const s = this._drawStart;

            const x1 = Math.min(s.x, ex);
            const y1 = Math.min(s.y, ey);
            const w = Math.abs(ex - s.x);
            const h = Math.abs(ey - s.y);

            if (w < 5 || h < 5) { this._redrawOverlay(); return; }

            // Normalize to 0-1 relative coords
            const relRect = {
                x: x1 / this._canvasW,
                y: y1 / this._canvasH,
                w: w / this._canvasW,
                h: h / this._canvasH,
            };

            if (this._mode === 'label') {
                // Use showModal instead of prompt() to avoid canvas issues
                const body = document.createElement('div');
                body.innerHTML = `
                    <p style="color:var(--text-secondary);margin-bottom:10px">Enter a name for this label group (e.g. "Invoice Number", "Date")</p>
                    <input type="text" id="ocr-label-name-input" placeholder="Label name…"
                           style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-inset);color:var(--text-primary);font-size:13px" />
                `;
                showModal({
                    title: '📦 New Label',
                    body,
                    confirmText: 'Create',
                    cancelText: 'Cancel',
                    onConfirm: () => {
                        const input = document.getElementById('ocr-label-name-input');
                        const name = (input?.value || '').trim();
                        if (!name) { this._redrawOverlay(); return; }
                        const box = { type: 'label', name, rect: relRect, children: [] };
                        this._boxes.push(box);
                        this._selectedBox = box;
                        this._activeParent = box;
                        this._updateBoxList();
                        this._redrawOverlay();
                        toast(`Label "${name}" created — now draw anchor/value inside`, 'success');
                    },
                    onCancel: () => { this._redrawOverlay(); },
                });
                // Auto-focus the input after modal appears
                setTimeout(() => {
                    const input = document.getElementById('ocr-label-name-input');
                    if (input) {
                        input.focus();
                        input.addEventListener('keydown', e2 => {
                            if (e2.key === 'Enter') {
                                document.getElementById('modal-confirm')?.click();
                            }
                        });
                    }
                }, 80);

            } else {
                // Anchor or Value mode
                const box = { type: this._mode, rect: relRect, anchorText: '' };
                if (this._mode === 'value') {
                    box.name = `Value ${this._activeParent.children.filter(c => c.type === 'value').length + 1}`;
                } else {
                    box.name = 'Anchor (scanning…)';
                }
                this._activeParent.children.push(box);

                // ★ Draw box IMMEDIATELY — don't wait for OCR
                this._updateBoxList();
                this._redrawOverlay();

                // Run OCR in background for anchor boxes
                if (this._mode === 'anchor') {
                    toast('Running OCR on anchor region…', 'info', 5000);
                    this._ocrRegion(relRect).then(text => {
                        box.anchorText = text;
                        box.name = text
                            ? `Anchor: ${text.substring(0, 25)}${text.length > 25 ? '…' : ''}`
                            : 'Anchor (no text)';
                        // Refresh UI with updated name
                        this._updateBoxList();
                        this._redrawOverlay();
                        if (text) {
                            toast(`⚓ Captured: "${text}"`, 'success');
                        } else {
                            toast('No text detected in anchor — try a larger box', 'info');
                        }
                    }).catch(err => {
                        console.error('Anchor OCR error:', err);
                        box.name = 'Anchor (OCR failed)';
                        this._updateBoxList();
                        this._redrawOverlay();
                    });
                } else {
                    toast(`💎 Value box added to "${this._activeParent.name}"`, 'success');
                }
            }
        });
    }

    _hitTest(x, y) {
        // Check children first (they're drawn on top)
        for (const box of this._boxes) {
            for (const child of box.children) {
                const r = child.rect;
                const px = r.x * this._canvasW, py = r.y * this._canvasH;
                const pw = r.w * this._canvasW, ph = r.h * this._canvasH;
                if (x >= px && x <= px + pw && y >= py && y <= py + ph) return child;
            }
            const r = box.rect;
            const px = r.x * this._canvasW, py = r.y * this._canvasH;
            const pw = r.w * this._canvasW, ph = r.h * this._canvasH;
            if (x >= px && x <= px + pw && y >= py && y <= py + ph) return box;
        }
        return null;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       PDF LOADING & RENDERING
    ═══════════════════════════════════════════════════════════════════════ */
    async _loadTrainPDF(file) {
        try {
            const buf = await file.arrayBuffer();
            this._trainRaw = new Uint8Array(buf);
            this._trainFileName = file.name;

            const loading = pdfjsLib.getDocument({ data: this._trainRaw.slice() });
            this._trainDoc = await loading.promise;
            this._trainPageCount = this._trainDoc.numPages;
            this._trainPage = 1;
            this._boxes = [];
            this._selectedBox = null;
            this._activeParent = null;

            this._el.querySelector('#ocr-pdf-name').textContent = file.name;
            await this._renderTrainPage();
            toast(`Loaded ${file.name} (${this._trainPageCount} pages)`, 'success');
        } catch (err) {
            showAlert('Failed to load PDF', err.message);
        }
    }

    async _renderTrainPage() {
        if (!this._trainDoc) return;
        const page = await this._trainDoc.getPage(this._trainPage);

        // Render at a scale that fits the center panel
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = this._el.querySelector('#ocr-pdf-canvas');
        const overlay = this._el.querySelector('#ocr-draw-overlay');
        const ctx = canvas.getContext('2d');

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        overlay.width = viewport.width;
        overlay.height = viewport.height;
        this._canvasW = viewport.width;
        this._canvasH = viewport.height;

        await page.render({ canvasContext: ctx, viewport }).promise;

        this._el.querySelector('#ocr-page-label').textContent =
            `Page ${this._trainPage} / ${this._trainPageCount}`;

        this._redrawOverlay();
    }

    _goPage(delta) {
        if (!this._trainDoc) return;
        const np = this._trainPage + delta;
        if (np < 1 || np > this._trainPageCount) return;
        this._trainPage = np;
        this._renderTrainPage();
    }

    /* ═══════════════════════════════════════════════════════════════════════
       OVERLAY DRAWING
    ═══════════════════════════════════════════════════════════════════════ */
    _redrawOverlay() {
        const overlay = this._el.querySelector('#ocr-draw-overlay');
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        for (const box of this._boxes) {
            this._drawBox(ctx, box, box === this._selectedBox);
            for (const child of box.children) {
                this._drawBox(ctx, child, child === this._selectedBox);
            }
        }
    }

    _drawBox(ctx, box, selected) {
        const color = BOX_COLORS[box.type] || BOX_COLORS.label;
        const r = box.rect;
        const x = r.x * this._canvasW;
        const y = r.y * this._canvasH;
        const w = r.w * this._canvasW;
        const h = r.h * this._canvasH;

        // Fill
        ctx.fillStyle = selected ? 'rgba(234,67,53,0.2)' : color.fill;
        ctx.fillRect(x, y, w, h);

        // Stroke
        ctx.strokeStyle = selected ? '#EA4335' : color.stroke;
        ctx.lineWidth = selected ? 3 : 2;
        ctx.strokeRect(x, y, w, h);

        // Label badge
        const prefix = box.type === 'label' ? '📦' : box.type === 'anchor' ? '⚓' : '💎';
        const label = `${prefix} ${box.name || box.type}`;
        ctx.font = 'bold 10px Inter, sans-serif';
        const tm = ctx.measureText(label);
        const lh = 14;
        const ly = Math.max(y - lh - 2, 0);

        ctx.fillStyle = selected ? '#EA4335' : color.badge;
        ctx.fillRect(x, ly, tm.width + 8, lh + 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x + 4, ly + lh - 2);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       BOX LIST
    ═══════════════════════════════════════════════════════════════════════ */
    _updateBoxList() {
        const list = this._el.querySelector('#ocr-box-list');
        let html = '';
        for (const box of this._boxes) {
            const sel = box === this._selectedBox ? 'selected' : '';
            html += `<div class="ocr-box-item ${sel}" data-id="${this._boxes.indexOf(box)}">
                <span style="color:#4285F4">📦</span> ${box.name}
            </div>`;
            for (const child of box.children) {
                const csel = child === this._selectedBox ? 'selected' : '';
                const ico = child.type === 'anchor' ? '⚓' : '💎';
                const col = child.type === 'anchor' ? '#34A853' : '#EA4335';
                html += `<div class="ocr-box-item child ${csel}" data-parent="${this._boxes.indexOf(box)}" data-child="${box.children.indexOf(child)}">
                    <span style="color:${col}">${ico}</span> ${child.name || child.type}
                </div>`;
            }
        }
        list.innerHTML = html;

        // Click handlers for box selection
        list.querySelectorAll('.ocr-box-item').forEach(item => {
            item.addEventListener('click', () => {
                const pid = item.dataset.id;
                const parentIdx = item.dataset.parent;
                const childIdx = item.dataset.child;

                if (pid !== undefined) {
                    this._selectedBox = this._boxes[parseInt(pid)];
                    this._activeParent = this._selectedBox;
                } else if (parentIdx !== undefined && childIdx !== undefined) {
                    const parent = this._boxes[parseInt(parentIdx)];
                    this._selectedBox = parent.children[parseInt(childIdx)];
                    this._activeParent = parent;
                }
                this._updateBoxList();
                this._redrawOverlay();
            });
        });
    }

    _deleteSelectedBox() {
        if (!this._selectedBox) { toast('No box selected', 'info'); return; }

        // If it's a top-level label, remove it entirely
        const idx = this._boxes.indexOf(this._selectedBox);
        if (idx >= 0) {
            this._boxes.splice(idx, 1);
        } else {
            // Find parent and remove child
            for (const box of this._boxes) {
                const ci = box.children.indexOf(this._selectedBox);
                if (ci >= 0) { box.children.splice(ci, 1); break; }
            }
        }

        this._selectedBox = null;
        this._updateBoxList();
        this._redrawOverlay();
        toast('Box deleted', 'success');
    }

    /* ═══════════════════════════════════════════════════════════════════════
       OCR (Tesseract.js)
    ═══════════════════════════════════════════════════════════════════════ */
    async _initTesseract() {
        if (this._tessWorker) return this._tessWorker;
        if (!window.Tesseract) {
            showAlert('Tesseract.js Not Loaded', 
                'Tesseract.js script not found. Make sure the CDN is included in index.html.');
            return null;
        }
        try {
            toast('Initializing OCR engine…', 'info', 5000);
            this._tessWorker = await Tesseract.createWorker('eng', 1, {
                logger: m => { /* silent */ }
            });
            toast('OCR engine ready', 'success');
            return this._tessWorker;
        } catch (err) {
            showAlert('OCR Init Failed', err.message);
            return null;
        }
    }

    async _ocrRegion(relRect) {
        const worker = await this._initTesseract();
        if (!worker) return '';

        try {
            const canvas = this._el.querySelector('#ocr-pdf-canvas');
            const x = Math.floor(relRect.x * canvas.width);
            const y = Math.floor(relRect.y * canvas.height);
            const w = Math.floor(relRect.w * canvas.width);
            const h = Math.floor(relRect.h * canvas.height);

            // Crop the region
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = w;
            cropCanvas.height = h;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

            const { data: { text } } = await worker.recognize(cropCanvas);
            return text.trim();
        } catch (err) {
            console.error('OCR region error:', err);
            return '';
        }
    }

    async _ocrRegionFromImage(imageData, relRect, imgW, imgH) {
        const worker = await this._initTesseract();
        if (!worker) return '';

        try {
            const x = Math.floor(relRect.x * imgW);
            const y = Math.floor(relRect.y * imgH);
            const w = Math.floor(relRect.w * imgW);
            const h = Math.floor(relRect.h * imgH);

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = w;
            cropCanvas.height = h;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(imageData, x, y, w, h, 0, 0, w, h);

            const { data: { text } } = await worker.recognize(cropCanvas);
            return text.trim();
        } catch (err) {
            console.error('OCR region error:', err);
            return '';
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       TEMPLATE SAVE / LOAD (localStorage)
    ═══════════════════════════════════════════════════════════════════════ */
    _saveTemplate() {
        const name = this._el.querySelector('#ocr-tpl-name').value.trim();
        if (!name) { toast('Enter a template name', 'info'); return; }
        if (!this._boxes.length) { toast('Draw some boxes first', 'info'); return; }

        const templates = JSON.parse(localStorage.getItem('ocr_templates') || '{}');
        templates[name] = {
            boxes: this._boxes.map(b => ({
                type: b.type,
                name: b.name,
                rect: b.rect,
                children: b.children.map(c => ({
                    type: c.type,
                    name: c.name,
                    rect: c.rect,
                    anchorText: c.anchorText || '',
                }))
            })),
            createdAt: new Date().toISOString(),
        };
        localStorage.setItem('ocr_templates', JSON.stringify(templates));
        this._loadTemplateList();
        toast(`Template "${name}" saved`, 'success');
    }

    _loadTemplate() {
        const sel = this._el.querySelector('#ocr-tpl-list').value;
        if (!sel) { toast('Select a template', 'info'); return; }

        const templates = JSON.parse(localStorage.getItem('ocr_templates') || '{}');
        const tpl = templates[sel];
        if (!tpl) { toast('Template not found', 'info'); return; }

        this._boxes = tpl.boxes.map(b => ({
            ...b,
            children: b.children.map(c => ({ ...c }))
        }));
        this._selectedBox = null;
        this._activeParent = null;
        this._el.querySelector('#ocr-tpl-name').value = sel;
        this._updateBoxList();
        this._redrawOverlay();
        toast(`Loaded template "${sel}" — ${this._boxes.length} labels`, 'success');
    }

    _loadTemplateList() {
        const templates = JSON.parse(localStorage.getItem('ocr_templates') || '{}');
        const sel = this._el.querySelector('#ocr-tpl-list');
        sel.innerHTML = '<option value="">— select template —</option>';
        Object.keys(templates).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       TEST EXTRACT (current page)
    ═══════════════════════════════════════════════════════════════════════ */
    async _testExtract() {
        if (!this._trainDoc) { toast('Load a PDF first', 'info'); return; }
        if (!this._boxes.length) { toast('Draw boxes first', 'info'); return; }

        toast('Running test extraction…', 'info', 8000);
        let msg = '';

        for (const box of this._boxes) {
            if (box.type !== 'label') continue;
            const anchors = box.children.filter(c => c.type === 'anchor');
            const values = box.children.filter(c => c.type === 'value');

            let anchorText = '';
            for (const a of anchors) {
                anchorText += (await this._ocrRegion(a.rect)) + ' ';
            }

            let valueText = '';
            for (const v of values) {
                valueText += (await this._ocrRegion(v.rect)) + ' ';
            }

            msg += `📦 ${box.name}:\n   ⚓ Anchor: ${anchorText.trim()}\n   💎 Value: ${valueText.trim()}\n\n`;
        }

        showAlert('OCR Test Results', `<pre style="white-space:pre-wrap;font-size:12px;color:var(--text-secondary)">${msg}</pre>`);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       RUN EXTRACTION (multi-PDF, anchor-offset approach)
    ═══════════════════════════════════════════════════════════════════════ */
    async _runExtraction(files) {
        const tplName = this._el.querySelector('#ocr-tpl-list').value ||
                        this._el.querySelector('#ocr-tpl-name').value;
        
        let boxes = this._boxes;
        if (!boxes.length) {
            // Try loading from selected template
            const templates = JSON.parse(localStorage.getItem('ocr_templates') || '{}');
            if (tplName && templates[tplName]) {
                boxes = templates[tplName].boxes;
            }
        }
        if (!boxes.length) { toast('No template loaded — save or select one first', 'info'); return; }

        toast(`Running OCR extraction on ${files.length} PDF(s)…`, 'info', 15000);
        this._extractResults = [];

        for (const file of files) {
            try {
                const buf = await file.arrayBuffer();
                const raw = new Uint8Array(buf);
                const loading = pdfjsLib.getDocument({ data: raw.slice() });
                const doc = await loading.promise;
                const row = { filename: file.name };

                for (const label of boxes) {
                    if (label.type !== 'label') continue;
                    const anchors = label.children.filter(c => c.type === 'anchor');
                    const values = label.children.filter(c => c.type === 'value');

                    if (!anchors.length || !values.length) continue;

                    const firstAnchor = anchors[0];
                    const firstValue = values[0];
                    const anchorSearchText = (firstAnchor.anchorText || '').toLowerCase().trim();

                    if (!anchorSearchText) continue;

                    // Search each page for anchor text
                    let found = false;
                    for (let p = 1; p <= doc.numPages; p++) {
                        const page = await doc.getPage(p);
                        const vp = page.getViewport({ scale: 1.5 });

                        // Render page to canvas
                        const tmpCanvas = document.createElement('canvas');
                        tmpCanvas.width = vp.width;
                        tmpCanvas.height = vp.height;
                        const tmpCtx = tmpCanvas.getContext('2d');
                        await page.render({ canvasContext: tmpCtx, viewport: vp }).promise;

                        // OCR the anchor region to find it
                        const anchorText = await this._ocrRegionFromImage(
                            tmpCanvas, firstAnchor.rect, vp.width, vp.height
                        );

                        if (anchorText.toLowerCase().includes(anchorSearchText) ||
                            anchorSearchText.includes(anchorText.toLowerCase().trim())) {
                            // Anchor found! Use relative offset to locate value
                            // Calculate offset: value position relative to anchor
                            const dx = firstValue.rect.x - firstAnchor.rect.x;
                            const dy = firstValue.rect.y - firstAnchor.rect.y;

                            const valueRect = {
                                x: firstAnchor.rect.x + dx,
                                y: firstAnchor.rect.y + dy,
                                w: firstValue.rect.w,
                                h: firstValue.rect.h,
                            };

                            const valueText = await this._ocrRegionFromImage(
                                tmpCanvas, valueRect, vp.width, vp.height
                            );

                            row[`${label.name}_anchor`] = anchorText.trim();
                            row[`${label.name}_value`] = valueText.trim();
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        row[`${label.name}_anchor`] = '';
                        row[`${label.name}_value`] = '';
                    }
                }

                this._extractResults.push(row);
            } catch (err) {
                console.error(`Extraction error for ${file.name}:`, err);
                this._extractResults.push({ filename: file.name, error: err.message });
            }
        }

        this._renderResults();
        toast(`✅ Extraction complete — ${files.length} PDFs processed`, 'success');
    }

    _renderResults() {
        const el = this._el.querySelector('#ocr-results-table');
        if (!this._extractResults.length) {
            el.innerHTML = '<div style="color:var(--text-muted);padding:12px">No results yet</div>';
            return;
        }

        // Collect all columns
        const cols = new Set();
        this._extractResults.forEach(r => Object.keys(r).forEach(k => cols.add(k)));
        const colArr = [...cols];

        let html = '<table class="ocr-table"><thead><tr>';
        colArr.forEach(c => html += `<th>${c}</th>`);
        html += '</tr></thead><tbody>';
        this._extractResults.forEach(row => {
            html += '<tr>';
            colArr.forEach(c => {
                html += `<td>${row[c] || ''}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        el.innerHTML = html;
    }

    _exportCSV() {
        if (!this._extractResults.length) { toast('No results to export', 'info'); return; }

        const cols = new Set();
        this._extractResults.forEach(r => Object.keys(r).forEach(k => cols.add(k)));
        const colArr = [...cols];

        let csv = colArr.join(',') + '\n';
        this._extractResults.forEach(row => {
            csv += colArr.map(c => `"${(row[c] || '').replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ocr-extraction.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('CSV exported', 'success');
    }

    onViewActivated() {
        if (this._trainDoc) this._renderTrainPage();
    }
}
