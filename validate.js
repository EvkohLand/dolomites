#!/usr/bin/env node
/* Contrôle les fichiers de configuration avant publication.
   Échoue avec un message nommant le fichier fautif : un JSON cassé depuis le téléphone
   ne doit pas produire une page blanche en ligne. */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, 'config');
const erreurs = [];
const alertes = [];

function err(f, m) { erreurs.push(`${f} : ${m}`); }
function warn(f, m) { alertes.push(`${f} : ${m}`); }

function lire(rel) {
  const abs = path.join(RACINE, rel);
  if (!fs.existsSync(abs)) { err(rel, 'fichier absent'); return null; }
  const brut = fs.readFileSync(abs, 'utf8');
  try {
    return JSON.parse(brut);
  } catch (e) {
    // Retrouver la ligne fautive : sans ça le message est inutilisable.
    const m = /position (\d+)/.exec(e.message);
    let ou = '';
    if (m) {
      const pos = Number(m[1]);
      const avant = brut.slice(0, pos);
      const ligne = avant.split('\n').length;
      const col = pos - avant.lastIndexOf('\n');
      ou = ` (ligne ${ligne}, colonne ${col})`;
    }
    err(rel, `JSON invalide${ou} — ${e.message}`);
    return null;
  }
}

/* ---------- Garde-fou données personnelles ---------- */

const MOTIFS = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, 'adresse e-mail'],
  [/(?:\+33|\b0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/, 'numéro de téléphone français'],
  [/\+39[\s.-]?\d[\d\s.-]{7,}/, 'numéro de téléphone italien'],
  [/\b[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}\b/, 'plaque d’immatriculation'],
  [/\b(?:\d[ ]?){13,19}\b/, 'suite de chiffres ressemblant à un numéro de carte'],
  [/\biban\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/i, 'IBAN'],
];

// Les URL contiennent légitimement des motifs proches : on les met de côté avant l'analyse.
function sansUrl(txt) {
  return txt.replace(/https?:\/\/[^\s"']+/g, ' ');
}

function chasserDonneesPerso(rel, valeur, chemin) {
  if (typeof valeur === 'string') {
    const t = sansUrl(valeur);
    for (const [re, nom] of MOTIFS) {
      if (re.test(t)) err(rel, `${nom} détecté dans « ${chemin} » : le dépôt est public, retirer cette donnée`);
    }
  } else if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => chasserDonneesPerso(rel, v, `${chemin}[${i}]`));
  } else if (valeur && typeof valeur === 'object') {
    for (const [k, v] of Object.entries(valeur)) {
      if (/^(telephone|tel|contact|plaque|immatriculation|iban|email|mail)$/i.test(k)) {
        err(rel, `champ interdit « ${chemin}.${k} » : donnée personnelle dans un dépôt public`);
      }
      chasserDonneesPerso(rel, v, chemin ? `${chemin}.${k}` : k);
    }
  }
}

/* ---------- Contrôles ---------- */

const scenarios = lire('scenarios.json');
const lieux = lire('commun/lieux.json');
const categories = lire('commun/categories.json');
const equipements = lire('commun/equipements.json');
const meteo = lire('commun/meteo.json');
const regles = lire('commun/reglementation.json');
const vehicule = lire('commun/vehicule.json');
const carburant = lire('commun/carburant.json');
const randonnees = lire('commun/randonnees.json');
const decouvertes = lire('commun/decouvertes.json');
const pratique = lire('commun/pratique.json');
const peages = lire('commun/peages.json');

for (const [rel, obj] of [
  ['scenarios.json', scenarios], ['commun/lieux.json', lieux],
  ['commun/categories.json', categories], ['commun/equipements.json', equipements],
  ['commun/meteo.json', meteo], ['commun/reglementation.json', regles],
  ['commun/vehicule.json', vehicule], ['commun/carburant.json', carburant],
  ['commun/randonnees.json', randonnees],
  ['commun/decouvertes.json', decouvertes],
  ['commun/pratique.json', pratique],
  ['commun/peages.json', peages],
]) {
  if (obj) chasserDonneesPerso(rel, obj, '');
}

const ids = new Set();
let zone = null;

