/**
 * tools-view.js — PDF Tools (Page Numbers, Header/Footer, Split, Redact, Metadata Strip)
 * Ported from OLDPDFEditor modules.py — all operations use pdf-lib client-side.
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showAlert, showConfirm } from '../components/modal.js';

export class ToolsView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._render();
    }

    /* ═══════════════════════════════════════════════════════════════════════
       RENDER
    ═══════════════════════════════════════════════════════════════════════ */
    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>PDF Tools</h2>
        <p>Page numbers, headers, split, redaction & metadata — all client-side</p>
      </div>

      <div class="tabs-header">
        <button class="tab-btn active" data-tab="pagenums">Page Numbers</button>
        <button class="tab-btn" data-tab="headfoot">Header / Footer</button>
        <button class="tab-btn" data-tab="split">Split PDF</button>
        <button class="tab-btn" data-tab="redact-area">Redact Area</button>
        <button class="tab-btn" data-tab="metadata-strip">Metadata</button>
      </div>

      <!-- ─── PAGE NUMBERS ───────────────────────────────────────────── -->
      <div class="tab-panel active tools-body" data-panel="pagenums">
        <div class="group-box">
          <div class="group-box-title">Add Page Numbers</div>
          <div class="tools-form">
            <div class="tools-row">
              <label>Format</label>
              <select id="pn-format">
                <option value="full">Page n of N</option>
                <option value="simple">n</option>
              </select>
            </div>
            <div class="tools-row">
              <label>Position</label>
              <select id="pn-position">
                <option value="bc">Bottom Center</option>
                <option value="br">Bottom Right</option>
                <option value="bl">Bottom Left</option>
                <option value="tc">Top Center</option>
                <option value="tr">Top Right</option>
              </select>
            </div>
            <div class="tools-row">
              <label>Font Size (pt)</label>
              <input type="number" id="pn-fontsize" value="10" min="6" max="72"/>
            </div>
            <div class="tools-row">
              <label>Distance from edge (pt)</label>
              <input type="number" id="pn-dist-edge" value="20" min="5" max="200"/>
            </div>
            <div class="tools-row">
              <label>Distance from top/bottom (pt)</label>
              <input type="number" id="pn-dist-tb" value="25" min="5" max="200"/>
            </div>
            <div class="tools-row">
              <label>Skip pages (no number, no count)</label>
              <input type="text" id="pn-skip" placeholder="e.g. 1, 3-5"/>
            </div>
            <div class="tools-row">
              <label>Omit pages (count continues, text hidden)</label>
              <input type="text" id="pn-omit" placeholder="e.g. 2, 6"/>
            </div>
            <button class="btn primary" id="pn-apply" style="margin-top:8px">Add Page Numbers & Download</button>
          </div>
        </div>
      </div>

      <!-- ─── HEADER / FOOTER ────────────────────────────────────────── -->
      <div class="tab-panel tools-body" data-panel="headfoot">
        <div class="group-box">
          <div class="group-box-title">Add Header / Footer</div>
          <div class="tools-form">
            <div class="tools-row">
              <label>Text</label>
              <input type="text" id="hf-text" placeholder="e.g. CONFIDENTIAL"/>
            </div>
            <button class="btn sm" id="hf-draft" style="margin-bottom:6px">Load DRAFT Preset</button>
            <div class="tools-row">
              <label>Type</label>
              <select id="hf-type"><option>Header</option><option>Footer</option></select>
            </div>
            <div class="tools-row">
              <label>Alignment</label>
              <select id="hf-align"><option>Center</option><option>Left</option><option>Right</option></select>
            </div>
            <div class="tools-row">
              <label>Font Size (pt)</label>
              <input type="number" id="hf-size" value="26" min="8" max="72"/>
            </div>
            <div class="tools-row">
              <label>Color</label>
              <select id="hf-color">
                <option value="#000000">Black</option>
                <option value="#cc0000" selected>Red</option>
                <option value="#0000cc">Blue</option>
                <option value="#008000">Green</option>
                <option value="#888888">Gray</option>
              </select>
            </div>
            <div class="tools-row">
              <label>Distance from top/bottom (pt)</label>
              <input type="number" id="hf-dist-tb" value="15" min="5" max="200"/>
            </div>
            <div class="tools-row">
              <label>Distance from edge (pt)</label>
              <input type="number" id="hf-dist-edge" value="20" min="5" max="200"/>
            </div>
            <button class="btn primary" id="hf-apply" style="margin-top:8px">Add Header/Footer & Download</button>
          </div>
        </div>
      </div>

      <!-- ─── SPLIT PDF ──────────────────────────────────────────────── -->
      <div class="tab-panel tools-body" data-panel="split">
        <div class="group-box">
          <div class="group-box-title">Split PDF by Page Ranges</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:10px">
            Enter page ranges to extract (e.g. <code>1-3, 5, 7-10</code>).
          </p>
          <div class="tools-row">
            <label>Page Ranges</label>
            <input type="text" id="split-ranges" placeholder="1-3, 5-7" style="flex:1"/>
          </div>
          <div id="split-total" style="font-size:11px;color:var(--text-muted);margin:6px 0"></div>
          <button class="btn primary" id="split-apply">Split & Download</button>
        </div>
      </div>

      <!-- ─── REDACT AREA (Draw-Box) ─────────────────────────────────── -->
      <div class="tab-panel tools-body" data-panel="redact-area">
        <div class="group-box">
          <div class="group-box-title">Redact by Drawing (All Pages)</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:12px">
            This feature draws a white rectangle at a chosen <b>relative position</b> on <b>every page</b>.
            Ideal for removing page numbers, footers, or watermarks that appear in the same spot on all pages.
          </p>
          <div class="tools-row">
            <label>X (% from left)</label>
            <input type="number" id="redact-x" value="40" min="0" max="100" step="1"/>
          </div>
          <div class="tools-row">
            <label>Y (% from top)</label>
            <input type="number" id="redact-y" value="95" min="0" max="100" step="1"/>
          </div>
          <div class="tools-row">
            <label>Width (%)</label>
            <input type="number" id="redact-w" value="20" min="1" max="100" step="1"/>
          </div>
          <div class="tools-row">
            <label>Height (%)</label>
            <input type="number" id="redact-h" value="4" min="1" max="100" step="1"/>
          </div>
          <div id="redact-preview-wrap" style="position:relative;width:160px;height:220px;border:1px solid var(--border);border-radius:6px;margin:8px 0;background:var(--bg-card);overflow:hidden">
            <div id="redact-preview-box" style="position:absolute;background:rgba(220,38,38,0.5);border:1px solid #dc2626;pointer-events:none"></div>
          </div>
          <p style="font-size:10px;color:var(--text-muted)">Red box = area to redact on every page</p>
          <button class="btn primary" id="redact-area-apply" style="margin-top:4px">Redact & Download</button>
          <div class="divider-h" style="margin:14px 0"></div>
          <p style="font-size:11px;color:var(--text-muted)"><strong>Tip:</strong> To visually select the area, switch to <strong>Editor → Whitebox tool</strong> and draw directly on the page.</p>
        </div>
      </div>

      <!-- ─── METADATA STRIP ─────────────────────────────────────────── -->
      <div class="tab-panel tools-body" data-panel="metadata-strip">
        <div class="group-box">
          <div class="group-box-title">Remove PDF Metadata</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:12px">
            Strips Author, Creator, Producer, Subject, Keywords and custom metadata from the PDF. 
            Useful for privacy or before sharing documents externally.
          </p>
          <div id="meta-current" style="margin-bottom:12px">
            <div style="color:var(--text-disabled);font-size:11px">Open a PDF, then click "Load" to inspect.</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn" id="meta-load-btn">Load Current Metadata</button>
            <button class="btn primary" id="meta-strip-btn">Strip All Metadata & Download</button>
          </div>
        </div>
      </div>
    `;

        this._bindTabs();
        this._bindPageNumbers();
        this._bindHeaderFooter();
        this._bindSplit();
        this._bindRedactArea();
        this._bindMetadata();
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

    /* ── Helpers ─────────────────────────────────────────────────────────── */
    _parsePageSet(str) {
        const pages = new Set();
        if (!str) return pages;
        str.split(',').forEach(part => {
            part = part.trim();
            if (!part) return;
            if (part.includes('-')) {
                const [a, b] = part.split('-').map(Number);
                if (!isNaN(a) && !isNaN(b)) for (let i = a; i <= b; i++) pages.add(i);
            } else {
                const n = parseInt(part, 10);
                if (!isNaN(n)) pages.add(n);
            }
        });
        return pages;
    }

    _downloadBlob(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       PAGE NUMBERS  (ported from OLDPDFEditor add_page_numbers)
    ═══════════════════════════════════════════════════════════════════════ */
    _bindPageNumbers() {
        this._el.querySelector('#pn-apply').addEventListener('click', () => this._applyPageNumbers());
    }

    async _applyPageNumbers() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const raw = pdfEngine._rawBytes;
        if (!raw || !window.PDFLib) { toast('PDF not ready', 'info'); return; }

        try {
            toast('Adding page numbers…', 'info', 3000);
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.load(raw, { ignoreEncryption: true });
            const font = await doc.embedFont(StandardFonts.Helvetica);

            const format   = this._el.querySelector('#pn-format').value;
            const position = this._el.querySelector('#pn-position').value;
            const fontSize = parseInt(this._el.querySelector('#pn-fontsize').value) || 10;
            const distEdge = parseInt(this._el.querySelector('#pn-dist-edge').value) || 20;
            const distTB   = parseInt(this._el.querySelector('#pn-dist-tb').value) || 25;
            const skipped  = this._parsePageSet(this._el.querySelector('#pn-skip').value);
            const omitted  = this._parsePageSet(this._el.querySelector('#pn-omit').value);

            const pages = doc.getPages();
            const totalEligible = pages.length - [...skipped].filter(p => p >= 1 && p <= pages.length).length;
            let seqNum = 1;

            for (let i = 0; i < pages.length; i++) {
                const pgIdx = i + 1;
                if (skipped.has(pgIdx)) continue;

                if (!omitted.has(pgIdx)) {
                    const page = pages[i];
                    const { width, height } = page.getSize();

                    const text = format === 'simple'
                        ? `${seqNum}`
                        : `Page ${seqNum} of ${totalEligible}`;

                    const tw = font.widthOfTextAtSize(text, fontSize);
                    let x, y;

                    // Y position
                    const isTop = position.startsWith('t');
                    y = isTop ? height - distTB - fontSize : distTB;

                    // X position
                    if (position.endsWith('c')) {
                        x = (width - tw) / 2;
                    } else if (position.endsWith('r')) {
                        x = width - distEdge - tw;
                    } else {
                        x = distEdge;
                    }

                    page.drawText(text, {
                        x, y, size: fontSize, font,
                        color: rgb(0, 0, 0),
                    });
                }
                seqNum++;
            }

            const bytes = await doc.save();
            const name = pdfEngine.fileName.replace('.pdf', '') + '-numbered.pdf';
            this._downloadBlob(bytes, name);
            toast(`✅ Page numbers added — ${name}`, 'success');
        } catch (err) {
            showAlert('Page Numbers Failed', err.message);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       HEADER / FOOTER  (ported from OLDPDFEditor add_header_footer)
    ═══════════════════════════════════════════════════════════════════════ */
    _bindHeaderFooter() {
        this._el.querySelector('#hf-draft').addEventListener('click', () => {
            this._el.querySelector('#hf-text').value = 'DRAFT';
            this._el.querySelector('#hf-type').value = 'Header';
            this._el.querySelector('#hf-align').value = 'Center';
            this._el.querySelector('#hf-size').value = '26';
            this._el.querySelector('#hf-color').value = '#cc0000';
            this._el.querySelector('#hf-dist-tb').value = '15';
            toast('DRAFT preset loaded', 'success');
        });
        this._el.querySelector('#hf-apply').addEventListener('click', () => this._applyHeaderFooter());
    }

    async _applyHeaderFooter() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const raw = pdfEngine._rawBytes;
        if (!raw || !window.PDFLib) { toast('PDF not ready', 'info'); return; }

        const text = this._el.querySelector('#hf-text').value.trim();
        if (!text) { toast('Enter text first', 'info'); return; }

        try {
            toast('Adding header/footer…', 'info', 3000);
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.load(raw, { ignoreEncryption: true });
            const font = await doc.embedFont(StandardFonts.TimesRoman);

            const isHeader = this._el.querySelector('#hf-type').value === 'Header';
            const align    = this._el.querySelector('#hf-align').value;
            const fontSize = parseInt(this._el.querySelector('#hf-size').value) || 26;
            const distTB   = parseInt(this._el.querySelector('#hf-dist-tb').value) || 15;
            const distEdge = parseInt(this._el.querySelector('#hf-dist-edge').value) || 20;
            const hex      = this._el.querySelector('#hf-color').value;

            // Parse hex color → rgb
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;

            const pages = doc.getPages();
            for (const page of pages) {
                const { width, height } = page.getSize();
                const tw = font.widthOfTextAtSize(text, fontSize);

                let x;
                if (align === 'Center') x = (width - tw) / 2;
                else if (align === 'Left') x = distEdge;
                else x = width - distEdge - tw;

                const y = isHeader
                    ? height - distTB - fontSize
                    : distTB;

                page.drawText(text, {
                    x, y, size: fontSize, font,
                    color: rgb(r, g, b),
                });
            }

            const bytes = await doc.save();
            const name = pdfEngine.fileName.replace('.pdf', '') + '-stamped.pdf';
            this._downloadBlob(bytes, name);
            toast(`✅ ${isHeader ? 'Header' : 'Footer'} added — ${name}`, 'success');
        } catch (err) {
            showAlert('Header/Footer Failed', err.message);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       SPLIT PDF  (ported from OLDPDFEditor split_pdf)
    ═══════════════════════════════════════════════════════════════════════ */
    _bindSplit() {
        const inp = this._el.querySelector('#split-ranges');
        inp.addEventListener('input', () => {
            if (!pdfEngine.isOpen()) return;
            const pages = this._parsePageSet(inp.value);
            const valid = [...pages].filter(p => p >= 1 && p <= pdfEngine.pageCount);
            this._el.querySelector('#split-total').textContent =
                `${valid.length} page(s) selected out of ${pdfEngine.pageCount}`;
        });
        this._el.querySelector('#split-apply').addEventListener('click', () => this._applySplit());
    }

    async _applySplit() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const raw = pdfEngine._rawBytes;
        if (!raw || !window.PDFLib) { toast('PDF not ready', 'info'); return; }

        const rangeStr = this._el.querySelector('#split-ranges').value.trim();
        if (!rangeStr) { toast('Enter page ranges', 'info'); return; }

        try {
            toast('Splitting PDF…', 'info', 3000);
            const { PDFDocument } = window.PDFLib;
            const src = await PDFDocument.load(raw, { ignoreEncryption: true });
            const pages = this._parsePageSet(rangeStr);
            const valid = [...pages].filter(p => p >= 1 && p <= src.getPageCount()).sort((a, b) => a - b);

            if (!valid.length) { toast('No valid pages in range', 'info'); return; }

            const newDoc = await PDFDocument.create();
            const indices = valid.map(p => p - 1);
            const copied = await newDoc.copyPages(src, indices);
            copied.forEach(p => newDoc.addPage(p));

            const bytes = await newDoc.save();
            const name = pdfEngine.fileName.replace('.pdf', '') + `-split-${valid.length}pages.pdf`;
            this._downloadBlob(bytes, name);
            toast(`✅ Split ${valid.length} pages — ${name}`, 'success');
        } catch (err) {
            showAlert('Split Failed', err.message);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       REDACT AREA (all-pages whitebox — ported from redact_custom_location)
    ═══════════════════════════════════════════════════════════════════════ */
    _bindRedactArea() {
        const inputs = ['redact-x', 'redact-y', 'redact-w', 'redact-h'];
        inputs.forEach(id => {
            this._el.querySelector(`#${id}`).addEventListener('input', () => this._updateRedactPreview());
        });
        this._updateRedactPreview();
        this._el.querySelector('#redact-area-apply').addEventListener('click', () => this._applyRedactArea());
    }

    _updateRedactPreview() {
        const x = parseFloat(this._el.querySelector('#redact-x').value) || 0;
        const y = parseFloat(this._el.querySelector('#redact-y').value) || 0;
        const w = parseFloat(this._el.querySelector('#redact-w').value) || 0;
        const h = parseFloat(this._el.querySelector('#redact-h').value) || 0;

        const box = this._el.querySelector('#redact-preview-box');
        const wrap = this._el.querySelector('#redact-preview-wrap');
        const pw = wrap.clientWidth;
        const ph = wrap.clientHeight;
        box.style.left   = (x / 100 * pw) + 'px';
        box.style.top    = (y / 100 * ph) + 'px';
        box.style.width  = (w / 100 * pw) + 'px';
        box.style.height = (h / 100 * ph) + 'px';
    }

    async _applyRedactArea() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const raw = pdfEngine._rawBytes;
        if (!raw || !window.PDFLib) { toast('PDF not ready', 'info'); return; }

        const xPct = parseFloat(this._el.querySelector('#redact-x').value) / 100;
        const yPct = parseFloat(this._el.querySelector('#redact-y').value) / 100;
        const wPct = parseFloat(this._el.querySelector('#redact-w').value) / 100;
        const hPct = parseFloat(this._el.querySelector('#redact-h').value) / 100;

        try {
            toast('Redacting area on all pages…', 'info', 3000);
            const { PDFDocument, rgb } = window.PDFLib;
            const doc = await PDFDocument.load(raw, { ignoreEncryption: true });
            const pages = doc.getPages();

            for (const page of pages) {
                const { width, height } = page.getSize();
                // pdf-lib y=0 is bottom
                const rx = xPct * width;
                const ry = height - (yPct * height) - (hPct * height);
                const rw = wPct * width;
                const rh = hPct * height;

                page.drawRectangle({
                    x: rx, y: ry, width: rw, height: rh,
                    color: rgb(1, 1, 1),
                    borderWidth: 0,
                });
            }

            const bytes = await doc.save();
            const name = pdfEngine.fileName.replace('.pdf', '') + '-redacted.pdf';
            this._downloadBlob(bytes, name);
            toast(`✅ Redacted ${pages.length} pages — ${name}`, 'success');
        } catch (err) {
            showAlert('Redaction Failed', err.message);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       METADATA STRIP  (ported from sanitize_pdf metadata removal)
    ═══════════════════════════════════════════════════════════════════════ */
    _bindMetadata() {
        this._el.querySelector('#meta-load-btn').addEventListener('click', async () => {
            if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
            const meta = await pdfEngine.getMetadata();
            const box = this._el.querySelector('#meta-current');
            const fields = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
            box.innerHTML = fields.map(f => {
                const val = meta[f] || '—';
                return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                  <span style="min-width:100px;font-size:11px;color:var(--text-muted);font-weight:600">${f}:</span>
                  <span style="font-size:11px;color:var(--text-secondary)">${String(val).replace(/</g, '&lt;')}</span>
                </div>`;
            }).join('');
            toast('Metadata loaded', 'success');
        });

        this._el.querySelector('#meta-strip-btn').addEventListener('click', () => this._stripMetadata());
    }

    async _stripMetadata() {
        if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
        const raw = pdfEngine._rawBytes;
        if (!raw || !window.PDFLib) { toast('PDF not ready', 'info'); return; }

        try {
            toast('Stripping metadata…', 'info', 3000);
            const { PDFDocument } = window.PDFLib;
            const doc = await PDFDocument.load(raw, { ignoreEncryption: true });

            doc.setTitle('');
            doc.setAuthor('');
            doc.setSubject('');
            doc.setKeywords([]);
            doc.setCreator('');
            doc.setProducer('');

            const bytes = await doc.save();
            const name = pdfEngine.fileName.replace('.pdf', '') + '-clean.pdf';
            this._downloadBlob(bytes, name);
            toast(`✅ Metadata stripped — ${name}`, 'success');
        } catch (err) {
            showAlert('Metadata Strip Failed', err.message);
        }
    }

    onViewActivated() { }
}
