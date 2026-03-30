/**
 * pdf-engine.js — PDF.js wrapper for Web PDF Editor Pro
 * Provides: open, render, navigate, text extraction, thumbnails
 */

const PDFJS_CDN_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export class PDFEngine extends EventTarget {
  constructor() {
    super();
    // Configure PDF.js worker
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN_WORKER;
    }
    this._doc       = null;   // PDFDocumentProxy
    this._fileName  = null;
    this._fileSize  = 0;
    this._pageCount = 0;
    this._textCache = new Map();   // page_num → text content
    this._outlineCache = null;
  }

  // ════════════════════════════════════════════
  // OPEN
  // ════════════════════════════════════════════

  async open(file) {
    if (!(file instanceof File)) throw new Error('Expected a File object');
    const arrayBuffer = await file.arrayBuffer();
    this._fileName  = file.name;
    this._fileSize  = file.size;
    this._rawBytes  = arrayBuffer;   // ← kept for pdf-lib operations
    this._textCache.clear();
    this._outlineCache = null;

    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice() });
    this._doc       = await loadingTask.promise;
    this._pageCount = this._doc.numPages;

    this.dispatchEvent(new CustomEvent('doc-opened', {
      detail: { fileName: this._fileName, pageCount: this._pageCount, fileSize: this._fileSize }
    }));
    return this._doc;
  }

  close() {
    if (this._doc) { this._doc.destroy(); this._doc = null; }
    this._fileName  = null;
    this._fileSize  = 0;
    this._pageCount = 0;
    this._textCache.clear();
    this._outlineCache = null;
    this.dispatchEvent(new CustomEvent('doc-closed'));
  }

  isOpen() { return this._doc !== null; }
  get fileName()  { return this._fileName; }
  get fileSize()  { return this._fileSize; }
  get pageCount() { return this._pageCount; }

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  /**
   * Render a page (1-indexed) onto a canvas.
   * Returns { width, height } of the rendered page.
   */
  async renderPage(pageNum, canvas, scale = 1.5) {
    if (!this._doc) throw new Error('No document open');
    const page = await this._doc.getPage(pageNum);  // 1-indexed
    const viewport = page.getViewport({ scale });

    const ctx = canvas.getContext('2d');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width  = viewport.width  + 'px';
    canvas.style.height = viewport.height + 'px';

    await page.render({ canvasContext: ctx, viewport }).promise;
    this.dispatchEvent(new CustomEvent('page-rendered', { detail: { pageNum, scale } }));
    return { width: viewport.width, height: viewport.height };
  }

  /**
   * Render page thumbnail to a new <canvas> (off-screen).
   * Returns the canvas element.
   */
  async renderThumbnail(pageNum, targetWidth = 110) {
    if (!this._doc) return null;
    const page = await this._doc.getPage(pageNum);
    const vp0  = page.getViewport({ scale: 1 });
    const scale = targetWidth / vp0.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // ════════════════════════════════════════════
  // TEXT
  // ════════════════════════════════════════════

  async getTextContent(pageNum) {
    if (!this._doc) return null;
    if (this._textCache.has(pageNum)) return this._textCache.get(pageNum);
    const page = await this._doc.getPage(pageNum);
    const content = await page.getTextContent();
    this._textCache.set(pageNum, content);
    return content;
  }

  async getFullText() {
    if (!this._doc) return '';
    let result = '';
    for (let i = 1; i <= this._pageCount; i++) {
      const content = await this.getTextContent(i);
      const pageText = content.items.map(it => it.str).join(' ');
      result += `\n--- Page ${i} ---\n${pageText}\n`;
    }
    return result;
  }

  async searchText(query) {
    if (!this._doc || !query) return [];
    const results = [];
    const q = query.toLowerCase();
    for (let i = 1; i <= this._pageCount; i++) {
      const content = await this.getTextContent(i);
      const pageText = content.items.map(it => it.str).join(' ');
      if (pageText.toLowerCase().includes(q)) {
        // Find all occurrences with context
        const lower = pageText.toLowerCase();
        let idx = 0;
        while ((idx = lower.indexOf(q, idx)) !== -1) {
          const start = Math.max(0, idx - 40);
          const end   = Math.min(pageText.length, idx + q.length + 40);
          results.push({
            page: i,
            matchStart: idx - start,
            matchEnd:   idx - start + q.length,
            context: pageText.substring(start, end),
          });
          idx += q.length;
          if (results.length > 200) break;  // cap results
        }
      }
    }
    return results;
  }

  // ════════════════════════════════════════════
  // OUTLINE / TOC
  // ════════════════════════════════════════════

  async getOutline() {
    if (!this._doc) return [];
    if (this._outlineCache) return this._outlineCache;
    const outline = await this._doc.getOutline();
    this._outlineCache = outline || [];
    return this._outlineCache;
  }

  async resolveDestination(dest) {
    if (!this._doc || !dest) return null;
    try {
      const pageRef = Array.isArray(dest) ? dest[0] : (await this._doc.getDestination(dest))?.[0];
      if (!pageRef) return null;
      const pageIndex = await this._doc.getPageIndex(pageRef);
      return pageIndex + 1;  // 1-indexed
    } catch { return null; }
  }

  // ════════════════════════════════════════════
  // META
  // ════════════════════════════════════════════

  async getMetadata() {
    if (!this._doc) return {};
    try {
      const meta = await this._doc.getMetadata();
      return meta.info || {};
    } catch { return {}; }
  }

  // ════════════════════════════════════════════
  // STATIC HELPERS
  // ════════════════════════════════════════════

  static formatBytes(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1048576)     return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}

// Singleton
export const pdfEngine = new PDFEngine();
