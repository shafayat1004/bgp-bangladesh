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
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

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
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
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
      <div class="progress-card">
        <h3 class="progress-title">Fetching Live Data</h3>
        <div class="progress-steps"></div>
        <div class="progress-current">
          <div class="progress-message"></div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill"></div>
          </div>
          <div class="progress-details"></div>
        </div>
        <div class="progress-actions">
          <button class="btn btn-cancel" id="progress-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  updateProgress(options);
  return overlay;
}

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
    const stepNames = ['Country Resources', 'BGP Routes', 'ASN Names', 'Processing'];
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
    fillEl.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
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
  if (overlay) overlay.style.display = 'none';
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
