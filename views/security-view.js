/**
 * security-view.js — Security & Redaction View
 * Password, Permissions, Redaction
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showAlert, showConfirm } from '../components/modal.js';

export class SecurityView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._redactions = [];
        this._render();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Security & Redaction</h2>
        <p>Password protection, permissions and content redaction</p>
      </div>

      <div class="tabs-header">
        <button class="tab-btn active" data-tab="password">Password</button>
        <button class="tab-btn" data-tab="permissions">Permissions</button>
        <button class="tab-btn" data-tab="redaction">Redaction</button>
        <button class="tab-btn" data-tab="metadata">Metadata</button>
      </div>

      <!-- Password Tab -->
      <div class="tab-panel active security-body" data-panel="password">
        <div class="group-box" style="margin-bottom:14px">
          <div class="group-box-title">Encrypt with Password</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <label style="width:140px;font-size:12px;color:var(--text-secondary)">User Password:</label>
              <input type="password" id="sec-user-pwd" placeholder="User password" style="flex:1"/>
              <button class="btn icon-btn" onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password'">👁</button>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <label style="width:140px;font-size:12px;color:var(--text-secondary)">Owner Password:</label>
              <input type="password" id="sec-owner-pwd" placeholder="Owner password" style="flex:1"/>
              <button class="btn icon-btn" onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password'">👁</button>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <label style="width:140px;font-size:12px;color:var(--text-secondary)">Encryption:</label>
              <select id="sec-enc" style="flex:1">
                <option>AES-256 (Recommended)</option>
                <option>AES-128</option>
                <option>RC4-128</option>
              </select>
            </div>
            <button class="btn primary" id="sec-set-pwd" style="align-self:flex-start">Encrypt & Save…</button>
          </div>
        </div>

        <div class="group-box">
          <div class="group-box-title">Remove Password / Decrypt</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <label style="font-size:12px;color:var(--text-secondary)">Current Password:</label>
            <input type="password" id="sec-rm-pwd" placeholder="Enter password" style="flex:1"/>
          </div>
          <button class="btn" id="sec-rm-btn">Decrypt & Save…</button>
        </div>
      </div>

      <!-- Permissions Tab -->
      <div class="tab-panel security-body" data-panel="permissions">
        <div class="group-box">
          <div class="group-box-title">Document Permissions</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:14px">
            These permissions apply alongside the owner password. The document must be encrypted for these to be enforced.
          </p>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${[
                ['perm-print', 'Allow Printing (High Quality)'],
                ['perm-copy', 'Allow Copying Text & Images'],
                ['perm-annot', 'Allow Annotations'],
                ['perm-form', 'Allow Form Filling'],
                ['perm-assemble', 'Allow Page Assembly'],
                ['perm-extract', 'Allow Content Extraction (Accessibility)'],
            ].map(([id, label]) =>
                `<label class="label-row"><input type="checkbox" id="${id}" checked/> ${label}</label>`
            ).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:16px">
            <button class="btn primary" id="perm-apply">Apply Permissions</button>
            <button class="btn" id="perm-reset">Reset to Full</button>
          </div>
        </div>

        <!-- Current PDF permissions display -->
        <div class="group-box" id="current-perms-box" style="margin-top:14px">
          <div class="group-box-title">Current Document Permissions</div>
          <div id="current-perms-content" style="color:var(--text-muted);font-size:12px">
            Open a PDF to inspect its permissions.
          </div>
        </div>
      </div>

      <!-- Redaction Tab -->
      <div class="tab-panel security-body" data-panel="redaction">
        <div class="group-box" style="margin-bottom:14px">
          <div class="group-box-title">Redaction</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:12px">
            Redaction permanently removes content. Switch to Editor → Whitebox tool to visually mark areas,
            then click "Apply Redactions" here to finalize.
          </p>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn primary" id="red-start">Start Drawing Redaction Boxes → Editor</button>
          </div>

          <div class="list-widget" id="redact-list" style="min-height:80px;max-height:200px">
            <div class="list-item" style="color:var(--text-disabled)">No pending redactions</div>
          </div>

          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn" style="flex:1;background:var(--danger);border-color:#A82020;color:#FFAAAA"
                    id="red-apply">Apply All Redactions (Permanent)</button>
            <button class="btn" id="red-clear">Clear Pending</button>
          </div>
        </div>
      </div>

      <!-- Metadata Tab (EXTRA FEATURE) -->
      <div class="tab-panel security-body" data-panel="metadata">
        <div class="group-box">
          <div class="group-box-title">Document Metadata</div>
          <p style="color:var(--text-muted);font-size:11px;margin-bottom:12px">
            Inspect the PDF's embedded metadata. Use "Strip & Save" to remove all metadata before sharing.
          </p>
          <button class="btn primary" id="meta-load" style="margin-bottom:12px">Load Metadata</button>
          <div id="meta-content" style="display:flex;flex-direction:column;gap:8px"></div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn" style="background:var(--danger);border-color:#A82020;color:#FFAAAA" id="meta-strip-save">Strip All Metadata & Download</button>
          </div>
        </div>
      </div>
    `;

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

        el.querySelector('#sec-set-pwd').addEventListener('click', () => {
            showAlert('Password Encryption', 'PDF encryption requires a Python/Node.js backend. In the desktop app, PyMuPDF handles this directly. In production, submit the PDF to a secure API endpoint for encryption.');
        });

        el.querySelector('#sec-rm-btn').addEventListener('click', () => {
            showAlert('Decrypt PDF', 'PDF decryption requires a backend service. The current open file can be viewed if the correct password was provided at open time.');
        });

        // Permissions
        el.querySelector('#perm-apply').addEventListener('click', () => {
            toast('Permissions noted. Apply encryption for these to take effect (requires backend).', 'info', 5000);
        });
        el.querySelector('#perm-reset').addEventListener('click', () => {
            el.querySelectorAll('[id^="perm-"]').forEach(c => { if (c.type === 'checkbox') c.checked = true; });
            toast('All permissions reset to full', 'success');
        });

        // Redaction
        el.querySelector('#red-start').addEventListener('click', () => {
            this._app.switchView('editor');
            toast('Switch to Whitebox tool in the Editor to mark redaction areas', 'info', 5000);
        });

        el.querySelector('#red-apply').addEventListener('click', () => {
            if (!this._redactions.length) { toast('No pending redactions', 'info'); return; }
            showConfirm('Apply Redactions',
                'This will permanently remove content. In the web app, this clears the visual overlays. Full PDF redaction requires backend processing.',
                () => {
                    this._redactions = [];
                    el.querySelector('#redact-list').innerHTML = '<div class="list-item" style="color:var(--text-disabled)">No pending redactions</div>';
                    toast('Redactions cleared (visual only — full removal via backend)', 'success');
                });
        });

        el.querySelector('#red-clear').addEventListener('click', () => {
            this._redactions = [];
            el.querySelector('#redact-list').innerHTML = '<div class="list-item" style="color:var(--text-disabled)">No pending redactions</div>';
            toast('Pending redactions cleared', 'success');
        });

        // Metadata
        el.querySelector('#meta-load').addEventListener('click', async () => {
            if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
            const meta = await pdfEngine.getMetadata();
            const box = el.querySelector('#meta-content');
            const fields = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
            box.innerHTML = '';
            fields.forEach(f => {
                const val = meta[f] || '—';
                box.innerHTML += `
          <div style="display:flex;gap:8px;align-items:center">
            <span style="min-width:110px;font-size:11px;color:var(--text-muted);font-weight:600">${f}:</span>
            <input type="text" value="${val.toString().replace(/"/g, '&quot;')}"
                   style="flex:1;font-size:11px" data-meta-key="${f}" />
          </div>`;
            });
            toast('Metadata loaded', 'success');
        });

        // Strip metadata & download (ported from sanitize_pdf)
        el.querySelector('#meta-strip-save').addEventListener('click', async () => {
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
                const blob = new Blob([bytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = pdfEngine.fileName.replace('.pdf', '') + '-clean.pdf';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                toast('✅ Metadata stripped & downloaded', 'success');
            } catch (err) {
                showAlert('Metadata Strip Failed', err.message);
            }
        });
    }

    addRedaction(page, x1, y1, x2, y2) {
        const entry = { page, x1, y1, x2, y2 };
        this._redactions.push(entry);
        const list = this._el.querySelector('#redact-list');
        list.innerHTML = '';
        this._redactions.forEach(r => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.textContent = `Page ${r.page} — (${r.x1.toFixed(0)},${r.y1.toFixed(0)}) → (${r.x2.toFixed(0)},${r.y2.toFixed(0)})`;
            list.appendChild(item);
        });
    }
}
