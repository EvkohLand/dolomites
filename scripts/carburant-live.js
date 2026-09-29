#!/usr/bin/env node
/* Prix du carburant du jour le long des tracés : stations à moins de 5 km du tracé de chaque
   jour ou de la nuit, pour la France (flux officiel prix-carburants) et l'Italie (Osservaprezzi
   MIMIT, extraction quotidienne). Écrit config/commun/carburant-live.json.
   Usage : node scripts/carburant-live.js */
'use strict';

const C = require('./live-commun');

const RAYON_KM = 5;
const PAR_JOUR = 12;           // candidats gardés par jour ; la page affiche les 3 moins chers
const FRAICHEUR_JOURS = 8;     // un prix plus ancien n'est pas un prix du jour
const FICHIER = 'commun/carburant-live.json';

const URL_FR = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json';
const URL_IT_PRIX = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
const URL_IT_STATIONS = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';

const arrondi = n => Math.round(n * 1000) / 1000;
const coord = n => Math.round(n * 1e5) / 1e5;

function titre(txt) {
  return String(txt || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/(^|[\s'(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

function frais(iso, maintenant) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !isNaN(t) && maintenant - t < FRAICHEUR_JOURS * 86400000;
}

async function stationsFrance(boite, maintenant) {
  const params = new URLSearchParams({
    select: 'id,adresse,ville,cp,geom,gazole_prix,gazole_maj,sp95_prix,sp95_maj,e10_prix,e10_maj',
    where: `in_bbox(geom,${boite.latMin},${boite.lonMin},${boite.latMax},${boite.lonMax})`
  });
  const brut = await (await C.telecharger(URL_FR + '?' + params)).json();
  const out = [];
  let releve = '';
  for (const s of brut) {
    if (!s.geom || typeof s.gazole_prix !== 'number' || !frais(s.gazole_maj, maintenant)) continue;
    const sp = frais(s.sp95_maj, maintenant) ? s.sp95_prix : null;
    const e10 = frais(s.e10_maj, maintenant) ? s.e10_prix : null;
    if (s.gazole_maj > releve) releve = s.gazole_maj;
    out.push({
      cle: 'FR-' + s.id, pays: 'FR', id: String(s.id),
      nom: titre(s.ville) + ' — ' + titre(s.adresse),
      adresse: [titre(s.adresse), [s.cp, titre(s.ville)].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      gps: [coord(s.geom.lat), coord(s.geom.lon)],
      autoroute: /autoroute|\baire\b/i.test(s.adresse || '') || undefined,
      gazole: arrondi(s.gazole_prix), gazole_mode: 'self',
      sp95: typeof sp === 'number' ? arrondi(sp) : undefined,
      e10: typeof e10 === 'number' ? arrondi(e10) : undefined,
      releve: s.gazole_maj
    });
  }
  return { stations: out, releve };
}

/* Lignes « a|b|c » ; le nom peut lui-même contenir un « | » : on lit les colonnes fixes par les deux bouts. */
function lignesCsv(txt) {
  return txt.split(/\r?\n/).filter(Boolean).map(l => l.replace(/\t/g, ' ').split('|'));
}

/* L'adresse du registre contient parfois déjà la commune : ne pas la répéter. */
function adresseItalienne(rue, commune, prov) {
  const r = titre(rue);
  if (commune && r.toLowerCase().indexOf(String(commune).trim().toLowerCase()) !== -1) return r;
  return [r, titre(commune) + (prov ? ' (' + prov.trim() + ')' : '')].filter(Boolean).join(', ');
}

function dateItalienne(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(txt || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : '';
}

async function stationsItalie(boite, maintenant) {
  const [txtStations, txtPrix] = await Promise.all([
    C.telecharger(URL_IT_STATIONS).then(r => r.text()),
    C.telecharger(URL_IT_PRIX).then(r => r.text())
  ]);
  const extraction = (/Estrazione del (\d{4}-\d{2}-\d{2})/.exec(txtPrix) || [])[1] || '';

  const stations = new Map();
  const autoroutes = new Set();
  for (const c of lignesCsv(txtStations).slice(2)) {
    if (c.length < 10) continue;
    if (/autostrad/i.test(c[3])) autoroutes.add(c[0]);
    const lat = Number(c[c.length - 2]), lon = Number(c[c.length - 1]);
    if (!lat || !lon || !C.dansBoite([lat, lon], boite)) continue;
    stations.set(c[0], {
      cle: 'IT-' + c[0], pays: 'IT', id: c[0],
      nom: titre(c.slice(4, c.length - 5).join(' ')),
      marque: c[2] && c[2] !== 'Pompe Bianche' ? c[2].trim() : (c[2] ? 'Indépendante (pompe blanche)' : undefined),
      autoroute: /autostrad/i.test(c[3]) || undefined,
      adresse: adresseItalienne(c[c.length - 5], c[c.length - 4], c[c.length - 3]),
      gps: [coord(lat), coord(lon)], prix: {}
    });
  }

  /* Moyenne nationale du jour, libre-service hors autoroute : prix de repli du budget. */
  const national = { gazole: [], sp95: [] };
  for (const c of lignesCsv(txtPrix).slice(2)) {
    const carbu = c[1] === 'Gasolio' ? 'gazole' : c[1] === 'Benzina' ? 'sp95' : null;
    const prix = Number(c[2]);
    const quand = dateItalienne(c[4]);
    if (!carbu || !prix || !frais(quand, maintenant)) continue;
    if (c[3] === '1' && !autoroutes.has(c[0]) && prix > 0.5 && prix < 5) national[carbu].push(prix);
    const s = stations.get(c[0]);
    if (!s) continue;
    const mode = c[3] === '1' ? 'self' : 'servito';
    s.prix[carbu + '_' + mode] = { prix, quand };
  }

  const out = [];
  for (const s of stations.values()) {
    const g = s.prix.gazole_self || s.prix.gazole_servito;
    if (!g) continue;
    const b = s.prix.sp95_self || s.prix.sp95_servito;
    out.push({
      cle: s.cle, pays: 'IT', id: s.id, nom: s.nom, marque: s.marque, autoroute: s.autoroute,
      adresse: s.adresse, gps: s.gps,
      gazole: arrondi(g.prix), gazole_mode: s.prix.gazole_self ? 'self' : 'servito',
      gazole_servito: s.prix.gazole_self && s.prix.gazole_servito ? arrondi(s.prix.gazole_servito.prix) : undefined,
      sp95: b ? arrondi(b.prix) : undefined,
      sp95_mode: b ? (s.prix.sp95_self ? 'self' : 'servito') : undefined,
      releve: g.quand
    });
  }
  const moy = l => l.length ? arrondi(l.reduce((a, b) => a + b, 0) / l.length) : undefined;
  const moyenne = { gazole: moy(national.gazole), sp95: moy(national.sp95), n: national.gazole.length, date: extraction, perimetre: 'libre-service hors autoroute' };
  return { stations: out, extraction, moyenne };
}

/* Moyenne nationale française du jour, même calcul que la page (qui la relit en direct). */
async function moyenneFrance() {
  const params = new URLSearchParams({
    limit: '1',
    select: 'avg(gazole_prix) as gazole, avg(e10_prix) as e10, avg(sp95_prix) as sp95, count(*) as n',
    where: 'gazole_maj >= now(days=-8)'
  });
  const x = ((await (await C.telecharger(URL_FR.replace('/exports/json', '/records') + '?' + params)).json()).results || [])[0];
  if (!x || typeof x.gazole !== 'number') throw new Error('moyenne France vide');
  return { gazole: arrondi(x.gazole), e10: arrondi(x.e10), sp95: arrondi(x.sp95), n: x.n, date: new Date().toISOString().slice(0, 10), perimetre: 'toutes stations' };
}

async function principal() {
  const maintenant = Date.now();
  const jours = C.joursParScenario(RAYON_KM);
  if (!jours.length) throw new Error('aucun tracé de jour trouvé');
  const tout = C.boite(jours.map(j => [[j.boite.latMin, j.boite.lonMin], [j.boite.latMax, j.boite.lonMax]]), 0);

  const precedent = C.lireJsonSiPresent(FICHIER);
  const sources = {};
  const moyennes = {};
  let candidats = [];
  const erreurs = [];

  /* Une source en panne ne vide pas l'autre : on garde alors ses stations de la veille. */
  try {
    const fr = await stationsFrance(tout, maintenant);
    candidats = candidats.concat(fr.stations);
    sources.FR = { libelle: 'Flux instantané prix-carburants (data.economie.gouv.fr)', url: 'https://www.prix-carburants.gouv.fr/', releve: fr.releve };
  } catch (e) { erreurs.push('France : ' + e.message); }
  try { moyennes.FR = await moyenneFrance(); } catch (e) { erreurs.push('moyenne France : ' + e.message); }
  try {
    const it = await stationsItalie(tout, maintenant);
    candidats = candidats.concat(it.stations);
    sources.IT = { libelle: 'Osservaprezzi carburanti (MIMIT), prix communiqués', url: 'https://carburanti.mise.gov.it/', extraction: it.extraction };
    if (it.moyenne.gazole) moyennes.IT = it.moyenne;
  } catch (e) { erreurs.push('Italie : ' + e.message); }

  if (precedent && precedent.stations) {
    for (const p of ['FR', 'IT']) {
      if (sources[p] || !(precedent.sources || {})[p]) continue;
      sources[p] = Object.assign({}, precedent.sources[p], { perime: true });
      candidats = candidats.concat(Object.values(precedent.stations).filter(s => s.pays === p).map(s => Object.assign({ cle: p + '-' + s.id }, s)));
    }
    for (const p of ['FR', 'IT']) {
      if (!moyennes[p] && (precedent.moyennes || {})[p]) moyennes[p] = Object.assign({}, precedent.moyennes[p], { perime: true });
    }
  }
  if (!candidats.length) throw new Error('aucune station récupérée — ' + erreurs.join(' ; '));

  const stations = {};
  const parJour = {};
  for (const j of jours) {
    const proches = [];
    for (const s of candidats) {
      if (!C.dansBoite(s.gps, j.boite)) continue;
      const d = C.distanceAuJour(s.gps, j);
      if (d <= RAYON_KM) proches.push({ s, km: Math.round(d * 10) / 10 });
    }
    proches.sort((a, b) => a.s.gazole - b.s.gazole || a.km - b.km);
    const gardes = proches.slice(0, PAR_JOUR);
    if (!gardes.length) continue;
    (parJour[j.scenario] = parJour[j.scenario] || {})[j.jour] = gardes.map(x => ({ id: x.s.cle, km: x.km }));
    gardes.forEach(x => {
      const copie = Object.assign({}, x.s);
      delete copie.cle;
      stations[x.s.cle] = copie;
    });
  }

  const obj = {
    genere_le: new Date(maintenant).toISOString().slice(0, 16) + 'Z',
    rayon_km: RAYON_KM,
    note: 'Stations à moins de ' + RAYON_KM + ' km du tracé du jour ou de la nuit, triées par prix du gazole. Italie : prix « self » (libre-service) quand il existe. Un prix de plus de ' + FRAICHEUR_JOURS + ' jours est écarté.',
    sources,
    moyennes,
    stations,
    jours: parJour
  };
  const change = C.ecrireSiChange(FICHIER, obj, ['genere_le']);
  const nb = Object.keys(stations).length;
  console.log(`${FICHIER} : ${nb} stations retenues${change ? '' : ' (inchangé)'}`);
  erreurs.forEach(e => console.warn('  source indisponible — ' + e));
}

principal().catch(e => { console.error('carburant-live : ' + e.message); process.exit(1); });
