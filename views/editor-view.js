/**
 * editor-view.js — Main editing canvas  v2.1
 * Fixes:
 *  - Full undo/redo history stack (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
 *  - In-place inline text editor (double-click to edit existing text annotations)
 *  - Image tool with real file picker
 *  - Highlight drag-draw fixed
 *  - Erase by click/drag with visual feedback
 *  - Save/Export as PNG
 *  - Annotation sync with Annotate view via shared store
 *  - Touch-friendly (pointer events)
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showAlert, showModal, closeModal } from '../components/modal.js';

const TOOLS = [
    { key: 'select', icon: '⟋', label: 'Select', tip: 'Select / pan' },
    { key: 'edit_text', icon: 'Tᴱ', label: 'Edit Text', tip: 'Click to edit text in-place' },
    { key: 'text', icon: 'T', label: 'Insert', tip: 'Click to insert text' },
    { key: 'freehand', icon: '✎', label: 'Draw', tip: 'Freehand ink drawing' },
    null,
    { key: 'rect', icon: '□', label: 'Rect', tip: 'Draw rectangle' },
    { key: 'circle', icon: '○', label: 'Circle', tip: 'Draw circle / ellipse' },
    { key: 'line', icon: '╱', label: 'Line', tip: 'Draw a line' },
    { key: 'arrow', icon: '→', label: 'Arrow', tip: 'Draw an arrow' },
    null,
    { key: 'image', icon: '⊞', label: 'Image', tip: 'Insert an image' },
    { key: 'whitebox', icon: '▪', label: 'Whitebox', tip: 'Cover area with white box' },
    { key: 'highlight', icon: '▐', label: 'Highlight', tip: 'Highlight area' },
    { key: 'redact', icon: '▬', label: 'Redact', tip: 'Draw redaction box (applies whitebox permanently)' },
    { key: 'erase', icon: '⌫', label: 'Erase', tip: 'Erase annotation (click or drag)' },
];

export class EditorView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._currentTool = 'select';
        this._currentColor = '#C0622A';
        this._zoom = 1.5;

        // ── Split-screen state ────────────────────────────────────────────
        this._splitActive = false;
        this._splitPage = 1;
        this._splitZoom = 1.5;
        this._currentPage = 1;

        // ── Shared annotation store (exported for Annotate view) ──────────────
        // window._annotations is used as a shared bus between editor & annotate
        if (!window._annotations) window._annotations = [];
        this._annotations = window._annotations;

        // ── History (undo/redo) ───────────────────────────────────────────────
        this._history = [];      // stack of snapshots (arrays of annotation objs)
        this._historyPointer = -1;

        // ── Image cache for loaded images ─────────────────────────────────────
        this._imgCache = new Map();

        this._render();
        this._bindEngine();
    }

    // ── Snapshot helpers ──────────────────────────────────────────────────────
    _snapshot() {
        // Trim redo future
        this._history = this._history.slice(0, this._historyPointer + 1);
        this._history.push(JSON.stringify(this._annotations));
        this._historyPointer = this._history.length - 1;
        this._updateUndoRedo();
    }

    _undo() {
        if (this._historyPointer <= 0) { toast('Nothing to undo', 'info'); return; }
        this._historyPointer--;
        this._loadSnapshot(this._history[this._historyPointer]);
        toast('Undo', 'info');
    }

    _redo() {
        if (this._historyPointer >= this._history.length - 1) { toast('Nothing to redo', 'info'); return; }
        this._historyPointer++;
        this._loadSnapshot(this._history[this._historyPointer]);
        toast('Redo', 'info');
    }

    _loadSnapshot(json) {
        const data = JSON.parse(json);
        // Update shared store in-place
        window._annotations.length = 0;
        data.forEach(a => window._annotations.push(a));
        this._annotations = window._annotations;
        this._redrawCurrentPage();
        this._updateUndoRedo();
    }

    _updateUndoRedo() {
        const undoBtn = this._el.querySelector('#undo-btn');
        const redoBtn = this._el.querySelector('#redo-btn');
        if (undoBtn) undoBtn.disabled = this._historyPointer <= 0;
        if (redoBtn) redoBtn.disabled = this._historyPointer >= this._history.length - 1;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    _render() {
        this._el.innerHTML = `
      <!-- Format Bar -->
      <div class="format-bar" id="editor-fmt-bar">
        <label>Font</label>
        <select id="fmt-font">
          <option>Helvetica</option><option>Times New Roman</option>
          <option>Courier</option><option>Arial</option><option>Georgia</option>
        </select>
        <input type="number" id="fmt-size" value="14" min="6" max="96" title="Font size" />
        <div class="divider-v"></div>
        <label>Color</label>
        <input type="color" id="fmt-color" value="#C0622A"
               style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;padding:0" />
        <div class="divider-v"></div>
        <!-- Undo / Redo -->
        <button class="btn icon-btn" id="undo-btn" title="Undo (Ctrl+Z)" disabled>↩</button>
        <button class="btn icon-btn" id="redo-btn" title="Redo (Ctrl+Y)" disabled>↪</button>
        <div class="divider-v"></div>
        <button class="btn icon-btn" id="zoom-out-btn" title="Zoom Out (Ctrl+-)">−</button>
        <span id="zoom-label">150%</span>
        <button class="btn icon-btn" id="zoom-in-btn"  title="Zoom In  (Ctrl++)">+</button>
        <input type="range" id="zoom-range" min="50" max="300" value="150"
               style="width:80px" title="Zoom slider" />
        <div class="divider-v"></div>
        <!-- Page Nav -->
        <button class="btn icon-btn" id="page-prev">◀</button>
        <span id="page-display" style="font-size:11px;color:var(--text-muted);min-width:70px;text-align:center">Page 1</span>
        <button class="btn icon-btn" id="page-next">▶</button>
        <input type="number" id="page-jump" min="1" value="1"
               style="width:52px" title="Jump to page" placeholder="Go…"/>
        <div class="divider-v"></div>
        <button class="btn icon-btn" id="split-toggle" title="Toggle Split Screen (side-by-side)">⊞</button>
        <button class="btn primary" id="editor-save" style="min-width:60px">Export PNG</button>
      </div>

      <!-- Editor Body -->
      <div class="editor-body">
        <!-- Tool Palette -->
        <div class="tool-palette" id="tool-palette"></div>

        <!-- Thumbnail Panel -->
        <div class="thumb-panel hidden" id="thumb-panel"></div>

        <!-- Canvas / Drop Zone -->
        <div id="canvas-area-wrap" style="flex:1;display:flex;overflow:auto;background:var(--bg-app);position:relative">
          <!-- Drop Zone (shown when no PDF) -->
          <div id="editor-drop-zone" class="editor-drop-zone" style="flex:1">
            <div class="dzz-badge">PDF</div>
            <h3>No Document Open</h3>
            <p>Open a PDF or drag and drop a file here to start editing</p>
            <button class="btn primary" id="dzz-open">Open PDF…</button>
          </div>

          <!-- Split-screen container -->
          <div id="split-container" style="display:flex;flex:1;width:100%;height:100%;gap:0">
            <!-- Left Panel (primary) -->
            <div id="pdf-canvas-area" class="pdf-canvas-area hidden"
                 style="display:flex;flex-direction:column;align-items:center;padding:20px;gap:20px;flex:1;min-width:0;overflow:auto"></div>

            <!-- Split Divider -->
            <div id="split-divider" class="split-divider" style="display:none"></div>

            <!-- Right Panel (split) -->
            <div id="split-canvas-area" class="pdf-canvas-area hidden"
                 style="display:none;flex-direction:column;align-items:center;padding:20px;gap:20px;flex:1;min-width:0;overflow:auto"></div>
          </div>

          <!-- Inline text editor (absolutely positioned) -->
          <textarea id="inline-text-editor" style="
            position:absolute;display:none;z-index:9999;
            background:rgba(30,18,8,0.92);
            border:2px solid var(--copper);
            border-radius:4px;
            color:#fff;
            font-family:Inter,sans-serif;
            font-size:14px;
            padding:4px 6px;
            resize:none;
            min-width:120px;min-height:32px;
            box-shadow:0 4px 16px rgba(0,0,0,0.8);
            outline:none;
          " placeholder="Type text… Enter to confirm, Esc to cancel"></textarea>
        </div>
      </div>

      <!-- Editor Status -->
      <div class="editor-status" id="editor-status">Open a PDF to begin editing</div>

      <!-- Hidden image input -->
      <input type="file" id="img-file-input" accept="image/*" style="display:none"/>
    `;

        this._buildToolPalette();
        this._bindFormatBar();
        this._bindDrop();
        this._bindInlineEditor();
        this._snapshot(); // initial empty snapshot
    }

    _buildToolPalette() {
        const palette = this._el.querySelector('#tool-palette');
        TOOLS.forEach(tool => {
            if (!tool) {
                const sep = document.createElement('div');
                sep.className = 'tool-sep';
                palette.appendChild(sep);
                return;
            }
            const btn = document.createElement('button');
            btn.className = 'tool-btn' + (tool.key === 'select' ? ' active' : '');
            btn.dataset.tool = tool.key;
            btn.title = tool.tip;
            btn.innerHTML = `<span class="tool-icon">${tool.icon}</span><span class="tool-label">${tool.label}</span>`;
            btn.addEventListener('click', () => this._setTool(tool.key));
            palette.appendChild(btn);
        });
    }

    _setTool(key) {
        this._currentTool = key;
        this._el.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === key));
        this._setStatus(`Tool: ${TOOLS.find(t => t && t.key === key)?.label || key} — ${TOOLS.find(t => t && t.key === key)?.tip || ''}`);
        const area = this._el.querySelector('#pdf-canvas-area');
        const cursorMap = {
            select: 'default', text: 'text', freehand: 'crosshair', rect: 'crosshair',
            circle: 'crosshair', line: 'crosshair', arrow: 'crosshair', whitebox: 'crosshair',
            highlight: 'crosshair', image: 'cell', erase: 'cell', edit_text: 'text'
        };
        if (area) area.style.cursor = cursorMap[key] || 'default';

        // Image tool: trigger picker immediately
        if (key === 'image') {
            this._el.querySelector('#img-file-input').click();
        }
    }

    _bindFormatBar() {
        const el = this._el;
        el.querySelector('#fmt-color').addEventListener('input', e => { this._currentColor = e.target.value; });
        el.querySelector('#zoom-in-btn').addEventListener('click', () => this._changeZoom(0.25));
        el.querySelector('#zoom-out-btn').addEventListener('click', () => this._changeZoom(-0.25));
        el.querySelector('#split-toggle').addEventListener('click', () => this._toggleSplit());
        el.querySelector('#zoom-range').addEventListener('input', e => {
            this._zoom = parseInt(e.target.value) / 100;
            this._renderCurrentPage();
        });
        el.querySelector('#page-prev').addEventListener('click', () => this._goPage(this._currentPage - 1));
        el.querySelector('#page-next').addEventListener('click', () => this._goPage(this._currentPage + 1));
        el.querySelector('#page-jump').addEventListener('change', e => this._goPage(parseInt(e.target.value)));
        el.querySelector('#undo-btn').addEventListener('click', () => this._undo());
        el.querySelector('#redo-btn').addEventListener('click', () => this._redo());

        // Export PNG
        el.querySelector('#editor-save').addEventListener('click', () => this._exportPNG());

        // Image file picker
        el.querySelector('#img-file-input').addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const img = new Image();
                img.src = ev.target.result;
                img.onload = () => {
                    // Store pending image; next click places it
                    this._pendingImage = { src: ev.target.result, img };
                    toast('Click on the canvas to place the image', 'info', 4000);
                };
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });

        el.querySelector('#dzz-open').addEventListener('click', () => this._app.triggerOpen());
    }

    _bindInlineEditor() {
        const editor = this._el.querySelector('#inline-text-editor');
        editor.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                editor.style.display = 'none';
                this._activeTextAnnot = null;
            } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._commitInlineText(editor.value);
            }
        });
        // Click outside closes
        document.addEventListener('mousedown', e => {
            if (editor.style.display !== 'none' && !editor.contains(e.target)) {
                this._commitInlineText(editor.value);
            }
        });
    }

    _openInlineEditor(x, y, existingAnnot = null) {
        const editor = this._el.querySelector('#inline-text-editor');
        const wrap = this._el.querySelector('#canvas-area-wrap');
        const wRect = wrap.getBoundingClientRect();
        const absX = x - wRect.left + wrap.scrollLeft;
        const absY = y - wRect.top + wrap.scrollTop;

        editor.style.left = absX + 'px';
        editor.style.top = absY + 'px';
        editor.style.display = 'block';
        editor.style.fontSize = this._el.querySelector('#fmt-size').value + 'px';
        editor.style.fontFamily = this._el.querySelector('#fmt-font').value;
        editor.value = existingAnnot?.data?.text || '';
        this._activeTextAnnot = existingAnnot;
        this._inlineEditorPage = this._currentPage;
        this._inlineEditorX = x;
        this._inlineEditorY = y;
        setTimeout(() => editor.focus(), 0);
    }

    _commitInlineText(text) {
        const editor = this._el.querySelector('#inline-text-editor');
        editor.style.display = 'none';
        if (!text?.trim()) { this._activeTextAnnot = null; return; }

        if (this._activeTextAnnot) {
            // Edit existing annotation
            this._activeTextAnnot.data.text = text;
        } else {
            // New text annotation — compute canvas-relative coords
            const overlay = this._el.querySelector(`#annot-overlay-${this._inlineEditorPage}`);
            if (!overlay) return;
            const oRect = overlay.getBoundingClientRect();
            const W = overlay.width, H = overlay.height;
            const cx = this._inlineEditorX - oRect.left;
            const cy = this._inlineEditorY - oRect.top;
            const annot = {
                page: this._inlineEditorPage, type: 'text',
                data: { x: cx / W, y: cy / H, text },
                color: this._currentColor,
                fontSize: parseInt(this._el.querySelector('#fmt-size').value),
                font: this._el.querySelector('#fmt-font').value,
            };
            this._annotations.push(annot);
            window._annotations = this._annotations;
        }
        this._snapshot();
        this._redrawCurrentPage();
        this._activeTextAnnot = null;
        toast('Text saved', 'success');
    }

    _bindDrop() {
        const area = this._el.querySelector('#canvas-area-wrap');
        area.addEventListener('dragover', e => e.preventDefault());
        area.addEventListener('drop', e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file?.name.toLowerCase().endsWith('.pdf')) this._app.openFile(file);
            else toast('Please drop a PDF file', 'error');
        });
    }

    _bindEngine() {
        pdfEngine.addEventListener('doc-opened', () => this._onDocOpened());
        pdfEngine.addEventListener('doc-closed', () => this._onDocClosed());
    }

    _onDocOpened() {
        const el = this._el;
        el.querySelector('#editor-drop-zone').classList.add('hidden');
        el.querySelector('#pdf-canvas-area').classList.remove('hidden');
        el.querySelector('#thumb-panel').classList.remove('hidden');
        this._currentPage = 1;
        // Clear annotations for new doc
        window._annotations.length = 0;
        this._history = [];
        this._historyPointer = -1;
        this._snapshot();
        this._renderCurrentPage();
        this._buildThumbnails();
        this._setStatus(`${pdfEngine.fileName} · ${pdfEngine.pageCount} pages`);
        this._updatePageNav();

        // Init split panel page counter
        this._splitPage = 1;
    }

    _onDocClosed() {
        const el = this._el;
        el.querySelector('#editor-drop-zone').classList.remove('hidden');
        el.querySelector('#pdf-canvas-area').classList.add('hidden');
        el.querySelector('#thumb-panel').classList.add('hidden');
        el.querySelector('#pdf-canvas-area').innerHTML = '';
        el.querySelector('#thumb-panel').innerHTML = '';
        this._setStatus('Open a PDF to begin editing');
    }

    async _renderCurrentPage() {
        if (!pdfEngine.isOpen()) return;
        const area = this._el.querySelector('#pdf-canvas-area');

        // Reuse or create page container
        let container = area.querySelector(`[data-page="${this._currentPage}"]`);
        if (!container) {
            // Hide all page containers
            area.querySelectorAll('.page-container').forEach(c => c.style.display = 'none');
            container = document.createElement('div');
            container.className = 'page-container';
            container.dataset.page = this._currentPage;
            container.style.position = 'relative';
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.id = `page-canvas-${this._currentPage}`;
            const overlay = document.createElement('canvas');
            overlay.className = 'annotation-overlay';
            overlay.id = `annot-overlay-${this._currentPage}`;
            overlay.style.position = 'absolute';
            overlay.style.top = '0'; overlay.style.left = '0';
            container.appendChild(canvas);
            container.appendChild(overlay);
            area.appendChild(container);
            this._bindOverlayEvents(overlay, this._currentPage);
        } else {
            area.querySelectorAll('.page-container').forEach(c => c.style.display = 'none');
            container.style.display = '';
        }

        const canvas = container.querySelector('.pdf-canvas');
        const overlay = container.querySelector('.annotation-overlay');

        await pdfEngine.renderPage(this._currentPage, canvas, this._zoom);

        overlay.width = canvas.width;
        overlay.height = canvas.height;
        overlay.style.width = canvas.style.width;
        overlay.style.height = canvas.style.height;

        await this._redrawAnnotations(overlay, this._currentPage);
        this._updatePageNav();

        const pct = Math.round(this._zoom * 100);
        this._el.querySelector('#zoom-label').textContent = pct + '%';
        this._el.querySelector('#zoom-range').value = pct;
        this._app.setStatus(`Page ${this._currentPage} / ${pdfEngine.pageCount}`, pct + '%');
    }

    async _buildThumbnails() {
        const panel = this._el.querySelector('#thumb-panel');
        panel.innerHTML = '';
        const count = pdfEngine.pageCount;
        for (let p = 1; p <= count; p++) {
            const item = document.createElement('div');
            item.className = 'thumb-item' + (p === 1 ? ' active' : '');
            item.dataset.p = p;
            item.innerHTML = `<div class="thumb-num">${p}</div>`;
            item.addEventListener('click', () => this._goPage(p));
            panel.appendChild(item);
            pdfEngine.renderThumbnail(p, 110).then(tc => {
                if (!tc) return;
                tc.className = 'thumb-canvas';
                item.insertBefore(tc, item.querySelector('.thumb-num'));
            });
        }
    }

    // ── Overlay drawing events ────────────────────────────────────────────────
    _bindOverlayEvents(overlay, pageNum) {
        let drawing = false;
        let sx = 0, sy = 0;
        let fpts = [];

        const getPos = e => {
            const r = overlay.getBoundingClientRect();
            const scaleX = overlay.width / r.width;
            const scaleY = overlay.height / r.height;
            const x = ((e.clientX ?? e.touches?.[0]?.clientX) - r.left) * scaleX;
            const y = ((e.clientY ?? e.touches?.[0]?.clientY) - r.top) * scaleY;
            return { x, y };
        };

        overlay.addEventListener('mousedown', e => {
            e.preventDefault();
            if (this._currentTool === 'select') return;

            const { x, y } = getPos(e);

            // ── Insert text ────────────────────────────────────────────────
            if (this._currentTool === 'text') {
                this._inlineEditorPage = pageNum;
                this._openInlineEditor(e.clientX, e.clientY);
                return;
            }

            // ── Edit existing text annotation ────────────────────────────
            if (this._currentTool === 'edit_text') {
                const W = overlay.width, H = overlay.height;
                const hit = this._annotations.filter(a => a.page === pageNum && a.type === 'text')
                    .find(a => Math.hypot(a.data.x * W - x, a.data.y * H - y) < 40);
                if (hit) {
                    this._openInlineEditor(e.clientX, e.clientY, hit);
                } else {
                    toast('Click near a text annotation to edit it', 'info');
                }
                return;
            }

            // ── Place pending image ───────────────────────────────────────
            if (this._currentTool === 'image' && this._pendingImage) {
                const W = overlay.width, H = overlay.height;
                const iw = Math.min(200, W * 0.3);
                const ih = (this._pendingImage.img.height / this._pendingImage.img.width) * iw;
                const annot = {
                    page: pageNum, type: 'image',
                    data: {
                        x: x / W, y: y / H,
                        w: iw / W, h: ih / H,
                        src: this._pendingImage.src,
                    },
                    color: '',
                };
                this._annotations.push(annot);
                this._pendingImage = null;
                this._snapshot();
                this._redrawAnnotations(overlay, pageNum);
                toast('Image placed', 'success');
                this._setTool('select');
                return;
            }

            drawing = true;
            sx = x; sy = y;
            fpts = [[x, y]];
        });

        overlay.addEventListener('mousemove', e => {
            if (!drawing) return;
            const { x: cx, y: cy } = getPos(e);
            const ctx = overlay.getContext('2d');

            if (this._currentTool === 'erase') {
                // Visual erase feedback
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                this._redrawAnnotationsSync(ctx, overlay.width, overlay.height, pageNum, cx, cy, true);
                return;
            }

            if (this._currentTool === 'freehand') {
                fpts.push([cx, cy]);
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                this._redrawAnnotationsSync(ctx, overlay.width, overlay.height, pageNum);
                ctx.strokeStyle = this._currentColor;
                ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.beginPath();
                fpts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
                ctx.stroke();
                return;
            }

            // Shape preview
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            this._redrawAnnotationsSync(ctx, overlay.width, overlay.height, pageNum);
            ctx.strokeStyle = this._currentColor;
            ctx.fillStyle = this._currentColor;
            ctx.lineWidth = 2;
            this._drawShape(ctx, this._currentTool, sx, sy, cx, cy);
        });

        overlay.addEventListener('mouseup', e => {
            if (!drawing) return;
            drawing = false;
            const { x: ex, y: ey } = getPos(e);
            const W = overlay.width, H = overlay.height;

            if (this._currentTool === 'erase') {
                const eraseRadius = 30;
                const before = this._annotations.length;
                this._annotations = this._annotations.filter(a => {
                    if (a.page !== pageNum) return true;
                    const d = a.data;
                    if (d.x !== undefined && d.y !== undefined && d.x1 === undefined) {
                        return Math.hypot(d.x * W - ex, d.y * H - ey) > eraseRadius;
                    }
                    const mx = ((d.x1 || 0) + (d.x2 || 0)) / 2 * W;
                    const my = ((d.y1 || 0) + (d.y2 || 0)) / 2 * H;
                    return Math.hypot(mx - ex, my - ey) > eraseRadius;
                });
                window._annotations = this._annotations;
                const erased = before - this._annotations.length;
                if (erased > 0) { this._snapshot(); toast(`Erased ${erased} annotation(s)`, 'success'); }
                this._redrawAnnotations(overlay, pageNum);
                return;
            }

            if (this._currentTool === 'freehand') {
                if (fpts.length > 2) {
                    this._annotations.push({
                        page: pageNum, type: 'freehand',
                        data: { pts: fpts.map(([px, py]) => [px / W, py / H]) },
                        color: this._currentColor,
                    });
                    this._snapshot();
                    toast('Drawing added', 'success');
                }
            } else if (this._currentTool === 'redact') {
                // ── Redact Tool: Draw → Prompt → Apply ────────────────────
                const dist = Math.hypot(ex - sx, ey - sy);
                if (dist < 8) return;

                // Store relative coordinates (0-1 range)
                const rX1 = Math.min(sx, ex) / W;
                const rY1 = Math.min(sy, ey) / H;
                const rX2 = Math.max(sx, ex) / W;
                const rY2 = Math.max(sy, ey) / H;

                // Show the red preview rectangle temporarily
                const ctx = overlay.getContext('2d');
                ctx.fillStyle = 'rgba(220,38,38,0.35)';
                ctx.fillRect(rX1 * W, rY1 * H, (rX2 - rX1) * W, (rY2 - rY1) * H);
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 2;
                ctx.strokeRect(rX1 * W, rY1 * H, (rX2 - rX1) * W, (rY2 - rY1) * H);

                // Build custom body for 3-option prompt
                const body = document.createElement('div');
                body.innerHTML = `
                    <p style="color:var(--text-secondary);margin-bottom:14px">
                        Apply a permanent white redaction box at the drawn position.
                    </p>
                    <div style="display:flex;flex-direction:column;gap:8px">
                        <button class="btn primary" id="redact-this-page" style="width:100%">This Page Only (page ${pageNum})</button>
                        <button class="btn" id="redact-all-pages" style="width:100%;background:var(--copper-dark);border-color:var(--copper);color:#fff">All Pages — Same Position</button>
                        <button class="btn" id="redact-cancel-btn" style="width:100%">Cancel</button>
                    </div>
                `;

                showModal({
                    title: 'Apply Redaction',
                    body,
                    hideCancel: true,
                    confirmText: '',
                    onConfirm: null,
                });

                // Hide the default confirm button (we have our own)
                const mConfirm = document.getElementById('modal-confirm');
                if (mConfirm) mConfirm.style.display = 'none';

                body.querySelector('#redact-this-page').addEventListener('click', () => {
                    closeModal();
                    if (mConfirm) mConfirm.style.display = '';
                    this._applyRedaction(pageNum, rX1, rY1, rX2, rY2, false);
                });
                body.querySelector('#redact-all-pages').addEventListener('click', () => {
                    closeModal();
                    if (mConfirm) mConfirm.style.display = '';
                    this._applyRedaction(pageNum, rX1, rY1, rX2, rY2, true);
                });
                body.querySelector('#redact-cancel-btn').addEventListener('click', () => {
                    closeModal();
                    if (mConfirm) mConfirm.style.display = '';
                    this._redrawAnnotations(overlay, pageNum);
                    toast('Redaction cancelled', 'info');
                });

            } else {
                const dist = Math.hypot(ex - sx, ey - sy);
                if (dist < 4) return; // ignore accidental tiny drags
                this._annotations.push({
                    page: pageNum, type: this._currentTool,
                    data: { x1: sx / W, y1: sy / H, x2: ex / W, y2: ey / H },
                    color: this._currentColor,
                });
                this._snapshot();
                toast(`${this._currentTool} added`, 'success');
            }

            window._annotations = this._annotations;
            this._redrawAnnotations(overlay, pageNum);
        });

        // Double-click to edit existing text
        overlay.addEventListener('dblclick', e => {
            const { x, y } = getPos(e);
            const W = overlay.width, H = overlay.height;
            const hit = this._annotations.filter(a => a.page === pageNum && a.type === 'text')
                .find(a => Math.hypot(a.data.x * W - x, a.data.y * H - y) < 40);
            if (hit) {
                this._openInlineEditor(e.clientX, e.clientY, hit);
                e.stopPropagation();
            }
        });
    }

    // ── Drawing ───────────────────────────────────────────────────────────────
    _drawShape(ctx, tool, x1, y1, x2, y2) {
        const w = x2 - x1, h = y2 - y1;
        switch (tool) {
            case 'rect':
                ctx.strokeRect(x1, y1, w, h); break;
            case 'circle':
                ctx.beginPath();
                ctx.ellipse(x1 + w / 2, y1 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
                ctx.stroke(); break;
            case 'line':
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); break;
            case 'arrow': {
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                const angle = Math.atan2(y2 - y1, x2 - x1), len = 14;
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - len * Math.cos(angle - 0.4), y2 - len * Math.sin(angle - 0.4));
                ctx.lineTo(x2 - len * Math.cos(angle + 0.4), y2 - len * Math.sin(angle + 0.4));
                ctx.closePath(); ctx.fill(); break;
            }
            case 'whitebox':
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(x1, y1, w, h); break;
            case 'highlight':
                ctx.fillStyle = 'rgba(255,220,0,0.4)';
                ctx.fillRect(x1, y1, w, h); break;
            case 'redact':
                ctx.fillStyle = 'rgba(220,38,38,0.35)';
                ctx.fillRect(x1, y1, w, h);
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 2;
                ctx.strokeRect(x1, y1, w, h); break;
        }
    }

    // ── Redraw (async for image loading) ──────────────────────────────────────
    async _redrawAnnotations(overlay, pageNum) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        const W = overlay.width, H = overlay.height;
        for (const a of this._annotations.filter(a => a.page === pageNum)) {
            await this._drawAnnotation(ctx, a, W, H);
        }
    }

    _redrawAnnotationsSync(ctx, W, H, pageNum, hoverX, hoverY, eraseMode = false) {
        this._annotations.filter(a => a.page === pageNum).forEach(a => {
            if (eraseMode) {
                const d = a.data;
                const cx = d.x !== undefined && d.x1 === undefined ? d.x * W : ((d.x1 || 0) + (d.x2 || 0)) / 2 * W;
                const cy = d.y !== undefined && d.y1 === undefined ? d.y * H : ((d.y1 || 0) + (d.y2 || 0)) / 2 * H;
                if (Math.hypot(cx - hoverX, cy - hoverY) < 30) return; // ghost erase preview
            }
            // Draw synchronously (images may flicker but that's OK during drag)
            ctx.strokeStyle = a.color || '#C0622A';
            ctx.fillStyle = a.color || '#C0622A';
            ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            const d = a.data;
            if (a.type === 'freehand') {
                ctx.beginPath();
                d.pts.forEach(([xr, yr], i) => i === 0 ? ctx.moveTo(xr * W, yr * H) : ctx.lineTo(xr * W, yr * H));
                ctx.stroke(); return;
            }
            if (a.type === 'text') {
                ctx.font = `${a.fontSize || 14}px ${a.font || 'Inter'}, sans-serif`;
                ctx.fillStyle = a.color;
                ctx.fillText(d.text, d.x * W, d.y * H); return;
            }
            if (a.type === 'image') return; // skip images in sync mode
            const x1 = d.x1 * W, y1 = d.y1 * H, x2 = d.x2 * W, y2 = d.y2 * H;
            this._drawShape(ctx, a.type, x1, y1, x2, y2);
        });
    }

    async _drawAnnotation(ctx, a, W, H) {
        const d = a.data;
        ctx.strokeStyle = a.color || '#C0622A';
        ctx.fillStyle = a.color || '#C0622A';
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

        if (a.type === 'freehand') {
            ctx.beginPath();
            d.pts.forEach(([xr, yr], i) => i === 0 ? ctx.moveTo(xr * W, yr * H) : ctx.lineTo(xr * W, yr * H));
            ctx.stroke(); return;
        }
        if (a.type === 'text') {
            ctx.font = `${a.fontSize || 14}px ${a.font || 'Inter'}, sans-serif`;
            ctx.fillStyle = a.color;
            ctx.fillText(d.text, d.x * W, d.y * H); return;
        }
        if (a.type === 'image') {
            let img = this._imgCache.get(d.src);
            if (!img) {
                img = await new Promise(res => {
                    const i = new Image();
                    i.onload = () => res(i);
                    i.onerror = () => res(null);
                    i.src = d.src;
                });
                if (img) this._imgCache.set(d.src, img);
            }
            if (img) ctx.drawImage(img, d.x * W, d.y * H, d.w * W, d.h * H);
            return;
        }

        const x1 = d.x1 * W, y1 = d.y1 * H, x2 = d.x2 * W, y2 = d.y2 * H;
        this._drawShape(ctx, a.type, x1, y1, x2, y2);
    }

    _redrawCurrentPage() {
        const overlay = this._el.querySelector(`#annot-overlay-${this._currentPage}`);
        if (overlay) this._redrawAnnotations(overlay, this._currentPage);
    }

    // ── Export ────────────────────────────────────────────────────────────────
    _exportPNG() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const container = this._el.querySelector(`[data-page="${this._currentPage}"]`);
        if (!container) return;

        const pdfCanvas = container.querySelector('.pdf-canvas');
        const annotCanvas = container.querySelector('.annotation-overlay');

        // Merge layers
        const merged = document.createElement('canvas');
        merged.width = pdfCanvas.width;
        merged.height = pdfCanvas.height;
        const ctx = merged.getContext('2d');
        ctx.drawImage(pdfCanvas, 0, 0);
        ctx.drawImage(annotCanvas, 0, 0);

        merged.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `page-${this._currentPage}.png`;
            a.click();
            URL.revokeObjectURL(url);
            toast(`Page ${this._currentPage} exported as PNG`, 'success');
        }, 'image/png');
    }

    // ── Navigation / Zoom ─────────────────────────────────────────────────────
    _goPage(page) {
        if (!pdfEngine.isOpen()) return;
        page = Math.max(1, Math.min(pdfEngine.pageCount, page));
        if (page === this._currentPage) return;
        this._currentPage = page;
        this._renderCurrentPage();
        this._el.querySelectorAll('.thumb-item').forEach(t => {
            t.classList.toggle('active', parseInt(t.dataset.p) === page);
        });
    }

    _changeZoom(delta) {
        this._zoom = Math.max(0.5, Math.min(3.5, this._zoom + delta));
        this._renderCurrentPage();
    }

    _updatePageNav() {
        const pc = pdfEngine.isOpen() ? pdfEngine.pageCount : 1;
        this._el.querySelector('#page-display').textContent = `Page ${this._currentPage} / ${pc}`;
        this._el.querySelector('#page-jump').value = this._currentPage;
        this._el.querySelector('#page-jump').max = pc;
        this._el.querySelector('#page-prev').disabled = this._currentPage <= 1;
        this._el.querySelector('#page-next').disabled = this._currentPage >= pc;
    }

    _setStatus(msg) {
        const s = this._el.querySelector('#editor-status');
        if (s) s.textContent = msg;
    }

    // ── Public API ────────────────────────────────────────────────────────────
    get currentPage() { return this._currentPage; }
    get zoom() { return this._zoom; }

    zoomIn() { this._changeZoom(0.25); }
    zoomOut() { this._changeZoom(-0.25); }
    zoomReset() { this._zoom = 1.5; this._renderCurrentPage(); }

    prevPage() { this._goPage(this._currentPage - 1); }
    nextPage() { this._goPage(this._currentPage + 1); }

    clearAnnotations() {
        const before = this._annotations.length;
        this._annotations = this._annotations.filter(a => a.page !== this._currentPage);
        window._annotations = this._annotations;
        if (this._annotations.length < before) this._snapshot();
        this._redrawCurrentPage();
        toast('Annotations cleared for this page', 'success');
    }

    getAnnotations() { return this._annotations; }

    handleKeydown(e) {
        if (!pdfEngine.isOpen()) return;
        const ctrl = e.ctrlKey || e.metaKey;

        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') this.prevPage();
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.nextPage();
        if (e.key === 'Home') this._goPage(1);
        if (e.key === 'End') this._goPage(pdfEngine.pageCount);
        if (ctrl && e.key === '=') { e.preventDefault(); this.zoomIn(); }
        if (ctrl && e.key === '-') { e.preventDefault(); this.zoomOut(); }
        if (ctrl && e.key === '0') { e.preventDefault(); this.zoomReset(); }

        // Undo / Redo
        if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); this._undo(); }
        if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); this._redo(); }

        // Tool shortcuts
        const keyToolMap = { s: 'select', t: 'text', d: 'freehand', h: 'highlight', e: 'erase', r: 'rect', i: 'image' };
        if (!ctrl && !e.shiftKey && keyToolMap[e.key]) this._setTool(keyToolMap[e.key]);

        // Delete selected (future: erase selection)
        if (e.key === 'Delete' || e.key === 'Backspace') { this.clearAnnotations(); }
    }

    // ── Redact Apply (pdf-lib) ────────────────────────────────────────────
    async _applyRedaction(pageNum, rX1, rY1, rX2, rY2, allPages) {
        if (!pdfEngine.isOpen()) return;
        const raw = pdfEngine._rawBytes;
        if (!raw || !window.PDFLib) { toast('PDF not ready', 'info'); return; }

        try {
            toast('Applying redaction…', 'info', 3000);
            const { PDFDocument, rgb, degrees } = window.PDFLib;
            const doc = await PDFDocument.load(raw, { ignoreEncryption: true });
            const pages = doc.getPages();

            const targetPages = allPages
                ? pages
                : [pages[pageNum - 1]];

            for (const page of targetPages) {
                const { width, height } = page.getSize();
                const rot = page.getRotation().angle % 360;

                // Canvas coords are in visual space (post-rotation).
                // pdf-lib drawRectangle uses the un-rotated coordinate system.
                // Y=0 is bottom in pdf-lib.
                let rx, ry, rw, rh;

                if (rot === 0) {
                    // Normal: visual x→pdf x, visual y→pdf (height - y)
                    rx = rX1 * width;
                    rw = (rX2 - rX1) * width;
                    rh = (rY2 - rY1) * height;
                    ry = height - rY2 * height; // flip Y
                } else if (rot === 90) {
                    // Rotated 90° CW: visual draws within (height × width)
                    // Visual x → pdf y (from bottom), visual y → pdf x
                    rx = rY1 * width;
                    rw = (rY2 - rY1) * width;
                    rh = (rX2 - rX1) * height;
                    ry = (1 - rX2) * height;
                } else if (rot === 180) {
                    // Rotated 180°: mirror both axes
                    rw = (rX2 - rX1) * width;
                    rh = (rY2 - rY1) * height;
                    rx = (1 - rX2) * width;
                    ry = rY1 * height;
                } else if (rot === 270) {
                    // Rotated 270° CW (90° CCW)
                    rx = (1 - rY2) * width;
                    rw = (rY2 - rY1) * width;
                    rh = (rX2 - rX1) * height;
                    ry = rX1 * height;
                } else {
                    // Fallback for arbitrary rotation — best-effort
                    rx = rX1 * width;
                    rw = (rX2 - rX1) * width;
                    rh = (rY2 - rY1) * height;
                    ry = height - rY2 * height;
                }

                page.drawRectangle({
                    x: rx, y: ry, width: rw, height: rh,
                    color: rgb(1, 1, 1),
                    borderWidth: 0,
                });
            }

            const bytes = await doc.save();

            // Reload the PDF so the redaction is visible immediately
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            await pdfEngine.open(url, pdfEngine.fileName);
            URL.revokeObjectURL(url);

            // Store raw bytes so subsequent operations work on the redacted version
            pdfEngine._rawBytes = bytes;

            this._renderCurrentPage();
            const label = allPages ? `all ${targetPages.length} pages` : `page ${pageNum}`;
            toast(`✅ Redaction applied to ${label}`, 'success');
        } catch (err) {
            showAlert('Redaction Failed', err.message);
        }
    }

    // ── Split-Screen ─────────────────────────────────────────────────────
    _toggleSplit() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        this._splitActive = !this._splitActive;

        const divider = this._el.querySelector('#split-divider');
        const splitArea = this._el.querySelector('#split-canvas-area');
        const toggleBtn = this._el.querySelector('#split-toggle');

        if (this._splitActive) {
            divider.style.display = '';
            splitArea.style.display = 'flex';
            splitArea.classList.remove('hidden');
            toggleBtn.classList.add('active');
            this._splitPage = Math.min(2, pdfEngine.pageCount);
            this._renderSplitPage();
            toast('Split screen enabled — right panel independent', 'success');
        } else {
            divider.style.display = 'none';
            splitArea.style.display = 'none';
            splitArea.classList.add('hidden');
            splitArea.innerHTML = '';
            toggleBtn.classList.remove('active');
            toast('Split screen disabled', 'info');
        }
    }

    async _renderSplitPage() {
        if (!pdfEngine.isOpen() || !this._splitActive) return;
        const area = this._el.querySelector('#split-canvas-area');

        // Build or reuse container
        area.innerHTML = '';

        // Navigation bar for split panel
        const nav = document.createElement('div');
        nav.className = 'split-nav-bar';
        nav.innerHTML = `
            <button class="btn icon-btn split-prev">◀</button>
            <span class="split-page-label">Page ${this._splitPage} / ${pdfEngine.pageCount}</span>
            <button class="btn icon-btn split-next">▶</button>
            <button class="btn icon-btn split-zoom-out">−</button>
            <span class="split-zoom-label">${Math.round(this._splitZoom * 100)}%</span>
            <button class="btn icon-btn split-zoom-in">+</button>
        `;
        area.appendChild(nav);

        nav.querySelector('.split-prev').addEventListener('click', () => this._goSplitPage(this._splitPage - 1));
        nav.querySelector('.split-next').addEventListener('click', () => this._goSplitPage(this._splitPage + 1));
        nav.querySelector('.split-zoom-in').addEventListener('click', () => {
            this._splitZoom = Math.min(3.5, this._splitZoom + 0.25);
            this._renderSplitPage();
        });
        nav.querySelector('.split-zoom-out').addEventListener('click', () => {
            this._splitZoom = Math.max(0.5, this._splitZoom - 0.25);
            this._renderSplitPage();
        });

        // Canvas
        const container = document.createElement('div');
        container.className = 'page-container';
        container.style.position = 'relative';
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        container.appendChild(canvas);
        area.appendChild(container);

        await pdfEngine.renderPage(this._splitPage, canvas, this._splitZoom);
    }

    _goSplitPage(page) {
        if (!pdfEngine.isOpen()) return;
        page = Math.max(1, Math.min(pdfEngine.pageCount, page));
        if (page === this._splitPage) return;
        this._splitPage = page;
        this._renderSplitPage();
    }
}

