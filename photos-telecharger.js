#!/usr/bin/env node
/* Télécharge dans photos/ les images déclarées par une url, et bascule la fiche
   sur le fichier local. Sans ça, les photos de Commons ne s'affichent pas hors
   ligne — or c'est précisément l'usage dans les vallées sans réseau.

   Usage : node photos-telecharger.js [nb-par-lieu]
   Par défaut 3 par lieu : embarquer 280 photos ferait un fichier de plusieurs
   dizaines de mégaoctets, intransférable sur un téléphone. Les autres restent
   en lien distant et s'affichent quand le réseau est là. */
'use strict';

const fs = require('fs');
const path = require('path');

const PAR_LIEU = Number(process.argv[2] || 3);
const DOSSIER = path.join(__dirname, 'photos');
const FICHIER = path.join(__dirname, 'config', 'commun', 'lieux.json');
const LARGEUR = 900;   // suffisant pour une galerie, trois fois plus léger que 1280

const dodo = ms => new Promise(r => setTimeout(r, ms));

function nomFichier(lieuId, i, url) {
  const ext = (url.match(/\.(jpe?g|png|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase();
  return `${lieuId}-${i + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

(async () => {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const lieux = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  let pris = 0, sautes = 0, echecs = 0;

  for (const l of lieux) {
    const photos = l.photos || [];
    let n = 0;
    for (let i = 0; i < photos.length && n < PAR_LIEU; i++) {
      const ph = photos[i];
      if (!ph || !ph.url || ph.fichier) continue;
      const nom = nomFichier(l.id, i, ph.url);
      const abs = path.join(DOSSIER, nom);

      if (fs.existsSync(abs)) { ph.fichier = nom; delete ph.url; n++; sautes++; continue; }

      /* Réduire la largeur demandée allège le fichier, mais toutes les vignettes
         ne se déclinent pas dans toutes les tailles : en cas de refus on reprend
         l'url d'origine plutôt que de perdre la photo. */
      const urls = [ph.url.replace(/\/(\d+)px-/, `/${LARGEUR}px-`), ph.url];
      try {
        let r = null;
        for (const u of urls) {
          r = await fetch(u, { headers: { 'User-Agent': 'dolomites-carnet/1.0 (carnet de voyage personnel)' } });
          if (r.ok) break;
          await dodo(200);
        }
        if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 4000) throw new Error('image suspecte, ' + buf.length + ' octets');
        fs.writeFileSync(abs, buf);
        ph.fichier = nom;
        delete ph.url;          // la fiche pointe désormais sur le fichier local
        n++; pris++;
      } catch (e) {
        console.log(`  ${l.id} photo ${i + 1} : ${e.message}`);
        echecs++;
      }
      await dodo(250);
    }
    fs.writeFileSync(FICHIER, JSON.stringify(lieux, null, 2) + '\n', 'utf8');
    process.stdout.write(`  ${l.id} : ${n} locale(s)\n`);
  }

  const octets = fs.readdirSync(DOSSIER)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .reduce((a, f) => a + fs.statSync(path.join(DOSSIER, f)).size, 0);
  console.log(`\n${pris} téléchargées, ${sautes} déjà présentes, ${echecs} en échec.`);
  console.log(`Dossier photos/ : ${(octets / 1024 / 1024).toFixed(1)} Mo`);
})();
