/* Outils partagés par les scripts de données en direct : tracés du jour et distances. */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CONFIG = path.join(RACINE, 'config');

function lireJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG, rel), 'utf8'));
}

function lireJsonSiPresent(rel) {
  try { return lireJson(rel); } catch (e) { return null; }
}

/* Écrit seulement si le contenu utile change : la date de génération seule ne fait pas un commit. */
function ecrireSiChange(rel, obj, champsVolatils) {
  const abs = path.join(CONFIG, rel);
  const avant = lireJsonSiPresent(rel);
  const sansVolatils = o => {
    if (!o) return '';
    const copie = Object.assign({}, o);
    (champsVolatils || []).forEach(k => delete copie[k]);
    return JSON.stringify(copie);
  };
  if (avant && sansVolatils(avant) === sansVolatils(obj)) return false;
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return true;
}

/* Projection locale en km : suffisante à l'échelle de quelques kilomètres. */
function versKm(p, lat0) {
  return [p[1] * 111.32 * Math.cos(lat0 * Math.PI / 180), p[0] * 110.57];
}

function distancePointSegment(p, a, b) {
  const lat0 = p[0];
  const P = versKm(p, lat0), A = versKm(a, lat0), B = versKm(b, lat0);
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = A[0] + t * dx - P[0], y = A[1] + t * dy - P[1];
  return Math.sqrt(x * x + y * y);
}

/* Distance minimale d'un point à un ensemble de lignes (listes de [lat, lon]) et de points isolés. */
function distanceAuJour(p, jour) {
  let min = Infinity;
  for (const ligne of jour.lignes) {
    if (ligne.length === 1) min = Math.min(min, distancePointSegment(p, ligne[0], ligne[0]));
    for (let i = 1; i < ligne.length; i++) {
      const d = distancePointSegment(p, ligne[i - 1], ligne[i]);
      if (d < min) min = d;
    }
  }
  return min;
}

function boite(lignes, margeKm) {
  let latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
  lignes.forEach(l => l.forEach(p => {
    latMin = Math.min(latMin, p[0]); latMax = Math.max(latMax, p[0]);
    lonMin = Math.min(lonMin, p[1]); lonMax = Math.max(lonMax, p[1]);
  }));
  const dLat = margeKm / 110.57, dLon = margeKm / (111.32 * Math.cos(((latMin + latMax) / 2) * Math.PI / 180));
  return { latMin: latMin - dLat, latMax: latMax + dLat, lonMin: lonMin - dLon, lonMax: lonMax + dLon };
}

function dansBoite(p, b) {
  return p[0] >= b.latMin && p[0] <= b.latMax && p[1] >= b.lonMin && p[1] <= b.lonMax;
}

/* Pour chaque scénario et chaque jour : les tracés routiers du jour et le point de la nuit. */
function joursParScenario(margeKm) {
  const scenarios = lireJson('scenarios.json').scenarios || [];
  const lieux = new Map(lireJson('commun/lieux.json').map(l => [l.id, l]));
  const out = [];
  for (const s of scenarios) {
    const planning = lireJsonSiPresent(s.dossier + '/planning.json') || [];
    const itin = lireJsonSiPresent(s.dossier + '/itineraire.json') || { etapes: [] };
    const trace = lireJsonSiPresent(s.dossier + '/trace.json') || { etapes: {} };
    for (const j of planning) {
      const lignes = [];
      const pays = [];
      for (const e of (itin.etapes || []).filter(x => x.jour === j.jour)) {
        const t = trace.etapes && trace.etapes[e.id];
        if (t && Array.isArray(t.points) && t.points.length) lignes.push(t.points);
        if (e.pays && pays.indexOf(e.pays) === -1) pays.push(e.pays);
      }
      const nuit = j.nuit && lieux.get(j.nuit);
      if (nuit && Array.isArray(nuit.gps)) lignes.push([nuit.gps]);
      if (!lignes.length) continue;
      out.push({ scenario: s.id, jour: j.jour, date: j.date, pays, lignes, boite: boite(lignes, margeKm) });
    }
  }
  return out;
}

async function telecharger(url, opts) {
  const r = await fetch(url, Object.assign({
    headers: { 'User-Agent': 'dolomites-carnet (GitHub Actions; donnees publiques)' },
    signal: AbortSignal.timeout(120000)
  }, opts || {}));
  if (!r.ok) throw new Error('HTTP ' + r.status + ' sur ' + url);
  return r;
}

module.exports = {
  RACINE, CONFIG, lireJson, lireJsonSiPresent, ecrireSiChange,
  distanceAuJour, dansBoite, boite, joursParScenario, telecharger
};
