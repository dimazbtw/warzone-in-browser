/**
 * Ícones de traço (SVG inline) do HUD — no lugar de emojis, para um visual limpo e
 * consistente. Todos usam currentColor, então herdam a cor do texto.
 */
const svg = (body, vb = '0 0 24 24') => `<svg class="ic" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON = {
  skull: svg('<path d="M12 3a7 7 0 0 0-7 7v3l2 2v3h10v-3l2-2v-3a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="11" r="1.4" fill="currentColor"/><circle cx="14.5" cy="11" r="1.4" fill="currentColor"/><path d="M10 18v2M14 18v2"/>'),
  person: svg('<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>'),
  squad: svg('<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M13.5 14.5c.9-.6 1.9-1 3-1 2.3 0 4 1.4 4.5 4.5"/>'),
  plate: svg('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 11.5l2 2 4-4"/>'),
  heal: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  grenade: svg('<circle cx="11" cy="14" r="6"/><path d="M11 8V5h4M14 5l3-2M8.5 11.5l5 5M13.5 11.5l-5 5"/>'),
  smoke: svg('<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 7 18z"/>'),
  cash: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>'),
  storm: svg('<path d="M4 14a5 5 0 0 1 9-3 4 4 0 0 1 7 2.5A3.5 3.5 0 0 1 17 17H6a3 3 0 0 1-2-3z"/><path d="M11 17l-2 4M15 17l-2 4"/>'),
  timer: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M9.5 2.5h5"/>'),
  resurgence: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>'),
  knife: svg('<path d="M3 21l6-6M9 15l10.5-10.5a2 2 0 0 1 1.5 3.4L12 17z"/><path d="M7 13l4 4"/>'),
  contract: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  radar: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>'),
  ammo: svg('<path d="M8 20V9l2-5 2 5v11zM14 20v-9l1.5-4 1.5 4v9z"/>'),
};
