// Vaultkeeper - icon set (24x24, line style). Everything is local, no internet.
const ICONS = {
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6L12 3z"/>',
  shieldCheck: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6L12 3z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/>',
  user: '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20c.9-3.6 3.8-5.6 7.2-5.6s6.3 2 7.2 5.6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.8 7l8.2 6 8.2-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5.5M11 16.5h5.5"/>',
  database: '<ellipse cx="12" cy="5.8" rx="7.5" ry="2.8"/><path d="M4.5 5.8v12.4c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V5.8"/><path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
  wallet: '<path d="M19 7.5V6a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20H19a2 2 0 0 0 2-2v-8.5a2 2 0 0 0-2-2H5.5"/><path d="M16.5 13.8h.01"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6.5 15h3.5"/>',
  bank: '<path d="M3 9.5L12 4l9 5.5"/><path d="M5 10v7M9.7 10v7M14.3 10v7M19 10v7M3.5 20h17"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.6 12.4a9.5 9.5 0 0 1 12.8 0"/><path d="M8.8 15.7a5 5 0 0 1 6.4 0"/><path d="M12 19.2h.01"/>',
  key: '<circle cx="8" cy="15.5" r="4.5"/><path d="M11.2 12.3L20 3.5M16.5 7l2.5 2.5M14 9.5l2 2"/>',
  license: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 11.5h5"/><circle cx="14.5" cy="16" r="1.8"/><path d="M13.3 17.4l-.8 2.3 2-1 2 1-.8-2.3"/>',
  note: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8.5 12h7M8.5 15.5h7"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.9 3.6M6.2 7.6A16 16 0 0 0 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.3 4-.9"/><path d="M9.9 10a2.8 2.8 0 0 0 4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.6l1.7-2.1"/><path d="M20 20v-4.5h-4.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  login: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16.5l4.5-4.5L10 7.5M14.5 12H3.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-7 7a1.4 1.4 0 0 1-2 0z"/><circle cx="8.2" cy="8.2" r="1.3"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  twofa: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M9.5 9.5l1.8 1.8 3.4-3.6"/>',
  wand: '<path d="M5 19L16 8M14 6l4 4"/><path d="M18 3v3M16.5 4.5h3M20 13v2.5M18.75 14.25h2.5M8 3v2M7 4h2"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  power: '<path d="M12 3.5v8"/><path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 8v4.3l3 1.8"/>',
  zap: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  paperclip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4L15 7.1"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  file: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5v4h4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
  fingerprint: '<path d="M7 18.5c1-1.8 1.5-4 1.5-6.5a3.5 3.5 0 0 1 7 0c0 1.3-.1 2.5-.3 3.6"/><path d="M12 12c0 3.2-.7 6-2 8.3M15 18.8c-.3.7-.6 1.3-1 1.9"/><path d="M4.6 15.5c.6-1.1.9-2.3.9-3.5a6.5 6.5 0 0 1 11.6-4M18.3 10.4c.1.5.2 1 .2 1.6 0 1.9-.2 3.6-.6 5.2"/><path d="M5.4 5.6A9 9 0 0 1 20 7.2"/>',
  puzzle: '<path d="M10 4.5a2 2 0 0 1 4 0V6h3.5a1 1 0 0 1 1 1v3.5H20a2 2 0 0 1 0 4h-1.5V18a1 1 0 0 1-1 1H14v-1.5a2 2 0 0 0-4 0V19H6.5a1 1 0 0 1-1-1v-3.5H7a2 2 0 0 0 0-4H5.5V7a1 1 0 0 1 1-1H10z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
};

function icon(name, cls = "") {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;
}

