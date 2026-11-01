/**
 * Small helpers for reading viz data ({ nodes, edges }), shared by the views,
 * the glossary, search, "How do I reach the world?", export and the layout
 * precompute script (so no DOM access here).
 */

// D3 simulations replace a connection's source and target ids with the
// network objects, so a connection's ends are either.
export const sourceAsn = (e) => e.source?.asn ?? e.source;
export const targetAsn = (e) => e.target?.asn ?? e.target;
export const connectionEnds = (e) => [sourceAsn(e), targetAsn(e)];

/** Networks keyed by ASN, for looking up a connection's ends. */
export function networksByAsn(nodes) {
  const byAsn = {};
  for (const n of nodes || []) byAsn[n.asn] = n;
  return byAsn;
}
