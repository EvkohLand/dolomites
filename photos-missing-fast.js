#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'config', 'commun', 'lieux.json');
const API = 'https://commons.wikimedia.org/w/api.php';
const TARGET = Number(process.env.CIBLE || 3);
const RESULTATS = Number(process.env.RESULTATS_PAR_RECHERCHE || 10);
const CONCURRENCY = Number(process.env.CONCURRENCE || 6);
const TIMEOUT = Number(process.env.HTTP_TIMEOUT_MS || 10000);
const PRIORITY = new Set(['camping', 'agricamper', 'aire', 'supermarche']);
const OK = /^(cc0|ccby|ccbysa|publicdomain|pd)/;
const KO = /(noncommercial|noderiv|fairuse|\bnc\b|-nc-|-nd-|ccbync|ccbynd)/;

function norm(v) { return String(v || '').toLowerCase().replace(/[\s._-]/g, ''); }
function clean(v) { return String(v || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

async function call(params, tries = 1) {
  const u = new URL(API);
  u.search = new URLSearchParams({ format: 'json', origin: '*', ...params }).toString();
  try {
    const r = await fetch(u, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'dolomites-carnet/1.0 (personal travel guide)' }
    });
    if ((r.status === 429 || r.status === 503) && tries < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * tries));
      return call(params, tries + 1);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } catch (e) {
    if (tries < 2 && (e.name === 'TimeoutError' || e.name === 'AbortError')) return call(params, tries + 1);
    throw e;
  }
}

async function searchText(q) {
  const d = await call({ action: 'query', list: 'search', srnamespace: '6', srsearch: q + ' filetype:bitmap', srlimit: String(RESULTATS) });
  return (d.query?.search || []).map(x => x.title);
}

async function searchGeo(gps, radius) {
  const d = await call({ action: 'query', list: 'geosearch', gsnamespace: '6', gscoord: `${gps[0]}|${gps[1]}`, gsradius: String(radius), gslimit: String(RESULTATS) });
  return (d.query?.geosearch || []).map(x => x.title);
}

async function details(titles) {
  if (!titles.length) return [];
  const d = await call({ action: 'query', prop: 'imageinfo', titles: titles.slice(0, 20).join('|'), iiprop: 'url|extmetadata|size', iiurlwidth: '960' });
  return Object.values(d.query?.pages || {}).map(p => {
    const i = p.imageinfo?.[0];
    if (!i) return null;
    const m = i.extmetadata || {};
    return {
      url: i.thumburl || i.url,
      licence: clean(m.LicenseShortName?.value || m.License?.value),
      auteur: clean(m.Artist?.value),
      legende: clean(m.ObjectName?.value || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')),
      largeur: i.width,
      hauteur: i.height
    };
  }).filter(Boolean);
}

function usable(p) {
  const l = norm(p.licence);
  if (!p.url || !l || KO.test(l) || !OK.test(l)) return false;
  if (p.largeur && p.largeur < 640) return false;
  if (p.largeur && p.hauteur) {
    const r = p.largeur / p.hauteur;
    if (r < 0.5 || r > 3) return false;
  }
  return true;
}

function append(place, arr, prefix, target) {
  const seen = new Set((place.photos || []).map(p => p.url || p.fichier || p.legende).filter(Boolean));
  for (const p of arr) {
    if ((place.photos || []).length >= target) break;
    if (!usable(p) || seen.has(p.url)) continue;
    const base = clean(p.legende).slice(0, 90) || place.nom;
    const author = clean(p.auteur).slice(0, 70) || 'auteur non précisé';
    place.photos = place.photos || [];
    place.photos.push({
      url: p.url,
      legende: prefix ? `${prefix} — ${base}`.slice(0, 140) : base,
      credit: `${author} — Wikimedia Commons, ${p.licence}`
    });
    seen.add(p.url);
  }
}

async function enrich(place) {
  const target = Math.min(TARGET, PRIORITY.has(place.categorie) ? 3 : 1);
  const shortName = String(place.nom || place.id).split('/')[0].trim();
  const commune = String(place.commune || '').replace(/\s*\([A-Z]{2}\)/, '').trim();
  const q = place.recherche_photo || `${shortName}${commune ? ' ' + commune : ''}`;
  try {
    append(place, await details(await searchText(q)), null, target);
  } catch (e) {
    console.log(`  ${place.id}: texte KO (${e.name || e.message})`);
  }
  const gpsOk = Array.isArray(place.gps) && Number.isFinite(Number(place.gps[0])) && Number.isFinite(Number(place.gps[1]));
  for (const radius of [2500, 8000]) {
    if ((place.photos || []).length >= target || !gpsOk) break;
    try {
      append(place, await details(await searchGeo(place.gps, radius)), `Environs de ${shortName}`, target);
    } catch (e) {
      console.log(`  ${place.id}: GPS ${radius}m KO (${e.name || e.message})`);
    }
  }
  console.log(`  ${place.id}: ${(place.photos || []).length}/${target}`);
}

(async () => {
  const places = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const missing = places.filter(p => !(p.photos || []).filter(Boolean).length);
  console.log(`${missing.length} POI sans photo à traiter.`);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= missing.length) return;
      await enrich(missing[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, missing.length)) }, worker));
  fs.writeFileSync(FILE, JSON.stringify(places, null, 2) + '\n');
  const still = places.filter(p => !(p.photos || []).filter(Boolean).length);
  console.log(`Couverture après recherche: ${places.length - still.length}/${places.length}.`);
  if (still.length) still.forEach(p => console.log(`  ! ${p.id} — ${p.nom}`));
})();
