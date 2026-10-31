/**
 * Educational Modal
 * Shows on first visit to explain BGP concepts and how to use the visualization.
 * The content lives in index.html (<dialog id="edu-modal">) so it is crawlable;
 * the native dialog provides focus trapping, Escape to close and focus return.
 * Uses localStorage to remember dismissed state.
 */

const MODAL_DISMISSED_KEY = 'bgp_bd_modal_dismissed';

/**
 * Check if modal has been dismissed before
 */
function isDismissed() {
  try {
    return localStorage.getItem(MODAL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Mark modal as dismissed
 */
function setDismissed() {
  try {
    localStorage.setItem(MODAL_DISMISSED_KEY, '1');
  } catch {
    // localStorage unavailable
  }
}

let wired = false;

function wire(dialog) {
  if (wired) return;
  wired = true;
  const close = () => dialog.close();
  dialog.querySelector('.modal-close').addEventListener('click', close);
  dialog.querySelector('.modal-dismiss').addEventListener('click', close);
  // A click on the backdrop lands on the <dialog> itself (the card fills its content box).
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  // Covers the buttons, the backdrop and Escape.
  dialog.addEventListener('close', setDismissed);
}

/**
 * Show the educational modal (first visit, or forced from "About this project")
 */
export function showModal(force = false) {
  if (!force && isDismissed()) return;
  const dialog = document.getElementById('edu-modal');
  if (!dialog || dialog.open) return;
  wire(dialog);
  dialog.showModal();
  dialog.querySelector('.modal-card').scrollTop = 0;
}

/**
 * Reset modal dismissed state (for "Show intro again" links)
 */
export function resetModal() {
  try {
    localStorage.removeItem(MODAL_DISMISSED_KEY);
  } catch {
    // ignore
  }
}
