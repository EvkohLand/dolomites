#!/usr/bin/env node
/* Télécharge dans photos/ les images ajoutées aux POI qui étaient sans photo.
   Les images viennent de Wikimedia Commons et conservent leur légende/crédit dans
   config/commun/lieux.json. Les catégories de séjour/courses reçoivent jusqu'à
   trois fichiers locaux ; les autres au moins un quand Commons fournit un candidat. */
'use strict';

const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, 'config', 'commun', 'lieux.json');
const AVANT = process.env.ORIGINAUX || path.join(process.env.RUNNER_TEMP || '.', 'lieux-avant.json');
const DOSSIER = path.join(__dirname, 'photos');
const PRIORITAIRES = new Set(['camping', 'agricamper', 'aire', 'supermarche']);
const PAR_PRIORITAIRE = Number(process.env.PAR_PRIORITAIRE || 3);
const PAR_AUTRE = Number(process.env.PAR_AUTRE || 1);

function extension(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('avif')) return 'avif';
  if (ct.includes('gif')) return 'gif';
  const m = String(url || '').match(/\.(jpe?g|png|webp|avif|gif)(?:$|[?/#])/i);
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  return 'jpg';
}

function fichierPour(id, numero, ext) {
  return `${id}-web-${numero}.${ext}`;
}

(async () => {
  if (!fs.existsSync(AVANT)) throw new Error(`Fichier d'état initial introuvable : ${AVANT}`);
  fs.mkdirSync(DOSSIER, { recursive: true });

  const avant = JSON.parse(fs.readFileSync(AVANT, 'utf8'));
  const lieux = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  const idsSansPhoto = new Set(
    avant.filter(l => !(l.photos || []).filter(Boolean).length).map(l => l.id)
  );

  console.log(`${idsSansPhoto.size} POI étaient sans photo avant enrichissement.`);
  let telechargees = 0;
  const bilan = [];

  for (const lieu of lieux) {
    if (!idsSansPhoto.has(lieu.id)) continue;
    const photos = Array.isArray(lieu.photos) ? lieu.photos : [];
    const cible = PRIORITAIRES.has(lieu.categorie) ? PAR_PRIORITAIRE : PAR_AUTRE;
    let locales = photos.filter(p => p && p.fichier).length;
    let numero = 1;

    for (const ph of photos) {
      if (locales >= cible) break;
      if (!ph || ph.fichier || !ph.url) continue;

      while (fs.existsSync(path.join(DOSSIER, fichierPour(lieu.id, numero, 'jpg'))) ||
             fs.existsSync(path.join(DOSSIER, fichierPour(lieu.id, numero, 'png'))) ||
             fs.existsSync(path.join(DOSSIER, fichierPour(lieu.id, numero, 'webp'))) ||
             fs.existsSync(path.join(DOSSIER, fichierPour(lieu.id, numero, 'avif'))) ||
             fs.existsSync(path.join(DOSSIER, fichierPour(lieu.id, numero, 'gif')))) numero++;

      try {
        const r = await fetch(ph.url, {
          headers: { 'User-Agent': 'dolomites-carnet/1.0 (carnet de voyage personnel)' }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 4000) throw new Error(`image suspecte (${buf.length} octets)`);
        const ext = extension(r.headers.get('content-type'), ph.url);
        const nom = fichierPour(lieu.id, numero, ext);
        fs.writeFileSync(path.join(DOSSIER, nom), buf);
        ph.fichier = nom;
        delete ph.url;
        locales++;
        numero++;
        telechargees++;
        console.log(`  ${lieu.id} : ${nom}`);
      } catch (e) {
        console.log(`  ${lieu.id} : téléchargement ignoré — ${e.message}`);
      }
    }

    bilan.push({ id: lieu.id, nom: lieu.nom, categorie: lieu.categorie, locales, total: photos.length });
  }

  fs.writeFileSync(FICHIER, JSON.stringify(lieux, null, 2) + '\n', 'utf8');

  const sansFichier = bilan.filter(x => x.locales === 0);
  console.log(`\n${telechargees} image(s) ajoutée(s) physiquement dans photos/.`);
  console.log(`POI initialement sans photo avec au moins un fichier local : ${bilan.length - sansFichier.length}/${bilan.length}.`);
  if (sansFichier.length) {
    console.log('POI encore sans fichier local :');
    sansFichier.forEach(x => console.log(`  ! ${x.id} — ${x.nom} (${x.categorie})`));
  } else {
    console.log('Tous les POI initialement sans photo ont désormais au moins un fichier local.');
  }
})();
