/**
 * annotate-view.js v2.1 — Annotation manager
 * Now synced with the shared window._annotations store from editor-view.js
 * Adds: undo, real-time list refresh, canvas-drawn shape shortcuts
 */
import { pdfEngine } from '../pdf-engine.js';
import { toast, showConfirm } from '../components/modal.js';

const STAMPS = ['Draft', 'Confidential', 'Approved', 'Final', 'Not Approved',
  'Expired', 'For Comment', 'For Public Release', 'Top Secret', 'Sold'];

export class AnnotateView {
  constructor(container, app) {
    this._el = container;
    this._app = app;
    this._render();
  }

  // Always read from shared store
  get _annotations() { return window._annotations || []; }

  _render() {
    this._el.innerHTML = `
      <div class="view-header">
        <h2>Annotations</h2>
        <p>Add markup, comments, and shapes to the current PDF page — all annotations are shared with the Editor</p>
      </div>
      <div class="annotate-body">
        <!-- Tools Panel -->
        <div class="annotate-tools">

          <!-- Text Markup — navigate to editor with tool set -->
          <div class="group-box">
            <div class="group-box-title">Text Markup <span style="font-size:9px;color:var(--text-disabled)">(draws on Editor canvas)</span></div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${[
        ['highlight', 'Highlight', '#FFFF00'],
        ['underline', 'Underline', '#4488FF'],
        ['strikeout', 'Strike-out', '#FF5050'],
        ['squiggly', 'Squiggly', '#44BB66'],
      ].map(([key, label, color]) => `
                <div class="tool-row">
                  <button class="btn" style="flex:1" data-markup="${key}">${label}</button>
                  <input type="color" class="markup-color" data-for="${key}" value="${color}"
                         style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;padding:0" title="Color"/>
                </div>`
      ).join('')}
            </div>
          </div>

          <!-- Comments & Notes -->
          <div class="group-box">
            <div class="group-box-title">Comments & Notes</div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
              <input type="color" id="sticky-color" value="#FFD700"
                     style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;padding:0"/>
              <label style="font-size:11px;color:var(--text-muted)">Note color</label>
            </div>
            <textarea id="annot-note-text" placeholder="Type your note here…" rows="3"
                      style="width:100%;margin-bottom:8px;font-size:11px;resize:vertical"></textarea>
            <button class="btn primary" id="annot-sticky" style="width:100%">Add Sticky Note</button>
          </div>

          <!-- Shapes (navigate to editor) -->
          <div class="group-box">
            <div class="group-box-title">Shapes <span style="font-size:9px;color:var(--text-disabled)">(activates Editor canvas)</span></div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${[
        ['rect', 'Rectangle', 'rect'],
        ['circle', 'Circle', 'circle'],
        ['line', 'Line', 'line'],
        ['arrow', 'Arrow', 'arrow'],
      ].map(([key, label, tool]) => `
                <div class="tool-row">
                  <button class="btn" style="flex:1" data-shape-tool="${tool}">${label}</button>
                  <input type="color" class="shape-color-${key}" value="#FF4444"
                         style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;padding:0"/>
                </div>`
      ).join('')}
            </div>
          </div>

          <!-- Stamps -->
          <div class="group-box">
            <div class="group-box-title">Stamps</div>
            <select id="stamp-select" style="width:100%;margin-bottom:8px">
              ${STAMPS.map(s => `<option>${s}</option>`).join('')}
            </select>
            <input type="color" id="stamp-color" value="#C0622A"
                   style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;padding:0;margin-bottom:8px"/>
            <label style="font-size:11px;color:var(--text-muted);margin-left:8px">Stamp color</label>
            <button class="btn primary" id="stamp-apply" style="width:100%;margin-top:8px">Apply Stamp</button>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:6px">
            <button class="btn" id="annot-undo" style="flex:1" title="Undo last annotation">↩ Undo</button>
            <button class="btn danger" id="annot-clear" style="flex:1">Clear Page</button>
          </div>
        </div>

        <!-- Annotation List -->
        <div class="annotate-list-panel">
          <div class="section-header" style="display:flex;align-items:center;justify-content:space-between">
            <span>Annotations on Current Page</span>
            <button class="btn sm" id="annot-refresh" title="Refresh list">⟳</button>
          </div>
          <div class="list-widget flex-1" id="annot-list" style="max-height:none;flex:1"></div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-shrink:0">
            <button class="btn danger" id="annot-delete-sel" style="flex:1">Delete Selected</button>
            <button class="btn" id="annot-export" style="flex:1" title="Export all annotations as JSON">Export JSON</button>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const el = this._el;

    // Markup — navigate to editor and activate tool
    el.querySelectorAll('[data-markup]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.markup;
        const color = el.querySelector(`[data-for="${type}"]`)?.value || '#FFFF00';
        // Switch to editor view with the highlight tool and set color
        this._app.switchView('editor');
        const ev = this._app.editorView;
        if (ev) {
          ev._currentColor = color;
          ev._el.querySelector('#fmt-color').value = color;
          ev._setTool('highlight');
          toast(`${type} tool active — drag to mark text on the PDF`, 'info', 4000);
        }
      });
    });

    // Shapes — switch to editor + set tool
    el.querySelectorAll('[data-shape-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.shapeTool;
        this._app.switchView('editor');
        const ev = this._app.editorView;
        if (ev) {
          const colorInput = el.querySelector(`.shape-color-${tool === 'rect' ? 'rect' : tool === 'circle' ? 'circle' : tool}`);
          if (colorInput) { ev._currentColor = colorInput.value; ev._el.querySelector('#fmt-color').value = colorInput.value; }
          ev._setTool(tool);
          toast(`Draw a ${tool} on the PDF — click and drag`, 'info', 3000);
        }
      });
    });

    // Sticky note
    el.querySelector('#annot-sticky').addEventListener('click', () => {
      const text = el.querySelector('#annot-note-text').value.trim();
      if (!text) { toast('Enter some note text first', 'info'); return; }
      const color = el.querySelector('#sticky-color').value;
      const page = this._app.editorView?.currentPage || 1;
      window._annotations = window._annotations || [];
      window._annotations.push({
        page, type: 'sticky', color,
        data: { x: 0.05, y: 0.05, text },
        fontSize: 13, font: 'Inter',
        ts: Date.now(),
      });
      // Draw on canvas
      const overlay = document.getElementById(`annot-overlay-${page}`);
      if (overlay) this._renderSticky(overlay, window._annotations[window._annotations.length - 1]);
      el.querySelector('#annot-note-text').value = '';
      this._refreshList();
      toast('Sticky note added', 'success');
    });

    // Stamp
    el.querySelector('#stamp-apply').addEventListener('click', () => {
      const stamp = el.querySelector('#stamp-select').value;
      const color = el.querySelector('#stamp-color').value;
      const page = this._app.editorView?.currentPage || 1;
      window._annotations = window._annotations || [];
      window._annotations.push({
        page, type: 'stamp', color,
        data: { x: 0.35, y: 0.05, text: stamp.toUpperCase() },
        fontSize: 20, font: 'Inter',
        ts: Date.now(),
      });
      const overlay = document.getElementById(`annot-overlay-${page}`);
      if (overlay) this._renderStamp(overlay, window._annotations[window._annotations.length - 1]);
      this._refreshList();
      toast(`Stamp "${stamp}" applied`, 'success');
    });

    // Undo
    el.querySelector('#annot-undo').addEventListener('click', () => {
      if (this._app.editorView) {
        this._app.editorView._undo();
        this._refreshList();
      } else { toast('Open the Editor tab to use undo', 'info'); }
    });

    // Clear
    el.querySelector('#annot-clear').addEventListener('click', () => {
      const page = this._app.editorView?.currentPage || 1;
      showConfirm('Clear Annotations', `Clear all annotations on page ${page}?`, () => {
        this._app.editorView?.clearAnnotations();
        this._refreshList();
      });
    });

    // Delete selected
    el.querySelector('#annot-delete-sel').addEventListener('click', () => {
      const sel = el.querySelector('.list-item.selected');
      if (!sel) { toast('Select an annotation first', 'info'); return; }
      const globalIdx = parseInt(sel.dataset.globalIdx);
      window._annotations.splice(globalIdx, 1);
      const ev = this._app.editorView;
      if (ev) { ev._annotations = window._annotations; ev._snapshot(); ev._redrawCurrentPage(); }
      this._refreshList();
      toast('Annotation deleted', 'success');
    });

    // Export
    el.querySelector('#annot-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(window._annotations || [], null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'annotations.json'; a.click();
      toast('All annotations exported', 'success');
    });

    // Refresh button
    el.querySelector('#annot-refresh').addEventListener('click', () => this._refreshList());
  }

  _renderSticky(overlay, a) {
    const ctx = overlay.getContext('2d');
    const W = overlay.width, H = overlay.height;
    const x = a.data.x * W, y = a.data.y * H;
    ctx.fillStyle = a.color;
    ctx.fillRect(x, y, 120, 60);
    ctx.fillStyle = '#000';
    ctx.font = '11px Inter, sans-serif';
    // Word-wrap rough
    const words = a.data.text.split(' ');
    let line = '', lineY = y + 16;
    for (const w of words) {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > 112 && line !== '') {
        ctx.fillText(line, x + 4, lineY);
        line = w + ' '; lineY += 14;
        if (lineY > y + 58) break;
      } else { line = test; }
    }
    ctx.fillText(line, x + 4, lineY);
  }

  _renderStamp(overlay, a) {
    const ctx = overlay.getContext('2d');
    const W = overlay.width, H = overlay.height;
    const x = a.data.x * W, y = a.data.y * H;
    ctx.font = `bold ${a.fontSize || 20}px Inter, sans-serif`;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 2;
    const metrics = ctx.measureText(a.data.text);
    const pw = metrics.width + 16, ph = (a.fontSize || 20) + 12;
    ctx.strokeRect(x, y - ph + 6, pw, ph);
    ctx.fillStyle = a.color;
    ctx.fillText(a.data.text, x + 8, y);
  }

  _refreshList() {
    const list = this._el.querySelector('#annot-list');
    const page = this._app.editorView?.currentPage || 1;
    const all = window._annotations || [];
    const items = all.map((a, i) => ({ ...a, _gi: i })).filter(a => a.page === page);

    if (!items.length) {
      list.innerHTML = `<div class="list-item" style="color:var(--text-disabled)">No annotations on page ${page}</div>`;
      return;
    }
    list.innerHTML = '';
    items.forEach(a => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.dataset.globalIdx = a._gi;

      // type label + color dot
      const typeLabel = a.type.charAt(0).toUpperCase() + a.type.slice(1);
      const colorStr = a.color || '#888';
      const extra = a.data?.text ? ': ' + String(a.data.text).substring(0, 35) : '';
      item.innerHTML = `
              <span style="width:10px;height:10px;border-radius:50%;background:${colorStr};flex-shrink:0;border:1px solid rgba(255,255,255,0.2)"></span>
              <span style="font-weight:600;text-transform:capitalize;min-width:70px">${typeLabel}</span>
              <span style="color:var(--text-disabled);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${extra}</span>
            `;
      item.addEventListener('click', () => {
        list.querySelectorAll('.list-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
      list.appendChild(item);
    });
  }

  onViewActivated() { this._refreshList(); }
}
