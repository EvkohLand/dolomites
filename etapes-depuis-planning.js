#!/usr/bin/env node
/* Régénère itineraire.json à partir du planning : une étape par journée, passant
   par les lieux réellement visités ce jour-là.

   Sans ça, le tracé ne relie que le départ et l'arrivée du séjour et ignore les
   journées sur place — il traverse alors le massif en ligne, loin des lieux du
   programme. Ce script rend le tracé fidèle au planning.

   Usage : node etapes-depuis-planning.js [id-du-scenario]
   Puis : node trace-route.js  (pour calculer le tracé routier réel). */
'use strict';

const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, 'config');
const lire = p => JSON.parse(fs.readFileSync(p, 'utf8'));

/* Un lieu qui ne se rejoint pas en voiture ne doit pas figurer sur le tracé
   routier : le sommet d'un téléphérique ou un plateau d'altitude ferait faire
   un détour absurde à la route. */
const SANS_VOITURE = new Set(['remontee', 'plateau', 'rando']);

const peagesConnus = {
  'etape-aller-1': 22,
  'etape-aller-2': 55,
  'etape-retour': 77,
};

(async () => {
  const scenarios = lire(path.join(CFG, 'scenarios.json'));
  const lieux = lire(path.join(CFG, 'commun', 'lieux.json'));
  const parId = new Map(lieux.map(l => [l.id, l]));
  const voulu = process.argv[2];

  for (const s of scenarios.scenarios) {
    if (voulu && s.id !== voulu) continue;
    const dossier = path.join(CFG, s.dossier);
    const planning = lire(path.join(dossier, 'planning.json'));
    const ancien = lire(path.join(dossier, 'itineraire.json'));

    const etapes = [];
    let veille = 'depart';          // d'où l'on part le matin

    for (const j of planning) {
      const arrivee = j.nuit || (j.jour === planning.length ? 'depart' : veille);

      /* Les points de passage de la journée : uniquement ceux qu'on rejoint en
         voiture, dans l'ordre du programme, sans répéter le départ ni l'arrivée. */
      const par = (j.activites || [])
        .map(a => a.lieu)
        .filter(id => {
          const l = parId.get(id);
          return l && !SANS_VOITURE.has(l.categorie);
        })
        .filter((id, i, t) => t.indexOf(id) === i)
        .filter(id => id !== veille && id !== arrivee);

      /* Une journée sans déplacement (même base, aucun arrêt en voiture)
         n'a pas d'étape : inutile de tracer un trait de zéro kilomètre. */
      if (arrivee === veille && !par.length) { continue; }

      const id = j.jour === 1 ? 'etape-aller-1'
               : j.jour === 2 ? 'etape-aller-2'
               : j.jour === planning.length ? 'etape-retour'
               : `etape-j${j.jour}`;

      const e = { id, jour: j.jour, de: veille, vers: arrivee, par };
      if (peagesConnus[id]) e.peages = peagesConnus[id];
      e.pays = j.jour === 1 ? 'FR' : 'IT';
      e.note = j.titre || '';
      etapes.push(e);
      veille = arrivee;
    }

    const itineraire = {
      etapes,
      style_trace: ancien.style_trace,
      note: ('Étapes générées depuis le planning : une par journée avec déplacement, passant par les '
             + 'lieux accessibles en voiture. Les sommets de remontées, plateaux et randonnées en sont '
             + 'exclus — on ne les rejoint pas au volant. Relancer node trace-route.js après modification.')
    };

    fs.writeFileSync(path.join(dossier, 'itineraire.json'), JSON.stringify(itineraire, null, 2) + '\n', 'utf8');
    console.log(`\n${s.id} : ${etapes.length} étapes`);
    for (const e of etapes) {
      console.log(`  j${String(e.jour).padStart(2)}  ${e.de} → ${e.vers}` + (e.par.length ? `  via ${e.par.join(', ')}` : ''));
    }
  }
})();
