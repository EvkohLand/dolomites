/* Dolomites — toute la logique. Aucune donnée ici : tout vient des fichiers de configuration. */
(function () {
  'use strict';

  var anomalies = [];
  var E = {};          // état courant
  var carte = null, coucheMarqueurs = null, coucheTrace = null;
  var marqueurs = new Map();
  var couchesEtapes = new Map();

  /* ---------- Chargement : servi (fetch) ou inliné (balises script) ---------- */

  function inline(id) {
    var n = document.getElementById(id);
    if (!n) return null;
    try { return JSON.parse(n.textContent); }
    catch (e) { anomalies.push('Données inlinées illisibles : ' + id + ' — ' + e.message); return null; }
  }

  function lire(chemin) {
    var direct = inline('cfg:' + chemin);
    if (direct !== null) return Promise.resolve(direct);
    return fetch('config/' + chemin, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) {
        anomalies.push('Fichier illisible : config/' + chemin + ' — ' + e.message);
        return null;
      });
  }

  var estInline = !!document.getElementById('cfg:scenarios.json');

  /* ---------- Utilitaires ---------- */

  function euros(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var arrondi = Math.round(n * 100) / 100;
    return (Number.isInteger(arrondi) ? arrondi : arrondi.toFixed(2)).toString().replace('.', ',') + ' €';
  }

  function dateCourte(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function dureeAffiche(h) {
    if (typeof h !== 'number' || isNaN(h)) return '';
    var total = Math.round(h * 60);
    var heures = Math.floor(total / 60), minutes = total % 60;
    if (!heures) return minutes + ' min';
    return heures + ' h' + (minutes ? ' ' + String(minutes).padStart(2, '0') : '');
  }

  function vide(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined && txt !== null) n.textContent = txt;
    return n;
  }

  function svg(nom) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#ico-' + nom);
    s.appendChild(u);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  /* ---------- Index et résolution des références ---------- */

  function indexer(lieux) {
    var parId = new Map();
    (lieux || []).forEach(function (l) {
      if (!l || !l.id) { anomalies.push('Lieu sans identifiant : ' + ((l && l.nom) || '(anonyme)')); return; }
      if (parId.has(l.id)) { anomalies.push('Identifiant en double : ' + l.id); return; }
      if (!Array.isArray(l.gps) || l.gps.length !== 2 || isNaN(l.gps[0]) || isNaN(l.gps[1])) {
        anomalies.push('Coordonnées absentes ou invalides : ' + l.id);
      }
      parId.set(l.id, l);
    });
    return parId;
  }

  function resoudre(ref) {
    if (!ref) return null;
    if (ref === 'depart') {
      var d = E.reglages && E.reglages.depart;
      if (d) return { id: 'depart', nom: d.libelle, gps: d.gps, categorie: 'etape-route', resume: d.note, depart: true };
    }
    var t = E.parId.get(ref);
    if (t) return t;
    anomalies.push('Référence introuvable : ' + ref);
    return { id: ref, nom: ref, introuvable: true, categorie: null, gps: null };
  }

  /* ---------- Catégories déduites des données ---------- */

  function construireCategories(lieux, declarees) {
    declarees = declarees || {};
    var utilisees = [];
    lieux.forEach(function (l) {
      if (l.categorie && utilisees.indexOf(l.categorie) === -1) utilisees.push(l.categorie);
    });
    return utilisees.map(function (id) {
      var d = declarees[id] || {};
      return {
        id: id,
        libelle: d.libelle || id,
        couleur: d.couleur || '#9a938a',
        icone: d.icone || 'point',
        ordre: typeof d.ordre === 'number' ? d.ordre : 999,
        actif: d.actif !== false
      };
    }).sort(function (a, b) {
      return (a.ordre - b.ordre) || a.libelle.localeCompare(b.libelle, 'fr');
    });
  }

  function cat(id) {
    return E.categories.find(function (c) { return c.id === id; })
      || { id: id, libelle: id || 'Autre', couleur: '#9a938a', icone: 'point' };
  }

  function aVerifier(l) {
    return !!(l && ((l.ouverture && l.ouverture.a_reverifier) || (l.prix && l.prix.annee_tarif && l.prix.annee_tarif < 2026)));
  }

  /* ---------- Prix ---------- */

  function prixAffiche(l) {
    var p = l && l.prix;
    if (!p) return null;
    if (p.type === 'gratuit') return 'Gratuit';
    if (p.type === 'variable') return 'Variable';
    var m = (p.montant !== undefined) ? p.montant : p.adulte_ar;
    if (m === undefined) return null;
    return euros(m) + (p.unite ? ' / ' + p.unite : '');
  }

  function montantDe(l) {
    var p = l && l.prix;
    if (!p) return 0;
    if (p.type === 'gratuit') return 0;
    var m = (p.montant !== undefined) ? p.montant : p.adulte_ar;
    return (typeof m === 'number' && !isNaN(m)) ? m : 0;
  }

  /* ---------- Carte ---------- */

  function initCarte() {
    var c = E.reglages.carte || {};
    var zone = document.getElementById('carte');
    if (!window.L) {
      anomalies.push("La bibliothèque de carte n'a pas pu être chargée.");
      montrerMessageCarte(c.tuiles && c.tuiles.message_hors_ligne);
      return;
    }
    carte = L.map(zone, { center: c.centre || [46.5, 11.9], zoom: c.zoom || 9, minZoom: c.zoom_min || 5, maxZoom: c.zoom_max || 17, scrollWheelZoom: true });

    var t = c.tuiles || {};
    var couche = L.tileLayer(t.url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: t.attribution || '© OpenStreetMap', maxZoom: c.zoom_max || 17
    });
    var raté = 0;
    couche.on('tileerror', function () {
      raté++;
      if (raté > 3) montrerMessageCarte(t.message_hors_ligne);
    });
    couche.on('tileload', function () {
      raté = 0;
      var m = document.getElementById('carte-hors-ligne');
      if (m) m.hidden = true;
    });
    couche.addTo(carte);

    coucheTrace = L.layerGroup().addTo(carte);
    coucheMarqueurs = L.layerGroup().addTo(carte);
  }

  function montrerMessageCarte(txt) {
    var m = document.getElementById('carte-hors-ligne');
    if (!m) return;
    m.textContent = txt || 'Fond de carte indisponible sans réseau. Les points et leur détail restent lisibles ci-contre.';
    m.hidden = false;
  }

  function etapesTriees() {
    return ((E.itineraire && E.itineraire.etapes) || []).slice()
      .sort(function (a, b) {
        var oa = typeof a.ordre === 'number' ? a.ordre : (a.jour || 0);
        var ob = typeof b.ordre === 'number' ? b.ordre : (b.jour || 0);
        return oa - ob;
      });
  }

  function typeEtape(e, i, total) {
    if (e && e.type) return e.type;
    if (e && (e.vers === 'depart' || i === total - 1)) return 'retour';
    if (e && e.de === e.vers) return 'boucle';
    if (i < 2) return 'aller';
    return 'transfert';
  }

  function styleEtape(type) {
    if (type === 'retour') return { couleur: '#8b4a3f', libelle: 'Retour' };
    if (type === 'boucle') return { couleur: '#2f6f4f', libelle: 'Boucle / détour' };
    if (type === 'transfert') return { couleur: '#9a6a2f', libelle: 'Transfert' };
    return { couleur: '#42627a', libelle: 'Aller' };
  }

  function nomRef(ref) {
    var l = resoudre(ref);
    return l ? l.nom : ref;
  }

  function referencesEtape(e) {
    return [e.de].concat(e.par || []).concat([e.vers]).filter(Boolean);
  }

  function visitesHorsRoute(e) {
    if (Array.isArray(e.visites_hors_route)) return e.visites_hors_route;
    var j = (E.planning || []).find(function (x) { return x.jour === e.jour; });
    if (!j) return [];
    var refs = new Set(referencesEtape(e));
    return (j.activites || []).map(function (a) { return a.lieu; })
      .filter(function (id) { return !refs.has(id); });
  }

  function indexPassagesEtapes() {
    var m = new Map();
    etapesTriees().forEach(function (e, i, arr) {
      var ordre = typeof e.ordre === 'number' ? e.ordre : i + 1;
      var type = typeEtape(e, i, arr.length);
      referencesEtape(e).forEach(function (ref) {
        if (!ref || ref === 'depart') return;
        var v = m.get(ref) || [];
        if (!v.some(function (x) { return x.ordre === ordre; })) {
          v.push({ ordre: ordre, jour: e.jour, type: type });
          m.set(ref, v);
        }
      });
    });
    return m;
  }

  function icone(c, alerte, passages) {
    passages = passages || [];
    var nums = passages.slice(0, 3).map(function (x) { return x.ordre; });
    var badge = nums.length
      ? '<span class="pin__etape">E' + nums.join('·') + (passages.length > 3 ? '+' : '') + '</span>'
      : '';
    return L.divIcon({
      className: 'pin' + (alerte ? ' pin--alerte' : ''),
      html: '<span class="pin__point" style="--pin:' + c.couleur + '"><svg aria-hidden="true"><use href="#ico-' + c.icone + '"></use></svg></span>' + badge,
      iconSize: [42, 34], iconAnchor: [13, 17]
    });
  }

  function infobulle(l, passages) {
    var bits = [cat(l.categorie).libelle];
    var px = prixAffiche(l);
    if (px) bits.push(px);
    if (l.altitude) bits.push(l.altitude + ' m');
    var n = el('div');
    n.appendChild(el('strong', null, l.nom));
    n.appendChild(document.createElement('br'));
    n.appendChild(el('span', 'bulle__meta', bits.join(' · ')));
    if (passages && passages.length) {
      n.appendChild(document.createElement('br'));
      n.appendChild(el('span', 'bulle__route',
        'Itinéraire : ' + passages.map(function (p) { return 'E' + p.ordre + ' (J' + p.jour + ')'; }).join(', ')));
    }
    return n;
  }

  function dessinerMarqueurs() {
    if (!carte) return;
    coucheMarqueurs.clearLayers();
    marqueurs.clear();
    var passages = indexPassagesEtapes();
    E.lieuxVisibles().forEach(function (l) {
      if (!Array.isArray(l.gps)) return;
      var pe = passages.get(l.id) || [];
      var m = L.marker(l.gps, { icon: icone(cat(l.categorie), aVerifier(l), pe), title: l.nom, riseOnHover: true });
      m.on('click', function () { ouvrirPanneau(l.id); });
      /* Survol : le nom, le prix et les étapes qui passent par ce point. */
      m.bindTooltip(infobulle(l, pe), { direction: 'top', offset: [0, -14], opacity: 1, className: 'bulle' });
      m.addTo(coucheMarqueurs);
      marqueurs.set(l.id, m);
    });
  }

  function pointEtAngle(ligne, fraction) {
    if (!ligne || ligne.length < 2) return null;
    var i = Math.max(1, Math.min(ligne.length - 2, Math.round((ligne.length - 1) * fraction)));
    var a = ligne[i - 1], p = ligne[i], b = ligne[i + 1];
    var dx = b[1] - a[1];
    var dy = -(b[0] - a[0]);
    return { gps: p, angle: Math.atan2(dy, dx) * 180 / Math.PI };
  }

  function iconeFleche(couleur, angle) {
    return L.divIcon({
      className: 'trace-fleche-wrap',
      html: '<span class="trace-fleche" style="--trace:' + couleur + ';transform:rotate(' + angle.toFixed(1) + 'deg)">➤</span>',
      iconSize: [22, 22], iconAnchor: [11, 11]
    });
  }

  function iconeNumeroEtape(ordre, jour, type, couleur) {
    var retour = type === 'retour' ? ' ↩' : '';
    return L.divIcon({
      className: 'trace-etape-wrap',
      html: '<span class="trace-etape" style="--trace:' + couleur + '"><b>E' + ordre + retour + '</b><small>J' + jour + '</small></span>',
      iconSize: [48, 32], iconAnchor: [24, 16]
    });
  }

  function focusEtape(e) {
    if (!carte || !e) return;
    var r = couchesEtapes.get(e.id);
    if (r && r.ligne && r.ligne.length > 1) {
      carte.fitBounds(L.latLngBounds(r.ligne), { padding: [44, 44], maxZoom: 13 });
      if (r.polyline && r.polyline.setStyle) {
        var w = r.poids || 4;
        r.polyline.setStyle({ weight: w + 3, opacity: 1 });
        setTimeout(function () {
          if (r.polyline && r.polyline.setStyle) r.polyline.setStyle({ weight: w, opacity: r.opacite });
        }, 1600);
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll('.resume-etape'), function (n) {
      n.classList.toggle('est-actif', n.dataset.etape === e.id);
    });
  }

  function dessinerTrace() {
    if (!carte || !E.itineraire) return;
    coucheTrace.clearLayers();
    couchesEtapes.clear();
    var st = E.itineraire.style_trace || {};
    var etapes = etapesTriees();

    etapes.forEach(function (e, i) {
      var pts = [];
      referencesEtape(e).forEach(function (ref) {
        var l = resoudre(ref);
        if (l && Array.isArray(l.gps)) pts.push(l.gps);
      });
      var reel = E.trace && E.trace.etapes && E.trace.etapes[e.id];
      var suitLaRoute = !!(reel && Array.isArray(reel.points) && reel.points.length > 1);
      var ligne = suitLaRoute ? reel.points : pts;
      if (ligne.length < 2) return;

      var ordre = typeof e.ordre === 'number' ? e.ordre : i + 1;
      var type = typeEtape(e, i, etapes.length);
      var meta = styleEtape(type);
      var poids = (st.epaisseur || 3) + 1;
      var opacite = suitLaRoute ? 0.78 : 0.38;
      var km = reel ? reel.distance_km : e.distance_km;
      var dh = reel ? reel.duree_h : e.duree_h;
      var titre = 'Étape ' + ordre + ' · J' + e.jour + ' · ' + meta.libelle;
      if (e.note) titre += ' — ' + e.note;
      if (km) titre += ' — ' + km + ' km';
      if (dh) titre += ' · ' + dureeAffiche(dh);

      var pl = L.polyline(ligne, {
        color: meta.couleur,
        weight: poids,
        opacity: opacite,
        dashArray: suitLaRoute ? (type === 'retour' ? '10 5' : null) : (st.pointilles || '6 6'),
        lineCap: 'round',
        lineJoin: 'round'
      }).bindTooltip(titre, { sticky: true, className: 'bulle bulle--trace' }).addTo(coucheTrace);

      pl.on('click', function () { focusEtape(e); });
      couchesEtapes.set(e.id, { polyline: pl, ligne: ligne, poids: poids, opacite: opacite });

      var milieu = pointEtAngle(ligne, 0.5);
      if (milieu) {
        L.marker(milieu.gps, {
          icon: iconeNumeroEtape(ordre, e.jour, type, meta.couleur),
          interactive: true,
          keyboard: false,
          zIndexOffset: 250
        }).on('click', function () { focusEtape(e); })
          .bindTooltip(titre, { direction: 'top', opacity: 1, className: 'bulle bulle--trace' })
          .addTo(coucheTrace);
      }

      var fractions = km && km > 250 ? [0.16, 0.34, 0.58, 0.78]
        : km && km > 70 ? [0.28, 0.68] : [0.58];
      fractions.forEach(function (fr) {
        var pa = pointEtAngle(ligne, fr);
        if (!pa) return;
        L.marker(pa.gps, {
          icon: iconeFleche(meta.couleur, pa.angle),
          interactive: false,
          keyboard: false,
          zIndexOffset: 180
        }).addTo(coucheTrace);
      });

      if (!suitLaRoute && e.id) anomalies.push('Tracé routier absent pour l’étape « ' + e.id + ' » : ligne droite affichée. Lancer node trace-route.js.');
    });
  }

  function dessinerResumeItineraire() {
    var zone = document.getElementById('resume-itineraire');
    if (!zone) return;
    vide(zone);
    var etapes = etapesTriees();
    if (!etapes.length) { zone.hidden = true; return; }
    zone.hidden = false;

    var tete = el('div', 'resume-itineraire__tete');
    tete.appendChild(el('strong', null, 'Itinéraire voiture'));
    tete.appendChild(el('span', null, etapes.length + ' étapes'));
    zone.appendChild(tete);

    if (E.scenario && (E.scenario.logique_route || E.scenario.resume)) {
      zone.appendChild(el('p', 'resume-itineraire__intro', E.scenario.logique_route || E.scenario.resume));
    }

    var liste = el('div', 'resume-itineraire__liste');
    etapes.forEach(function (e, i) {
      var ordre = typeof e.ordre === 'number' ? e.ordre : i + 1;
      var type = typeEtape(e, i, etapes.length);
      var meta = styleEtape(type);
      var reel = E.trace && E.trace.etapes && E.trace.etapes[e.id];
      var km = reel ? reel.distance_km : e.distance_km;
      var dh = reel ? reel.duree_h : e.duree_h;

      var b = el('button', 'resume-etape');
      b.type = 'button';
      b.dataset.etape = e.id;
      b.style.setProperty('--trace', meta.couleur);

      var num = el('span', 'resume-etape__num', 'E' + ordre);
      b.appendChild(num);
      var corps = el('span', 'resume-etape__corps');
      corps.appendChild(el('span', 'resume-etape__titre', 'J' + e.jour + ' · ' + (e.note || meta.libelle)));
      var parcours = referencesEtape(e).map(nomRef).join(' → ');
      corps.appendChild(el('span', 'resume-etape__parcours', parcours));
      var infos = [meta.libelle, km ? km + ' km' : '', dh ? dureeAffiche(dh) : ''].filter(Boolean);
      corps.appendChild(el('span', 'resume-etape__meta', infos.join(' · ')));

      var hors = visitesHorsRoute(e);
      if (hors.length) {
        corps.appendChild(el('span', 'resume-etape__detour',
          'Visites hors tracé voiture : ' + hors.map(nomRef).join(', ')));
      }
      if (type === 'boucle' && km >= 80) {
        corps.appendChild(el('span', 'resume-etape__detour',
          'Détour routier important : ' + km + ' km aller-retour depuis la base.'));
      }

      b.appendChild(corps);
      b.addEventListener('click', function () { focusEtape(e); });
      liste.appendChild(b);
    });
    zone.appendChild(liste);

    var leg = el('div', 'trace-legende');
    ['aller', 'boucle', 'transfert', 'retour'].forEach(function (type) {
      var m = styleEtape(type);
      var s = el('span');
      var p = el('i');
      p.style.setProperty('--trace', m.couleur);
      s.appendChild(p);
      s.appendChild(document.createTextNode(m.libelle));
      leg.appendChild(s);
    });
    zone.appendChild(leg);
    zone.appendChild(el('p', 'resume-itineraire__aide',
      'Flèches = sens de circulation. Les pastilles E1, E2… numérotent les étapes ; ↩ identifie le retour.'));
  }

  /* ---------- Filtres et liste ---------- */

  function dessinerFiltres() {
    var zone = document.getElementById('filtres');
    vide(zone);
    E.categories.forEach(function (c) {
      var b = el('button', 'filtre');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(E.actives.has(c.id)));
      var p = el('span', 'filtre__pastille');
      p.style.setProperty('--c', c.couleur);
      b.appendChild(p);
      b.appendChild(document.createTextNode(c.libelle));
      b.addEventListener('click', function () {
        if (E.actives.has(c.id)) E.actives.delete(c.id); else E.actives.add(c.id);
        b.setAttribute('aria-pressed', String(E.actives.has(c.id)));
        dessinerMarqueurs();
        dessinerListe();
      });
      zone.appendChild(b);
    });
  }

  /* Vignette de la liste : la première photo du lieu, sinon l'icône de sa catégorie
     sur un aplat de sa couleur — toutes les lignes gardent ainsi le même alignement. */
  function vignette(l) {
    var c = cat(l.categorie);
    var n = el('span', 'vignette');
    n.style.setProperty('--c', c.couleur);

    var ph = (l.photos || []).find(function (x) { return x && (x.url || x.fichier); });
    if (ph) {
      var img = document.createElement('img');
      img.src = ph.url || cheminPhoto(ph.fichier);
      img.alt = '';
      img.loading = 'lazy';
      /* Photo distante indisponible hors ligne : on retombe sur l'icône. */
      img.addEventListener('error', function () {
        img.remove();
        n.classList.add('vignette--icone');
        n.appendChild(svg(c.icone));
      });
      n.appendChild(img);
    } else {
      n.classList.add('vignette--icone');
      n.appendChild(svg(c.icone));
    }
    if (aVerifier(l)) n.classList.add('vignette--alerte');
    return n;
  }

  function dessinerListe() {
    var ul = document.getElementById('liste-lieux');
    var compte = document.getElementById('liste-compte');
    vide(ul);
    var v = E.lieuxVisibles();
    compte.textContent = v.length + (v.length > 1 ? ' lieux affichés' : ' lieu affiché') + ' sur ' + E.lieux.length;
    v.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); }).forEach(function (l) {
      var li = document.createElement('li');
      var b = el('button', 'liste__item');
      b.type = 'button';
      b.dataset.lieu = l.id;
      b.appendChild(vignette(l));
      var d = el('span', 'liste__texte');
      d.appendChild(el('span', 'liste__nom', l.nom));
      d.appendChild(document.createElement('br'));
      var bits = [cat(l.categorie).libelle];
      var px = prixAffiche(l);
      if (px) bits.push(px);
      if (aVerifier(l)) bits.push('à revérifier');
      d.appendChild(el('span', 'liste__meta', bits.join(' · ')));
      b.appendChild(d);
      b.addEventListener('click', function () { ouvrirPanneau(l.id); });
      b.addEventListener('mouseenter', function () {
        var m = marqueurs.get(l.id);
        if (m && m.setZIndexOffset) m.setZIndexOffset(1000);
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /* ---------- Panneau plein écran ---------- */

  function bloc(titre, contenu) {
    var b = el('div', 'bloc');
    b.appendChild(el('p', 'bloc__titre', titre));
    b.appendChild(contenu);
    return b;
  }

  function cheminPhoto(fichier) {
    var inl = document.getElementById('photo:' + fichier);
    if (inl) return inl.textContent.trim();   // embarquée dans le fichier autonome
    return 'photos/' + fichier;
  }

  /* Agrandissement : une image plein écran, flèches et Échap pour naviguer. */
  function agrandir(photos, index, titre) {
    var utiles = photos.filter(function (p) { return p && (p.url || p.fichier); });
    if (!utiles.length) return;
    var i = Math.max(0, Math.min(index, utiles.length - 1));

    var v = el('div', 'visionneuse');
    var img = document.createElement('img');
    var leg = el('p', 'visionneuse__legende');
    var f = el('button', 'visionneuse__fermer', '\u00d7');
    f.type = 'button';
    f.setAttribute('aria-label', 'Fermer');

    function montrer() {
      var p = utiles[i];
      img.src = p.url || cheminPhoto(p.fichier);
      img.alt = p.legende || titre;
      leg.textContent = [p.legende, p.credit].filter(Boolean).join(' — ')
        + (utiles.length > 1 ? '   (' + (i + 1) + '/' + utiles.length + ')' : '');
    }

    function fermer() {
      v.remove();
      document.removeEventListener('keydown', clavier);
    }
    function clavier(e) {
      if (e.key === 'Escape') { e.stopPropagation(); fermer(); }
      else if (e.key === 'ArrowRight' && utiles.length > 1) { i = (i + 1) % utiles.length; montrer(); }
      else if (e.key === 'ArrowLeft' && utiles.length > 1) { i = (i - 1 + utiles.length) % utiles.length; montrer(); }
    }

    v.appendChild(img);
    v.appendChild(leg);
    v.appendChild(f);
    if (utiles.length > 1) {
      var prec = el('button', 'visionneuse__nav visionneuse__nav--prec', '\u2039');
      var suiv = el('button', 'visionneuse__nav visionneuse__nav--suiv', '\u203a');
      prec.type = suiv.type = 'button';
      prec.setAttribute('aria-label', 'Photo précédente');
      suiv.setAttribute('aria-label', 'Photo suivante');
      prec.addEventListener('click', function (e) { e.stopPropagation(); i = (i - 1 + utiles.length) % utiles.length; montrer(); });
      suiv.addEventListener('click', function (e) { e.stopPropagation(); i = (i + 1) % utiles.length; montrer(); });
      v.appendChild(prec);
      v.appendChild(suiv);
    }
    f.addEventListener('click', fermer);
    v.addEventListener('click', function (e) { if (e.target === v) fermer(); });
    document.addEventListener('keydown', clavier);
    document.body.appendChild(v);
    montrer();
  }

  function ouvrirPanneau(id) {
    var l = E.parId.get(id);
    if (!l) return;
    var c = cat(l.categorie);
    var p = document.getElementById('panneau');
    var corps = document.getElementById('panneau-corps');

    var hcat = document.getElementById('panneau-cat');
    hcat.textContent = c.libelle;
    hcat.style.setProperty('--c', c.couleur);
    document.getElementById('panneau-titre').textContent = l.nom;

    var sous = [];
    if (l.commune) sous.push(l.commune);
    if (l.altitude) sous.push(l.altitude + ' m');
    if (Array.isArray(l.gps)) sous.push(l.gps[0].toFixed(4) + ', ' + l.gps[1].toFixed(4));
    document.getElementById('panneau-lieu').textContent = sous.join(' · ');

    vide(corps);

    /* Badges */
    var badges = el('div', 'badges');
    var px = prixAffiche(l);
    if (px) {
      var bp = el('span', 'badge ' + (px === 'Gratuit' ? 'badge--gratuit' : 'badge--prix'), px);
      badges.appendChild(bp);
    }
    if (l.niveau_prix) badges.appendChild(el('span', 'badge badge--niveau', l.niveau_prix));
    if (l.chien && l.chien.admis) {
      var t = 'Chien admis';
      if (l.chien.supplement) t = 'Chien +' + euros(l.chien.supplement);
      else if (l.chien.supplement === 0) t = 'Chien gratuit';
      var bc = el('span', 'badge');
      bc.appendChild(svg('chien'));
      bc.appendChild(document.createTextNode(t));
      badges.appendChild(bc);
    }
    if (l.reserver && l.reserver.obligatoire) badges.appendChild(el('span', 'badge badge--alerte', 'Réservation obligatoire'));
    if (aVerifier(l)) {
      var an = (l.prix && l.prix.annee_tarif) ? ('tarif ' + l.prix.annee_tarif + ', à revérifier') : 'à revérifier';
      badges.appendChild(el('span', 'badge badge--alerte', an));
    }
    if (l.introuvable) badges.appendChild(el('span', 'badge badge--alerte', 'référence introuvable'));
    if (badges.childNodes.length) corps.appendChild(badges);

    /* Description */
    if (l.description) corps.appendChild(el('p', 'modale__desc', l.description));
    else if (l.resume) corps.appendChild(el('p', 'modale__desc', l.resume));
    if (l.description && l.resume) { /* le résumé sert la liste, la description le panneau */ }

    /* Photos */
    if (Array.isArray(l.photos) && l.photos.length) {
      var g = el('div', 'galerie');
      l.photos.forEach(function (ph, i) {
        if (!ph) return;
        var src = ph.url || (ph.fichier ? cheminPhoto(ph.fichier) : null);
        if (!src) return;
        var fig = el('figure', 'photo');
        var img = document.createElement('img');
        img.src = src;
        img.alt = ph.legende || l.nom;
        img.loading = 'lazy';
        img.addEventListener('click', function () { agrandir(l.photos, i, l.nom); });
        /* Une photo distante ne charge pas hors ligne : on retire le cadre plutôt
           que de laisser une icône d'image cassée. */
        img.addEventListener('error', function () { fig.remove(); });
        fig.appendChild(img);
        if (ph.legende || ph.credit) {
          var cap = el('figcaption');
          if (ph.legende) cap.appendChild(document.createTextNode(ph.legende));
          if (ph.credit) {
            if (ph.legende) cap.appendChild(document.createElement('br'));
            cap.appendChild(el('span', 'photo__credit', ph.credit));
          }
          fig.appendChild(cap);
        }
        g.appendChild(fig);
      });
      if (g.childNodes.length) corps.appendChild(bloc('Photos', g));
    }

    /* Équipements */
    if (Array.isArray(l.equipements) && l.equipements.length) {
      var eq = el('div', 'equipements');
      l.equipements.forEach(function (k) {
        var d = (E.equipements && E.equipements[k]) || { libelle: k, icone: 'point' };
        var s = el('span', 'equipement');
        s.appendChild(svg(d.icone || 'point'));
        s.appendChild(document.createTextNode(d.libelle));
        eq.appendChild(s);
      });
      corps.appendChild(bloc('Sur place', eq));
    }

    /* Prix détaillé */
    if (l.prix && (l.prix.detail || l.prix.annee_tarif)) {
      var dp = el('div');
      if (l.prix.detail) dp.appendChild(el('p', null, l.prix.detail));
      if (l.prix.annee_tarif) dp.appendChild(el('p', 'jour__note', 'Tarif relevé pour ' + l.prix.annee_tarif + '.'));
      corps.appendChild(bloc('Prix', dp));
    }

    /* Saison */
    if (l.ouverture) {
      var o = el('div');
      if (l.ouverture.fin_saison) o.appendChild(el('p', null, 'Fin de saison : ' + dateCourte(l.ouverture.fin_saison)));
      if (l.ouverture.note) o.appendChild(el('p', null, l.ouverture.note));
      if (o.childNodes.length) corps.appendChild(bloc('Saison', o));
    }

    /* Randonnée */
    if (l.rando) {
      var tb = el('table', 'tableau-cle');
      var lignes = [
        ['Distance', l.rando.distance_km ? l.rando.distance_km + ' km' : null],
        ['Dénivelé', l.rando.denivele_m ? l.rando.denivele_m + ' m' : null],
        ['Durée', l.rando.duree_h ? l.rando.duree_h + ' h' : null],
        ['Difficulté', l.rando.difficulte],
        ['Forme', l.rando.boucle === true ? 'Boucle' : (l.rando.boucle === false ? 'Aller-retour' : null)]
      ];
      lignes.forEach(function (x) {
        if (!x[1]) return;
        var tr = document.createElement('tr');
        tr.appendChild(el('th', null, x[0]));
        tr.appendChild(el('td', null, String(x[1])));
        tb.appendChild(tr);
      });
      if (l.rando.depart_lieu) {
        var dep = resoudre(l.rando.depart_lieu);
        var tr2 = document.createElement('tr');
        tr2.appendChild(el('th', null, 'Départ'));
        var td2 = document.createElement('td');
        var a2 = el('a', null, dep.nom);
        a2.href = '#';
        a2.addEventListener('click', function (ev) { ev.preventDefault(); ouvrirPanneau(dep.id); });
        td2.appendChild(a2);
        tr2.appendChild(td2);
        tb.appendChild(tr2);
      }
      if (tb.childNodes.length) corps.appendChild(bloc('Randonnée', tb));
    }

    /* Chien */
    if (l.chien && l.chien.note) corps.appendChild(bloc('Chien', el('p', null, l.chien.note)));

    /* Accès */
    if (l.acces) corps.appendChild(bloc('Accès', el('p', null, l.acces)));

    /* Règle liée */
    if (l.reglement && E.regles) {
      var r = E.regles.find(function (x) { return x.id === l.reglement; });
      if (r) {
        var dr = el('div');
        dr.appendChild(el('p', null, r.resume));
        if (r.detail) dr.appendChild(el('p', 'jour__note', r.detail));
        corps.appendChild(bloc('Règle à connaître — ' + r.titre, dr));
      }
    }

    /* Au programme */
    var quand = [];
    (E.planning || []).forEach(function (j) {
      if (j.nuit === l.id) quand.push({ j: j, txt: 'Nuit' });
      (j.activites || []).forEach(function (a) {
        if (a.lieu === l.id) quand.push({ j: j, txt: a.heure || 'Au programme', note: a.note });
      });
    });
    if (quand.length) {
      var dq = el('div');
      quand.forEach(function (q) {
        var b2 = el('button', 'jour__item');
        b2.type = 'button';
        b2.appendChild(el('span', 'jour__heure', 'Jour ' + q.j.jour));
        b2.appendChild(el('span', 'jour__lieu', q.j.titre + ' — ' + q.txt));
        b2.addEventListener('click', function () {
          fermerPanneau();
          viserJour(q.j.jour);
        });
        dq.appendChild(b2);
        if (q.note) dq.appendChild(el('p', 'jour__note', q.note));
      });
      corps.appendChild(bloc('Au programme', dq));
    }

    /* Liens */
    var liens = (l.liens || []).slice();
    if (l.reserver && l.reserver.url) liens.unshift({ libelle: 'Réserver', url: l.reserver.url });
    if (l.lien_p4n) liens.push({ libelle: 'Voir sur park4night', url: l.lien_p4n });
    if (l.source) liens.push({ libelle: 'Source de ces informations', url: l.source });
    if (liens.length) {
      var dl = el('div', 'liens');
      var vus = {};
      liens.forEach(function (x) {
        if (!x || !x.url || vus[x.url]) return;
        vus[x.url] = 1;
        var a = el('a', 'lien-ext', x.libelle || x.url);
        a.href = x.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        dl.appendChild(a);
      });
      if (dl.childNodes.length) corps.appendChild(bloc('Liens', dl));
    }

    /* Actions */
    if (Array.isArray(l.gps)) {
      var paire = el('div', 'paire');
      var coord = l.gps[0] + ',' + l.gps[1];

      /* Navigation : Google Maps et Waze prennent tous deux les coordonnées brutes,
         ce qui évite toute ambiguïté de nom de lieu en montagne. */
      var g = el('a', 'action action--fort', 'Google Maps');
      g.href = 'https://www.google.com/maps/search/?api=1&query=' + coord;
      g.target = '_blank';
      g.rel = 'noopener noreferrer';
      paire.appendChild(g);

      var w = el('a', 'action action--fort', 'Waze');
      w.href = 'https://waze.com/ul?ll=' + coord + '&navigate=yes';
      w.target = '_blank';
      w.rel = 'noopener noreferrer';
      paire.appendChild(w);

      var cp = el('button', 'action', 'Copier les coordonnées');
      cp.type = 'button';
      cp.addEventListener('click', function () {
        var txt = l.gps[0] + ', ' + l.gps[1];
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { cp.textContent = 'Copié'; setTimeout(function () { cp.textContent = 'Copier les coordonnées'; }, 1500); });
      });
      paire.appendChild(cp);
      corps.appendChild(paire);
    }

    p.hidden = false;
    document.body.style.overflow = 'hidden';
    if (location.hash !== '#lieu-' + l.id) history.pushState({ lieu: l.id }, '', '#lieu-' + l.id);
    document.getElementById('panneau-fermer').focus();
    corps.scrollTop = 0;
  }

  function fermerPanneau() {
    var p = document.getElementById('panneau');
    if (p.hidden) return;
    p.hidden = true;
    document.body.style.overflow = '';
    if (location.hash.indexOf('#lieu-') === 0) history.pushState({}, '', location.pathname + location.search);
  }

  /* ---------- Planning ---------- */

  function viserJour(n) {
    var c = document.querySelector('.jour[data-jour="' + n + '"]');
    if (!c) return;
    c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    c.classList.add('est-vise');
    setTimeout(function () { c.classList.remove('est-vise'); }, 1600);
  }

  function dessinerPlanning() {
    var zone = document.getElementById('planning');
    vide(zone);
    (E.planning || []).forEach(function (j) {
      var c = el('div', 'jour');
      c.dataset.jour = j.jour;

      var t = el('div', 'jour__tete');
      t.appendChild(el('span', 'jour__num', 'Jour ' + j.jour));
      t.appendChild(el('span', 'jour__date', dateCourte(j.date)));
      c.appendChild(t);

      c.appendChild(el('h3', 'jour__titre', j.titre || ''));
      if (j.zone) c.appendChild(el('span', 'jour__zone', j.zone));

      var routeJour = etapesTriees().find(function (e) { return e.jour === j.jour; });
      if (routeJour) {
        var toutes = etapesTriees();
        var ri = toutes.indexOf(routeJour);
        var ordre = typeof routeJour.ordre === 'number' ? routeJour.ordre : ri + 1;
        var type = typeEtape(routeJour, ri, toutes.length);
        var metaRoute = styleEtape(type);
        var reelRoute = E.trace && E.trace.etapes && E.trace.etapes[routeJour.id];
        var kmRoute = reelRoute ? reelRoute.distance_km : routeJour.distance_km;
        var hRoute = reelRoute ? reelRoute.duree_h : routeJour.duree_h;

        var tr = el('button', 'jour__trajet');
        tr.type = 'button';
        tr.style.setProperty('--trace', metaRoute.couleur);
        tr.appendChild(el('span', 'jour__trajet-num', 'E' + ordre));
        var tc = el('span', 'jour__trajet-corps');
        tc.appendChild(el('span', 'jour__trajet-parcours', referencesEtape(routeJour).map(nomRef).join(' → ')));
        tc.appendChild(el('span', 'jour__trajet-meta',
          [metaRoute.libelle, kmRoute ? kmRoute + ' km' : '', hRoute ? dureeAffiche(hRoute) : ''].filter(Boolean).join(' · ')));
        var horsRoute = visitesHorsRoute(routeJour);
        if (horsRoute.length) tc.appendChild(el('span', 'jour__trajet-detour', 'Hors route voiture : ' + horsRoute.map(nomRef).join(', ')));
        if (type === 'boucle' && kmRoute >= 80) {
          tc.appendChild(el('span', 'jour__trajet-detour', 'Détour routier important : ' + kmRoute + ' km A/R.'));
        }
        tr.appendChild(tc);
        tr.addEventListener('click', function () {
          focusEtape(routeJour);
          document.getElementById('section-carte').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        c.appendChild(tr);
      }

      if ((j.activites || []).length) {
        var ul = el('ul', 'jour__liste');
        j.activites.forEach(function (a) {
          var l = resoudre(a.lieu);
          var li = document.createElement('li');
          var b = el('button', 'jour__item');
          b.type = 'button';
          b.appendChild(el('span', 'jour__heure', a.heure || '—'));
          var nom = el('span', 'jour__lieu', l ? l.nom : a.lieu);
          if (l && aVerifier(l)) nom.textContent += ' ⚠';
          b.appendChild(nom);
          b.addEventListener('click', function () { if (l) ouvrirPanneau(l.id); });
          li.appendChild(b);
          ul.appendChild(li);
        });
        c.appendChild(ul);
      }

      if (j.nuit) {
        var n = resoudre(j.nuit);
        var dn = el('p', 'jour__nuit');
        dn.appendChild(document.createTextNode('Nuit : '));
        var a = el('a', null, n ? n.nom : j.nuit);
        a.href = '#';
        a.addEventListener('click', function (ev) { ev.preventDefault(); if (n) ouvrirPanneau(n.id); });
        dn.appendChild(a);
        var mp = n ? prixAffiche(n) : null;
        if (mp) dn.appendChild(document.createTextNode(' — ' + mp));
        c.appendChild(dn);
      } else {
        c.appendChild(el('p', 'jour__nuit', 'Nuit : retour, pas d’hébergement.'));
      }

      if (j.note) c.appendChild(el('p', 'jour__note', j.note));
      zone.appendChild(c);
    });
  }

  /* ---------- Budget ---------- */

  function prixLitre(paysCode) {
    var c = E.carburant;
    if (!c) return 0;
    var p = (c.pays || {})[paysCode || c.defaut] || (c.pays || {})[c.defaut] || {};
    var type = (E.vehicule && E.vehicule.carburant) || 'gazole';
    return p[type] || p.gazole || 0;
  }

  function consoReelle() {
    var v = E.vehicule || {};
    if (typeof v.conso_reelle_100km === 'number') return v.conso_reelle_100km;
    var base = v.conso_base_100km || 0;
    var sur = v.surconso_tente_pct || 0;
    return base * (1 + sur / 100);
  }

  function calculerBudget() {
    var b = E.budget;
    if (!b) return null;
    var postes = b.postes || [];
    var lignes = [];   // { jour, poste, libelle, montant }

    (b.calcule || []).forEach(function (r) {
      if (r.depuis === 'planning.nuit') {
        (E.planning || []).forEach(function (j) {
          if (!j.nuit) return;
          var l = resoudre(j.nuit);
          var m = montantDe(l);
          if (m) lignes.push({ jour: j.jour, poste: r.poste, libelle: l.nom, montant: m });
        });
      } else if (r.depuis === 'planning.activites') {
        (E.planning || []).forEach(function (j) {
          (j.activites || []).forEach(function (a) {
            var l = resoudre(a.lieu);
            var m = montantDe(l);
            if (m) lignes.push({ jour: j.jour, poste: r.poste, libelle: l.nom, montant: m });
          });
        });
      } else if (r.depuis === 'itineraire.peages') {
        ((E.itineraire && E.itineraire.etapes) || []).forEach(function (e) {
          if (e.peages) lignes.push({ jour: e.jour, poste: r.poste, libelle: 'Péages étape ' + e.jour, montant: e.peages });
        });
      } else if (r.depuis === 'itineraire.carburant') {
        var conso = consoReelle();
        ((E.itineraire && E.itineraire.etapes) || []).forEach(function (e) {
          if (!e.distance_km) return;
          var pl = prixLitre(e.pays);
          var m = e.distance_km / 100 * conso * pl;
          if (m) lignes.push({
            jour: e.jour, poste: r.poste,
            libelle: e.distance_km + ' km' + (e.pays ? ' (' + e.pays + ')' : '') + ' à ' + euros(pl) + '/L',
            montant: m
          });
        });
      }
    });

    (b.saisi || []).forEach(function (s) {
      lignes.push({ jour: s.jour, poste: s.poste, libelle: s.libelle, montant: s.montant || 0 });
    });

    var total = lignes.reduce(function (a, x) { return a + x.montant; }, 0);
    var parPoste = {};
    postes.forEach(function (p) { parPoste[p.id] = 0; });
    lignes.forEach(function (x) { parPoste[x.poste] = (parPoste[x.poste] || 0) + x.montant; });

    return { lignes: lignes, total: total, parPoste: parPoste, postes: postes };
  }

  function dessinerBudget() {
    var zone = document.getElementById('budget');
    vide(zone);
    var r = calculerBudget();
    if (!r) { zone.appendChild(el('p', 'jour__note', 'Budget indisponible.')); return; }

    var nbJours = (E.planning || []).length || 1;

    var ch = el('div', 'chiffres');
    [
      [euros(r.total), 'Total du séjour'],
      [euros(r.total / nbJours), 'Par jour en moyenne'],
      [String(nbJours), 'Jours'],
      [E.budget.objectif_par_jour ? euros(E.budget.objectif_par_jour) : '—', 'Objectif par jour']
    ].forEach(function (x) {
      var c = el('div', 'chiffre');
      c.appendChild(el('div', 'chiffre__val', x[0]));
      c.appendChild(el('div', 'chiffre__lib', x[1]));
      ch.appendChild(c);
    });
    zone.appendChild(ch);

    var max = Math.max.apply(null, r.postes.map(function (p) { return r.parPoste[p.id] || 0; }).concat([1]));
    var barres = el('div', 'barres');
    r.postes.forEach(function (p) {
      var v = r.parPoste[p.id] || 0;
      var li = el('div', 'barre');
      li.appendChild(el('span', null, p.libelle));
      var piste = el('div', 'barre__piste');
      var part = el('div', 'barre__part');
      part.style.width = (v / max * 100).toFixed(1) + '%';
      part.style.setProperty('--c', p.couleur || '#2f6f4f');
      piste.appendChild(part);
      li.appendChild(piste);
      li.appendChild(el('span', 'barre__val', euros(v)));
      barres.appendChild(li);
    });
    zone.appendChild(barres);

    var env = el('div', 'tableau-enveloppe');
    var tb = el('table', 'grille');
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    trh.appendChild(el('th', null, 'Jour'));
    r.postes.forEach(function (p) { trh.appendChild(el('th', null, p.libelle)); });
    trh.appendChild(el('th', null, 'Total'));
    thead.appendChild(trh);
    tb.appendChild(thead);

    var tbody = document.createElement('tbody');
    (E.planning || []).forEach(function (j) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, 'J' + j.jour + ' · ' + (j.titre || '')));
      var som = 0;
      r.postes.forEach(function (p) {
        var v = r.lignes.filter(function (x) { return x.jour === j.jour && x.poste === p.id; })
          .reduce(function (a, x) { return a + x.montant; }, 0);
        som += v;
        tr.appendChild(el('td', null, v ? euros(v) : '—'));
      });
      tr.appendChild(el('td', null, euros(som)));
      tbody.appendChild(tr);
    });

    var horsJour = r.lignes.filter(function (x) { return x.jour === null || x.jour === undefined; });
    if (horsJour.length) {
      var tr2 = document.createElement('tr');
      tr2.appendChild(el('td', null, 'Hors jour (forfaits, marge)'));
      var s2 = 0;
      r.postes.forEach(function (p) {
        var v = horsJour.filter(function (x) { return x.poste === p.id; }).reduce(function (a, x) { return a + x.montant; }, 0);
        s2 += v;
        tr2.appendChild(el('td', null, v ? euros(v) : '—'));
      });
      tr2.appendChild(el('td', null, euros(s2)));
      tbody.appendChild(tr2);
    }
    tb.appendChild(tbody);

    var tfoot = document.createElement('tfoot');
    var trf = document.createElement('tr');
    trf.appendChild(el('td', null, 'Total'));
    r.postes.forEach(function (p) { trf.appendChild(el('td', null, euros(r.parPoste[p.id] || 0))); });
    trf.appendChild(el('td', null, euros(r.total)));
    tfoot.appendChild(trf);
    tb.appendChild(tfoot);

    env.appendChild(tb);
    zone.appendChild(env);

    var notes = [];
    if (E.vehicule) notes.push('Carburant calculé sur ' + consoReelle().toFixed(1).replace('.', ',') + ' L/100 km (tente de toit comprise).');
    if (E.carburant && E.carburant.strategie) notes.push(E.carburant.strategie);
    if (notes.length) zone.appendChild(el('p', 'jour__note', notes.join(' ')));
  }

  /* ---------- Météo ---------- */

  function dessinerMeteo() {
    var zone = document.getElementById('meteo');
    vide(zone);
    var m = E.meteo;
    if (!m) { zone.appendChild(el('p', 'jour__note', 'Météo indisponible.')); return; }

    if (m.avertissement) zone.appendChild(el('p', 'meteo-avert', m.avertissement));

    var dates = {};
    (E.planning || []).forEach(function (j) { dates[j.date] = j.jour; });

    var g = el('div', 'meteo-grille');
    (m.jours || []).forEach(function (d) {
      if (Object.keys(dates).length && !(d.date in dates)) return;   // un scénario court n'affiche que ses jours
      var c = el('button', 'meteo-jour');
      c.type = 'button';
      c.appendChild(el('div', 'meteo-jour__date', dateCourte(d.date)));
      var ic = el('div', 'meteo-jour__icone');
      var def = (m.ciels || {})[d.ciel] || { icone: 'nuage' };
      ic.appendChild(svg(def.icone || 'nuage'));
      c.appendChild(ic);
      var t = el('div', 'meteo-jour__temp');
      t.appendChild(document.createTextNode(d.temp_max + '°'));
      t.appendChild(el('span', 'meteo-jour__min', ' / ' + d.temp_min + '°'));
      c.appendChild(t);
      if (d.pluie_pct !== undefined) c.appendChild(el('div', 'meteo-jour__pluie', d.pluie_pct + ' % pluie'));
      if (d.note) c.title = d.note;
      c.addEventListener('click', function () { if (dates[d.date]) viserJour(dates[d.date]); });
      g.appendChild(c);
    });
    zone.appendChild(g);

    var pieds = [];
    if (m.note_altitude) pieds.push(m.note_altitude);
    if (m.soleil) pieds.push('Lever ' + m.soleil.lever + ', coucher ' + m.soleil.coucher + '. ' + (m.soleil.note || ''));
    if (m.source) pieds.push('Source : ' + m.source);
    pieds.forEach(function (t) { zone.appendChild(el('p', 'jour__note', t)); });
  }

  /* ---------- Règles ---------- */

  function dessinerRegles() {
    var zone = document.getElementById('reglementation');
    vide(zone);
    var d = el('div', 'regles');
    (E.regles || []).forEach(function (r) {
      var c = el('div', 'regle' + (r.gravite ? ' regle--' + r.gravite : ''));
      c.appendChild(el('h3', 'regle__titre', r.titre));
      if (r.portee) c.appendChild(el('div', 'regle__portee', r.portee));
      if (r.resume) c.appendChild(el('p', 'regle__resume', r.resume));
      if (r.detail) c.appendChild(el('p', 'regle__detail', r.detail));
      if (r.amende) c.appendChild(el('span', 'badge badge--alerte regle__amende', 'Amende : ' + r.amende));
      if (r.a_reverifier) c.appendChild(el('span', 'badge badge--alerte regle__amende', 'à revérifier avant le départ'));
      if (Array.isArray(r.sources) && r.sources.length) {
        r.sources.forEach(function (s, i) {
          if (!s || !s.url) return;
          var a = el('a', 'lien-ext', s.libelle || ('Source ' + (i + 1)));
          a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.style.marginTop = '10px';
          c.appendChild(a);
        });
      } else if (r.source) {
        var a = el('a', 'lien-ext', 'Source');
        a.href = r.source; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.style.marginTop = '10px';
        c.appendChild(a);
      }
      d.appendChild(c);
    });
    zone.appendChild(d);
  }

  /* ---------- Navigation et diagnostic ---------- */

  function dessinerNav() {
    var n = document.getElementById('nav');
    vide(n);
    (E.reglages.sections || []).forEach(function (s) {
      var sec = document.getElementById('section-' + s.id);
      if (!sec) return;
      var a = el('a', null, s.libelle);
      a.href = '#section-' + s.id;
      n.appendChild(a);
    });
  }

  function dessinerDiagnostic() {
    var sec = document.getElementById('section-diagnostic');
    var ul = document.getElementById('diagnostic-liste');
    vide(ul);
    if (!anomalies.length) { sec.hidden = true; return; }
    sec.hidden = false;
    document.getElementById('diagnostic-resume').textContent =
      anomalies.length + (anomalies.length > 1 ? ' anomalies de configuration' : ' anomalie de configuration');
    anomalies.forEach(function (a) { ul.appendChild(el('li', null, a)); });
  }

  /* ---------- Scénarios ---------- */

  var CLE = 'dolomites.scenario';

  function dessinerChoixScenario() {
    var sel = document.getElementById('choix-scenario');
    vide(sel);
    (E.scenarios.scenarios || []).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = (s.libelle || s.titre || s.id) + (s.etapes_route ? ' · ' + s.etapes_route + ' étapes route' : '');
      o.title = [s.resume, s.logique_route].filter(Boolean).join(' — ');
      sel.appendChild(o);
    });
    sel.value = E.scenarioId;
    sel.addEventListener('change', function () {
      try { localStorage.setItem(CLE, sel.value); } catch (e) { /* navigation privée */ }
      chargerScenario(sel.value).then(rendre);
    });
    if ((E.scenarios.scenarios || []).length < 2) {
      sel.parentNode.hidden = true;
    }
  }

  function chargerScenario(id) {
    var s = (E.scenarios.scenarios || []).find(function (x) { return x.id === id; })
      || (E.scenarios.scenarios || [])[0];
    if (!s) return Promise.reject(new Error('Aucun scénario défini'));
    E.scenarioId = s.id;
    E.scenario = s;
    var d = s.dossier + '/';
    return Promise.all([
      lire(d + 'reglages.json'), lire(d + 'planning.json'),
      lire(d + 'itineraire.json'), lire(d + 'budget.json'),
      lire(d + 'trace.json')
    ]).then(function (r) {
      E.reglages = r[0] || {};
      E.planning = r[1] || [];
      E.itineraire = r[2] || { etapes: [] };
      E.budget = r[3] || null;
      E.trace = r[4] || null;
    });
  }

  /* ---------- Rendu complet ---------- */

  function rendre() {
    var c = E.reglages.couleurs || {};
    Object.keys(c).forEach(function (k) { document.documentElement.style.setProperty('--' + k, c[k]); });

    var titre = E.reglages.titre || (E.scenario && E.scenario.titre) || 'Dolomites';
    document.getElementById('titre').textContent = titre;
    document.title = titre;
    var sous = E.reglages.sous_titre || '';
    var sej = E.reglages.sejour;
    if (sej && sej.debut && sej.fin) sous += (sous ? ' · ' : '') + 'du ' + dateCourte(sej.debut) + ' au ' + dateCourte(sej.fin);
    document.getElementById('sous-titre').textContent = sous;

    E.actives = new Set(E.categories.filter(function (x) { return x.actif; }).map(function (x) { return x.id; }));

    dessinerNav();
    dessinerResumeItineraire();
    dessinerFiltres();
    dessinerMarqueurs();
    dessinerTrace();
    dessinerListe();
    dessinerPlanning();
    dessinerBudget();
    dessinerMeteo();
    dessinerRegles();
    dessinerDiagnostic();

    var pied = [];
    if (E.scenario) pied.push(E.scenario.libelle);
    pied.push('Tous les contenus viennent des fichiers de configuration.');
    document.getElementById('pied-texte').textContent = pied.join(' — ');
  }

  /* ---------- Démarrage ---------- */

  function demarrer() {
    Promise.all([
      lire('scenarios.json'),
      lire('commun/lieux.json'),
      lire('commun/categories.json'),
      lire('commun/equipements.json'),
      lire('commun/meteo.json'),
      lire('commun/reglementation.json'),
      lire('commun/vehicule.json'),
      lire('commun/carburant.json')
    ]).then(function (r) {
      E.scenarios = r[0] || { scenarios: [] };
      E.lieux = r[1] || [];
      E.equipements = r[3] || {};
      E.meteo = r[4];
      E.regles = r[5] || [];
      E.vehicule = r[6];
      E.carburant = r[7];

      E.parId = indexer(E.lieux);
      E.categories = construireCategories(E.lieux, r[2] || {});
      E.actives = new Set(E.categories.filter(function (x) { return x.actif; }).map(function (x) { return x.id; }));
      E.lieuxVisibles = function () {
        return E.lieux.filter(function (l) { return E.actives.has(l.categorie); });
      };

      var voulu = null;
      try { voulu = localStorage.getItem(CLE); } catch (e) { /* ignore */ }
      var dispo = (E.scenarios.scenarios || []).map(function (s) { return s.id; });
      if (dispo.indexOf(voulu) === -1) voulu = E.scenarios.defaut || dispo[0];

      return chargerScenario(voulu).then(function () {
        initCarte();
        dessinerChoixScenario();
        rendre();
        preparerHorsLigne();

        if (location.hash.indexOf('#lieu-') === 0) {
          var id = location.hash.slice(6);
          if (E.parId.has(id)) ouvrirPanneau(id);
        }
      });
    }).catch(function (e) {
      anomalies.push('Démarrage impossible : ' + e.message);
      dessinerDiagnostic();
    });
  }

  function preparerHorsLigne() {
    var a = document.getElementById('lien-hors-ligne');
    if (!a) return;
    if (estInline) { a.hidden = true; return; }     // on consulte déjà la version autonome
    var meta = document.getElementById('meta-hors-ligne');
    var info = window.__DOLOMITES_BUILD__;
    if (info) {
      a.hidden = false;
      meta.textContent = [info.poids, info.date].filter(Boolean).join(' · ');
    } else {
      a.hidden = true;   // pas de fichier autonome produit : ne pas proposer un lien mort
    }
  }

  /* ---------- Événements ---------- */

  document.getElementById('panneau-fermer').addEventListener('click', fermerPanneau);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fermerPanneau(); });
  window.addEventListener('popstate', function () {
    if (location.hash.indexOf('#lieu-') === 0) {
      var id = location.hash.slice(6);
      if (E.parId && E.parId.has(id)) { ouvrirPanneau(id); return; }
    }
    fermerPanneau();
  });

  var nav = document.getElementById('nav');
  var sections = [];
  window.addEventListener('scroll', function () {
    if (!sections.length) sections = Array.prototype.slice.call(document.querySelectorAll('.section[id]'));
    var y = window.scrollY + 120, actif = null;
    sections.forEach(function (s) { if (s.offsetTop <= y) actif = s.id; });
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + actif));
    });
  }, { passive: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})();
