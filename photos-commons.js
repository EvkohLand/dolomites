#!/usr/bin/env node
/* Récupère des photos sous licence libre depuis Wikimedia Commons et les inscrit
   dans config/commun/lieux.json, avec leur auteur et leur licence.

   Usage :
     node photos-commons.js            toutes les fiches qui ont moins de CIBLE photos
     node photos-commons.js lagazuoi   une seule fiche

   Pourquoi Commons et pas une recherche d'images ordinaire : le dépôt est public.
   Republier une photo prise sur un site de tourisme est une contrefaçon ; les
   images de Commons sont librement réutilisables si l'on cite l'auteur, ce que
   ce script inscrit dans le champ « credit » de chaque photo. */
'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = Number(process.env.CIBLE || 10);
const LARGEUR = 1280;
const API = 'https://commons.wikimedia.org/w/api.php';

/* Licences acceptées : domaine public et Creative Commons réutilisables.
   Tout ce qui porte « NonCommercial », « NoDerivatives » ou « Fair use » est écarté. */
/* Le libellé arrive sous des formes variées : « CC BY-SA 3.0 », « cc-by-sa-3.0 »,
   « Public domain », « CC0 ». On normalise avant de comparer. */
const LICENCES_OK = /^(cc0|ccby|ccbysa|publicdomain|pd)/;
const LICENCES_KO = /(noncommercial|noderiv|fairuse|\bnc\b|-nc-|-nd-|ccbync|ccbynd)/;

function normaliser(txt) {
  return String(txt || '').toLowerCase().replace(/[\s._-]/g, '');
}

const dodo = ms => new Promise(r => setTimeout(r, ms));

/* Commons limite le débit : un 429 n'est pas une erreur définitive, on attend et on
   réessaie. Sans ça, une rafale de requêtes fait échouer tous les lieux d'un coup. */
async function api(params, essai) {
  essai = essai || 1;
  const u = new URL(API);
  u.search = new URLSearchParams({ format: 'json', origin: '*', ...params }).toString();
  const r = await fetch(u, { headers: { 'User-Agent': 'dolomites-carnet/1.0 (carnet de voyage personnel)' } });
  if (r.status === 429 || r.status === 503) {
    if (essai > 5) throw new Error('Commons HTTP ' + r.status + ' après 5 tentatives');
    const attente = 4000 * essai;
    process.stdout.write(`(débit limité, pause ${attente / 1000}s) `);
    await dodo(attente);
    return api(params, essai + 1);
  }
  if (!r.ok) throw new Error('Commons HTTP ' + r.status);
  return r.json();
}

async function chercher(requete, limite) {
  const d = await api({
    action: 'query', list: 'search', srnamespace: '6',
    srsearch: requete + ' filetype:bitmap', srlimit: String(limite)
  });
  return (d.query?.search || []).map(x => x.title);
}

async function detailler(titres) {
  const out = [];
  // 20 titres par appel : au-delà, l'API tronque.
  for (let i = 0; i < titres.length; i += 20) {
    const d = await api({
      action: 'query', prop: 'imageinfo', titles: titres.slice(i, i + 20).join('|'),
      iiprop: 'url|extmetadata|size', iiurlwidth: String(LARGEUR)
    });
    for (const p of Object.values(d.query?.pages || {})) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const m = info.extmetadata || {};
      const licence = (m.LicenseShortName?.value || m.License?.value || '').replace(/<[^>]+>/g, '').trim();
      const auteur = (m.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const legende = (m.ObjectName?.value || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''))
        .replace(/<[^>]+>/g, '').replace(/[_-]+/g, ' ').trim();
      out.push({ titre: p.title, url: info.thumburl || info.url, licence, auteur, legende,
                 largeur: info.width, hauteur: info.height });
    }
    await dodo(900);
  }
  return out;
}

function acceptable(ph) {
  if (!ph.url || !ph.licence) return false;
  const n = normaliser(ph.licence);
  if (LICENCES_KO.test(n)) return false;
  if (!LICENCES_OK.test(n)) return false;
  if (ph.largeur && ph.largeur < 640) return false;         // trop petite pour une galerie
  if (ph.hauteur && ph.largeur) {
    const r = ph.largeur / ph.hauteur;
    if (r > 3 || r < 0.5) return false;   // panoramique démesurée, panneau, blason
  }
  return true;
}

function credit(ph) {
  const a = ph.auteur && ph.auteur.length < 70 ? ph.auteur : 'auteur non précisé';
  return `${a} — Wikimedia Commons, ${ph.licence}`;
}

(async () => {
  const fichier = path.join(__dirname, 'config', 'commun', 'lieux.json');
  const lieux = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const voulu = process.argv[2];

  for (const l of lieux) {
    if (voulu && l.id !== voulu) continue;
    const deja = (l.photos || []).length;
    if (deja >= CIBLE) { console.log(`  ${l.id} : déjà ${deja} photos, ignoré`); continue; }

    // Plusieurs formulations : le nom seul rend peu sur les lieux peu connus.
    const requetes = [l.recherche_photo, l.nom, l.nom + ' Dolomites',
                      l.commune ? l.nom.split('/')[0].trim() + ' ' + l.commune.replace(/\s*\([A-Z]{2}\)/, '') : null]
                     .filter(Boolean);

    const vus = new Set();
    const gardees = [];
    for (const q of requetes) {
      if (gardees.length >= CIBLE) break;
      let titres;
      try { titres = await chercher(q, 30); }
      catch (e) { console.log(`  ${l.id} : recherche « ${q} » en échec — ${e.message}`); continue; }
      const nouveaux = titres.filter(t => !vus.has(t));
      nouveaux.forEach(t => vus.add(t));
      if (!nouveaux.length) continue;
      const details = await detailler(nouveaux);
      for (const ph of details) {
        if (gardees.length >= CIBLE) break;
        if (!acceptable(ph)) continue;
        if (gardees.some(g => g.url === ph.url)) continue;
        gardees.push({ url: ph.url, legende: ph.legende.slice(0, 90), credit: credit(ph) });
      }
      await dodo(1100);
    }

    l.photos = gardees;
    const etat = gardees.length >= CIBLE ? 'OK' : (gardees.length ? 'partiel' : 'AUCUNE');
    console.log(`  ${l.id} : ${gardees.length}/${CIBLE} photos — ${etat}`);
    // Sauvegarde au fil de l'eau : une interruption ne perd pas le travail déjà fait.
    fs.writeFileSync(fichier, JSON.stringify(lieux, null, 2) + '\n', 'utf8');
    await dodo(1500);
  }

  fs.writeFileSync(fichier, JSON.stringify(lieux, null, 2) + '\n', 'utf8');

  const sous = lieux.filter(l => (l.photos || []).length < CIBLE);
  console.log(`\n${lieux.length} lieux traités.`);
  if (sous.length) {
    console.log(`${sous.length} sous la cible de ${CIBLE} :`);
    sous.forEach(l => console.log(`  · ${l.id} (${(l.photos || []).length})`));
  } else {
    console.log(`Tous les lieux ont au moins ${CIBLE} photos.`);
  }
})();
