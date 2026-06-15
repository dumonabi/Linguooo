const CUSTOM_FLAG_SVGS = {
  'ES-CT': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 18"><rect fill="#FCDD09" width="27" height="18"/><rect fill="#DA121A" y="2" width="27" height="2"/><rect fill="#DA121A" y="6" width="27" height="2"/><rect fill="#DA121A" y="10" width="27" height="2"/><rect fill="#DA121A" y="14" width="27" height="2"/></svg>`,
  'EU-BASQUE': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 18"><rect width="27" height="18" fill="#D52B1E"/><path fill="none" stroke="#009B48" stroke-width="5.5" d="M-1 0 28 18M28 0-1 18"/><rect x="11.25" width="4.5" height="18" fill="#FFF"/><rect y="6.75" width="27" height="4.5" fill="#FFF"/></svg>`,
  'ES-GALICIA': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 18"><rect width="27" height="18" fill="#FFFFFF"/><rect y="5" width="27" height="8" fill="#005EB8"/><path fill="#FFD700" d="M13.5 6.2c-1.8 0-3.2 1.2-3.2 2.7 0 1.8 3.2 4.6 3.2 4.6s3.2-2.8 3.2-4.6c0-1.5-1.4-2.7-3.2-2.7zm0 1.4c.9 0 1.6.6 1.6 1.3 0 .8-1.6 2.4-1.6 2.4s-1.6-1.6-1.6-2.4c0-.7.7-1.3 1.6-1.3z"/></svg>`,
};

const flagModules = import.meta.glob(
  '../node_modules/country-flag-icons/3x2/*.svg',
  { eager: true, query: '?raw', import: 'default' },
);

const flagsByIso = {};

for (const [path, svg] of Object.entries(flagModules)) {
  const match = path.match(/\/([^/]+)\.svg$/i);
  if (match) flagsByIso[match[1].toUpperCase()] = svg;
}

export function getFlagSvg(flagCode) {
  if (!flagCode) return null;
  const key = flagCode.toUpperCase();
  if (CUSTOM_FLAG_SVGS[key]) return CUSTOM_FLAG_SVGS[key];
  return flagsByIso[key] || null;
}

export function formatFlagSvg(svg) {
  if (!svg) return '';
  return svg.replace(
    '<svg ',
    '<svg class="flag-svg-flag" aria-hidden="true" focusable="false" ',
  );
}
