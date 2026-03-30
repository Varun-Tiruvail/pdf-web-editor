/**
 * convert-view.js v2.1 — Export & Convert View
 * NOW FULLY CLIENT-SIDE via pdf-lib (window.PDFLib):
 *   ✅ Merge multiple PDFs into one download
 *   ✅ Split by page range → real PDF output
 *   ✅ Extract each page as individual PDF
 *   ✅ Images (PNG/JPEG) → PDF
 *   ✅ Export all/current pages as images
 *   ✅ Extract full text
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showAlert } from '../components/modal.js';

// Helper: get PDFLib from global or throw
const getPDFLib = () => {
    if (!window.PDFLib) throw new Error('pdf-lib not loaded — check internet connection');
    return window.PDFLib;
};

// Helper: read File → ArrayBuffer
const fileToBuffer = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = rej;
    r.readAsArrayBuffer(f);
});

// Helper: download Uint8Array as a named file
// NOTE: anchor MUST be appended to document.body before .click()
// otherwise browsers ignore the `download` attribute and use the blob UUID as filename
const downloadBytes = (bytes, filename) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
};

export class ConvertView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._imgFiles   = [];  // File[] for Images→PDF
        this._mergeFiles = [];  // { file, name }[] for merge list
        this._render();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Export & Convert</h2>
        <p>All operations run <strong style="color:var(--copper)">100% in your browser</strong> — no server required</p>
      </div>

      <!-- Tabs -->
      <div class="tabs-header">
        <button class="tab-btn active" data-tab="export">Export</button>
        <button class="tab-btn" data-tab="import">Import / Merge</button>
        <button class="tab-btn" data-tab="split">Split / Extract</button>
      </div>

      <!-- ── EXPORT TAB ─────────────────────────────────── -->
      <div class="tab-panel active convert-body" data-panel="export">

        <!-- PDF → Images -->
        <div class="group-box">
          <div class="group-box-title">PDF → Images <span class="badge-client">Client-Side ✅</span></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
            <label>Format:</label>
            <select id="img-fmt" style="width:90px">
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/webp">WebP</option>
            </select>
            <label>Scale:</label>
            <select id="img-scale" style="width:100px">
              <option value="1">1× (72 dpi)</option>
              <option value="2" selected>2× (150 dpi)</option>
              <option value="3">3× (216 dpi)</option>
              <option value="4">4× (288 dpi)</option>
            </select>
            <label>Quality:</label>
            <input type="range" id="img-quality" min="0.5" max="1" step="0.05" value="0.92"
                   style="width:80px" title="JPEG/WebP quality"/>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="exp-img-all">Export All Pages</button>
            <button class="btn" id="exp-img-page">Export Current Page</button>
          </div>
          <div id="exp-progress" style="display:none;margin-top:10px">
            <div style="background:var(--bg-card);border-radius:4px;height:8px;overflow:hidden">
              <div id="exp-prog-bar" style="height:100%;background:var(--copper);width:0%;transition:width 0.2s"></div>
            </div>
            <div id="exp-prog-label" style="font-size:11px;color:var(--text-muted);margin-top:4px">Exporting…</div>
          </div>
        </div>

        <!-- PDF → Text -->
        <div class="group-box">
          <div class="group-box-title">PDF → Plain Text <span class="badge-client">Client-Side ✅</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:10px">
            Extracts all text using PDF.js. Layout-based DOCX conversion requires a backend.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="exp-text">Download as .txt</button>
            <button class="btn" id="exp-text-preview">Preview Text</button>
            <button class="btn" id="exp-html">Export as HTML</button>
          </div>
          <textarea id="text-preview" style="display:none;width:100%;margin-top:10px;height:160px;font-size:11px;font-family:var(--font-mono)" readonly></textarea>
        </div>

        <!-- Export with Annotations (merged canvas) -->
        <div class="group-box">
          <div class="group-box-title">Export with Annotations <span class="badge-client">Client-Side ✅</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:10px">
            Exports the current page as a PNG with all canvas annotations baked in.
          </p>
          <button class="btn primary" id="exp-annotated">Export Page with Annotations (PNG)</button>
        </div>

        <!-- DOCX stub -->
        <div class="group-box">
          <div class="group-box-title">PDF → DOCX <span class="badge-backend">Requires Backend ⚙</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:10px">
            Layout-preserving Word conversion needs Python + <code>pdf2docx</code>. Text content is exported instead.
          </p>
          <button class="btn" id="exp-docx">Download text as .docx.txt</button>
        </div>
      </div>

      <!-- ── IMPORT / MERGE TAB ──────────────────────────── -->
      <div class="tab-panel convert-body" data-panel="import">

        <!-- Images → PDF -->
        <div class="group-box">
          <div class="group-box-title">Images → PDF <span class="badge-client">Client-Side ✅</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:8px">
            Select PNG/JPEG images — each becomes one page in the output PDF.
          </p>
          <div class="list-widget" id="img-list" style="min-height:70px;max-height:160px"></div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn" id="img-add">Add Images…</button>
            <button class="btn" id="img-sort">Sort by Name</button>
            <button class="btn" id="img-clear">Clear</button>
            <input type="file" id="img-file-in" accept="image/png,image/jpeg,image/webp" multiple style="display:none"/>
          </div>
          <button class="btn primary" id="img-to-pdf" style="width:100%;margin-top:10px">
            Convert to PDF & Download
          </button>
        </div>

        <!-- Merge PDFs -->
        <div class="group-box">
          <div class="group-box-title">Merge Multiple PDFs <span class="badge-client">Client-Side ✅</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:8px">
            Select multiple PDF files — all pages are combined into one download.
          </p>
          <div class="list-widget" id="merge-list" style="min-height:80px;max-height:160px"></div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="btn" id="merge-add">Add PDFs…</button>
            <button class="btn" id="merge-up">↑ Up</button>
            <button class="btn" id="merge-dn">↓ Down</button>
            <button class="btn danger" id="merge-rm">Remove</button>
            <input type="file" id="merge-file-in" accept=".pdf,application/pdf" multiple style="display:none"/>
          </div>
          <button class="btn primary" id="do-merge" style="width:100%;margin-top:10px">
            Merge All → Download PDF
          </button>
          <div id="merge-progress" style="display:none;margin-top:10px">
            <div style="background:var(--bg-card);border-radius:4px;height:8px">
              <div id="merge-prog-bar" style="height:100%;background:var(--copper);width:0%;transition:width 0.2s"></div>
            </div>
            <div id="merge-prog-label" style="font-size:11px;color:var(--text-muted);margin-top:4px">Merging…</div>
          </div>
        </div>
      </div>

      <!-- ── SPLIT / EXTRACT TAB ─────────────────────────── -->
      <div class="tab-panel convert-body" data-panel="split">

        <!-- Split by page range → real PDF -->
        <div class="group-box">
          <div class="group-box-title">Extract Page Range → PDF <span class="badge-client">Client-Side ✅</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:8px">
            Extracts a range of pages from the open PDF and downloads as a new PDF file.
          </p>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
            <label>From page:</label>
            <input type="number" id="split-from" value="1" min="1" style="width:64px"/>
            <label>To:</label>
            <input type="number" id="split-to" value="1" min="1" style="width:64px"/>
          </div>
          <button class="btn primary" id="split-range">Extract Range as PDF</button>
        </div>

        <!-- Split each page into its own PDF -->
        <div class="group-box">
          <div class="group-box-title">Split — One PDF per Page <span class="badge-client">Client-Side ✅</span></div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:8px">
            Downloads each page as a separate PDF file. For large documents, this may generate many downloads.
          </p>
          <button class="btn" id="split-each-pdf">Split into Individual PDFs</button>
          <div class="divider-h" style="margin:12px 0"></div>
          <div class="group-box-title" style="margin-bottom:6px">Export as Images (ZIP alternative)</div>
          <button class="btn" id="split-each-img">Export Each Page as PNG</button>
        </div>

        <!-- Remove pages link -->
        <div class="group-box" style="border-color:var(--border-copper)">
          <div class="group-box-title" style="color:var(--copper)">Page Management</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:8px">
            To delete, reorder, rotate, or duplicate pages — use the Organize view.
            After making changes there, use "Save Reordered PDF" to download the result.
          </p>
          <button class="btn primary" id="go-organize">Go to Organize →</button>
        </div>
      </div>
    `;

        // Inject badge styles if not already present
        if (!document.getElementById('badge-styles')) {
            const s = document.createElement('style');
            s.id = 'badge-styles';
            s.textContent = `
        .badge-client { font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;
          background:rgba(60,180,60,0.15);color:#5c5;letter-spacing:0.5px;margin-left:6px;vertical-align:middle; }
        .badge-backend { font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;
          background:rgba(192,98,42,0.15);color:var(--copper);letter-spacing:0.5px;margin-left:6px;vertical-align:middle; }
        .divider-h { height:1px;background:var(--border); }
      `;
            document.head.appendChild(s);
        }

        this._bindTabs();
        this._bindActions();
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

    _bindActions() {
        const el = this._el;
        const needsPDF = () => {
            if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return false; }
            return true;
        };

        // ── Export Images ─────────────────────────────────────────────────────
        el.querySelector('#exp-img-all').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const fmt   = el.querySelector('#img-fmt').value;
            const scale = parseFloat(el.querySelector('#img-scale').value);
            const qual  = parseFloat(el.querySelector('#img-quality').value);
            const ext   = fmt === 'image/png' ? 'png' : fmt === 'image/jpeg' ? 'jpg' : 'webp';
            const total = pdfEngine.pageCount;
            const prog  = el.querySelector('#exp-progress');
            const bar   = el.querySelector('#exp-prog-bar');
            const label = el.querySelector('#exp-prog-label');
            prog.style.display = 'block';
            for (let p = 1; p <= total; p++) {
                bar.style.width = Math.round(p / total * 100) + '%';
                label.textContent = `Exporting page ${p} of ${total}…`;
                const canvas = document.createElement('canvas');
                await pdfEngine.renderPage(p, canvas, scale);
                const a = document.createElement('a');
                a.href = canvas.toDataURL(fmt, qual);
                a.download = `${pdfEngine.fileName.replace('.pdf','')}-page${String(p).padStart(3,'0')}.${ext}`;
                a.click();
                await new Promise(r => setTimeout(r, 200));
            }
            prog.style.display = 'none';
            toast(`✅ ${total} pages exported as ${ext.toUpperCase()}`, 'success');
        });

        el.querySelector('#exp-img-page').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const p   = this._app.editorView?.currentPage || 1;
            const fmt = el.querySelector('#img-fmt').value;
            const ext = fmt === 'image/png' ? 'png' : 'jpg';
            const canvas = document.createElement('canvas');
            await pdfEngine.renderPage(p, canvas, parseFloat(el.querySelector('#img-scale').value));
            const a = document.createElement('a');
            a.href = canvas.toDataURL(fmt, parseFloat(el.querySelector('#img-quality').value));
            a.download = `page-${p}.${ext}`;
            a.click();
            toast(`Page ${p} exported`, 'success');
        });

        // ── Export Text ───────────────────────────────────────────────────────
        el.querySelector('#exp-text').addEventListener('click', async () => {
            if (!needsPDF()) return;
            toast('Extracting text…', 'info');
            const text = await pdfEngine.getFullText();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = pdfEngine.fileName.replace('.pdf', '') + '.txt';
            a.click();
            toast('Text downloaded ✅', 'success');
        });

        el.querySelector('#exp-text-preview').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const prev = el.querySelector('#text-preview');
            if (prev.style.display === 'none') {
                toast('Extracting text…', 'info');
                prev.value = await pdfEngine.getFullText();
                prev.style.display = 'block';
            } else { prev.style.display = 'none'; }
        });

        el.querySelector('#exp-html').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const text = await pdfEngine.getFullText();
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${pdfEngine.fileName}</title>
<style>body{font-family:Arial,sans-serif;line-height:1.6;max-width:800px;margin:40px auto;padding:0 20px}</style>
</head><body><pre>${text.replace(/</g,'&lt;')}</pre></body></html>`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            a.download = pdfEngine.fileName.replace('.pdf', '') + '.html';
            a.click();
            toast('HTML exported ✅', 'success');
        });

        // ── Export with Annotations ───────────────────────────────────────────
        el.querySelector('#exp-annotated').addEventListener('click', () => {
            if (!needsPDF()) return;
            this._app.editorView?._exportPNG();
        });

        // ── DOCX stub ─────────────────────────────────────────────────────────
        el.querySelector('#exp-docx').addEventListener('click', async () => {
            if (!needsPDF()) return;
            showAlert('DOCX Export', 'Layout-preserving Word conversion needs a Python backend (pdf2docx). Downloading text content instead.');
            const text = await pdfEngine.getFullText();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = pdfEngine.fileName.replace('.pdf','') + '.docx.txt';
            a.click();
        });

        // ── Images → PDF (pdf-lib) ────────────────────────────────────────────
        el.querySelector('#img-add').addEventListener('click', () => el.querySelector('#img-file-in').click());
        el.querySelector('#img-file-in').addEventListener('change', e => {
            Array.from(e.target.files).forEach(f => {
                this._imgFiles.push(f);
                const row = document.createElement('div');
                row.className = 'list-item';
                row.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
                  <span style="font-size:10px;color:var(--text-muted)">${(f.size/1024).toFixed(0)} KB</span>`;
                el.querySelector('#img-list').appendChild(row);
                row.addEventListener('click', () => {
                    el.querySelector('#img-list').querySelectorAll('.list-item').forEach(i => i.classList.remove('selected'));
                    row.classList.add('selected');
                });
            });
            e.target.value = '';
        });
        el.querySelector('#img-sort').addEventListener('click', () => {
            this._imgFiles.sort((a, b) => a.name.localeCompare(b.name));
            const list = el.querySelector('#img-list');
            list.innerHTML = '';
            this._imgFiles.forEach(f => {
                const row = document.createElement('div');
                row.className = 'list-item';
                row.textContent = f.name;
                list.appendChild(row);
            });
        });
        el.querySelector('#img-clear').addEventListener('click', () => {
            this._imgFiles = [];
            el.querySelector('#img-list').innerHTML = '';
        });
        el.querySelector('#img-to-pdf').addEventListener('click', async () => {
            if (!this._imgFiles.length) { toast('Add image files first', 'info'); return; }
            try {
                const { PDFDocument } = getPDFLib();
                const pdfDoc = await PDFDocument.create();
                toast(`Creating PDF from ${this._imgFiles.length} image(s)…`, 'info', 5000);
                for (const file of this._imgFiles) {
                    const buf = await fileToBuffer(file);
                    let img;
                    if (file.type === 'image/jpeg') img = await pdfDoc.embedJpg(buf);
                    else {
                        // Convert to PNG canvas first for WebP compatibility
                        const bmp = await createImageBitmap(new Blob([buf], { type: file.type }));
                        const canvas = document.createElement('canvas');
                        canvas.width = bmp.width; canvas.height = bmp.height;
                        canvas.getContext('2d').drawImage(bmp, 0, 0);
                        const pngBuf = await new Promise(r => canvas.toBlob(b => b.arrayBuffer().then(r), 'image/png'));
                        img = await pdfDoc.embedPng(pngBuf);
                    }
                    const page = pdfDoc.addPage([img.width, img.height]);
                    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
                }
                const bytes = await pdfDoc.save();
                downloadBytes(bytes, 'images-to-pdf.pdf');
                toast(`✅ PDF created from ${this._imgFiles.length} image(s)!`, 'success');
            } catch (err) {
                showAlert('Error', `Images→PDF failed: ${err.message}`);
            }
        });

        // ── Merge PDFs (pdf-lib) ──────────────────────────────────────────────
        el.querySelector('#merge-add').addEventListener('click', () => el.querySelector('#merge-file-in').click());
        el.querySelector('#merge-file-in').addEventListener('change', e => {
            Array.from(e.target.files).forEach(f => {
                this._mergeFiles.push(f);
                const row = document.createElement('div');
                row.className = 'list-item';
                row.dataset.name = f.name;
                row.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
                  <span style="font-size:10px;color:var(--text-muted)">${(f.size/1024).toFixed(0)} KB</span>`;
                el.querySelector('#merge-list').appendChild(row);
                row.addEventListener('click', () => {
                    el.querySelector('#merge-list').querySelectorAll('.list-item').forEach(i => i.classList.remove('selected'));
                    row.classList.add('selected');
                });
            });
            e.target.value = '';
        });
        el.querySelector('#merge-up').addEventListener('click', () => {
            const sel = el.querySelector('#merge-list .list-item.selected');
            if (sel?.previousElementSibling) { sel.parentNode.insertBefore(sel, sel.previousElementSibling); this._syncMergeOrder(); }
        });
        el.querySelector('#merge-dn').addEventListener('click', () => {
            const sel = el.querySelector('#merge-list .list-item.selected');
            if (sel?.nextElementSibling) { sel.parentNode.insertBefore(sel.nextElementSibling, sel); this._syncMergeOrder(); }
        });
        el.querySelector('#merge-rm').addEventListener('click', () => {
            const sel = el.querySelector('#merge-list .list-item.selected');
            if (!sel) return;
            const idx = [...el.querySelector('#merge-list').children].indexOf(sel);
            this._mergeFiles.splice(idx, 1);
            sel.remove();
        });
        el.querySelector('#do-merge').addEventListener('click', async () => {
            if (this._mergeFiles.length < 2) { toast('Add at least 2 PDF files to merge', 'info'); return; }
            const bar   = el.querySelector('#merge-prog-bar');
            const label = el.querySelector('#merge-prog-label');
            el.querySelector('#merge-progress').style.display = 'block';
            try {
                const { PDFDocument } = getPDFLib();
                const merged = await PDFDocument.create();
                for (let i = 0; i < this._mergeFiles.length; i++) {
                    bar.style.width = Math.round(i / this._mergeFiles.length * 100) + '%';
                    label.textContent = `Processing ${this._mergeFiles[i].name} (${i+1}/${this._mergeFiles.length})…`;
                    const buf  = await fileToBuffer(this._mergeFiles[i]);
                    const doc  = await PDFDocument.load(buf, { ignoreEncryption: true });
                    const pages = await merged.copyPages(doc, doc.getPageIndices());
                    pages.forEach(p => merged.addPage(p));
                }
                bar.style.width = '100%';
                label.textContent = 'Saving merged PDF…';
                const bytes = await merged.save();
                downloadBytes(bytes, 'merged.pdf');
                toast(`✅ ${this._mergeFiles.length} PDFs merged → merged.pdf`, 'success');
            } catch (err) {
                showAlert('Merge Failed', err.message);
            } finally {
                setTimeout(() => { el.querySelector('#merge-progress').style.display = 'none'; bar.style.width = '0%'; }, 1500);
            }
        });

        // ── Split: range → PDF (pdf-lib) ──────────────────────────────────────
        el.querySelector('#split-range').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const from = parseInt(el.querySelector('#split-from').value);
            const to   = Math.min(parseInt(el.querySelector('#split-to').value), pdfEngine.pageCount);
            if (from < 1 || to < from) { toast('Invalid page range', 'info'); return; }
            try {
                const { PDFDocument } = getPDFLib();
                const srcBytes = pdfEngine._rawBytes;
                if (!srcBytes) { toast('Re-open the PDF to enable PDF-level split', 'info'); return; }
                const src    = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
                const newDoc = await PDFDocument.create();
                const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
                const pages  = await newDoc.copyPages(src, indices);
                pages.forEach(p => newDoc.addPage(p));
                const bytes = await newDoc.save();
                downloadBytes(bytes, `${pdfEngine.fileName.replace('.pdf','')}-pages${from}-${to}.pdf`);
                toast(`✅ Pages ${from}–${to} extracted as PDF`, 'success');
            } catch (err) {
                showAlert('Split Failed', err.message);
            }
        });

        // ── Split: each page → separate PDF ───────────────────────────────────
        el.querySelector('#split-each-pdf').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const count = pdfEngine.pageCount;
            if (count > 20) {
                if (!confirm(`This will download ${count} PDF files. Continue?`)) return;
            }
            try {
                const { PDFDocument } = getPDFLib();
                const srcBytes = pdfEngine._rawBytes;
                if (!srcBytes) { toast('Re-open the PDF to enable PDF-level split', 'info'); return; }
                const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
                Toast_progress: for (let p = 0; p < count; p++) {
                    toast(`Exporting page ${p+1} of ${count}…`, 'info', 800);
                    const oneDoc = await PDFDocument.create();
                    const [page] = await oneDoc.copyPages(src, [p]);
                    oneDoc.addPage(page);
                    const bytes = await oneDoc.save();
                    downloadBytes(bytes, `${pdfEngine.fileName.replace('.pdf','')}-page${p+1}.pdf`);
                    await new Promise(r => setTimeout(r, 250));
                }
                toast(`✅ Split into ${count} PDFs`, 'success');
            } catch (err) {
                showAlert('Split Failed', err.message);
            }
        });

        el.querySelector('#split-each-img').addEventListener('click', async () => {
            if (!needsPDF()) return;
            const count = pdfEngine.pageCount;
            toast(`Exporting ${count} pages as PNG…`, 'info', 4000);
            for (let p = 1; p <= count; p++) {
                const canvas = document.createElement('canvas');
                await pdfEngine.renderPage(p, canvas, 2);
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = `${pdfEngine.fileName.replace('.pdf','')}-page${p}.png`;
                a.click();
                await new Promise(r => setTimeout(r, 200));
            }
            toast(`✅ ${count} pages exported`, 'success');
        });

        el.querySelector('#go-organize').addEventListener('click', () => this._app.switchView('organize'));
    }

    _syncMergeOrder() {
        const names = [...this._el.querySelectorAll('#merge-list .list-item')].map(r => r.dataset.name);
        this._mergeFiles.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
    }

    onViewActivated() {
        if (pdfEngine.isOpen()) {
            this._el.querySelector('#split-from').max = pdfEngine.pageCount;
            this._el.querySelector('#split-to').value = pdfEngine.pageCount;
            this._el.querySelector('#split-to').max   = pdfEngine.pageCount;
        }
    }
}
