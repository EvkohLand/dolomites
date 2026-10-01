#!/usr/bin/env node
/* Complète les POI sans photo à partir de Wikimedia Commons.
   - recherche précise par nom/commune en premier ;
   - fallback géographique autour du POI si nécessaire ;
   - uniquement licences librement réutilisables ;
   - les photos de proximité sont légendées « Environs de … » pour ne pas les
     présenter comme une vue exacte de l'établissement.

   Usage : node photos-commons.js [id-lieu]
*/
'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = Number(process.env.CIBLE || 3);
const LARGEUR = Number(process.env.LARGEUR || 960);
const RESULTATS = Number(process.env.RESULTATS_PAR_RECHERCHE || 12);
const SEULEMENT_SANS_PHOTO = process.env.SEULEMENT_SANS_PHOTO === '1';
const CONCURRENCE = Math.max(1, Number(process.env.CONCURRENCE || 4));
const PRIORITAIRES = new Set(['camping', 'agricamper', 'aire', 'supermarche']);
const API = 'https://commons.wikimedia.org/w/api.php';
const LICENCES_OK = /^(cc0|ccby|ccbysa|publicdomain|pd)/;
const LICENCES_KO = /(noncommercial|noderiv|fairuse|\bnc\b|-nc-|-nd-|ccbync|ccbynd)/;

const dodo = ms => new Promise(r => setTimeout(r, ms));

function normaliser(txt) {
  return String(txt || '').toLowerCase().replace(/[\s._-]/g, '');
}

function nettoyerTextePublic(txt) {
  return String(txt || '')
    .replace(/\b(?:\d[\s.\-]?){8,}\b/g, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function api(params, essai = 1) {
  const u = new URL(API);
  u.search = new URLSearchParams({ format: 'json', origin: '*', ...params }).toString();
  const r = await fetch(u, {
    headers: { 'User-Agent': 'dolomites-carnet/1.0 (carnet de voyage personnel)' }
  });
  if (r.status === 429 || r.status === 503) {
    if (essai > 5) throw new Error(`Commons HTTP ${r.status} après 5 tentatives`);
    await dodo(1500 * essai);
    return api(params, essai + 1);
  }
  if (!r.ok) throw new Error(`Commons HTTP ${r.status}`);
  return r.json();
}

async function chercherTexte(q) {
  const d = await api({
    action: 'query', list: 'search', srnamespace: '6',
    srsearch: q + ' filetype:bitmap', srlimit: String(RESULTATS)
  });
  return (d.query?.search || []).map(x => x.title);
}

async function chercherAutour(gps, rayon) {
  const d = await api({
    action: 'query', list: 'geosearch', gsnamespace: '6',
    gscoord: `${gps[0]}|${gps[1]}`,
    gsradius: String(rayon), gslimit: String(RESULTATS)
  });
  return (d.query?.geosearch || []).map(x => x.title);
}

async function detailler(titres) {
  if (!titres.length) return [];
  const out = [];
  for (let i = 0; i < titres.length; i += 20) {
    const d = await api({
      action: 'query', prop: 'imageinfo', titles: titres.slice(i, i + 20).join('|'),
      iiprop: 'url|extmetadata|size', iiurlwidth: String(LARGEUR)
    });
    for (const p of Object.values(d.query?.pages || {})) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const m = info.extmetadata || {};
      const licence = (m.LicenseShortName?.value || m.License?.value || '')
        .replace(/<[^>]+>/g, '').trim();
      const auteur = (m.Artist?.value || '').replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ').trim();
      const legende = (m.ObjectName?.value || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''))
        .replace(/<[^>]+>/g, '').replace(/[_-]+/g, ' ').trim();
      out.push({ url: info.thumburl || info.url, licence, auteur, legende,
                 largeur: info.width, hauteur: info.height });
    }
  }
  return out;
}

function acceptable(ph) {
  if (!ph.url || !ph.licence) return false;
  const n = normaliser(ph.licence);
  if (LICENCES_KO.test(n) || !LICENCES_OK.test(n)) return false;
  if (ph.largeur && ph.largeur < 640) return false;
  if (ph.hauteur && ph.largeur) {
    const ratio = ph.largeur / ph.hauteur;
    if (ratio > 3 || ratio < 0.5) return false;
  }
  return true;
}

