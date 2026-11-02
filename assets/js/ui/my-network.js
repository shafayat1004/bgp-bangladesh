/**
 * The visitor's own network, looked up once from their IP address and shared
 * by every place that asks: the sidebar's "How do I reach the world?" and the
 * Layered View's "Find my network". The lookup sends the IP address to
 * ipify.org and RIPEstat, so it only runs when the visitor asks for it.
 */

let lookup = null;             // () => Promise<{ asn, holder }>
let result = null;
let pending = null;
let status = 'idle';           // 'idle' | 'pending' | 'done' | 'error'
const resultListeners = new Set();
const statusListeners = new Set();

/** main.js passes () => ripeClient.getMyASN(). */
export function setLookup(fn) {
  lookup = fn;
}

function setStatus(next) {
  status = next;
  for (const cb of statusListeners) cb(status);
}

/** Look the network up, or join the request already running; cached for the session. */
export function findMyNetwork() {
  if (result) return Promise.resolve(result);
  if (pending) return pending;
  if (!lookup) return Promise.reject(new Error('No lookup configured'));
  setStatus('pending');
  pending = Promise.resolve()
    .then(() => lookup())
    .then((r) => {
      result = { ...r, asn: String(r.asn) };
      pending = null;
      setStatus('done');
      for (const cb of resultListeners) cb(result);
      return result;
    }, (err) => {
      pending = null;
      setStatus('error');
      throw err;
    });
  return pending;
}

/** The visitor's network once found, else null. */
export const myNetwork = () => result;

/** 'idle', 'pending', 'done' or 'error'. */
export const lookupStatus = () => status;

/** Called with { asn, holder } when the lookup succeeds; returns unsubscribe. */
export function onMyNetwork(cb) {
  resultListeners.add(cb);
  return () => resultListeners.delete(cb);
}

/** Called with the new status whenever it changes; returns unsubscribe. */
export function onLookupStatus(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

/** Forget the result (for tests). */
export function resetMyNetwork() {
  result = null;
  pending = null;
  status = 'idle';
}
