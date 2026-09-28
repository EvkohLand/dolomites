#!/usr/bin/env node
/* Messages de circulation près des tracés : Haut-Adige (centrale trafic de la Province de
   Bolzano), routes nationales ANAS, communiqués Veneto Strade (province de Belluno).
   Écrit config/commun/routes-live.json, copie de secours de ce que la page lit en direct.
   Usage : node scripts/routes-live.js */
'use strict';

const C = require('./live-commun');

const RAYON_KM = 5;
const FICHIER = 'commun/routes-live.json';
const JOURS_VENETO = 14;

const URL_BZ = 'https://static-verkehr.provinz.bz.it/publications/traffic/traffic.json';
const URL_ANAS = 'https://www.stradeanas.it/it/anas_vai/getevents?single_data=EVENTI_ALL';
const URL_VENETO = 'https://www.venetostrade.it/myportal/VSSPA/api/content?type=rve_avviso&pageIndex=1&onlyNotHidden=true&parent=/Avvisi&includeSubFolders=true&sortBy=pubDate&desc=true&pageSize=10';

function texte(html) {
  return String(html || '')
    .replace(/<br\s*\/?>|<\/(p|li|div)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è').replace(/&eacute;/g, 'é')
    .replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù').replace(/&igrave;/g, 'ì')
    .replace(/&[lr]squo;|&#39;/g, '\'').replace(/&[lr]dquo;|&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function couper(t, n) { return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }

function dateIt(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(txt || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/* Même conversion que dans la page (src/app.js, messageBz) : la page relit ce flux en direct. */
function messageBz(x) {
  if (typeof x.X !== 'number' || typeof x.Y !== 'number') return null;
  if (/piste ciclabili|radwege/i.test(x.messageStreetInternetDescIt || x.messageStreetInternetDescDe || '')) return null;
  const grade = String(x.messageGradId || '');
  return {
    source: 'bz', id: String(x.messageId),
    route: [String(x.messageStreetNr || '').trim(), x.messageStreetInternetDescIt].filter(Boolean).join(' — '),
    niveau: grade === '3' ? 'fermeture' : grade === '4' ? 'gene' : 'info',
    etat: x.messageGradDescIt || '',
    texte: couper(texte(x.placeIt || x.placeDe), 400),
    debut: x.beginDate || '', fin: x.endDate || '',
    gps: [Math.round(x.Y * 1e5) / 1e5, Math.round(x.X * 1e5) / 1e5]
  };
}

function messageAnas(e) {
  const lat = Number(e.latitudine), lon = Number(e.longitudine);
  if (!lat || !lon) return null;
  let cal = [];
  try {
    const c = JSON.parse(e.calendario_ordinanza || '{}').CalendarioOrdinanza;
    cal = Array.isArray(c) ? c : c ? [c] : [];
  } catch (err) { cal = []; }
  const fins = cal.map(c => dateIt(c.DATA_FINE_ORDINANZA));
  const fin = fins.some(f => !f) ? '' : fins.sort().pop() || '';
  const debut = cal.map(c => dateIt(c.DATA_INIZIO_ORDINANZA)).filter(Boolean).sort()[0] || (e.data || '').slice(0, 10);
  const crit = String(e.criticita || '');
  const periode = cal.length ? texte(cal[0].DESCRIZIONE) : '';
  return {
    source: 'anas', id: String(e.id),
    route: texte(e.strada) || e.sigla_strada || '',
    niveau: /chiusura|divieto di transito/i.test(e.descrizione_tipo) ? 'fermeture' : crit === '1' ? 'info' : 'gene',
    etat: texte(e.descrizione_causa),
    texte: couper(texte(e.descrizione_tipo).replace(/^-\s*/, '').replace(/\s-\s/g, ' · ') + (periode ? ' — ' + periode : ''), 400),
    debut, fin,
    gps: [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]
  };
}

/* ANAS garde des années de limitations permanentes et des « trafic normal » : ce n'est pas un message du jour. */
function utileAnas(e) {
  return !/traffico regolare/i.test(e.descrizione_tipo || '');
}
function recentAnas(m) {
  if (m.niveau === 'fermeture' || m.fin) return true;
  return m.debut >= new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
}

/* Même conversion que dans la page (src/app.js, avisVeneto). */
function avisVeneto(ent) {
  const a = ent.attributes || {};
  return {
    titre: texte(a.sys_title),
    texte: couper(texte(a.sys_testo_incorporamento || a.sys_description), 500),
    date: String(a.sys_start_pub_date || a.def_date_last_modified || '').slice(0, 16),
    url: a.sys_canonical_url ? 'https://www.venetostrade.it/myportal/VSSPA' + a.sys_canonical_url : 'https://www.venetostrade.it/'
  };
}

async function principal() {
  const jours = C.joursParScenario(RAYON_KM);
  const precedent = C.lireJsonSiPresent(FICHIER) || {};
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const sources = {};
  const erreurs = [];
  let messages = [];

  const prochesDUnTrace = m => m && jours.some(j => C.dansBoite(m.gps, j.boite) && C.distanceAuJour(m.gps, j) <= RAYON_KM);
  const enCours = m => !m.fin || m.fin >= aujourdhui;
  const anciens = src => (precedent.messages || []).filter(m => m.source === src);

  try {
    const r = await C.telecharger(URL_BZ);
    const brut = await r.json();
    messages = messages.concat(brut.map(messageBz).filter(prochesDUnTrace).filter(enCours));
    sources.bz = { libelle: 'Centrale trafic de la Province de Bolzano', url: 'https://verkehr.provinz.bz.it/it/', maj: (brut[0] && brut[0].publishDateTime || '').slice(0, 16) };
  } catch (e) { erreurs.push('Bolzano : ' + e.message); messages = messages.concat(anciens('bz')); sources.bz = precedent.sources && precedent.sources.bz; }

  try {
    const r = await C.telecharger(URL_ANAS);
    const brut = await r.json();
    messages = messages.concat((brut.eventi || []).filter(utileAnas).map(messageAnas).filter(prochesDUnTrace).filter(enCours).filter(recentAnas));
    sources.anas = { libelle: 'ANAS, VAI — viabilité des routes nationales', url: 'https://www.stradeanas.it/it/vai-traffico-in-tempo-reale', maj: aujourdhui };
  } catch (e) { erreurs.push('ANAS : ' + e.message); messages = messages.concat(anciens('anas')); sources.anas = precedent.sources && precedent.sources.anas; }

  let veneto = precedent.veneto || [];
  try {
    const r = await C.telecharger(URL_VENETO);
    const brut = await r.json();
    const limite = new Date(Date.now() - JOURS_VENETO * 86400000).toISOString();
    veneto = ((brut.page && brut.page.entities) || []).map(avisVeneto).filter(a => a.date >= limite.slice(0, 16));
    sources.veneto = { libelle: 'Veneto Strade — avis de circulation, province de Belluno', url: 'https://www.venetostrade.it/myportal/VSSPA/home', maj: aujourdhui };
  } catch (e) { erreurs.push('Veneto Strade : ' + e.message); sources.veneto = precedent.sources && precedent.sources.veneto; }

  /* Doublons exacts (même message publié dans les deux sens de circulation). */
  const vus = new Set();
  messages = messages.filter(m => {
    const k = m.source + '|' + m.route + '|' + m.texte;
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  });
  messages.sort((a, b) => (a.source + a.route).localeCompare(b.source + b.route) || a.id.localeCompare(b.id));

  const obj = {
    genere_le: new Date().toISOString().slice(0, 16) + 'Z',
    rayon_km: RAYON_KM,
    note: 'Copie de secours, lue hors ligne ou si la source directe ne répond pas. Messages en cours à moins de ' + RAYON_KM + ' km d\'un tracé.',
    sources,
    messages,
    veneto
  };
  const change = C.ecrireSiChange(FICHIER, obj, ['genere_le']);
  console.log(`${FICHIER} : ${messages.length} messages près des tracés, ${veneto.length} avis Veneto Strade${change ? '' : ' (inchangé)'}`);
  erreurs.forEach(e => console.warn('  source indisponible — ' + e));
  if (erreurs.length === 3) process.exit(1);
}

principal().catch(e => { console.error('routes-live : ' + e.message); process.exit(1); });
