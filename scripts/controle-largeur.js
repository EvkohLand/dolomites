#!/usr/bin/env node
/* Contrôle de largeur : chaque onglet de chaque jour doit occuper au moins 85 % de l'écran, sans débordement.
   Usage : node scripts/controle-largeur.js [url] [largeur]   (défaut : page en ligne, 1680 px)
   Nécessite playwright (NODE_PATH vers un node_modules qui le contient). */
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'https://evkohland.github.io/dolomites/'; const W = Number(process.argv[3] || 1680);
  const b = await chromium.launch(); const ko = []; let n = 0;
  for (let j = 1; j <= 8; j++) {
    const p = await b.newPage({ viewport: { width: W, height: 1000 } }); const err = []; p.on('pageerror', e => err.push(e.message));
    await p.goto(url + '#jour-' + j, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
    const ids = await p.evaluate(() => [...document.querySelectorAll('.onglet')].map(b => b.dataset.onglet));
    for (const id of ids) {
      await p.click('.onglet[data-onglet="' + id + '"]'); await p.waitForTimeout(id === 'meteo' ? 3000 : 400);
      const r = await p.evaluate(() => {
        const pn = document.querySelector('.onglet-panneau:not([hidden])'); const pr = pn.getBoundingClientRect();
        let droite = pr.left;
        /* Seuls comptent le texte réel, les images et les graphiques : pas les bordures ni les traits. */
        pn.querySelectorAll('*').forEach(e => {
          const vraiTexte = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
          if (!vraiTexte && !/^(IMG|svg|INPUT|BUTTON)$/.test(e.tagName)) return;
          if (e.closest('details:not([open]) > :not(summary)')) return;
          const r = e.getBoundingClientRect(); if (r.width && r.height) droite = Math.max(droite, r.right);
        });
        return { part: (droite - pr.left) / pr.width, larg: document.documentElement.scrollWidth, vue: innerWidth };
      });
      n++;
      if (r.part < 0.85 || r.larg > r.vue || err.length) ko.push('J' + j + ' ' + id + ' : ' + Math.round(r.part * 100) + ' % de la largeur' + (r.larg > r.vue ? ', DÉBORDE' : '') + (err.length ? ', ERREUR ' + err[0] : ''));
    }
    await p.close();
  }
  console.log(n + ' onglets contrôlés à ' + W + ' px ; problèmes : ' + ko.length); ko.forEach(x => console.log('  ' + x)); await b.close();
})();
