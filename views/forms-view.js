/**
 * forms-view.js — PDF Form Fields View
 * Detect, display, fill, and flatten form fields
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showAlert, showConfirm } from '../components/modal.js';

export class FormsView {
    constructor(container, app) {
        this._el = container;
        this._app = app;
        this._fields = [];
        this._render();
    }

    _render() {
        this._el.innerHTML = `
      <div class="view-header">
        <h2>Form Fields</h2>
        <p>Detect, fill, and flatten PDF form fields</p>
      </div>

      <div class="action-bar">
        <button class="btn primary" id="form-detect">Detect Fields</button>
        <button class="btn" id="form-apply">Apply All Changes</button>
        <button class="btn" id="form-flatten">Flatten (Make Non-Editable)</button>
        <button class="btn" id="form-export-json">Export Values as JSON</button>
        <button class="btn" id="form-prefill" title="Load field values from a JSON file">Prefill from JSON…</button>
        <input type="file" id="form-json-in" accept=".json" style="display:none"/>
        <span id="form-status" style="margin-left:auto;font-size:11px;color:var(--text-muted)">
          No fields detected
        </span>
      </div>

      <div class="forms-body flex-1">
        <div style="overflow:auto;flex:1">
          <table class="data-table" id="form-table">
            <thead>
              <tr>
                <th style="width:54px">Page</th>
                <th>Field Name</th>
                <th style="width:90px">Type</th>
                <th>Current Value</th>
                <th class="editable">New Value ✎</th>
              </tr>
            </thead>
            <tbody id="form-tbody">
              <tr>
                <td colspan="5" style="text-align:center;color:var(--text-disabled);padding:24px">
                  Click "Detect Fields" to scan the current PDF for form fields
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Add Field -->
        <div class="group-box" style="margin:12px;flex-shrink:0">
          <div class="group-box-title">Add New Form Field (Visual Overlay)</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <label>Type:</label>
            <select id="field-type" style="width:110px">
              <option value="text">Text</option>
              <option value="checkbox">Checkbox</option>
              <option value="radio">Radio</option>
              <option value="listbox">List Box</option>
              <option value="combobox">Combo Box</option>
              <option value="button">Button</option>
            </select>
            <label>Name:</label>
            <input type="text" id="field-name" placeholder="Field name" style="width:160px"/>
            <label>Page:</label>
            <input type="number" id="field-page" value="1" min="1" style="width:60px"/>
            <button class="btn primary" id="form-add-field">Add Field</button>
          </div>
        </div>
      </div>
    `;

        this._bindEvents();
    }

    _bindEvents() {
        const el = this._el;

        el.querySelector('#form-detect').addEventListener('click', async () => {
            if (!pdfEngine.isOpen()) { toast('Open a PDF first', 'info'); return; }
            // PDF.js doesn't expose form fields directly; simulate with metadata scan
            toast('Scanning for form fields via PDF.js text content…', 'info');
            // Try to get annotations/acroform fields
            this._fields = await this._detectFields();
            this._renderTable();
            el.querySelector('#form-status').textContent = `${this._fields.length} field(s) found`;
            toast(`${this._fields.length} field(s) detected`, this._fields.length ? 'success' : 'info');
        });

        el.querySelector('#form-apply').addEventListener('click', () => {
            if (!this._fields.length) { toast('No fields to apply', 'info'); return; }
            const tbody = el.querySelector('#form-tbody');
            let changed = 0;
            this._fields.forEach((f, i) => {
                const row = tbody.rows[i];
                const newVal = row?.cells[4]?.textContent;
                if (newVal !== undefined && newVal !== f.value) {
                    f.value = newVal;
                    changed++;
                }
            });
            toast(`${changed} field(s) updated (visual only — requires backend to write to PDF)`, 'success', 5000);
        });

        el.querySelector('#form-flatten').addEventListener('click', () => {
            showConfirm('Flatten Form',
                'Flattening makes all form fields static and non-editable. For web use, this is a visual update only.',
                () => {
                    this._fields = this._fields.map(f => ({ ...f, editable: false }));
                    this._renderTable();
                    toast('Form flattened (visual — full flatten requires PDF rewrite via backend)', 'success', 5000);
                });
        });

        el.querySelector('#form-export-json').addEventListener('click', () => {
            const data = this._fields.map(f => ({ page: f.page, name: f.name, type: f.type, value: f.value }));
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'form-values.json'; a.click();
            toast('Form values exported as JSON', 'success');
        });

        el.querySelector('#form-prefill').addEventListener('click', () => el.querySelector('#form-json-in').click());
        el.querySelector('#form-json-in').addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                data.forEach(entry => {
                    const field = this._fields.find(f => f.name === entry.name);
                    if (field) field.value = entry.value;
                });
                this._renderTable();
                toast('Fields prefilled from JSON', 'success');
            } catch { toast('Invalid JSON file', 'error'); }
        });

        el.querySelector('#form-add-field').addEventListener('click', () => {
            const name = el.querySelector('#field-name').value.trim();
            const type = el.querySelector('#field-type').value;
            const page = parseInt(el.querySelector('#field-page').value);
            if (!name) { toast('Enter a field name', 'info'); return; }
            this._fields.push({ page, name, type, value: '', editable: true });
            this._renderTable();
            el.querySelector('#field-name').value = '';
            toast(`Field "${name}" added`, 'success');
        });
    }

    async _detectFields() {
        // PDF.js doesn't expose AcroForm fields directly in the public API.
        // We scan pages looking for form-like patterns in text and annotations.
        const fields = [];
        const doc = pdfEngine._doc;
        if (!doc) return fields;

        for (let p = 1; p <= pdfEngine.pageCount; p++) {
            try {
                const page = await doc.getPage(p);
                const annots = await page.getAnnotations();
                annots.forEach(a => {
                    if (a.fieldName || a.fieldType) {
                        fields.push({
                            page: p,
                            name: a.fieldName || `Field_${p}_${fields.length}`,
                            type: a.fieldType || a.subtype || 'text',
                            value: (a.fieldValue || '').toString(),
                            editable: true,
                        });
                    }
                });
            } catch { /* page error */ }
        }
        return fields;
    }

    _renderTable() {
        const tbody = this._el.querySelector('#form-tbody');
        if (!this._fields.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-disabled);padding:24px">No fields found in this document</td></tr>`;
            return;
        }
        tbody.innerHTML = '';
        this._fields.forEach((f, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${f.page}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${f.name}</td>
        <td><span style="background:var(--bg-elevated);border-radius:3px;padding:2px 6px;font-size:10px">${f.type}</span></td>
        <td style="color:var(--text-muted)">${f.value || '—'}</td>
        <td class="editable" contenteditable="${f.editable}">${f.value || ''}</td>
      `;
            tbody.appendChild(tr);
        });
    }
}
