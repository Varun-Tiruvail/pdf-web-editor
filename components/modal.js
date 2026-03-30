/**
 * modal.js — Dialog and toast notification system
 */

// ── Modal ────────────────────────────────────────────────────────────────────
const overlay = document.getElementById('modal-overlay');
const box = document.getElementById('modal-box');
const mTitle = document.getElementById('modal-title');
const mBody = document.getElementById('modal-body');
const mCancel = document.getElementById('modal-cancel');
const mConfirm = document.getElementById('modal-confirm');
const mClose = document.getElementById('modal-close');

let _onConfirm = null;
let _onCancel = null;

mClose.addEventListener('click', closeModal);
mCancel.addEventListener('click', () => { _onCancel?.(); closeModal(); });
mConfirm.addEventListener('click', () => { _onConfirm?.(); closeModal(); });
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
});

export function showModal({ title, body, confirmText = 'OK', cancelText = 'Cancel',
    onConfirm = null, onCancel = null, hideCancel = false }) {
    mTitle.textContent = title;
    if (typeof body === 'string') {
        mBody.innerHTML = body;
    } else {
        mBody.innerHTML = '';
        mBody.appendChild(body);
    }
    mConfirm.textContent = confirmText;
    mCancel.textContent = cancelText;
    mCancel.classList.toggle('hidden', hideCancel);
    _onConfirm = onConfirm;
    _onCancel = onCancel;
    overlay.classList.remove('hidden');
    mConfirm.focus();
}

export function closeModal() {
    overlay.classList.add('hidden');
    _onConfirm = null;
    _onCancel = null;
}

export function showAlert(title, message) {
    showModal({
        title, body: `<p style="color:var(--text-secondary)">${message}</p>`,
        hideCancel: true, confirmText: 'OK'
    });
}

export function showConfirm(title, message, onConfirm) {
    showModal({
        title, body: `<p style="color:var(--text-secondary)">${message}</p>`,
        onConfirm, confirmText: 'Yes', cancelText: 'No'
    });
}

export function showPrompt(title, placeholder, onConfirm) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.style.width = '100%';
    const wrap = document.createElement('div');
    wrap.appendChild(input);
    setTimeout(() => input.focus(), 100);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { onConfirm?.(input.value); closeModal(); } });
    showModal({ title, body: wrap, onConfirm: () => onConfirm?.(input.value) });
}

// ── Toast ────────────────────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');

export function toast(message, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'toastOut 300ms forwards';
        setTimeout(() => el.remove(), 310);
    }, duration);
}
