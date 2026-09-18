#!/usr/bin/env node
/* Produit deux sorties dans dist/ :
   - le site servi par GitHub Pages (index.html + config/ chargés par fetch)
   - dolomites.html, fichier unique autonome qui marche en file:// sans réseau */
'use strict';

const fs = require('fs');
const path = require('path');

const R = __dirname;
const DIST = path.join(R, 'dist');

function lireFichier(p) { return fs.readFileSync(p, 'utf8'); }

function copierRec(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copierRec(s, d);
    else fs.copyFileSync(s, d);
  }
}

function listerConfig(dir, prefixe = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefixe ? `${prefixe}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listerConfig(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

function poidsLisible(octets) {
  if (octets < 1024) return octets + ' o';
  if (octets < 1024 * 1024) return Math.round(octets / 1024) + ' Ko';
  return (octets / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
}

/* Un </script> à l'intérieur d'un bloc JSON fermerait la balise : on le neutralise. */
function echapper(txt) {
  return txt.replace(/<\/(script)/gi, '<\\/$1');
}

const html = lireFichier(path.join(R, 'src', 'index.html'));
const css = lireFichier(path.join(R, 'src', 'style.css'));
const js = lireFichier(path.join(R, 'src', 'app.js'));
const leafletJs = lireFichier(path.join(R, 'vendor', 'leaflet.js'));
const leafletCss = lireFichier(path.join(R, 'vendor', 'leaflet.css'));

/* Leaflet cherche ses images de marqueurs sur un CDN. On n'utilise que des divIcon,
   mais on coupe la recherche pour qu'aucune requête ne parte hors ligne. */
const leafletNeutre = leafletJs + '\n;if(window.L&&L.Icon&&L.Icon.Default){L.Icon.Default.prototype._getIconUrl=function(){return "";};}\n';

const dateBuild = new Date().toISOString().slice(0, 10);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* ---------- 1. Le site servi ---------- */

copierRec(path.join(R, 'config'), path.join(DIST, 'config'));

const DOSSIER_PHOTOS = path.join(R, 'photos');
const photosDispo = fs.existsSync(DOSSIER_PHOTOS)
  ? fs.readdirSync(DOSSIER_PHOTOS).filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
  : [];
if (photosDispo.length) copierRec(DOSSIER_PHOTOS, path.join(DIST, 'photos'));

const siteHtml = html
  .replace('<!--[[CSS]]-->',
    `<style>\n${leafletCss}\n</style>\n<style>\n${css}\n</style>`)
  .replace('<!--[[JS]]-->',
    `<script>\n${leafletNeutre}\n</script>\n` +
    `<script>window.__DOLOMITES_BUILD__={date:"[[DATE]]",poids:"[[POIDS]]"};</script>\n` +
    `<script>\n${js}\n</script>`);

/* ---------- 2. Le fichier autonome ---------- */

const fichiers = listerConfig(path.join(R, 'config'));
const blocs = fichiers.map(rel => {
  const contenu = lireFichier(path.join(R, 'config', rel));
  return `<script type="application/json" id="cfg:${rel}">${echapper(contenu)}</script>`;
}).join('\n');

const PLAFOND_MO = 15;
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };

/* Seules les photos réellement citées par un lieu sont embarquées : une image
   oubliée dans le dossier ne doit pas alourdir le fichier qu'on met sur le téléphone. */
const citees = new Set();
for (const rel of fichiers) {
  if (!rel.endsWith('lieux.json')) continue;
  for (const l of JSON.parse(lireFichier(path.join(R, 'config', rel)))) {
    (l.photos || []).forEach(ph => { if (ph && ph.fichier) citees.add(ph.fichier); });
  }
}

const blocsPhotos = [];
let poidsPhotos = 0;
const ignorees = [];
for (const f of photosDispo) {
  if (!citees.has(f)) { ignorees.push(f); continue; }
  const abs = path.join(DOSSIER_PHOTOS, f);
  const octets = fs.statSync(abs).size;
  const type = TYPES[path.extname(f).toLowerCase()];
  if (!type) { ignorees.push(f + ' (format non géré)'); continue; }
  if (poidsPhotos + octets * 1.37 > PLAFOND_MO * 1024 * 1024) {
    ignorees.push(f + ' (plafond de ' + PLAFOND_MO + ' Mo atteint)');
    continue;
  }
  poidsPhotos += octets * 1.37;
  const b64 = fs.readFileSync(abs).toString('base64');
  blocsPhotos.push(`<script type="text/plain" id="photo:${f}">data:${type};base64,${b64}</script>`);
}

const autonomeHtml = html
  .replace('<!--[[CSS]]-->',
    `<style>\n${leafletCss}\n</style>\n<style>\n${css}\n</style>`)
  .replace('<!--[[JS]]-->',
    `${blocs}\n${blocsPhotos.join('\n')}\n<script>\n${leafletNeutre}\n</script>\n<script>\n${js}\n</script>`);

fs.writeFileSync(path.join(DIST, 'dolomites.html'), autonomeHtml, 'utf8');
const poids = poidsLisible(Buffer.byteLength(autonomeHtml, 'utf8'));

/* Le site connaît le poids et la date du fichier autonome, pour l'afficher sur le bouton. */
fs.writeFileSync(
  path.join(DIST, 'index.html'),
  siteHtml.replace('[[DATE]]', dateBuild).replace('[[POIDS]]', poids),
  'utf8'
);

fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

/* ---------- Contrôle : aucune dépendance réseau bloquante dans l'autonome ---------- */

/* Seules comptent les ressources que le navigateur CHARGE : <script src>, <link href>,
   <img src>. Un <a href> vers un site externe ne bloque rien hors ligne. */
const externesBloquants = [];
for (const m of autonomeHtml.matchAll(/<(script|link|img|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
  externesBloquants.push(m[2]);
}
for (const m of autonomeHtml.matchAll(/@import\s+(?:url\()?["'](https?:\/\/[^"']+)["']/gi)) {
  externesBloquants.push(m[1]);
}

console.log(`\nBuild terminé — ${dateBuild}`);
console.log(`  dist/index.html      site servi par Pages`);
console.log(`  dist/dolomites.html  fichier autonome hors ligne, ${poids}`);
console.log(`  ${fichiers.length} fichiers de configuration inlinés`);
if (blocsPhotos.length) console.log(`  ${blocsPhotos.length} photo(s) embarquée(s), ${poidsLisible(poidsPhotos)}`);
if (ignorees.length) console.log(`  ${ignorees.length} photo(s) non embarquée(s) : ${ignorees.join(', ')}`);
if (externesBloquants.length) {
  console.warn('\n  Attention — ressources externes qui bloqueraient le hors ligne :');
  externesBloquants.forEach(u => console.warn('    · ' + u));
  process.exitCode = 1;
} else {
  console.log(`  Aucune ressource externe bloquante : le fichier autonome fonctionne sans réseau.\n`);
}
