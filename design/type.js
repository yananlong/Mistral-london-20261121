/* Typeface candidates, compared in system.html.
   Decided: Atkinson Hyperlegible Next. The others stay here only so the comparison can still be seen.
   "Use for this page" switches the page for a moment; nothing is remembered, and every load starts on Atkinson.
   ?font=b612 (or another key) in the URL starts on that face instead. */
(function () {
  const T = window.TYPEFACES = {
    atkinson: {
      name: 'Atkinson Hyperlegible Next', family: '"Atkinson Hyperlegible Next"',
      href: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;600&display=swap',
      by: `Braille Institute and Applied Design, 2019; Next, 2025`,
      why: `Made for people with low vision. Each letter has a shape no other letter shares, so I, l and 1 or O and 0 can't be confused.`,
      facts: `Free, SIL Open Font License. 7 weights. More than 150 languages.`,
    },
    b612: {
      name: 'B612', family: '"B612"',
      href: 'https://fonts.googleapis.com/css2?family=B612:wght@400;700&display=swap',
      by: `Airbus with Intactile Design, for cockpit screens; open since 2017`,
      why: `Built so pilots can read a screen at a glance, in bad light and while tired. The nearest free match to Volvo's idea.`,
      facts: `Free, Open Font License and Eclipse. 2 weights only. Wide, so fewer words fit on a line.`,
    },
    inclusive: {
      name: 'Inclusive Sans', family: '"Inclusive Sans"',
      href: 'https://fonts.googleapis.com/css2?family=Inclusive+Sans:wght@400;600&display=swap',
      by: `Olivia King, 2023; version 2, 2025`,
      why: `A neat, modern face based on legibility research, with small details that keep similar letters apart.`,
      facts: `Free, SIL Open Font License. Several weights. Looks the most like a normal app.`,
    },
    lexend: {
      name: 'Lexend', family: '"Lexend"',
      href: 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;600&display=swap',
      by: `Bonnie Shaver-Troup and Thomas Jockin, 2019`,
      why: `Wide letters and generous spacing, made to help people who struggle to read. Friendly and round.`,
      facts: `Free, SIL Open Font License. 9 weights. The reading claims come from its makers.`,
    },
    andika: {
      name: 'Andika', family: '"Andika"',
      href: 'https://fonts.googleapis.com/css2?family=Andika:wght@400;700&display=swap',
      by: `SIL International`,
      why: `Made for children and adults learning to read. Letters are shaped the way they are taught in school, such as a single-storey a.`,
      facts: `Free, SIL Open Font License. 2 weights. Looks the least modern.`,
    },
    inter: {
      name: 'Inter', family: '"InterVariable", "Inter"', features: '"cv05" 1, "cv08" 1',
      href: 'https://rsms.me/inter/inter.css',
      by: `Rasmus Andersson, 2017`,
      why: `Used in the first draft. Neat and neutral, but it is the default of countless apps, so it looks generic.`,
      facts: `Free, SIL Open Font License. Needs its alternates on to tell I from l.`,
    },
  };
  const DEFAULT = 'atkinson';

  for (const k in T) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = T[k].href;
    document.head.appendChild(l);
  }

  window.useFont = function (k) {
    if (!T[k]) k = DEFAULT;
    const r = document.documentElement.style;
    r.setProperty('--font', T[k].family + ', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif');
    r.setProperty('--legible', T[k].features || 'normal');
    document.documentElement.dataset.font = k;
    document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.font === k)));
    return k;
  };

  window.useFont(new URLSearchParams(location.search).get('font') || DEFAULT);
  document.addEventListener('DOMContentLoaded', () => window.useFont(document.documentElement.dataset.font));
})();
