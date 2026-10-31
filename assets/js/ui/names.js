/**
 * Display names for networks.
 */

/**
 * Registry names often start with a handle ("LINK3-TECH-AS-BD-AP Link3
 * Technologies Ltd."); drop it when a readable name follows.
 */
export function friendlyName(node) {
  const name = node?.name || '';
  const m = name.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)+)\s+(.+)$/);
  return (m ? m[2] : name) || `AS${node?.asn}`;
}