if (Array.isArray(lieux)) {
  lieux.forEach((l, i) => {
    const ou = `commun/lieux.json`;
    const nom = l && (l.id || l.nom) || `#${i}`;
    if (!l || typeof l !== 'object') { err(ou, `entrée #${i} : pas un objet`); return; }
    for (const champ of ['id', 'nom', 'categorie']) {
      if (!l[champ]) err(ou, `« ${nom} » : champ obligatoire « ${champ} » manquant`);
    }
    if (l.id) {
      if (ids.has(l.id)) err(ou, `identifiant en double : « ${l.id} »`);
      ids.add(l.id);
      if (!/^[a-z0-9-]+$/.test(l.id)) warn(ou, `« ${l.id} » : identifiant à écrire en minuscules sans accent`);
    }
    if (!Array.isArray(l.gps) || l.gps.length !== 2 || l.gps.some(n => typeof n !== 'number' || isNaN(n))) {
      err(ou, `« ${nom} » : coordonnées gps manquantes ou invalides (attendu [latitude, longitude])`);
    }
    if (l.prix && !['gratuit', 'payant', 'inclus', 'variable'].includes(l.prix.type)) {
      err(ou, `« ${nom} » : prix.type vaut « ${l.prix.type} », attendu gratuit, payant, inclus ou variable`);
    }
    if (l.prix && l.prix.budget && l.prix.budget !== 'indispensable') {
      err(ou, `« ${nom} » : prix.budget vaut « ${l.prix.budget} », seule valeur admise : indispensable (sinon l'activité est une option)`);
    }
    if (l.prix && l.prix.budget === 'indispensable' && !l.prix.raison_budget) {
      err(ou, `« ${nom} » : un accès payant déclaré indispensable doit donner sa raison (prix.raison_budget)`);
    }
    if (l.niveau_prix && !/^€{1,4}$/.test(l.niveau_prix)) {
      err(ou, `« ${nom} » : niveau_prix vaut « ${l.niveau_prix} », attendu € à €€€€`);
    }
    (l.equipements || []).forEach(k => {
      if (equipements && !equipements[k]) warn(ou, `« ${nom} » : équipement « ${k} » inconnu de commun/equipements.json`);
    });
    (l.photos || []).forEach((ph, j) => {
      if (!ph || (!ph.fichier && !ph.url)) { err(ou, `« ${nom} » : photo #${j} sans « fichier » ni « url »`); return; }
      if (ph.fichier) {
        const abs = path.join(__dirname, 'photos', ph.fichier);
        if (!fs.existsSync(abs)) err(ou, `« ${nom} » : photo « ${ph.fichier} » absente du dossier photos/`);
        else if (!/\.(jpe?g|png|webp|avif|gif)$/i.test(ph.fichier)) err(ou, `« ${nom} » : « ${ph.fichier} » n'est pas une image`);
        else {
          const mo = fs.statSync(abs).size / 1024 / 1024;
          if (mo > 3) warn(ou, `« ${nom} » : « ${ph.fichier} » pèse ${mo.toFixed(1)} Mo — redimensionner avant le build`);
        }
      }
      if (ph.url && !/^https?:\/\//.test(ph.url)) err(ou, `« ${nom} » : photo #${j}, url invalide`);
      if (!ph.credit) warn(ou, `« ${nom} » : photo #${j} sans « credit » — obligatoire pour une image sous licence libre`);
    });

    (l.liens || []).forEach((x, j) => {
      if (!x || !x.url) err(ou, `« ${nom} » : lien #${j} sans url`);
      else if (!/^https?:\/\//.test(x.url)) err(ou, `« ${nom} » : lien #${j} doit commencer par http`);
    });
    if (l.reglement && Array.isArray(regles) && !regles.some(r => r.id === l.reglement)) {
      err(ou, `« ${nom} » : règle « ${l.reglement} » introuvable dans commun/reglementation.json`);
    }
  });
}

if (Array.isArray(lieux) && categories) {
  const declarees = new Set(Object.keys(categories));
  const utilisees = new Set(lieux.map(l => l && l.categorie).filter(Boolean));
  for (const c of utilisees) {
    if (!declarees.has(c)) warn('commun/categories.json', `catégorie « ${c} » utilisée mais non déclarée : elle s'affichera en gris`);
  }
}

/* Les listes visibles dans la section pratique doivent être cohérentes avec la carte.
   Tous les magasins et toutes les nuits programmées doivent y apparaître. */
const pratiques = new Set();
if (pratique && Array.isArray(lieux)) {
  const parId = new Map(lieux.map(l => [l.id, l]));
  for (const [cle, attendue] of [['groupes_hebergement', ['camping', 'agricamper', 'aire', 'parking']], ['groupes_courses', ['supermarche']]]) {
    if (!Array.isArray(pratique[cle])) { err('commun/pratique.json', `${cle} : liste absente`); continue; }
    for (const g of pratique[cle]) {
      if (!g.titre || !Array.isArray(g.lieux)) { err('commun/pratique.json', `groupe ${cle} incomplet`); continue; }
      for (const id of g.lieux) {
        const l = parId.get(id);
        if (!l) err('commun/pratique.json', `« ${id} » : lieu inexistant`);
        else if (!attendue.includes(l.categorie)) err('commun/pratique.json', `« ${id} » : catégorie inattendue pour ${cle}`);
        if (pratiques.has(id)) err('commun/pratique.json', `« ${id} » apparaît dans deux groupes`);
        pratiques.add(id);
      }
    }
  }
  for (const l of lieux.filter(l => l.categorie === 'supermarche')) {
    if (!pratiques.has(l.id)) err('commun/pratique.json', `magasin « ${l.id} » absent de la section pratique`);
  }
}

if (vehicule) {
  if (typeof vehicule.conso_base_100km !== 'number') err('commun/vehicule.json', 'conso_base_100km doit être un nombre');
  if (typeof vehicule.hauteur_tente_fermee_m !== 'number') warn('commun/vehicule.json', 'hauteur_tente_fermee_m absente : à mesurer avant le départ');
}

if (carburant) {
  if (!carburant.pays || !Object.keys(carburant.pays).length) err('commun/carburant.json', 'aucun pays défini');
  else {
    for (const [code, p] of Object.entries(carburant.pays)) {
      if (typeof p.gazole !== 'number' && typeof p.sp95 !== 'number') {
        err('commun/carburant.json', `pays « ${code} » : aucun prix de carburant`);
      }
    }
    if (carburant.defaut && !carburant.pays[carburant.defaut]) {
      err('commun/carburant.json', `pays par défaut « ${carburant.defaut} » absent de la liste`);
    }
  }
}

/* ---------- Péages : chaque tronçon est une option du budget ---------- */

const troncons = new Set();
if (peages) {
  const ou = 'commun/peages.json';
  const verdicts = ['vaut le coup', 'limite', 'ne vaut pas le coup'];
  if (!Array.isArray(peages.troncons)) err(ou, 'troncons doit être un tableau');
  else peages.troncons.forEach((t, i) => {
    const nom = t && t.id || `#${i}`;
    if (!t.id) err(ou, `tronçon #${i} : id manquant`);
    else if (troncons.has(t.id)) err(ou, `tronçon en double : « ${t.id} »`);
    else troncons.add(t.id);
    for (const champ of ['prix', 'heures_gagnees', 'carburant_ecart', 'net']) {
      if (typeof t[champ] !== 'number' || isNaN(t[champ])) err(ou, `« ${nom} » : ${champ} doit être un nombre`);
    }
    if (!verdicts.includes(t.verdict)) err(ou, `« ${nom} » : verdict « ${t.verdict} » inconnu (attendu : ${verdicts.join(', ')})`);
    if (!Array.isArray(t.sources) || !t.sources.length || t.sources.some(x => !x || !/^https:\/\//.test(x.url || ''))) {
      err(ou, `« ${nom} » : au moins une source HTTPS obligatoire`);
    }
  });
}

/* ---------- Randonnées par zone ---------- */

if (randonnees) {
  if (!Array.isArray(randonnees.zones)) {
    err('commun/randonnees.json', 'zones doit être un tableau');
  } else {
    const zonesRando = new Set();
    randonnees.zones.forEach((z, zi) => {
      const nomZone = z && z.id || `#${zi}`;
      if (!z || typeof z !== 'object') {
        err('commun/randonnees.json', `zone #${zi} : pas un objet`);
        return;
      }
      if (!z.id) err('commun/randonnees.json', `zone #${zi} : id manquant`);
      else if (zonesRando.has(z.id)) err('commun/randonnees.json', `zone en double : « ${z.id} »`);
      else zonesRando.add(z.id);
      if (!Array.isArray(z.zones_planning) || !z.zones_planning.length) {
        err('commun/randonnees.json', `« ${nomZone} » : zones_planning vide`);
      }
      if (!z.difficulte_zone) warn('commun/randonnees.json', `« ${nomZone} » : difficulté de zone absente`);
      if (!Array.isArray(z.risques_zone) || !z.risques_zone.length) {
        warn('commun/randonnees.json', `« ${nomZone} » : risques de zone absents`);
      }
      if (!Array.isArray(z.randos) || !z.randos.length) {
        err('commun/randonnees.json', `« ${nomZone} » : aucune randonnée`);
        return;
      }

      const noms = new Set();
      z.randos.forEach((r, ri) => {
        const nom = r && r.nom || `#${ri}`;
        if (!r || typeof r !== 'object') {
          err('commun/randonnees.json', `« ${nomZone} » randonnée #${ri} : pas un objet`);
          return;
        }
        if (!r.nom) err('commun/randonnees.json', `« ${nomZone} » randonnée #${ri} : nom manquant`);
        else if (noms.has(r.nom)) err('commun/randonnees.json', `« ${nomZone} » : randonnée en double « ${r.nom} »`);
        else noms.add(r.nom);
        if (!r.duree) err('commun/randonnees.json', `« ${nomZone} / ${nom} » : durée manquante`);
        if (!r.niveau) err('commun/randonnees.json', `« ${nomZone} / ${nom} » : niveau manquant`);
        if (!r.risque) err('commun/randonnees.json', `« ${nomZone} / ${nom} » : risque manquant`);
        if (!Array.isArray(r.plan) || !r.plan.length) {
          err('commun/randonnees.json', `« ${nomZone} / ${nom} » : plan de randonnée manquant`);
        }
        if (!r.source || !/^https:\/\//.test(r.source)) {
          err('commun/randonnees.json', `« ${nomZone} / ${nom} » : source HTTPS obligatoire`);
        }
        if (r.distance_km === null || r.distance_km === undefined) {
          warn('commun/randonnees.json', `« ${nomZone} / ${nom} » : distance non publiée dans la fiche source`);
        }
        if (r.denivele_plus_m === null || r.denivele_plus_m === undefined) {
          warn('commun/randonnees.json', `« ${nomZone} / ${nom} » : dénivelé positif non publié dans la fiche source`);
        }
      });
    });
  }
}

/* ---------- Découvertes / activités / remontées / bonnes adresses ---------- */

if (decouvertes) {
  if (!Array.isArray(decouvertes.zones)) {
    err('commun/decouvertes.json', 'zones doit être un tableau');
  } else {
    const idsZones = new Set();
    decouvertes.zones.forEach((z, zi) => {
      const nomZone = z && z.id || `#${zi}`;
      if (!z || typeof z !== 'object') { err('commun/decouvertes.json', `zone #${zi} : pas un objet`); return; }
      if (!z.id) err('commun/decouvertes.json', `zone #${zi} : id manquant`);
      else if (idsZones.has(z.id)) err('commun/decouvertes.json', `zone en double : « ${z.id} »`);
      else idsZones.add(z.id);
      if (!Array.isArray(z.zones_planning) || !z.zones_planning.length) err('commun/decouvertes.json', `« ${nomZone} » : zones_planning vide`);
      if (!Array.isArray(z.items) || !z.items.length) { err('commun/decouvertes.json', `« ${nomZone} » : aucun item`); return; }
      const noms = new Set();
      z.items.forEach((x, xi) => {
        const nom = x && x.nom || `#${xi}`;
        if (!x || typeof x !== 'object') { err('commun/decouvertes.json', `« ${nomZone} » item #${xi} : pas un objet`); return; }
        if (!x.nom) err('commun/decouvertes.json', `« ${nomZone} » item #${xi} : nom manquant`);
        else if (noms.has(x.nom)) err('commun/decouvertes.json', `« ${nomZone} » : item en double « ${x.nom} »`);
        else noms.add(x.nom);
        if (!x.type) warn('commun/decouvertes.json', `« ${nomZone} / ${nom} » : type absent`);
        if (!x.resume) warn('commun/decouvertes.json', `« ${nomZone} / ${nom} » : résumé absent`);
        if (!x.source || !/^https:\/\//.test(x.source)) err('commun/decouvertes.json', `« ${nomZone} / ${nom} » : source HTTPS obligatoire`);
      });
    });
  }
}

/* ---------- Scénarios ---------- */

if (scenarios && Array.isArray(scenarios.scenarios)) {
  if (!scenarios.scenarios.length) err('scenarios.json', 'aucun scénario défini');
  const vus = new Set();
  for (const s of scenarios.scenarios) {
    const ou = 'scenarios.json';
    if (!s.id) { err(ou, 'scénario sans id'); continue; }
    if (vus.has(s.id)) err(ou, `scénario en double : « ${s.id} »`);
    vus.add(s.id);
    if (!s.titre) warn(ou, `« ${s.id} » : pas de titre`);
    if (!s.dossier) { err(ou, `« ${s.id} » : champ dossier manquant`); continue; }

    const reglages = lire(`${s.dossier}/reglages.json`);
    const planning = lire(`${s.dossier}/planning.json`);
    const itineraire = lire(`${s.dossier}/itineraire.json`);
    const budget = lire(`${s.dossier}/budget.json`);

    for (const [rel, obj] of [
      [`${s.dossier}/reglages.json`, reglages], [`${s.dossier}/planning.json`, planning],
      [`${s.dossier}/itineraire.json`, itineraire], [`${s.dossier}/budget.json`, budget],
    ]) { if (obj) chasserDonneesPerso(rel, obj, ''); }

    if (reglages && reglages.carte && Array.isArray(reglages.carte.zone_valide)) {
      zone = reglages.carte.zone_valide;
    }

    if (Array.isArray(planning)) {
      const jours = new Set();
      planning.forEach(j => {
        const ou2 = `${s.dossier}/planning.json`;
        if (typeof j.jour !== 'number') err(ou2, `une journée sans numéro « jour »`);
        else if (jours.has(j.jour)) err(ou2, `jour ${j.jour} en double`);
        else jours.add(j.jour);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date || '')) err(ou2, `jour ${j.jour} : date attendue au format AAAA-MM-JJ`);
        if (j.nuit && !ids.has(j.nuit)) err(ou2, `jour ${j.jour} : lieu de nuit « ${j.nuit} » introuvable`);
        if (j.nuit && pratique && !pratiques.has(j.nuit)) err(ou2, `jour ${j.jour} : nuit « ${j.nuit} » absente de la section pratique`);
        (j.activites || []).forEach(a => {
          if (!a.lieu) err(ou2, `jour ${j.jour} : une activité sans lieu`);
          else if (!ids.has(a.lieu)) err(ou2, `jour ${j.jour} : lieu « ${a.lieu} » introuvable dans commun/lieux.json`);
        });
      });
      if (reglages && reglages.sejour && reglages.sejour.jours && planning.length !== reglages.sejour.jours) {
        warn(`${s.dossier}/planning.json`, `${planning.length} journées décrites mais sejour.jours vaut ${reglages.sejour.jours}`);
      }
    }

    if (itineraire && Array.isArray(itineraire.etapes)) {
      itineraire.etapes.forEach(e => {
        const ou2 = `${s.dossier}/itineraire.json`;
        for (const bout of ['de', 'vers']) {
          const v = e[bout];
          if (!v) err(ou2, `étape « ${e.id} » : champ « ${bout} » manquant`);
          else if (v !== 'depart' && !ids.has(v)) err(ou2, `étape « ${e.id} » : lieu « ${v} » introuvable`);
        }
        (e.par || []).forEach(v => {
          if (!ids.has(v)) err(ou2, `étape « ${e.id} » : passage « ${v} » introuvable`);
        });
        (e.troncons_peage || []).forEach(id => {
          if (!troncons.has(id)) err(ou2, `étape « ${e.id} » : tronçon à péage « ${id} » absent de commun/peages.json`);
        });
        if (e.peage_local && !(e.par || []).includes(e.peage_local)) {
          err(ou2, `étape « ${e.id} » : peage_local « ${e.peage_local} » doit être un des passages (par)`);
        }
        (e.via_gps || []).forEach((g, k) => {
          if (!Array.isArray(g) || g.length !== 2 || g.some(n => typeof n !== 'number')) err(ou2, `étape « ${e.id} » : via_gps #${k} invalide (attendu [latitude, longitude])`);
        });
        if (e.pays && carburant && carburant.pays && !carburant.pays[e.pays]) {
          err(ou2, `étape « ${e.id} » : pays « ${e.pays} » absent de commun/carburant.json`);
        }
      });
    }

    if (budget) {
      const postes = new Set((budget.postes || []).map(p => p.id));
      (budget.calcule || []).forEach(r => {
        const ou2 = `${s.dossier}/budget.json`;
        const connues = ['planning.nuit', 'planning.activites', 'itineraire.peages', 'itineraire.carburant'];
        if (!connues.includes(r.depuis)) err(ou2, `règle « ${r.depuis} » inconnue (attendu : ${connues.join(', ')})`);
        if (!postes.has(r.poste)) err(ou2, `règle « ${r.depuis} » : poste « ${r.poste} » non déclaré`);
      });
      (budget.saisi || []).forEach((l, i) => {
        const ou2 = `${s.dossier}/budget.json`;
        if (!postes.has(l.poste)) err(ou2, `ligne saisie #${i} : poste « ${l.poste} » non déclaré`);
        if (typeof l.montant !== 'number') err(ou2, `ligne saisie « ${l.libelle} » : montant non numérique`);
      });
    }
  }

  if (scenarios.defaut && !vus.has(scenarios.defaut)) {
    err('scenarios.json', `scénario par défaut « ${scenarios.defaut} » introuvable`);
  }
}

/* Coordonnées dans la zone attendue : une virgule inversée met un point au Kazakhstan. */
if (zone && Array.isArray(lieux)) {
  const [[latMin, lonMin], [latMax, lonMax]] = zone;
  lieux.forEach(l => {
    if (!Array.isArray(l.gps) || l.gps.length !== 2) return;
    const [lat, lon] = l.gps;
    if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) {
      err('commun/lieux.json', `« ${l.id} » : coordonnées ${lat}, ${lon} hors de la zone du voyage — latitude et longitude inversées ?`);
    }
  });
}

/* ---------- Données en direct et webcams : facultatives, la page s'en passe ---------- */

function lireFacultatif(rel) {
  return fs.existsSync(path.join(RACINE, rel)) ? lire(rel) : null;
}

const webcams = lireFacultatif('commun/webcams.json');
if (webcams) {
  chasserDonneesPerso('commun/webcams.json', webcams, '');
  if (!webcams.lieux || typeof webcams.lieux !== 'object') err('commun/webcams.json', 'objet « lieux » absent');
  else for (const [id, cams] of Object.entries(webcams.lieux)) {
    if (!ids.has(id)) err('commun/webcams.json', `lieu « ${id} » introuvable dans commun/lieux.json`);
    if (!Array.isArray(cams)) { err('commun/webcams.json', `« ${id} » : liste de webcams attendue`); continue; }
    cams.forEach((c, i) => {
      if (!c || !/^https:\/\//.test(c.image || '')) err('commun/webcams.json', `« ${id} » webcam #${i} : image HTTPS obligatoire`);
    });
  }
}

const carbuLive = lireFacultatif('commun/carburant-live.json');
if (carbuLive) {
  if (!carbuLive.stations || !carbuLive.jours) err('commun/carburant-live.json', 'champs « stations » et « jours » attendus');
  else for (const [sc, jours] of Object.entries(carbuLive.jours)) {
    for (const [jour, liste] of Object.entries(jours || {})) {
      (liste || []).forEach(x => {
        const s = carbuLive.stations[x && x.id];
        if (!s) err('commun/carburant-live.json', `${sc} jour ${jour} : station « ${x && x.id} » absente`);
        else if (typeof s.gazole !== 'number' || !Array.isArray(s.gps)) err('commun/carburant-live.json', `station « ${x.id} » : prix ou gps manquant`);
      });
    }
  }
}

const routesLive = lireFacultatif('commun/routes-live.json');
if (routesLive && !Array.isArray(routesLive.messages)) err('commun/routes-live.json', 'liste « messages » attendue');

/* ---------- Rapport ---------- */

if (alertes.length) {
  console.log(`\n${alertes.length} avertissement${alertes.length > 1 ? 's' : ''} :`);
  alertes.forEach(a => console.log('  · ' + a));
}

if (erreurs.length) {
  console.error(`\n${erreurs.length} erreur${erreurs.length > 1 ? 's' : ''} — publication refusée :`);
  erreurs.forEach(e => console.error('  ✗ ' + e));
  console.error('');
  process.exit(1);
}

const nbLieux = Array.isArray(lieux) ? lieux.length : 0;
const nbScen = scenarios && scenarios.scenarios ? scenarios.scenarios.length : 0;
console.log(`\nConfiguration valide : ${nbLieux} lieux, ${nbScen} scénario${nbScen > 1 ? 's' : ''}, aucune donnée personnelle détectée.\n`);
