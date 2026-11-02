/**
 * Timeline (history time-slider)
 *
 * Reads the rolling history manifest (data/<country>/history/index.json) and
 * builds a bottom slider that defaults to the latest snapshot. Scrubbing back
 * lazy-loads older snapshots (with a small LRU cache to stay mobile-friendly)
 * and hands the viz data back to the caller for re-rendering. Play steps
 * through the snapshots on every tab.
 */

const CACHE_MAX = 10;          // max snapshots kept in memory
const DEBOUNCE_MS = 140;       // wait for the slider to settle before fetching
/** Time each snapshot stays on screen while playing, after it is drawn. */
export const PLAY_STEP_MS = 1200;

/**
 * The snapshot Play shows next, or null past the end. Play from the latest
 * snapshot starts again at the oldest. Pure + exported for testing.
 */
export function nextPlayIndex(current, latestIndex, starting) {
  if (starting && current === latestIndex) return 0;
  return current + 1 <= latestIndex ? current + 1 : null;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

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
 *   onSelectLatest(index)            - user returned to the newest snapshot
 *   onSelectSnapshot(viz, ts, index) - user picked an older snapshot
 *   onReady(api)                     - the history list loaded; api is
 *     { selectIndex(i), currentIndex(), snapshots(), setMarks(positions), isPlaying() }
 */
export function initTimeline({ country = 'BD', onSelectSnapshot, onSelectLatest, onReady } = {}) {
  const bar = document.getElementById('timeline-bar');
  const slider = document.getElementById('timeline-slider');
  const label = document.getElementById('timeline-label');
  const badge = document.getElementById('timeline-latest-badge');
  const spinner = document.getElementById('timeline-spinner');
  const prevBtn = document.getElementById('timeline-prev');
  const nextBtn = document.getElementById('timeline-next');
  const playBtn = document.getElementById('timeline-play');
  const marks = document.getElementById('timeline-marks');
  const status = document.getElementById('timeline-status');
  if (!bar || !slider) return;

  fetch(`data/${country}/history/index.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((index) => {
      const snapshots = index && Array.isArray(index.snapshots) ? index.snapshots : [];
      // Need at least two points for a meaningful slider.
      if (snapshots.length < 2) {
        bar.classList.replace('timeline-pending', 'hidden');
        return;
      }
      setup(snapshots);
    })
    .catch(() => {
      bar.classList.replace('timeline-pending', 'hidden');
    });

  function setup(snapshots) {
    const cache = new Map();      // file -> viz data (insertion-ordered LRU)
    const latestIndex = snapshots.length - 1;
    let debounceTimer = null;
    let loadToken = 0;            // guards against out-of-order async loads

    bar.classList.remove('timeline-pending', 'hidden');
    bar.removeAttribute('aria-hidden');
    slider.min = '0';
    slider.max = String(latestIndex);
    slider.step = '1';
    slider.value = String(latestIndex);
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', String(latestIndex));

    updateLabel(latestIndex);

    let playing = false;
    let playTimer = null;
    let playWake = null;          // resolves the current Play wait early on pause

    slider.addEventListener('input', () => {
      pause();
      const idx = Number(slider.value);
      updateLabel(idx);                       // label tracks the thumb live
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => select(idx), DEBOUNCE_MS);
    });

    if (prevBtn) prevBtn.addEventListener('click', () => { pause(); step(-1); });
    if (nextBtn) nextBtn.addEventListener('click', () => { pause(); step(1); });
    if (playBtn) playBtn.addEventListener('click', () => (playing ? pause() : play()));

    function setPlaying(on) {
      playing = on;
      if (!playBtn) return;
      // The name says what a press does (Play/Pause), so no aria-pressed:
      // a state on top of a changing name reads as "Pause, pressed".
      playBtn.dataset.playing = String(on);
      playBtn.querySelector('.timeline-play-icon').textContent = on ? '❚❚' : '▶';
      playBtn.querySelector('.timeline-play-text').textContent = on ? 'Pause' : 'Play';
      if (status) status.textContent = on ? 'Playing' : 'Paused';
    }

    function pause() {
      if (!playing) return;
      setPlaying(false);
      clearTimeout(playTimer);
      playWake?.();
    }

    function wait(ms) {
      return new Promise((resolve) => {
        playWake = resolve;
        playTimer = setTimeout(resolve, ms);
      });
    }

    // Each step waits until the snapshot is drawn, then PLAY_STEP_MS, so Play
    // never skips a snapshot or shows stale data. Stops at the latest.
    async function play() {
      setPlaying(true);
      let starting = true;
      while (playing) {
        const current = Number(slider.value);
        const idx = nextPlayIndex(current, latestIndex, starting);
        if (idx === null) break;
        if (!starting || idx === 0) {
          slider.value = String(idx);
          updateLabel(idx);
          const ok = await select(idx);
          if (!ok) break;
        }
        starting = false;
        if (!playing || Number(slider.value) >= latestIndex) break;
        const following = Number(slider.value) + 1;
        if (following < latestIndex) loadSnapshot(snapshots[following].file).catch(() => {});
        await wait(PLAY_STEP_MS);
      }
      if (playing) setPlaying(false);
    }

    function drawMarks(positions) {
      if (!marks) return;
      marks.innerHTML = '';
      for (const pos of new Set(positions)) {
        if (!(pos >= 0 && pos <= latestIndex)) continue;
        const tick = document.createElement('span');
        tick.className = 'timeline-mark';
        tick.style.setProperty('--at', String(pos / latestIndex));
        marks.append(tick);
      }
    }

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

    // Resolves true once the callback ran and the result had two frames to
    // paint; false when the load failed or a newer selection replaced it.
    async function select(index) {
      const { isLatest, snapshot, index: clamped } = resolveSelection(snapshots, index);
      if (isLatest) {
        if (spinner) spinner.classList.add('hidden');
        loadToken++;                          // cancel any in-flight snapshot load
        if (onSelectLatest) onSelectLatest(clamped);
        await nextFrame();
        await nextFrame();
        return true;
      }
      const token = ++loadToken;
      try {
        if (spinner) spinner.classList.remove('hidden');
        const viz = await loadSnapshot(snapshot.file);
        if (token !== loadToken) return false;  // a newer selection superseded this
        if (onSelectSnapshot) onSelectSnapshot(viz, snapshot.ts, clamped);
        await nextFrame();
        await nextFrame();
        return true;
      } catch (err) {
        console.error('Failed to load snapshot', snapshot.file, err);
        return false;
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

    onReady?.({
      // A jump from elsewhere (e.g. a change list entry) pauses Play.
      selectIndex(i) {
        pause();
        clearTimeout(debounceTimer);
        const idx = Math.min(latestIndex, Math.max(0, i));
        slider.value = String(idx);
        updateLabel(idx);
        return select(idx).then(() => {});
      },
      currentIndex: () => Number(slider.value),
      snapshots: () => snapshots,
      setMarks: drawMarks,
      isPlaying: () => playing,
    });
  }
}
