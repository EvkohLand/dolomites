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
      'Flèches = sens de circulation ; les pastilles E1, E2… sont les étapes.'));
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

  function lienExterne(libelle, url) {
    var a = el('a', 'lien-ext', libelle);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  /* [{ libelle, valeur }] → tableau à deux colonnes ; une chaîne seule prend toute la ligne. */
  function tableauCle(lignes) {
    var tb = el('table', 'tableau-cle');
    (lignes || []).forEach(function (x) {
      if (!x) return;
      var tr = document.createElement('tr');
      if (typeof x === 'string') {
        var td = el('td', null, x);
        td.colSpan = 2;
        tr.appendChild(td);
      } else {
        tr.appendChild(el('th', null, x.libelle || ''));
        tr.appendChild(el('td', null, String(x.valeur == null ? '' : x.valeur)));
      }
      tb.appendChild(tr);
    });
    return tb;
  }

  function ouvrirPanneau(id, opts) {
    var l = E.parId.get(id);
    if (!l) return;
    var retour = opts && opts.retour;
    document.getElementById('panneau').classList.remove('modale--etape');
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
    if (Array.isArray(l.gps)) sous.push((l.gps_approximatif ? 'Position indicative : ' : '') + l.gps[0].toFixed(4) + ', ' + l.gps[1].toFixed(4));
    document.getElementById('panneau-lieu').textContent = sous.join(' · ');

    vide(corps);

    if (retour) {
      var br = el('button', 'retour-etape', '← Retour au jour ' + retour);
      br.type = 'button';
      br.addEventListener('click', function () { ouvrirEtape(retour); });
      corps.appendChild(br);
    }

    /* Badges */
    var badges = el('div', 'badges');
    var px = prixAffiche(l);
    if (px) {
      var bp = el('span', 'badge ' + (px === 'Gratuit' ? 'badge--gratuit' : 'badge--prix'), px);
      badges.appendChild(bp);
    }
    if (l.niveau_prix) badges.appendChild(el('span', 'badge badge--niveau', l.niveau_prix));
    if (l.nuit_possible === false) badges.appendChild(el('span', 'badge badge--alerte', 'Ne pas y dormir avec notre tente de toit'));
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
      var g = el('div', 'galerie galerie--etape');
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

    /* Adresse */
    if (l.adresse) corps.appendChild(bloc('Adresse', el('p', null, l.adresse)));

    /* Prix détaillé */
    if (l.prix && (l.prix.detail || l.prix.annee_tarif || l.prix.grille)) {
      var dp = el('div');
      if (l.prix.grille) dp.appendChild(tableauCle(l.prix.grille));
      if (l.prix.detail) dp.appendChild(el('p', null, l.prix.detail));
      if (l.prix.annee_tarif) dp.appendChild(el('p', 'jour__note', 'Tarif relevé pour ' + l.prix.annee_tarif + '.'));
      corps.appendChild(bloc('Prix', dp));
    }

    /* Saison et horaires */
    if (l.ouverture || l.horaires) {
      var o = el('div');
      if (l.horaires) o.appendChild(tableauCle(l.horaires));
      if (l.ouverture && l.ouverture.fin_saison) o.appendChild(el('p', null, 'Fin de saison : ' + dateCourte(l.ouverture.fin_saison)));
      if (l.ouverture && l.ouverture.note) o.appendChild(el('p', null, l.ouverture.note));
      if (o.childNodes.length) corps.appendChild(bloc(l.horaires ? 'Saison et horaires' : 'Saison', o));
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

    /* Infos pratiques */
    if (l.pratique) corps.appendChild(bloc('Pratique', tableauCle(l.pratique)));

    /* Solutions de repli */
    if (Array.isArray(l.alternatives) && l.alternatives.length) {
      var da = el('div', 'alternatives');
      l.alternatives.forEach(function (x) {
        var d = el('div', 'alternative');
        d.appendChild(el('p', 'alternative__nom', x.nom));
        if (x.adresse) d.appendChild(el('p', 'jour__note', x.adresse));
        if (x.note) d.appendChild(el('p', null, x.note));
        var dl2 = el('div', 'liens');
        if (Array.isArray(x.gps)) dl2.appendChild(lienExterne('Google Maps', 'https://www.google.com/maps/search/?api=1&query=' + x.gps[0] + ',' + x.gps[1]));
        if (x.url) dl2.appendChild(lienExterne('Site', x.url));
        if (dl2.childNodes.length) d.appendChild(dl2);
        da.appendChild(d);
      });
      corps.appendChild(bloc('Si c\'est plein ou fermé', da));
    }

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
          ouvrirEtape(q.j.jour);
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
        dl.appendChild(lienExterne(x.libelle || x.url, x.url));
      });
      if (dl.childNodes.length) corps.appendChild(bloc('Liens', dl));
    }

    /* Vérification : quand, contre quelles sources, ce qui reste incertain */
    if (l.verification) {
      var v = l.verification;
      var dv = el('div');
      if (v.date) dv.appendChild(el('p', 'jour__note', 'Données recoupées le ' + dateCourte(v.date) + (v.sources && v.sources.length ? ' sur ' + v.sources.length + ' source' + (v.sources.length > 1 ? 's' : '') + '.' : '.')));
      if (v.doutes) dv.appendChild(el('p', null, 'Reste incertain : ' + v.doutes));
      if (v.sources && v.sources.length) {
        var ds = el('div', 'liens');
        v.sources.forEach(function (s) { if (s && s.url) ds.appendChild(lienExterne(s.libelle || s.url, s.url)); });
        dv.appendChild(ds);
      }
      corps.appendChild(bloc('Sources vérifiées', dv));
    }

    /* Actions */
    if (Array.isArray(l.gps) && !l.gps_approximatif) {
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
    if (/^#(lieu|jour)-/.test(location.hash)) history.pushState({}, '', location.pathname + location.search);
  }

  /* ---------- Planning ---------- */

  function randosPourJour(j) {
    var groupes = (((E.randonnees || {}).zones) || []).filter(function (g) {
      return Array.isArray(g.zones_planning) && g.zones_planning.indexOf(j.zone) !== -1;
    });
    var titre = (j.titre || '').toLowerCase();

    /* Falzarego contient deux sous-zones très proches mais distinctes.
       On ne montre que le secteur nommé par la journée, sauf lorsque le planning
       prévoit explicitement l'un comme solution de repli de l'autre. */
    if (j.zone === 'Alta Badia / Falzarego') {
      var citeCinque = titre.indexOf('cinque torri') !== -1;
      var citeLagazuoi = titre.indexOf('lagazuoi') !== -1;
      if (citeCinque && !citeLagazuoi) groupes = groupes.filter(function (g) { return g.id === 'cinque-torri'; });
      if (citeLagazuoi && !citeCinque) groupes = groupes.filter(function (g) { return g.id === 'lagazuoi'; });
    }
    return groupes;
  }

  function texteMetrique(val, suffixe) {
    if (val === null || val === undefined || val === '') return null;
    return String(val).replace('.', ',') + (suffixe || '');
  }

  function randoResume(r) {
    return [
      texteMetrique(r.distance_km, ' km'),
      r.distance_max_km ? ('jusqu\'à ' + texteMetrique(r.distance_max_km, ' km')) : null,
      r.duree,
      r.denivele_plus_m !== null && r.denivele_plus_m !== undefined ? ('D+ ' + r.denivele_plus_m + ' m') : null,
      r.niveau
    ].filter(Boolean).join(' · ');
  }

  function dessinerRandosJour(j, conteneur) {
    var groupes = randosPourJour(j);
    if (!groupes.length) return;

    var sec = el('section', 'jour-randos');
    sec.appendChild(el('h4', 'jour-randos__titre', 'Randonnées de cette zone'));

    groupes.forEach(function (g) {
      var zg = el('div', 'zone-rando');
      var zh = el('div', 'zone-rando__head');
      zh.appendChild(el('strong', null, g.id.replace(/-/g, ' ')));
      if (g.difficulte_zone) zh.appendChild(el('span', null, g.difficulte_zone));
      zg.appendChild(zh);

      if (Array.isArray(g.risques_zone) && g.risques_zone.length) {
        var rz = el('p', 'zone-rando__risques');
        rz.appendChild(el('strong', null, 'Risques de la zone : '));
        rz.appendChild(document.createTextNode(g.risques_zone.join(' · ')));
        zg.appendChild(rz);
      }

      (g.randos || []).forEach(function (r) {
        var d = el('details', 'rando-card');
        var sm = document.createElement('summary');
        sm.appendChild(el('span', 'rando-card__nom', r.nom));
        var resume = randoResume(r);
        if (resume) sm.appendChild(el('span', 'rando-card__meta', resume));
        d.appendChild(sm);

        var grille = el('dl', 'rando-grid');
        [
          ['Distance', r.distance_km !== null && r.distance_km !== undefined
            ? (texteMetrique(r.distance_km, ' km') + (r.distance_max_km ? ' à ' + texteMetrique(r.distance_max_km, ' km') : ''))
            : null],
          ['Durée', r.duree],
          ['Dénivelé +', r.denivele_plus_m !== null && r.denivele_plus_m !== undefined ? r.denivele_plus_m + ' m' : null],
          ['Dénivelé -', r.denivele_moins_m !== null && r.denivele_moins_m !== undefined ? r.denivele_moins_m + ' m' : null],
          ['Altitude max', r.altitude_max_m ? r.altitude_max_m + ' m' : null],
          ['Niveau', r.niveau],
          ['Type', r.type],
          ['Départ', r.depart],
          ['Risque', r.risque],
          ['Statut source', r.statut_source]
        ].forEach(function (x) {
          if (!x[1]) return;
          grille.appendChild(el('dt', null, x[0]));
          grille.appendChild(el('dd', null, String(x[1])));
        });
        d.appendChild(grille);

        if (Array.isArray(r.plan) && r.plan.length) {
          var bp = el('div', 'rando-plan');
          bp.appendChild(el('strong', null, 'Plan de randonnée'));
          var ol = document.createElement('ol');
          r.plan.forEach(function (p) { ol.appendChild(el('li', null, p)); });
          bp.appendChild(ol);
          d.appendChild(bp);
        }

        if (r.source) {
          var src = el('a', 'rando-source', 'Source de l’itinéraire');
          src.href = r.source;
          src.target = '_blank';
          src.rel = 'noopener noreferrer';
          d.appendChild(src);
        }
        zg.appendChild(d);
      });
      sec.appendChild(zg);
    });

    conteneur.appendChild(sec);
  }


  function decouvertesPourJour(j) {
    return ((((E.decouvertes || {}).zones) || []).filter(function (g) {
      return Array.isArray(g.zones_planning) && g.zones_planning.indexOf(j.zone) !== -1;
    }));
  }

  function dessinerDecouvertesJour(j, conteneur) {
    var groupes = decouvertesPourJour(j);
    if (!groupes.length) return;

    var sec = el('section', 'jour-decouvertes');
    sec.appendChild(el('h4', 'jour-decouvertes__titre', 'À faire, remontées & bonnes adresses'));

    groupes.forEach(function (g) {
      var zg = el('div', 'zone-decouverte');
      (g.items || []).forEach(function (x) {
        var d = el('details', 'decouverte-card');
        var sm = document.createElement('summary');
        sm.appendChild(el('span', 'decouverte-card__type', (x.type || 'idée').replace(/_/g, ' ')));
        sm.appendChild(el('span', 'decouverte-card__nom', x.nom || ''));
        if (x.disponibilite) sm.appendChild(el('span', 'decouverte-card__dispo', x.disponibilite));
        d.appendChild(sm);

        if (x.resume) d.appendChild(el('p', 'decouverte-card__resume', x.resume));
        var grille = el('dl', 'decouverte-grid');
        [
          ['Disponibilité', x.disponibilite],
          ['Prix', x.prix],
          ['Chien', x.chien]
        ].forEach(function (p) {
          if (!p[1]) return;
          grille.appendChild(el('dt', null, p[0]));
          grille.appendChild(el('dd', null, String(p[1])));
        });
        if (grille.children.length) d.appendChild(grille);

        if (x.source) {
          var a = el('a', 'decouverte-source', 'Source / informations');
          a.href = x.source;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          d.appendChild(a);
        }
        zg.appendChild(d);
      });
      sec.appendChild(zg);
    });

    conteneur.appendChild(sec);
  }

  function dessinerPratique() {
    var zone = document.getElementById('pratique');
    if (!zone) return;
    vide(zone);
    var d = E.pratique || {};
    [d.introduction, d.alerte_courses, d.conseil_nuit, d.conseil_chien].forEach(function (t) {
      if (t) zone.appendChild(el('p', 'pratique__note', t));
    });
  }

  /* Groupe d'hébergements ou de courses qui contient ce lieu, pour proposer
     les voisins comme solutions de repli dans la vue de l'étape. */
  function groupeDe(groupes, id) {
    return (groupes || []).find(function (g) { return (g.lieux || []).indexOf(id) !== -1; }) || null;
  }

  function distanceKm(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    var dx = (a[1] - b[1]) * 76, dy = (a[0] - b[0]) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function lieuxDuJour(j) {
    var ids = [];
    (j.activites || []).forEach(function (a) { if (a.lieu && ids.indexOf(a.lieu) === -1) ids.push(a.lieu); });
    if (j.nuit && ids.indexOf(j.nuit) === -1) ids.push(j.nuit);
    return ids.map(function (id) { return E.parId.get(id); }).filter(Boolean);
  }

  function photosDuJour(j) {
    var out = [];
    lieuxDuJour(j).forEach(function (l) {
      (l.photos || []).forEach(function (ph) {
        if (ph && (ph.url || ph.fichier)) out.push({ ph: ph, lieu: l });
      });
    });
    return out;
  }

  function routeDuJour(j) {
    var toutes = etapesTriees();
    var e = toutes.find(function (x) { return x.jour === j.jour; });
    if (!e) return null;
    var i = toutes.indexOf(e);
    var reel = E.trace && E.trace.etapes && E.trace.etapes[e.id];
    var type = typeEtape(e, i, toutes.length);
    return {
      etape: e, type: type, meta: styleEtape(type),
      ordre: typeof e.ordre === 'number' ? e.ordre : i + 1,
      km: reel ? reel.distance_km : e.distance_km,
      h: reel ? reel.duree_h : e.duree_h
    };
  }

  function dessinerRouteHiver() {
    var zone = document.getElementById('route-hiver');
    var bandeau = document.getElementById('bandeau-route');
    if (bandeau) {
      vide(bandeau);
      bandeau.appendChild(document.createTextNode('Octobre : les cols (Gardena, Falzarego, Giau, Pordoi…) ne se passent que sur chaussée sèche, sans chaînes à bord. '));
      var a = el('a', null, 'Consignes route');
      a.href = '#volet-route';
      a.addEventListener('click', function () { document.getElementById('volet-route').open = true; });
      bandeau.appendChild(a);
    }
    if (!zone) return;
    vide(zone);
    zone.appendChild(el('p', null, 'La période générale d’obligation hivernale commence habituellement le 15 novembre, mais neige, verglas ou pluie verglaçante peuvent rendre un équipement hivernal obligatoire avant cette date sur les routes de montagne. Véhicule déclaré sans chaînes et sans pneus hiver : ne pas engager un col enneigé ou verglacé.'));
    var hu = el('ul', null);
    [
      'Avant chaque journée avec col ou route d’altitude : vérifier météo et état officiel de la route le matin même.',
      'Si neige, verglas, pluie verglaçante ou chaussée blanche : demi-tour ou itinéraire de vallée ; ne pas tenter le passage.',
      'Vérifier les marquages réels des pneus 4 saisons : M+S pour la conformité italienne ; 3PMSF est nettement préférable sur neige.',
      'Sans chaînes à bord, Passo Gardena, Falzarego, Valparola, Pordoi, Giau et les accès élevés sont conditionnels à une chaussée sèche et dégagée.'
    ].forEach(function (x) { hu.appendChild(el('li', null, x)); });
    zone.appendChild(hu);
  }

  function dessinerPlanning() {
    var zone = document.getElementById('planning');
    vide(zone);

    (E.planning || []).forEach(function (j) {
      var c = el('button', 'etape');
      c.type = 'button';
      c.dataset.jour = j.jour;

      var photos = photosDuJour(j);
      var couv = el('div', 'etape__photo');
      if (photos.length) {
        var ph = photos[0].ph;
        var img = document.createElement('img');
        img.src = ph.url || cheminPhoto(ph.fichier);
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () { img.remove(); });
        couv.appendChild(img);
        if (photos.length > 1) couv.appendChild(el('span', 'etape__nb-photos', photos.length + ' photos'));
      }
      c.appendChild(couv);

      var corps = el('div', 'etape__corps');
      var t = el('div', 'etape__tete');
      t.appendChild(el('span', 'etape__num', 'Jour ' + j.jour));
      t.appendChild(el('span', 'etape__date', dateCourte(j.date)));
      corps.appendChild(t);
      corps.appendChild(el('h3', 'etape__titre', j.titre || ''));

      var r = routeDuJour(j);
      var infos = [];
      if (r && r.km) infos.push(r.km + ' km' + (r.h ? ' · ' + dureeAffiche(r.h) : ''));
      var nbAct = (j.activites || []).length;
      if (nbAct) infos.push(nbAct + ' visite' + (nbAct > 1 ? 's' : ''));
      if (infos.length) corps.appendChild(el('p', 'etape__meta', infos.join(' · ')));

      var n = j.nuit ? resoudre(j.nuit) : null;
      corps.appendChild(el('p', 'etape__nuit', n ? 'Nuit : ' + n.nom : 'Pas de nuit : retour'));
      if (lieuxDuJour(j).some(aVerifier)) corps.appendChild(el('span', 'etape__alerte', 'infos à revérifier'));
      c.appendChild(corps);

      c.addEventListener('click', function () { ouvrirEtape(j.jour); });
      zone.appendChild(c);
    });
  }

  function ouvrirEtape(num) {
    var j = (E.planning || []).find(function (x) { return x.jour === Number(num); });
    if (!j) return;
    var p = document.getElementById('panneau');
    var corps = document.getElementById('panneau-corps');
    var hcat = document.getElementById('panneau-cat');
    hcat.textContent = 'Jour ' + j.jour + ' · ' + dateCourte(j.date);
    hcat.style.setProperty('--c', 'var(--accent)');
    document.getElementById('panneau-titre').textContent = j.titre || '';
    document.getElementById('panneau-lieu').textContent = j.zone || '';
    vide(corps);

    /* Photos de tous les lieux de la journée, chacune légendée par son lieu. */
    var photos = photosDuJour(j);
    if (photos.length) {
      var g = el('div', 'galerie galerie--etape');
      var liste = photos.map(function (x) {
        return { url: x.ph.url, fichier: x.ph.fichier, legende: x.lieu.nom + (x.ph.legende ? ' — ' + x.ph.legende : ''), credit: x.ph.credit };
      });
      liste.forEach(function (ph, i) {
        var fig = el('figure', 'photo');
        var img = document.createElement('img');
        img.src = ph.url || cheminPhoto(ph.fichier);
        img.alt = ph.legende;
        img.loading = 'lazy';
        img.addEventListener('click', function () { agrandir(liste, i, j.titre); });
        img.addEventListener('error', function () { fig.remove(); });
        fig.appendChild(img);
        fig.appendChild(el('figcaption', null, photos[i].lieu.nom));
        g.appendChild(fig);
      });
      corps.appendChild(bloc('Photos (' + photos.length + ')', g));
    }

    if (j.note) corps.appendChild(el('p', 'modale__desc', j.note));

    var grille = el('div', 'etape-grille');
    var principal = el('div', 'etape-grille__principal');
    var cote = el('div', 'etape-grille__cote');
    grille.appendChild(principal);
    grille.appendChild(cote);
    corps.appendChild(grille);

    dessinerMeteoEtape(j, cote);
    dessinerBudgetEtape(j, cote);

    /* Route */
    var r = routeDuJour(j);
    if (r) {
      var tr = el('button', 'jour__trajet');
      tr.type = 'button';
      tr.style.setProperty('--trace', r.meta.couleur);
      tr.appendChild(el('span', 'jour__trajet-num', 'E' + r.ordre));
      var tc = el('span', 'jour__trajet-corps');
      tc.appendChild(el('span', 'jour__trajet-parcours', referencesEtape(r.etape).map(nomRef).join(' → ')));
      tc.appendChild(el('span', 'jour__trajet-meta',
        [r.meta.libelle, r.km ? r.km + ' km' : '', r.h ? dureeAffiche(r.h) : '', 'voir sur la carte'].filter(Boolean).join(' · ')));
      var hors = visitesHorsRoute(r.etape);
      if (hors.length) tc.appendChild(el('span', 'jour__trajet-detour', 'Hors route voiture : ' + hors.map(nomRef).join(', ')));
      tr.appendChild(tc);
      tr.addEventListener('click', function () {
        fermerPanneau();
        focusEtape(r.etape);
        document.getElementById('section-carte').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      cote.appendChild(bloc('Route', tr));
    }

    /* Programme : chaque visite ouvre sa fiche complète. */
    if ((j.activites || []).length) {
      var ul = el('div', 'programme');
      j.activites.forEach(function (a) {
        var l = resoudre(a.lieu);
        var b = el('button', 'programme__item');
        b.type = 'button';
        b.appendChild(el('span', 'jour__heure', a.heure || '—'));
        var txt = el('span', 'programme__corps');
        txt.appendChild(el('span', 'jour__lieu', (l ? l.nom : a.lieu) + (l && aVerifier(l) ? ' ⚠' : '')));
        var px = l ? prixAffiche(l) : null;
        if (px) txt.appendChild(el('span', 'programme__prix', px));
        if (a.note) txt.appendChild(el('span', 'jour__note', a.note));
        b.appendChild(txt);
        b.addEventListener('click', function () { if (l) ouvrirPanneau(l.id, { retour: j.jour }); });
        ul.appendChild(b);
      });
      principal.appendChild(bloc('Programme', ul));
    }

    /* Nuit, puis les solutions de repli du même secteur. */
    var pr = E.pratique || {};
    if (j.nuit) {
      var n = resoudre(j.nuit);
      var dn = el('div');
      var bn = el('button', 'programme__item');
      bn.type = 'button';
      var tn = el('span', 'programme__corps');
      tn.appendChild(el('span', 'jour__lieu', n.nom + (aVerifier(n) ? ' ⚠' : '')));
      var pn = prixAffiche(n);
      if (pn) tn.appendChild(el('span', 'programme__prix', pn));
      if (n.resume) tn.appendChild(el('span', 'jour__note', n.resume));
      bn.appendChild(tn);
      bn.addEventListener('click', function () { ouvrirPanneau(n.id, { retour: j.jour }); });
      dn.appendChild(bn);
      var gh = groupeDe(pr.groupes_hebergement, n.id);
      var autres = gh ? gh.lieux.filter(function (id) { return id !== n.id && E.parId.has(id); }) : [];
      if (autres.length) {
        dn.appendChild(el('p', 'jour__note', 'Si c’est plein ou fermé :'));
        var ra = el('div', 'puces');
        autres.forEach(function (id) {
          var l = E.parId.get(id);
          var b = el('button', 'puce', l.nom);
          b.type = 'button';
          b.addEventListener('click', function () { ouvrirPanneau(id, { retour: j.jour }); });
          ra.appendChild(b);
        });
        dn.appendChild(ra);
      }
      principal.appendChild(bloc('Nuit', dn));

      /* Courses : magasins listés à moins de 25 km de la nuit. */
      var courses = [];
      (pr.groupes_courses || []).forEach(function (g) {
        (g.lieux || []).forEach(function (id) {
          var l = E.parId.get(id);
          if (l && courses.indexOf(l) === -1 && distanceKm(l.gps, n.gps) < 25) courses.push(l);
        });
      });
      if (courses.length) {
        var dc = el('div', 'puces');
        courses.forEach(function (l) {
          var b = el('button', 'puce', l.nom);
          b.type = 'button';
          b.addEventListener('click', function () { ouvrirPanneau(l.id, { retour: j.jour }); });
          dc.appendChild(b);
        });
        principal.appendChild(bloc('Courses à proximité', dc));
      }
    }

    /* Randonnées et adresses de la zone : repliées, pour ne pas noyer la journée. */
    var nbRandos = randosPourJour(j).reduce(function (s, g) { return s + (g.randos || []).length; }, 0);
    if (nbRandos) {
      var dr = el('details', 'volet volet--interne');
      dr.appendChild(el('summary', null, 'Autres randonnées dans la zone (' + nbRandos + ')'));
      dessinerRandosJour(j, dr);
      principal.appendChild(dr);
    }
    var nbDec = decouvertesPourJour(j).reduce(function (s, g) { return s + (g.items || []).length; }, 0);
    if (nbDec) {
      var dd = el('details', 'volet volet--interne');
      dd.appendChild(el('summary', null, 'À faire, remontées et bonnes adresses (' + nbDec + ')'));
      dessinerDecouvertesJour(j, dd);
      principal.appendChild(dd);
    }

    dessinerReglesEtape(j, cote);

    /* Navigation entre les jours sans refermer. */
    var nav = el('div', 'paire');
    var prec = (E.planning || []).find(function (x) { return x.jour === j.jour - 1; });
    var suiv = (E.planning || []).find(function (x) { return x.jour === j.jour + 1; });
    if (prec) { var bp = el('button', 'action', '← Jour ' + prec.jour); bp.type = 'button'; bp.addEventListener('click', function () { ouvrirEtape(prec.jour); }); nav.appendChild(bp); }
    if (suiv) { var bs = el('button', 'action action--fort', 'Jour ' + suiv.jour + ' →'); bs.type = 'button'; bs.addEventListener('click', function () { ouvrirEtape(suiv.jour); }); nav.appendChild(bs); }
    corps.appendChild(nav);

    p.classList.add('modale--etape');
    p.hidden = false;
    document.body.style.overflow = 'hidden';
    if (location.hash !== '#jour-' + j.jour) history.pushState({ jour: j.jour }, '', '#jour-' + j.jour);
    document.getElementById('panneau-fermer').focus();
    corps.scrollTop = 0;
  }

  /* ---------- Météo, budget et règles d'une étape ---------- */

  var CODES_METEO = {
    0: 'Ciel clair', 1: 'Plutôt clair', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant',
    51: 'Bruine faible', 53: 'Bruine', 55: 'Bruine forte', 61: 'Pluie faible', 63: 'Pluie', 65: 'Pluie forte',
    66: 'Pluie verglaçante', 67: 'Pluie verglaçante forte', 71: 'Neige faible', 73: 'Neige', 75: 'Neige forte', 77: 'Grains de neige',
    80: 'Averses faibles', 81: 'Averses', 82: 'Averses violentes', 85: 'Averses de neige', 86: 'Fortes averses de neige',
    95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec forte grêle'
  };
  var cacheMeteo = {};

  /* Points météo du jour : la nuit, plus le lieu le plus haut s'il dépasse la nuit de 300 m. */
  function pointsMeteo(j) {
    var lieux = lieuxDuJour(j).filter(function (l) { return Array.isArray(l.gps); });
    var nuit = j.nuit ? E.parId.get(j.nuit) : null;
    var haut = lieux.slice().sort(function (a, b) { return (b.altitude || 0) - (a.altitude || 0); })[0];
    var pts = [];
    if (nuit && Array.isArray(nuit.gps)) pts.push({ lieu: nuit, role: 'Nuit' });
    if (haut && (!nuit || (haut.altitude || 0) > (nuit.altitude || 0) + 300)) pts.push({ lieu: haut, role: 'Point haut' });
    if (!pts.length && lieux.length) pts.push({ lieu: lieux[0], role: 'Étape' });
    return pts;
  }

  function dansZone(l, z) {
    return !!(z && l && Array.isArray(l.gps) && l.gps[0] >= z.lat_min && l.gps[0] <= z.lat_max && l.gps[1] >= z.lng_min && l.gps[1] <= z.lng_max);
  }

  /* Normale d'octobre de la station de référence, ramenée à l'altitude du lieu. */
  function normale(l, date) {
    var n = (E.meteo || {}).normales_reference;
    if (!n || !date || !l.altitude || !dansZone(l, n.zone) || date.slice(5, 7) !== '10') return null;
    var jour = Number(date.slice(8, 10));
    var dec = (n.decades || []).find(function (x) { return jour <= x.jusqu_au; });
    if (!dec) return null;
    var delta = (l.altitude - n.altitude) / 100 * (n.gradient_c_par_100m || 0.6);
    return Math.round(dec.min - delta) + ' / ' + Math.round(dec.max - delta) + ' °C';
  }

  function prevision(l, date) {
    var cle = l.id + '|' + date;
    if (!cacheMeteo[cle]) {
      var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + l.gps[0] + '&longitude=' + l.gps[1] +
        (l.altitude ? '&elevation=' + l.altitude : '') +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max' +
        '&timezone=Europe%2FRome&start_date=' + date + '&end_date=' + date;
      cacheMeteo[cle] = fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { return d.daily; });
      cacheMeteo[cle].catch(function () { delete cacheMeteo[cle]; });
    }
    return cacheMeteo[cle];
  }

  function dessinerMeteoEtape(j, conteneur) {
    var m = E.meteo || {};
    var d = el('div', 'meteo-etape');
    var pts = pointsMeteo(j);
    pts.forEach(function (pt) {
      var ligne = el('div', 'meteo-etape__point');
      ligne.appendChild(el('p', 'meteo-etape__lieu', pt.role + ' · ' + pt.lieu.nom + (pt.lieu.altitude ? ' (' + pt.lieu.altitude + ' m)' : '')));
      var val = el('p', 'meteo-etape__val', 'Prévision en cours de chargement…');
      ligne.appendChild(val);
      d.appendChild(ligne);
      var nm = normale(pt.lieu, j.date);
      if (nm) ligne.appendChild(el('p', 'jour__note', 'Normale de saison estimée à ' + (pt.lieu.altitude || '?') + ' m : ' + nm));
      if (!j.date || !window.fetch) { val.textContent = 'Prévision indisponible hors ligne.'; return; }
      prevision(pt.lieu, j.date).then(function (x) {
        if (!x || !x.time || !x.time.length || x.temperature_2m_max[0] == null) throw new Error('vide');
        var t = [
          CODES_METEO[x.weather_code[0]] || 'Temps variable',
          Math.round(x.temperature_2m_min[0]) + ' / ' + Math.round(x.temperature_2m_max[0]) + ' °C',
          'pluie ' + x.precipitation_sum[0] + ' mm' + (x.precipitation_probability_max[0] != null ? ' (' + x.precipitation_probability_max[0] + ' %)' : ''),
          x.snowfall_sum[0] ? 'neige ' + x.snowfall_sum[0] + ' cm' : null,
          'vent ' + Math.round(x.wind_speed_10m_max[0]) + ' km/h'
        ].filter(Boolean).join(' · ');
        val.textContent = t;
        val.classList.add('meteo-etape__val--ok');
      }).catch(function () {
        val.textContent = 'Pas encore de prévision pour cette date (au-delà de 16 jours ou hors ligne).';
      });
    });
    d.appendChild(el('p', 'jour__note', 'Prévision Open-Meteo à l’altitude du lieu, actualisée à chaque ouverture ; fiable à 3–5 jours seulement.'));
    var enDolomites = pts.some(function (pt) { return dansZone(pt.lieu, (m.normales_reference || {}).zone); });
    if (enDolomites) {
      if (pts.some(function (pt) { return (pt.lieu.altitude || 0) >= 1800; }) && m.note_altitude) d.appendChild(el('p', 'jour__note', m.note_altitude));
      var liens = el('div', 'puces');
      (m.sources || []).forEach(function (s) { if (s && s.url) liens.appendChild(lienExterne(s.libelle, s.url)); });
      if (liens.childNodes.length) d.appendChild(liens);
    }
    conteneur.appendChild(bloc('Météo du jour', d));
  }

  function dessinerBudgetEtape(j, conteneur) {
    var b = calculerBudget();
    if (!b) return;
    var lignes = b.lignes.filter(function (x) { return x.jour === j.jour; });
    if (!lignes.length) return;
    var libPoste = {};
    (b.postes || []).forEach(function (p) { libPoste[p.id] = p.libelle; });
    var total = lignes.reduce(function (a, x) { return a + x.montant; }, 0);
    var d = el('div');
    d.appendChild(tableauCle(lignes.map(function (x) {
      return { libelle: (libPoste[x.poste] || x.poste) + ' — ' + x.libelle, valeur: euros(x.montant) };
    }).concat([{ libelle: 'Total du jour', valeur: euros(total) }])));
    conteneur.appendChild(bloc('Budget du jour', d));
  }

  function dessinerReglesEtape(j, conteneur) {
    var ids = [];
    lieuxDuJour(j).forEach(function (l) { if (l.reglement && ids.indexOf(l.reglement) === -1) ids.push(l.reglement); });
    var regles = ids.map(function (id) { return (E.regles || []).find(function (r) { return r.id === id; }); }).filter(Boolean);
    if (!regles.length) return;
    var d = el('div');
    regles.forEach(function (r) {
      d.appendChild(el('p', 'regle-etape__titre', r.titre));
      if (r.resume) d.appendChild(el('p', 'jour__note', r.resume));
    });
    conteneur.appendChild(bloc('Règles qui s’appliquent', d));
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

    if (m.mode === 'climatologie' && Array.isArray(m.reperes)) {
      var rc = el('div', 'meteo-grille');
      m.reperes.forEach(function (r) {
        var c = el('div', 'meteo-jour meteo-jour--repere');
        c.appendChild(el('div', 'meteo-jour__date', r.zone || 'Repère'));
        c.appendChild(el('div', 'meteo-jour__temp', r.temperature || ''));
        if (r.note) c.appendChild(el('div', 'meteo-jour__pluie', r.note));
        rc.appendChild(c);
      });
      zone.appendChild(rc);
      if (Array.isArray(m.sources)) m.sources.forEach(function (s) {
        var a = el('a', 'lien-ext', s.libelle || 'Source météo officielle');
        a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        zone.appendChild(a);
      });
      if (m.note_altitude) zone.appendChild(el('p', 'jour__note', m.note_altitude));
      return;
    }

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
      c.addEventListener('click', function () { if (dates[d.date]) ouvrirEtape(dates[d.date]); });
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
    [['etapes', 'Étapes'], ['carte', 'Carte'], ['infos', 'Avant de partir']].forEach(function (x) {
      var a = el('a', null, x[1]);
      a.href = '#section-' + x[0];
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
    dessinerPratique();
    dessinerRouteHiver();
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
      lire('commun/carburant.json'),
      lire('commun/randonnees.json'),
      lire('commun/decouvertes.json'),
      lire('commun/pratique.json')
    ]).then(function (r) {
      E.scenarios = r[0] || { scenarios: [] };
      E.lieux = r[1] || [];
      E.equipements = r[3] || {};
      E.meteo = r[4];
      E.regles = r[5] || [];
      E.vehicule = r[6];
      E.carburant = r[7];
      E.randonnees = r[8] || { zones: [] };
      E.decouvertes = r[9] || { zones: [] };
      E.pratique = r[10] || {};

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

        ouvrirDepuisAdresse();
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
  /* #lieu-<id> ouvre une fiche, #jour-<n> la vue d'une étape. */
  function ouvrirDepuisAdresse() {
    var h = location.hash;
    if (h.indexOf('#lieu-') === 0 && E.parId && E.parId.has(h.slice(6))) { ouvrirPanneau(h.slice(6)); return true; }
    if (h.indexOf('#jour-') === 0 && E.planning) { ouvrirEtape(Number(h.slice(6))); return true; }
    return false;
  }
  window.addEventListener('popstate', function () {
    if (!ouvrirDepuisAdresse()) fermerPanneau();
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
