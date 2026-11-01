/**
 * Display names for networks and countries.
 */

const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();
// Codes that aren't one country: no registry data, or an RIR record that
// names a region instead of a country.
export const NOT_COUNTRIES = {
  'Unknown': 'Unknown country',
  'EU': 'Europe (no single country)',
  'AP': 'Asia-Pacific (no single country)',
};

export function countryName(cc) {
  if (NOT_COUNTRIES[cc]) return NOT_COUNTRIES[cc];
  try { return regionNames?.of(cc) || cc; } catch { return cc; }
}

/**
 * Registry names often start with a handle ("LINK3-TECH-AS-BD-AP Link3
 * Technologies Ltd."); drop it when a readable name follows.
 */
export function friendlyName(node) {
  const name = node?.name || '';
  // "HURRICANE - Hurricane Electric LLC", or a handle with a hyphen and no dash.
  const m = name.match(/^[A-Z0-9]+(?:-[A-Z0-9]+)*\s+-\s+(.+)$/) || name.match(/^[A-Z0-9]+(?:-[A-Z0-9]+)+\s+(.+)$/);
  return (m ? m[1] : name) || `AS${node?.asn}`;
}

/**
 * A two-letter country code as a flag emoji
 */
export function countryToFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  const upper = cc.toUpperCase();
  const offset = 0x1F1E6 - 65; // 'A' = 65
  return String.fromCodePoint(
    upper.charCodeAt(0) + offset,
    upper.charCodeAt(1) + offset
  );
}
