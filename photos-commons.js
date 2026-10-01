#!/usr/bin/env node
/* Récupère des photos sous licence libre depuis Wikimedia Commons et les inscrit
   dans config/commun/lieux.json, avec leur auteur et leur licence.

   Usage :
     node photos-commons.js            toutes les fiches qui ont moins de CIBLE photos
     node photos-commons.js lagazuoi   une seule fiche

   Les fiches sans aucune photo sont traitées en premier. Si les recherches par nom
   ne donnent pas assez d'images, un fallback géographique cherche des photos Commons
   autour des coordonnées du POI. Elles sont alors explicitement légendées « Environs de … »
   afin de ne jamais faire croire qu'elles représentent exactement un commerce/camping.

   Pourquoi Commons et pas une recherche d'images ordinaire : le dépôt est public.
   Republier une photo prise sur un site de tourisme est une contrefaçon ; les
   images de Commons sont librement réutilisables si l'on cite l'auteur, ce que
   ce script inscrit dans le champ « credit » de chaque photo. */
'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = Number(process.env.CIBLE || 30);
const LARGEUR = Number(process.env.LARGEUR || 960);
const RESULTATS_PAR_RECHERCHE = Number(process.env.RESULTATS_PAR_RECHERCHE || 50);
const MIN_GEO = Number(process.env.MIN_GEO || 6);
const MIN_GEO_PRIORITAIRE = Number(process.env.MIN_GEO_PRIORITAIRE || 10);
const RAYONS_GEO = [800, 2500, 8000];
const PRIORITAIRES = new Set(['camping', 'agricamper', 'aire', 'supermarche']);
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