function credit(ph) {
  const brut = ph.auteur && ph.auteur.length < 70 ? ph.auteur : 'auteur non précisé';
  return `${nettoyerTextePublic(brut) || 'auteur non précisé'} — Wikimedia Commons, ${ph.licence}`;
}

function ajouter(details, lieu, gardees, prefixe, cible) {
  const urls = new Set(gardees.map(p => p && p.url).filter(Boolean));
  const legendes = new Set(gardees.map(p => normaliser(p && p.legende)).filter(Boolean));
  for (const ph of details) {
    if (gardees.length >= cible) break;
    if (!acceptable(ph) || urls.has(ph.url)) continue;
    const cle = normaliser(ph.legende);
    if (cle && legendes.has(cle)) continue;
    const base = nettoyerTextePublic(ph.legende).slice(0, 90) || lieu.nom;
    gardees.push({
      url: ph.url,
      legende: prefixe ? `${prefixe} — ${base}`.slice(0, 140) : base,
      credit: credit(ph)
    });
    urls.add(ph.url);
    if (cle) legendes.add(cle);
  }
}

async function enrichir(lieu) {
  const gardees = (lieu.photos || []).filter(Boolean).slice();
  if (SEULEMENT_SANS_PHOTO && gardees.length) return;
  const cible = Math.min(CIBLE, PRIORITAIRES.has(lieu.categorie) ? 3 : 1);
  if (gardees.length >= cible) return;

  const commune = lieu.commune ? lieu.commune.replace(/\s*\([A-Z]{2}\)/, '').trim() : '';
  const nomCourt = lieu.nom.split('/')[0].trim();
  const requete = lieu.recherche_photo || (commune ? `${nomCourt} ${commune}` : lieu.nom);

  try {
    const titres = await chercherTexte(requete);
    ajouter(await detailler(titres), lieu, gardees, null, cible);
  } catch (e) {
    console.log(`  ${lieu.id} : recherche précise en échec — ${e.message}`);
  }

  const gpsOk = Array.isArray(lieu.gps) && lieu.gps.length >= 2 &&
    Number.isFinite(Number(lieu.gps[0])) && Number.isFinite(Number(lieu.gps[1]));

  if (gpsOk && gardees.length < cible) {
    for (const rayon of [2500, 8000]) {
      if (gardees.length >= cible) break;
      try {
        const titres = await chercherAutour(lieu.gps, rayon);
        ajouter(await detailler(titres), lieu, gardees, `Environs de ${nomCourt}`, cible);
      } catch (e) {
        console.log(`  ${lieu.id} : recherche GPS ${rayon} m en échec — ${e.message}`);
      }
    }
  }

  lieu.photos = gardees;
  console.log(`  ${lieu.id} : ${gardees.length}/${cible} photo(s)`);
}

(async () => {
  const fichier = path.join(__dirname, 'config', 'commun', 'lieux.json');
  const lieux = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const voulu = process.argv[2];
  const candidats = lieux.filter(l => {
    if (voulu && l.id !== voulu) return false;
    const n = (l.photos || []).filter(Boolean).length;
    return SEULEMENT_SANS_PHOTO ? n === 0 : n < CIBLE;
  });

  console.log(`${candidats.length} POI à enrichir, concurrence ${CONCURRENCE}.`);
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= candidats.length) return;
      await enrichir(candidats[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCE, candidats.length || 1) }, worker));

  fs.writeFileSync(fichier, JSON.stringify(lieux, null, 2) + '\n', 'utf8');
  const sans = lieux.filter(l => !(l.photos || []).filter(Boolean).length);
  console.log(`Couverture photo : ${lieux.length - sans.length}/${lieux.length} lieux avec au moins une photo.`);
  if (sans.length) {
    console.log(`${sans.length} lieu(x) encore sans photo :`);
    sans.forEach(l => console.log(`  ! ${l.id} — ${l.nom}`));
  } else {
    console.log('Tous les lieux ont au moins une photo.');
  }
})();