// App logo (vault door). Each instance gets unique gradient ids.
const LOGO_SVG = { full: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><defs><clipPath id=\"tile\"><rect x=\"48\" y=\"48\" width=\"928\" height=\"928\" rx=\"220\"/></clipPath><linearGradient id=\"neonU\" x1=\"212\" y1=\"212\" x2=\"812\" y2=\"812\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#22d3ee\"/><stop offset=\".5\" stop-color=\"#4f8cff\"/><stop offset=\"1\" stop-color=\"#8b5cf6\"/></linearGradient><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#151d3b\"/><stop offset=\"1\" stop-color=\"#080c18\"/></linearGradient><linearGradient id=\"neon\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#22d3ee\"/><stop offset=\".5\" stop-color=\"#4f8cff\"/><stop offset=\"1\" stop-color=\"#8b5cf6\"/></linearGradient><radialGradient id=\"glow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#4f8cff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#4f8cff\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"shine\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\".18\"/><stop offset=\".5\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient><filter id=\"blur\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\"><feGaussianBlur stdDeviation=\"22\"/></filter><filter id=\"soft\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\"><feGaussianBlur stdDeviation=\"10\"/></filter></defs><g clip-path=\"url(#tile)\"><rect x=\"48\" y=\"48\" width=\"928\" height=\"928\" rx=\"220\" fill=\"url(#bg)\"/><rect x=\"50\" y=\"50\" width=\"924\" height=\"924\" rx=\"218\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".09\" stroke-width=\"4\"/><circle cx=\"512\" cy=\"512\" r=\"400\" fill=\"url(#glow)\"/><circle cx=\"512\" cy=\"512\" r=\"300\" fill=\"none\" stroke=\"url(#neon)\" stroke-width=\"46\" filter=\"url(#blur)\" opacity=\".8\"/><circle cx=\"512\" cy=\"512\" r=\"300\" fill=\"#0b1124\" stroke=\"url(#neon)\" stroke-width=\"46\"/><g stroke=\"url(#neonU)\" stroke-width=\"12\" stroke-linecap=\"round\" opacity=\".85\"><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(0 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(15 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(30 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(45 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(60 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(75 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(90 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(105 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(120 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(135 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(150 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(165 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(180 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(195 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(210 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(225 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(240 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(255 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(270 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(285 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(300 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(315 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(330 512 512)\"/><line x1=\"512\" y1=\"250\" x2=\"512\" y2=\"276\" transform=\"rotate(345 512 512)\"/></g><circle cx=\"512\" cy=\"512\" r=\"196\" fill=\"#0e1630\" stroke=\"#fff\" stroke-opacity=\".07\" stroke-width=\"4\"/><g fill=\"url(#neon)\" filter=\"url(#soft)\" opacity=\".7\"><circle cx=\"512\" cy=\"478\" r=\"54\"/><path d=\"M482 505 L542 505 L562 610 Q512 624 462 610 Z\"/></g><g fill=\"url(#neon)\"><circle cx=\"512\" cy=\"478\" r=\"54\"/><path d=\"M482 505 L542 505 L562 610 Q512 624 462 610 Z\"/></g><rect x=\"48\" y=\"48\" width=\"928\" height=\"464\" rx=\"220\" fill=\"url(#shine)\" opacity=\".6\"/></g></svg>", small: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><defs><clipPath id=\"tile\"><rect x=\"48\" y=\"48\" width=\"928\" height=\"928\" rx=\"220\"/></clipPath><linearGradient id=\"neonU\" x1=\"212\" y1=\"212\" x2=\"812\" y2=\"812\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#22d3ee\"/><stop offset=\".5\" stop-color=\"#4f8cff\"/><stop offset=\"1\" stop-color=\"#8b5cf6\"/></linearGradient><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#151d3b\"/><stop offset=\"1\" stop-color=\"#080c18\"/></linearGradient><linearGradient id=\"neon\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#22d3ee\"/><stop offset=\".5\" stop-color=\"#4f8cff\"/><stop offset=\"1\" stop-color=\"#8b5cf6\"/></linearGradient><radialGradient id=\"glow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#4f8cff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#4f8cff\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"shine\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\".18\"/><stop offset=\".5\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient><filter id=\"blur\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\"><feGaussianBlur stdDeviation=\"22\"/></filter><filter id=\"soft\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\"><feGaussianBlur stdDeviation=\"10\"/></filter></defs><g clip-path=\"url(#tile)\"><rect x=\"48\" y=\"48\" width=\"928\" height=\"928\" rx=\"220\" fill=\"url(#bg)\"/><circle cx=\"512\" cy=\"512\" r=\"420\" fill=\"url(#glow)\"/><circle cx=\"512\" cy=\"512\" r=\"292\" fill=\"#0b1124\" stroke=\"url(#neonU)\" stroke-width=\"96\"/><g fill=\"url(#neonU)\"><circle cx=\"512\" cy=\"462\" r=\"92\"/><path d=\"M462 500 L562 500 L592 668 Q512 690 432 668 Z\"/></g></g></svg>" };
let _logoN = 0;
function logo(kind = "small") {
  const sfx = "_lg" + (++_logoN);
  return LOGO_SVG[kind]
    .replace(/id="([^"]+)"/g, (m, id) => `id="${id}${sfx}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${id}${sfx})`)
    .replace("<svg ", '<svg class="logo" aria-hidden="true" ');
}
