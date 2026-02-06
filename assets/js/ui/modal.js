/**
 * Educational Modal
 * Shows on first visit to explain BGP concepts and how to use the visualization.
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

/**
 * Create and show the educational modal
 */
export function showModal(force = false) {
  if (!force && isDismissed()) return;

  // Remove existing if any
  const existing = document.getElementById('edu-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'edu-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <button class="modal-close" aria-label="Close">&times;</button>

      <h2 class="modal-title">How Does Bangladesh's Internet Connect to the World?</h2>

      <div class="modal-body">
        <div class="modal-section">
          <h3>What You're Looking At</h3>
          <p>This visualization shows the <strong>BGP (Border Gateway Protocol)</strong> routing paths
          that connect Bangladesh to the global internet. Every time you visit a website or send a message,
          your data travels through these paths.</p>
        </div>

        <div class="modal-diagram">
          <div class="modal-layer modal-layer-inside">
            <div class="modal-layer-label">Your ISP / Domestic Gateways</div>
            <div class="modal-layer-desc">BTCL, GrameenPhone, Robi, BDCOM, Banglalink...</div>
          </div>
          <div class="modal-arrow">&#8595; BGP Peering &#8595;</div>
          <div class="modal-layer modal-layer-outside">
            <div class="modal-layer-label">International Transit Providers</div>
            <div class="modal-layer-desc">Bharti Airtel, Hurricane Electric, NTT, TATA, Cogent...</div>
          </div>
          <div class="modal-arrow">&#8595;</div>
          <div class="modal-layer modal-layer-world">
            <div class="modal-layer-label">The Global Internet</div>
          </div>
        </div>

        <div class="modal-section">
          <h3>Key Concepts</h3>
          <dl class="modal-terms">
            <dt>ASN (Autonomous System Number)</dt>
            <dd>A unique identifier for a network (e.g., AS58717 = BTCL). Think of it as a "network ID".</dd>

            <dt>BGP Route</dt>
            <dd>A path that internet traffic follows between networks. Like a road between cities.</dd>

            <dt>Inside BD (Green nodes)</dt>
            <dd>Bangladeshi networks that receive international traffic. These are your domestic gateways.</dd>

            <dt>Outside BD (Red nodes)</dt>
            <dd>International networks that send traffic into Bangladesh. These are your international feeders.</dd>

            <dt>IIG (International Internet Gateway)</dt>
            <dd>Licensed operators in Bangladesh that provide the physical connection to the global internet.</dd>
          </dl>
        </div>

        <div class="modal-section">
          <h3>How to Use</h3>
          <ul class="modal-tips">
            <li><strong>Switch tabs</strong> to see different visualizations of the same data</li>
            <li><strong>Hover</strong> over nodes for details about each network</li>
            <li><strong>Click</strong> a node to highlight its connections</li>
            <li><strong>Use filters</strong> in the sidebar to adjust what's shown</li>
            <li><strong>Fetch Live Data</strong> to see the current BGP state in real-time</li>
            <li><strong>Export</strong> the data as CSV to analyze in a spreadsheet</li>
          </ul>
        </div>

        <div class="modal-section modal-section-why">
          <h3>Why This Matters</h3>
          <p>Understanding these paths reveals <strong>bottlenecks</strong> and <strong>single points of failure</strong>.
          If a major gateway goes down, whether intentionally or due to a submarine cable cut,
          it affects millions of users. This tool helps visualize that dependency.</p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary modal-dismiss">Got it, show me the data</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const closeModal = () => {
    setDismissed();
    overlay.classList.add('modal-exit');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  overlay.querySelector('.modal-dismiss').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handler);
    }
  });
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
