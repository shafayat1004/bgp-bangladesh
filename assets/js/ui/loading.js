/**
 * Loading & Progress UI Module
 * Multi-step progress bar, status messages, and toast notifications.
 */

let toastContainer = null;

/**
 * Initialize the toast container
 */
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    // Polite live region; error toasts carry role="alert" to be announced at once.
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

// Create the live region up front: screen readers only announce changes to a
// region that already existed.
if (typeof document !== 'undefined' && document.body) ensureToastContainer();

/**
 * Show a toast notification
 * @param {'info'|'warning'|'error'|'success'} type
 * @param {string} message
 * @param {number} duration - ms before auto-dismiss (0 = manual only)
 */
export function showToast(type, message, duration = 5000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  if (type === 'error') toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    <button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);

  // Auto-dismiss (errors stay)
  if (duration > 0 && type !== 'error') {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }
}

/**
 * Show/update the progress overlay
 */
export function showProgress(options = {}) {
  let overlay = document.getElementById('progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'progress-overlay';
    overlay.innerHTML = `
      <div class="progress-card" role="dialog" aria-modal="true" aria-labelledby="progress-title">
        <h2 class="progress-title" id="progress-title">Fetching Live Data</h2>
        <div class="progress-steps"></div>
        <div class="progress-current">
          <div class="progress-message" role="status" aria-live="polite"></div>
          <div class="progress-bar-container" role="progressbar" aria-labelledby="progress-title" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="progress-bar-fill"></div>
          </div>
          <div class="progress-details"></div>
        </div>
        <div class="progress-actions">
          <button class="btn btn-cancel" id="progress-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const wasHidden = overlay.style.display !== 'flex';
  overlay.style.display = 'flex';
  if (wasHidden) {
    // Modal while fetching: the page behind is inert, focus moves to Cancel.
    focusBeforeProgress = document.activeElement;
    const app = document.getElementById('app');
    if (app) app.inert = true;
    overlay.querySelector('#progress-cancel')?.focus();
  }
  updateProgress(options);
  return overlay;
}

let focusBeforeProgress = null;

/**
 * Update the progress display
 */
export function updateProgress(options = {}) {
  const { step, totalSteps, message, progress, completed, failed, total, eta, complete, warning } = options;
  const overlay = document.getElementById('progress-overlay');
  if (!overlay) return;

  // Update steps indicator
  const stepsEl = overlay.querySelector('.progress-steps');
  if (step && totalSteps) {
    const stepNames = ['Country Resources', 'BGP Routes', 'Analysis & ASN Info', 'PeeringDB Locations', 'Build Visualization'];
    let stepsHtml = '';
    for (let i = 1; i <= totalSteps; i++) {
      const cls = i < step ? 'step-done' : i === step ? 'step-active' : 'step-pending';
      stepsHtml += `<div class="progress-step ${cls}">${i}. ${stepNames[i - 1] || `Step ${i}`}</div>`;
    }
    stepsEl.innerHTML = stepsHtml;
  }

  // Update message
  const msgEl = overlay.querySelector('.progress-message');
  if (message) msgEl.textContent = message;
  if (warning) msgEl.classList.add('progress-warning');
  else msgEl.classList.remove('progress-warning');

  // Update progress bar
  const fillEl = overlay.querySelector('.progress-bar-fill');
  if (progress !== undefined) {
    const pct = Math.min(100, Math.max(0, progress * 100));
    fillEl.style.width = `${pct}%`;
    overlay.querySelector('.progress-bar-container')?.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  // Update details
  const detailsEl = overlay.querySelector('.progress-details');
  const parts = [];
  if (completed !== undefined && total !== undefined) {
    parts.push(`${completed} / ${total} completed`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  if (eta !== undefined && eta > 0) {
    parts.push(`~${eta}s remaining`);
  }
  detailsEl.textContent = parts.join(' | ');
}

/**
 * Hide the progress overlay
 */
export function hideProgress() {
  const overlay = document.getElementById('progress-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  overlay.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.inert = false;
  focusBeforeProgress?.focus?.();
  focusBeforeProgress = null;
}

/**
 * Set the cancel button handler
 */
export function onProgressCancel(handler) {
  const btn = document.getElementById('progress-cancel');
  if (btn) {
    btn.onclick = handler;
  }
}
