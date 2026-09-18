#!/usr/bin/env node
/* Calcule le VRAI tracé routier de chaque étape et le fige dans
   config/scenarios/<id>/trace.json, pour que la carte suive les routes
   et que le tracé reste disponible hors ligne.

   Usage : node trace-route.js [id-du-scenario]
   Le service OSRM est public et sans clé. À relancer seulement si
   les étapes changent — sinon le fichier figé suffit. */
'use strict';

const fs = require('fs');
const path = require('path');

const R = __dirname;
const CFG = path.join(R, 'config');
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

const lire = p => JSON.parse(fs.readFileSync(p, 'utf8'));

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

async function route(dep, arr, par) {
  const pts = [dep, ...par, arr];
  // OSRM attend longitude,latitude — l'inverse de nos coordonnées.
  const coords = pts.map(p => `${p[1]},${p[0]}`).join(';');
  const url = `${OSRM}${coords}?overview=full&geometries=geojson`;
  const rep = await fetch(url, { headers: { 'User-Agent': 'dolomites-carnet' } });
  if (!rep.ok) throw new Error(`OSRM HTTP ${rep.status}`);
  const d = await rep.json();
  if (d.code !== 'Ok' || !d.routes || !d.routes.length) throw new Error(`OSRM : ${d.code || 'aucune route'}`);
  const r = d.routes[0];
  return {
    distance_km: Math.round(r.distance / 1000),
    duree_h: Math.round(r.duration / 360) / 10,
    // GeoJSON donne [lon, lat] : on remet dans notre ordre [lat, lon].
    points: allege(r.geometry.coordinates.map(c => [
      Math.round(c[1] * 1e5) / 1e5,
      Math.round(c[0] * 1e5) / 1e5
    ]), 600)
  };
}

(async () => {
  const scenarios = lire(path.join(CFG, 'scenarios.json'));
  const lieux = lire(path.join(CFG, 'commun', 'lieux.json'));
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

    const trace = { genere_le: new Date().toISOString().slice(0, 10), source: 'OSRM (router.project-osrm.org)', etapes: {} };

    for (const e of itineraire.etapes) {
      const dep = gps(e.de), arr = gps(e.vers);
      if (!dep || !arr) { console.warn(`  ${e.id} : coordonnées manquantes, étape ignorée`); continue; }
      const par = (e.par || []).map(gps).filter(Boolean);
      process.stdout.write(`  ${s.id} / ${e.id} … `);
      try {
        const r = await route(dep, arr, par);
        trace.etapes[e.id] = r;
        const ecart = e.distance_km ? ` (annoncé ${e.distance_km} km)` : '';
        console.log(`${r.distance_km} km, ${r.duree_h} h, ${r.points.length} points${ecart}`);
      } catch (err) {
        console.log(`échec — ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1200));   // service public : on ne le martèle pas
    }

    fs.writeFileSync(path.join(dossier, 'trace.json'), JSON.stringify(trace, null, 2) + '\n', 'utf8');
    console.log(`  → ${s.dossier}/trace.json écrit\n`);
  }
})();
