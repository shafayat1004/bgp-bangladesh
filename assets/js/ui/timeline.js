/**
 * Timeline (history time-slider)
 *
 * Reads the rolling history manifest (data/<country>/history/index.json) and
 * builds a bottom slider that defaults to the latest snapshot. Scrubbing back
 * lazy-loads older snapshots (with a small LRU cache to stay mobile-friendly)
 * and hands the viz data back to the caller for re-rendering.
 */

const CACHE_MAX = 10;          // max snapshots kept in memory
const DEBOUNCE_MS = 140;       // wait for the slider to settle before fetching

/**
 * Format an ISO timestamp into a compact, human-friendly label.
 * Exported for unit testing.
 */
export function formatTimestamp(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Decide what a given slider index maps to. Pure + exported for testing.
 * Returns { isLatest, snapshot }.
 */
export function resolveSelection(snapshots, index) {
  const latestIndex = snapshots.length - 1;
  const clamped = Math.min(latestIndex, Math.max(0, index));
  return {
    isLatest: clamped === latestIndex,
    index: clamped,
    snapshot: snapshots[clamped],
  };
}

/**
 * Initialize the timeline. Callbacks:
 *   onSelectLatest()             - user returned to the newest snapshot
 *   onSelectSnapshot(viz, ts)    - user picked an older snapshot
 */
export function initTimeline({ country = 'BD', onSelectSnapshot, onSelectLatest } = {}) {
  const bar = document.getElementById('timeline-bar');
  const slider = document.getElementById('timeline-slider');
  const label = document.getElementById('timeline-label');
  const badge = document.getElementById('timeline-latest-badge');
  const spinner = document.getElementById('timeline-spinner');
  const prevBtn = document.getElementById('timeline-prev');
  const nextBtn = document.getElementById('timeline-next');
  if (!bar || !slider) return;

  fetch(`data/${country}/history/index.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((index) => {
      const snapshots = index && Array.isArray(index.snapshots) ? index.snapshots : [];
      // Need at least two points for a meaningful slider.
      if (snapshots.length < 2) {
        bar.classList.add('hidden');
        return;
      }
      setup(snapshots);
    })
    .catch(() => {
      bar.classList.add('hidden');
    });

  function setup(snapshots) {
    const cache = new Map();      // file -> viz data (insertion-ordered LRU)
    const latestIndex = snapshots.length - 1;
    let debounceTimer = null;
    let loadToken = 0;            // guards against out-of-order async loads

    bar.classList.remove('hidden');
    bar.removeAttribute('aria-hidden');
    slider.min = '0';
    slider.max = String(latestIndex);
    slider.step = '1';
    slider.value = String(latestIndex);
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', String(latestIndex));

    updateLabel(latestIndex);

    slider.addEventListener('input', () => {
      const idx = Number(slider.value);
      updateLabel(idx);                       // label tracks the thumb live
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => select(idx), DEBOUNCE_MS);
    });

    if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => step(1));

    function step(delta) {
      const idx = Math.min(latestIndex, Math.max(0, Number(slider.value) + delta));
      if (idx === Number(slider.value)) return;
      slider.value = String(idx);
      updateLabel(idx);
      select(idx);
    }

    function updateLabel(index) {
      const { isLatest, snapshot } = resolveSelection(snapshots, index);
      if (label) label.textContent = formatTimestamp(snapshot.ts);
      if (badge) badge.classList.toggle('hidden', !isLatest);
      slider.setAttribute('aria-valuenow', String(index));
      slider.setAttribute('aria-valuetext', formatTimestamp(snapshot.ts));
    }

    async function select(index) {
      const { isLatest, snapshot } = resolveSelection(snapshots, index);
      if (isLatest) {
        if (spinner) spinner.classList.add('hidden');
        loadToken++;                          // cancel any in-flight snapshot load
        if (onSelectLatest) onSelectLatest();
        return;
      }
      const token = ++loadToken;
      try {
        if (spinner) spinner.classList.remove('hidden');
        const viz = await loadSnapshot(snapshot.file);
        if (token !== loadToken) return;      // a newer selection superseded this
        if (onSelectSnapshot) onSelectSnapshot(viz, snapshot.ts);
      } catch (err) {
        console.error('Failed to load snapshot', snapshot.file, err);
      } finally {
        if (token === loadToken && spinner) spinner.classList.add('hidden');
      }
    }

    async function loadSnapshot(file) {
      if (cache.has(file)) {
        const viz = cache.get(file);
        cache.delete(file);                   // bump recency
        cache.set(file, viz);
        return viz;
      }
      const resp = await fetch(`data/${country}/history/${file}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const viz = await resp.json();
      cache.set(file, viz);
      if (cache.size > CACHE_MAX) {
        cache.delete(cache.keys().next().value);  // evict oldest
      }
      return viz;
    }
  }
}
