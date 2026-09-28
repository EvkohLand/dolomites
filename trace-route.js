#!/usr/bin/env node
/* Calcule le VRAI tracé routier de chaque étape, SANS PÉAGE, et le fige dans
   config/scenarios/<id>/trace.json, pour que la carte suive les routes
   et que le tracé reste disponible hors ligne.

   Usage : node trace-route.js [id-du-scenario]

   Moteur : Valhalla public (FOSSGIS, sans clé). L'OSRM public ne sait pas exclure
   les péages (« Exclude flag combination is not supported ») ; Valhalla le fait avec
   exclude_tolls, et on refuse toute réponse qui en contient encore un.
   Pour les étapes qui listent des troncons_peage, on calcule aussi la variante
   avec péages, gardée pour comparaison (avec_peages).
   Une étape qui nomme un peage_local (route de montagne payante dont le prix est
   porté par la fiche du lieu, ex. route des Tre Cime) garde cette route. */
'use strict';

const fs = require('fs');
const path = require('path');

const R = __dirname;
const CFG = path.join(R, 'config');
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';

const lire = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const pause = ms => new Promise(r => setTimeout(r, ms));

function allege(points, pasMax) {
  // 13 000 points par étape alourdissent le fichier autonome pour rien :
  // on garde un point sur N, plus les deux extrémités.
  if (points.length <= pasMax) return points;
  const pas = Math.ceil(points.length / pasMax);
  const out = points.filter((_, i) => i % pas === 0);
  const dernier = points[points.length - 1];
  if (out[out.length - 1] !== dernier) out.push(dernier);
  return out;
}

// Polyline Valhalla : précision 6 décimales.
function decoder(txt) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < txt.length) {
    for (const axe of [0, 1]) {
      let b, dec = 0, res = 0;
      do { b = txt.charCodeAt(i++) - 63; res |= (b & 0x1f) << dec; dec += 5; } while (b >= 0x20);
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if (axe === 0) lat += d; else lon += d;
    }
    out.push([Math.round(lat / 10) / 1e5, Math.round(lon / 10) / 1e5]);
  }
  return out;
}

async function route(etapes, sansPeage, hauteur) {
  const body = {
    locations: etapes.map(p => ({ lat: p.gps[0], lon: p.gps[1], type: p.type })),
    costing: 'auto',
    costing_options: { auto: { exclude_tolls: sansPeage, height: hauteur } },
    units: 'km',
    directions_type: 'none'
  };
  const rep = await fetch(VALHALLA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'dolomites-carnet' },
    body: JSON.stringify(body)
  });
  const d = await rep.json().catch(() => ({}));
  if (!rep.ok || !d.trip) throw new Error(`Valhalla HTTP ${rep.status} ${d.error || ''}`.trim());
  const s = d.trip.summary;
  if (sansPeage && s.has_toll) throw new Error('le trajet contient encore un péage');
  return {
    distance_km: Math.round(s.length),
    duree_h: Math.round(s.time / 360) / 10,
    points: allege([].concat(...d.trip.legs.map(l => decoder(l.shape))), 600)
  };
}

(async () => {
  const scenarios = lire(path.join(CFG, 'scenarios.json'));
  const lieux = lire(path.join(CFG, 'commun', 'lieux.json'));
  const vehicule = lire(path.join(CFG, 'commun', 'vehicule.json'));
  const hauteur = vehicule.hauteur_tente_fermee_m || 2;
  const parId = new Map(lieux.map(l => [l.id, l]));
  const voulu = process.argv[2];

  for (const s of scenarios.scenarios) {
    if (voulu && s.id !== voulu) continue;
    const dossier = path.join(CFG, s.dossier);
    const reglages = lire(path.join(dossier, 'reglages.json'));
    const itineraire = lire(path.join(dossier, 'itineraire.json'));

    const gps = ref => {
      if (ref === 'depart') return reglages.depart && reglages.depart.gps;
      const l = parId.get(ref);
      return l && l.gps;
    };

    const trace = {
      genere_le: new Date().toISOString().slice(0, 10),
      source: 'Valhalla (valhalla1.openstreetmap.de), péages exclus, hauteur ' + hauteur + ' m',
      etapes: {}
    };

    for (const e of itineraire.etapes) {
      const dep = gps(e.de), arr = gps(e.vers);
      if (!dep || !arr) { console.warn(`  ${e.id} : coordonnées manquantes, étape ignorée`); continue; }
      // via_gps = passage imposé au calcul, sans arrêt, parcouru avant les lieux visités (par).
      const pts = [{ gps: dep, type: 'break' }]
        .concat((e.via_gps || []).map(g => ({ gps: g, type: 'through' })))
        .concat((e.par || []).map(gps).filter(Boolean).map(g => ({ gps: g, type: 'break' })))
        .concat([{ gps: arr, type: 'break' }]);
      process.stdout.write(`  ${s.id} / ${e.id} … `);
      try {
        const r = await route(pts, !e.peage_local, hauteur);
        trace.etapes[e.id] = r;
        const ecart = e.distance_km ? ` (ancien ${e.distance_km} km)` : '';
        e.distance_km = r.distance_km;
        e.duree_h = r.duree_h;
        let msg = `${r.distance_km} km, ${r.duree_h} h ${e.peage_local ? "avec la route payante " + e.peage_local : "sans péage"}, ${r.points.length} points${ecart}`;
        if ((e.troncons_peage || []).length) {
          await pause(1200);
          // Les passages imposés servent l'itinéraire sans péage : la variante autoroute s'en passe.
          const a = await route(pts.filter(p => p.type !== 'through'), false, hauteur);
          e.avec_peages = { distance_km: a.distance_km, duree_h: a.duree_h };
          msg += ` — avec péages ${a.distance_km} km, ${a.duree_h} h`;
        } else {
          delete e.avec_peages;
        }
        console.log(msg);
      } catch (err) {
        console.log(`échec — ${err.message}`);
      }
      await pause(1200);   // service public : on ne le martèle pas
    }

    fs.writeFileSync(path.join(dossier, 'trace.json'), JSON.stringify(trace, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(dossier, 'itineraire.json'), JSON.stringify(itineraire, null, 2) + '\n', 'utf8');
    console.log(`  → ${s.dossier}/trace.json + itineraire.json écrits\n`);
  }
})();
