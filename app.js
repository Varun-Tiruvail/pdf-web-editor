/**
 * app.js — Main application controller (ES Module)
 * Wires: sidebar → views, PDF engine, keyboard shortcuts, status bar
 */

import { pdfEngine, PDFEngine } from './pdf-engine.js';
import { Sidebar } from './components/sidebar.js';
import { toast, showAlert, showConfirm } from './components/modal.js';

import { HomeView } from './views/home-view.js';
import { EditorView } from './views/editor-view.js';
import { AnnotateView } from './views/annotate-view.js';
import { OrganizeView } from './views/organize-view.js';
import { ToolsView } from './views/tools-view.js';
import { MergeView } from './views/merge-view.js';
import { ConvertView } from './views/convert-view.js';
import { SecurityView } from './views/security-view.js';
import { FormsView } from './views/forms-view.js';
import { BookmarksView } from './views/bookmarks-view.js';
import { SearchView } from './views/search-view.js';
import { OCRView } from './views/ocr-view.js';

class App {
    constructor() {
        this._views = {};
        this._currentView = 'home';
        this._sidebar = null;
        this._init();
    }

    _init() {
        // Configure PDF.js worker
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Build sidebar
        this._sidebar = new Sidebar(
            document.getElementById('sidebar'),
            document.getElementById('sidebar-toggle')
        );
        this._sidebar.addEventListener('page-change', e => this.switchView(e.detail.key));

        // Build views
        const viewDefs = {
            home: [HomeView, this],
            editor: [EditorView, this],
            annotate: [AnnotateView, this],
            organize: [OrganizeView, this],
            tools: [ToolsView, this],
            merge: [MergeView, this],
            convert: [ConvertView, this],
            security: [SecurityView, this],
            forms: [FormsView, this],
            bookmarks: [BookmarksView, this],
            search: [SearchView, this],
            ocr: [OCRView, this],
        };
        Object.entries(viewDefs).forEach(([key, [Cls, ...args]]) => {
            const container = document.getElementById(`view-${key}`);
            if (container) this._views[key] = new Cls(container, ...args);
        });

        // Wire title bar buttons
        document.getElementById('btn-open').addEventListener('click', () => this.triggerOpen());
        document.getElementById('btn-new').addEventListener('click', () => {
            toast('New blank PDF — feature requires backend (will create an empty one via jsPDF in production)', 'info', 5000);
        });
        document.getElementById('btn-save').addEventListener('click', () => {
            if (!pdfEngine.isOpen()) { toast('No document open', 'info'); return; }
            toast('To save: use Browser → right-click canvas → "Save image as" for PNG, or use Export → Text for content', 'info', 5000);
        });

        // Window controls (browser-safe)
        document.getElementById('wc-btn-close').addEventListener('click', () => {
            if (pdfEngine.isOpen()) {
                showConfirm('Close Document', 'Close the current document?', () => {
                    pdfEngine.close();
                    document.getElementById('doc-title').textContent = 'No Document';
                    this.setStatus('Ready — Open a PDF to begin');
                });
            } else {
                toast('No document is open', 'info');
            }
        });
        document.getElementById('wc-btn-max').addEventListener('click', () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
            else document.exitFullscreen?.();
        });
        document.getElementById('wc-btn-min').addEventListener('click', () => {
            toast('Minimise: browser windows cannot be minimised from web pages', 'info');
        });

        // File input
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) { this.openFile(file); fileInput.value = ''; }
        });

        // Global drag-drop
        document.addEventListener('dragover', e => e.preventDefault());
        document.addEventListener('drop', e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file?.name.toLowerCase().endsWith('.pdf')) this.openFile(file);
        });

        // Engine events
        pdfEngine.addEventListener('doc-opened', () => this._onDocOpened());
        pdfEngine.addEventListener('doc-closed', () => this._onDocClosed());

        // Keyboard shortcuts
        document.addEventListener('keydown', e => this._handleKeys(e));

        // Context menu dismiss
        document.addEventListener('click', () => {
            document.getElementById('context-menu').classList.add('hidden');
        });

        // Right-click prevention on text content
        document.addEventListener('contextmenu', e => {
            if (!e.target.closest('#org-grid,.pdf-canvas-area')) return;
            // Allow native right-click on canvas
        });
    }

    _onDocOpened() {
        const name = pdfEngine.fileName;
        document.getElementById('doc-title').textContent = name;
        document.title = `${name} — PDF Editor Pro`;
        this.setStatus(`Opened ${name} · ${pdfEngine.pageCount} pages · ${PDFEngine.formatBytes(pdfEngine.fileSize)}`);

        // Add to recent
        HomeView.addRecent({
            name, pages: pdfEngine.pageCount,
            sizeStr: PDFEngine.formatBytes(pdfEngine.fileSize),
            ts: Date.now()
        });
        this._views.home?.refresh?.();

        // Auto-switch to editor
        this.switchView('editor');
        toast(`Opened: ${name}`, 'success');
    }

    _onDocClosed() {
        document.getElementById('doc-title').textContent = 'No Document';
        document.title = 'PDF Editor Pro';
    }

    _handleKeys(e) {
        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && e.key === 'o') { e.preventDefault(); this.triggerOpen(); }
        if (ctrl && e.key === 'b') { e.preventDefault(); this._sidebar.toggle(); }
        if (ctrl && e.key === 'f') { e.preventDefault(); this.switchView('search'); this._views.search?.focus?.(); }
        if (ctrl && e.key === 'w') {
            e.preventDefault();
            if (pdfEngine.isOpen()) showConfirm('Close Document', 'Close the current document?', () => pdfEngine.close());
        }

        // Delegate to editor
        if (this._currentView === 'editor') {
            this._views.editor?.handleKeydown(e);
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    switchView(key) {
        if (!this._views[key]) return;

        // Hide all
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        // Show selected
        const target = document.getElementById(`view-${key}`);
        if (target) target.classList.add('active');
        this._currentView = key;
        this._sidebar.navigateTo(key);

        // Lifecycle hooks
        this._views[key]?.onViewActivated?.();
    }

    triggerOpen() {
        document.getElementById('file-input').click();
    }

    async openFile(file) {
        const prog = document.getElementById('progress-bar-wrap');
        const bar = document.getElementById('progress-bar-inner');
        prog.classList.remove('hidden');
        bar.style.width = '30%';
        try {
            bar.style.width = '60%';
            await pdfEngine.open(file);
            bar.style.width = '100%';
        } catch (err) {
            showAlert('Open Failed', `Could not open PDF:\n${err.message || err}`);
            toast('Failed to open PDF', 'error');
        } finally {
            setTimeout(() => { prog.classList.add('hidden'); bar.style.width = '0%'; }, 600);
        }
    }

    setStatus(msg, zoom = '') {
        document.getElementById('status-msg').textContent = msg;
        if (zoom) document.getElementById('status-zoom').textContent = zoom;
    }

    // Expose editor view reference
    get editorView() { return this._views.editor; }
    get currentView() { return this._currentView; }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
    window._app = new App();

    // Start on home view
    window._app.switchView('home');

    // Show version toast
    setTimeout(() => toast('PDF Editor Pro v2.0 — Open a PDF or drag it here to start', 'info', 4000), 800);
});