async function chercherAutour(gps, rayon, limite) {
  const d = await api({
    action: 'query', list: 'geosearch', gsnamespace: '6',
    gscoord: `${gps[0]}|${gps[1]}`,
    gsradius: String(rayon),
    gslimit: String(limite)
  });
  return (d.query?.geosearch || []).map(x => x.title);
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

function nettoyerTextePublic(txt) {
  return String(txt || '')
    // Certains noms de fichiers Commons contiennent des identifiants Flickr/Panoramio
    // assez longs pour ressembler à des numéros personnels au validateur du dépôt.
    .replace(/\b(?:\d[\s.\-]?){8,}\b/g, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function credit(ph) {
  const brut = ph.auteur && ph.auteur.length < 70 ? ph.auteur : 'auteur non précisé';
  const a = nettoyerTextePublic(brut) || 'auteur non précisé';
  return `${a} — Wikimedia Commons, ${ph.licence}`;
}

function ajouterDetails(details, l, gardees, urlsGardees, legendesGardees, prefixe) {
  for (const ph of details) {
    if (gardees.length >= CIBLE) break;
    if (!acceptable(ph)) continue;
    const cleLegende = normaliser(ph.legende);
    if (urlsGardees.has(ph.url)) continue;
    if (cleLegende && legendesGardees.has(cleLegende)) continue;
    const brut = nettoyerTextePublic(ph.legende).slice(0, 90) || l.nom;
    const legende = prefixe ? `${prefixe} — ${brut}`.slice(0, 140) : brut;
    gardees.push({ url: ph.url, legende, credit: credit(ph) });
    urlsGardees.add(ph.url);
    if (cleLegende) legendesGardees.add(cleLegende);
  }
}

(async () => {
  const fichier = path.join(__dirname, 'config', 'commun', 'lieux.json');
  const lieux = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const voulu = process.argv[2];

  // Les trous de couverture passent avant les galeries déjà fournies.
  // À nombre de photos égal, campings/agricampings/aires/courses passent d'abord.
  const aTraiter = lieux.slice().sort((a, b) => {
    const na = (a.photos || []).filter(Boolean).length;
    const nb = (b.photos || []).filter(Boolean).length;
    if ((na === 0) !== (nb === 0)) return na === 0 ? -1 : 1;
    const pa = PRIORITAIRES.has(a.categorie) ? 0 : 1;
    const pb = PRIORITAIRES.has(b.categorie) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return na - nb;
  });

  for (const l of aTraiter) {
    if (voulu && l.id !== voulu) continue;
    const existantes = (l.photos || []).filter(Boolean);
    const deja = existantes.length;
    if (deja >= CIBLE) { console.log(`  ${l.id} : déjà ${deja} photos, ignoré`); continue; }

    // On commence par les formulations les plus précises pour éviter qu'un nom
    // générique (camping, aire, station...) ramène des photos d'un homonyme.
    const communePhoto = l.commune ? l.commune.replace(/\s*\([A-Z]{2}\)/, '').trim() : '';
    const nomCourt = l.nom.split('/')[0].trim();
    const requetes = [l.recherche_photo,
                      communePhoto ? nomCourt + ' ' + communePhoto : null,
                      l.nom + ' Dolomites',
                      l.nom + ' Italy',
                      l.nom]
                     .filter(Boolean);

    const vus = new Set();
    const gardees = existantes.slice();
    const urlsGardees = new Set(gardees.map(x => x && x.url).filter(Boolean));
    const legendesGardees = new Set(gardees.map(x => normaliser(x && x.legende)).filter(Boolean));

    for (const q of requetes) {
      if (gardees.length >= CIBLE) break;
      let titres;
      try { titres = await chercher(q, RESULTATS_PAR_RECHERCHE); }
      catch (e) { console.log(`  ${l.id} : recherche « ${q} » en échec — ${e.message}`); continue; }
      const nouveaux = titres.filter(t => !vus.has(t));
      nouveaux.forEach(t => vus.add(t));
      if (!nouveaux.length) continue;
      const details = await detailler(nouveaux);
      ajouterDetails(details, l, gardees, urlsGardees, legendesGardees, null);
      await dodo(1100);
    }

    // Les petits établissements et services ont souvent zéro résultat textuel.
    // On complète alors avec des photos géolocalisées de plus en plus larges.
    // La légende indique explicitement qu'il s'agit des environs, pas du POI lui-même.
    const gpsValide = Array.isArray(l.gps) && l.gps.length >= 2 &&
      Number.isFinite(Number(l.gps[0])) && Number.isFinite(Number(l.gps[1]));
    const minimumGeo = Math.min(CIBLE, PRIORITAIRES.has(l.categorie) ? MIN_GEO_PRIORITAIRE : MIN_GEO);
    if (gpsValide && gardees.length < minimumGeo) {
      for (const rayon of RAYONS_GEO) {
        if (gardees.length >= minimumGeo) break;
        let titres;
        try { titres = await chercherAutour(l.gps, rayon, RESULTATS_PAR_RECHERCHE); }
        catch (e) { console.log(`  ${l.id} : recherche géographique ${rayon} m en échec — ${e.message}`); continue; }
        const nouveaux = titres.filter(t => !vus.has(t));
        nouveaux.forEach(t => vus.add(t));
        if (!nouveaux.length) continue;
        const details = await detailler(nouveaux);
        ajouterDetails(details, l, gardees, urlsGardees, legendesGardees, `Environs de ${nomCourt}`);
        await dodo(1100);
      }
    }

    l.photos = gardees;
    const etat = gardees.length >= CIBLE ? 'OK' : (gardees.length ? 'partiel' : 'AUCUNE');
    console.log(`  ${l.id} : ${gardees.length}/${CIBLE} photos — ${etat}`);
    // Sauvegarde au fil de l'eau : une interruption ne perd pas le travail déjà fait.
    fs.writeFileSync(fichier, JSON.stringify(lieux, null, 2) + '\n', 'utf8');
    await dodo(1500);
  }

  fs.writeFileSync(fichier, JSON.stringify(lieux, null, 2) + '\n', 'utf8');

  const sans = lieux.filter(l => !(l.photos || []).filter(Boolean).length);
  const sous = lieux.filter(l => (l.photos || []).filter(Boolean).length < CIBLE);
  console.log(`\n${lieux.length} lieux traités.`);
  console.log(`Couverture photo : ${lieux.length - sans.length}/${lieux.length} lieux avec au moins une photo.`);
  if (sans.length) {
    console.log(`${sans.length} lieu(x) encore sans photo :`);
    sans.forEach(l => console.log(`  ! ${l.id} — ${l.nom}`));
  } else {
    console.log('Tous les lieux ont au moins une photo.');
  }
  if (sous.length) {
    console.log(`${sous.length} sous la cible de ${CIBLE} :`);
    sous.forEach(l => console.log(`  · ${l.id} (${(l.photos || []).length})`));
  } else {
    console.log(`Tous les lieux ont au moins ${CIBLE} photos.`);
  }
})();
