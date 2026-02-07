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
          <p><em>Note: The dataset includes the top 1,500 international connections and top 2,000 domestic connections, 
          capturing all significant BGP traffic while keeping the visualization focused and performant.</em></p>
        </div>

        <div class="modal-diagram">
          <div class="modal-layer" style="background:rgba(66,165,245,0.15);border:1px solid #42a5f5;">
            <div class="modal-layer-label">Layer 1: Your Local Company / ISP</div>
            <div class="modal-layer-desc">ADN Telecom, Triangle Services, KS Network, Dot Internet, Mazeda Networks...</div>
          </div>
          <div class="modal-arrow">&#8595; Domestic BGP Peering &#8595;</div>
          <div class="modal-layer modal-layer-inside">
            <div class="modal-layer-label">Layer 2: Border Gateways</div>
            <div class="modal-layer-desc">Summit Communications, Fiber@Home, Level3, Earth Telecom, Windstream...</div>
          </div>
          <div class="modal-arrow">&#8595; International BGP Peering &#8595;</div>
          <div class="modal-layer modal-layer-outside">
            <div class="modal-layer-label">Layer 3: International Transit</div>
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
            <dd>A unique identifier for a network (e.g., AS58717 = Summit). Think of it as a "network ID".</dd>

            <dt>BGP Route</dt>
            <dd>A path that internet traffic follows between networks. Like a road between cities.</dd>

            <dt>Local Company (Blue nodes)</dt>
            <dd>Your local Bangladeshi company or ISP that originates the route to your network.</dd>

            <dt>IIG - International Internet Gateway (Green nodes)</dt>
            <dd>Border gateway operators in Bangladesh that peer with international networks and provide transit for domestic ISPs. Cross-referenced against the known BTRC IIG list.</dd>

            <dt>Detected Gateway (Amber nodes)</dt>
            <dd>An ASN observed acting as a border gateway for other BD networks, but not found in the known IIG list. This may indicate a new operator, a subsidiary, or a data mapping gap.</dd>

            <dt>Offshore Enterprise (Cyan nodes)</dt>
            <dd>A BD-registered ASN with infrastructure located outside Bangladesh, but no downstream BD customers. Typically tech companies or cloud users. Detected via IP geolocation and PeeringDB analysis.</dd>

            <dt>Offshore Gateway (Pink nodes)</dt>
            <dd>A BD-registered ASN with infrastructure abroad that is also providing transit to other BD networks. This is a potential regulatory concern. Detected via IP geolocation + transit analysis.</dd>

            <dt>Outside BD (Red nodes)</dt>
            <dd>International transit networks that connect Bangladesh to the world. These are your international feeders.</dd>
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
