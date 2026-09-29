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

  /* Fichier facultatif (données en direct, webcams) : son absence n'est pas une anomalie. */
  function lireOptionnel(chemin) {
    var direct = inline('cfg:' + chemin);
    if (direct !== null) return Promise.resolve(direct);
    if (!window.fetch) return Promise.resolve(null);
    return fetch('config/' + chemin, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
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
    /* Fond aérien au choix (imagerie Esri, gratuite avec attribution, sans clé),
       avec les noms de lieux par-dessus. Le choix est mémorisé sur l'appareil ;
       sans stockage, la carte s'ouvre simplement sur le plan. */
    var a = c.tuiles_aeriennes;
    var fondChoisi = couche;
    if (a && a.url) {
      var opt = { attribution: a.attribution, maxZoom: c.zoom_max || 17, maxNativeZoom: a.zoom_max_natif || 18 };
      var aerien = L.layerGroup([L.tileLayer(a.url, opt)].concat(a.noms_url ? [L.tileLayer(a.noms_url, opt)] : []));
      var fonds = {};
      fonds[t.libelle || 'Plan'] = couche;
      fonds[a.libelle || 'Vue aérienne'] = aerien;
      L.control.layers(fonds, null, { collapsed: false, position: 'topright' }).addTo(carte);
      try { if (localStorage.getItem('dolomites-fond') === 'aerien') fondChoisi = aerien; } catch (e) {}
      carte.on('baselayerchange', function (ev) {
        try { localStorage.setItem('dolomites-fond', ev.layer === aerien ? 'aerien' : 'plan'); } catch (e) {}
      });
    }
    fondChoisi.addTo(carte);

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

  /* Accueil du chien, qui donne la couleur du repère sur la carte (l'icône garde la
     catégorie) : vert admis, jaune seulement en sac ou en caisse de transport
     (chien.en_sac), rouge non admis, orange quand la fiche ne le dit pas
     (admis null ou absent). */
  var STATUTS_CHIEN = {
    oui: { libelle: 'Chien admis' },
    sac: { libelle: 'Chien en sac ou caisse' },
    non: { libelle: 'Chien non admis' },
    inconnu: { libelle: 'Chien : on ne sait pas' }
  };

  function statutChien(l) {
    var c = l && l.chien;
    if (c && c.en_sac) return 'sac';
    if (c && c.admis === true) return 'oui';
    if (c && c.admis === false) return 'non';
    return 'inconnu';
  }

  function icone(c, alerte, passages, chien) {
    passages = passages || [];
    var nums = passages.slice(0, 3).map(function (x) { return x.ordre; });
    var badge = nums.length
      ? '<span class="pin__etape">E' + nums.join('·') + (passages.length > 3 ? '+' : '') + '</span>'
      : '';
    return L.divIcon({
      className: 'pin' + (alerte ? ' pin--alerte' : ''),
      html: '<span class="pin__point pin__point--chien-' + chien + '"><svg aria-hidden="true"><use href="#ico-' + c.icone + '"></use></svg></span>' + badge,
      iconSize: [42, 34], iconAnchor: [13, 17]
    });
  }

  function infobulle(l, passages) {
    var bits = [cat(l.categorie).libelle];
    var px = prixAffiche(l);
    if (px) bits.push(px);
    if (l.altitude) bits.push(l.altitude + ' m');
    bits.push(STATUTS_CHIEN[statutChien(l)].libelle);
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
      var m = L.marker(l.gps, { icon: icone(cat(l.categorie), aVerifier(l), pe, statutChien(l)), title: l.nom, riseOnHover: true });
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
    var legChien = el('div', 'trace-legende');
    Object.keys(STATUTS_CHIEN).forEach(function (k) {
      var s = el('span');
      s.appendChild(el('i', 'chien-pastille pin__point--chien-' + k));
      s.appendChild(document.createTextNode(STATUTS_CHIEN[k].libelle));
      legChien.appendChild(s);
    });
    zone.appendChild(legChien);
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
      /* La couleur des repères dit l'accueil du chien : le filtre montre donc l'icône
         de la catégorie, pas une pastille de couleur qui ne correspondrait plus. */
      var p = el('span', 'filtre__pastille');
      p.appendChild(svg(c.icone));
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

    /* Échanges e-mail avec l'exploitant (by-chatgpt/mails) */
    if (Array.isArray(l.echanges) && l.echanges.length) {
      var de = el('div', 'echanges');
      l.echanges.forEach(function (x) {
        var pe = el('p', 'echange echange--' + (x.etat || '').replace(/[^a-z]+/gi, '-'));
        pe.appendChild(el('strong', null, (x.etat || 'échange') + ' · ' + dateCourte(x.date) + ' — '));
        pe.appendChild(document.createTextNode(x.resume || ''));
        de.appendChild(pe);
      });
      corps.appendChild(bloc('Échanges avec l’établissement', de));
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
        ['Vertige', l.vertige ? l.vertige.niveau + ' — ' + l.vertige.passages : null],
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
      if (v.doutes) dv.appendChild(el('p', null, 'Non publié à ce jour : ' + v.doutes));
      if (Array.isArray(v.a_demander) && v.a_demander.length) {
        var dq = el('div', 'a-demander');
        dq.appendChild(el('p', 'jour__note', 'À demander avant de partir :'));
        v.a_demander.forEach(function (q) {
          var ligne = el('p', null, q.question + ' ');
          if (q.page) { var a = el('a', null, 'Contacter'); a.href = q.page; a.target = '_blank'; a.rel = 'noopener noreferrer'; ligne.appendChild(a); }
          dq.appendChild(ligne);
        });
        dv.appendChild(dq);
      }
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
    /* Le planning peut restreindre les zones de randonnée d'un jour : « zones_randos » : [ids]. */
    if (Array.isArray(j.zones_randos)) groupes = groupes.filter(function (g) { return j.zones_randos.indexOf(g.id) !== -1; });
    return groupes;
  }

  function texteMetrique(val, suffixe) {
    if (val === null || val === undefined || val === '') return null;
    return String(val).replace('.', ',') + (suffixe || '');
  }

  /* Valeur quelconque des fichiers de données → texte lisible sur une ligne.
     Objets : « clé : valeur » ; listes : éléments séparés par « · ». */
  function texteListe(v) {
    if (v == null || v === '' || v === false) return null;
    if (v === true) return 'oui';
    if (typeof v !== 'object') return String(v);
    if (Array.isArray(v)) {
      var t = v.map(function (x) {
        if (x && typeof x === 'object' && !Array.isArray(x) && (x.nom || x.libelle)) {
          var reste = {};
          Object.keys(x).forEach(function (k) { if (k !== 'nom' && k !== 'libelle' && k !== 'gps' && k !== 'url') reste[k] = x[k]; });
          var r = texteListe(x.valeur !== undefined ? x.valeur : reste);
          return (x.nom || x.libelle) + (r ? ' (' + r + ')' : '');
        }
        return texteListe(x);
      }).filter(Boolean).join(' · ');
      return t || null;
    }
    if (v.traduction) return v.traduction + (v.officiel ? ' — ' + v.officiel : '');
    var parts = Object.keys(v).filter(function (k) { return ['gps', 'url', 'admis', 'source', 'sources'].indexOf(k) === -1; }).map(function (k) {
      var t = texteListe(v[k]);
      return t ? k.replace(/_/g, ' ') + ' : ' + t : null;
    }).filter(Boolean);
    return parts.length ? parts.join(' ; ') : null;
  }

  function niveauCourt(n) {
    if (!n) return null;
    return typeof n === 'object' ? (n.traduction || n.officiel || null) : n;
  }

  function randoResume(r) {
    return [
      texteMetrique(r.distance_km, ' km'),
      r.distance_max_km ? ('jusqu\'à ' + texteMetrique(r.distance_max_km, ' km')) : null,
      r.duree,
      r.denivele_plus_m !== null && r.denivele_plus_m !== undefined ? ('D+ ' + r.denivele_plus_m + ' m') : null,
      niveauCourt(r.niveau)
    ].filter(Boolean).join(' · ');
  }

  var VERTIGE = {
    'aucun': { texte: 'Vertige : aucun', cls: 'badge--gratuit' },
    'léger': { texte: 'Vertige : léger', cls: 'badge--alerte' },
    'fort': { texte: 'Déconseillé (vertige)', cls: 'badge--danger' }
  };

  function badgeVertige(v) {
    if (!v || !VERTIGE[v.niveau]) return null;
    var b = el('span', 'badge badge--vertige ' + VERTIGE[v.niveau].cls, VERTIGE[v.niveau].texte);
    if (v.passages) b.title = v.passages;
    return b;
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

      /* Vertige « fort » : repliées à part, marquées déconseillées. */
      var fortes = null;
      (g.randos || []).forEach(function (r) {
        var d = el('details', 'rando-card' + (r.vertige && r.vertige.niveau === 'fort' ? ' rando-card--deconseillee' : ''));
        var sm = document.createElement('summary');
        sm.appendChild(el('span', 'rando-card__nom', r.nom));
        var resume = randoResume(r);
        if (resume) sm.appendChild(el('span', 'rando-card__meta', resume));
        var bv = badgeVertige(r.vertige);
        if (bv) sm.appendChild(bv);
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
          ['Niveau', texteListe(r.niveau)],
          ['Type', r.type],
          ['Départ', r.depart],
          ['Arrivée', r.arrivee],
          ['Retour au départ', r.retour_au_depart || r.retour_depart || r.retour],
          ['Risque', r.risque],
          ['Vertige', r.vertige ? r.vertige.niveau + ' — ' + r.vertige.passages : null],
          ['Altitude min', r.altitude_min_m ? r.altitude_min_m + ' m' : null],
          ['Balisage', texteListe(r.balisage)],
          ['Parking', texteListe(r.parking)],
          ['Accès', texteListe(r.acces_transport)],
          ['Chien', r.chien ? (r.chien.admis === false ? 'NON ADMIS — ' : 'admis — ') + (texteListe(r.chien) || '') : null],
          ['Eau', texteListe(r.eau)],
          ['Ravitaillement en octobre', texteListe(r.ravitaillement_octobre)],
          ['État en octobre', texteListe(r.statut_octobre)],
          ['Meilleur moment', r.meilleur_moment],
          ['Points forts', texteListe(r.points_forts)],
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

        var lr = el('div', 'puces');
        if (Array.isArray(r.depart_gps)) lr.appendChild(lienExterne('Départ sur Google Maps', 'https://www.google.com/maps/search/?api=1&query=' + r.depart_gps[0] + ',' + r.depart_gps[1]));
        if (r.carte_url) lr.appendChild(lienExterne('Carte et tracé', r.carte_url));
        if (r.gpx_url) lr.appendChild(lienExterne('Fichier GPX', r.gpx_url));
        (r.sources || []).forEach(function (x) { if (x && x.url && x.url !== r.source) lr.appendChild(lienExterne(x.libelle || 'Source', x.url)); });
        if (lr.childNodes.length) d.appendChild(lr);
        if (texteListe(r.doutes)) d.appendChild(el('p', 'jour__note', 'Non publié : ' + texteListe(r.doutes)));

        if (r.source) {
          var src = el('a', 'rando-source', 'Source de l’itinéraire');
          src.href = r.source;
          src.target = '_blank';
          src.rel = 'noopener noreferrer';
          d.appendChild(src);
        }
        if (r.vertige && r.vertige.niveau === 'fort') {
          if (!fortes) {
            fortes = el('details', 'volet volet--interne rando-fortes');
            fortes.appendChild(el('summary', null, 'Déconseillées (vertige)'));
          }
          fortes.appendChild(d);
        } else zg.appendChild(d);
      });
      if (fortes) {
        fortes.querySelector('summary').textContent = 'Déconseillées (vertige) : ' + (fortes.childNodes.length - 1);
        zg.appendChild(fortes);
      }
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
        var dispo = (x.saison || x.horaires) && /^à vérifier/i.test(x.disponibilite || '') ? texteListe(x.saison) : x.disponibilite;
        if (dispo) sm.appendChild(el('span', 'decouverte-card__dispo', dispo));
        d.appendChild(sm);

        if (x.resume) d.appendChild(el('p', 'decouverte-card__resume', x.resume));
        var grille = el('dl', 'decouverte-grid');
        [
          ['Disponibilité', (x.saison || x.horaires) && /^à vérifier/i.test(x.disponibilite || '') ? null : x.disponibilite],
          ['Saison', texteListe(x.saison)],
          ['Horaires', texteListe(x.horaires)],
          ['Prix', texteListe(x.prix)],
          ['Chien', x.chien && typeof x.chien === 'object' ? [x.chien.admis === false ? 'non admis' : 'admis', x.chien.conditions].filter(Boolean).join(' · ') : x.chien],
          ['Durée', x.duree],
          ['Réservation', x.reservation && typeof x.reservation === 'object' ? (x.reservation.obligatoire ? 'obligatoire' : 'non obligatoire') : x.reservation],
          ['Adresse', x.adresse],
          ['Accès et parking', x.acces],
          ['Avec un chien en octobre', x.interet]
        ].forEach(function (p) {
          if (!p[1]) return;
          grille.appendChild(el('dt', null, p[0]));
          grille.appendChild(el('dd', null, String(p[1])));
        });
        if (grille.children.length) d.appendChild(grille);

        var lx = el('div', 'puces');
        if (Array.isArray(x.gps)) lx.appendChild(lienExterne('Google Maps', 'https://www.google.com/maps/search/?api=1&query=' + x.gps[0] + ',' + x.gps[1]));
        if (x.site) lx.appendChild(lienExterne('Site officiel', x.site));
        if (x.page_contact) lx.appendChild(lienExterne('Contact', x.page_contact));
        if (x.reservation && x.reservation.url) lx.appendChild(lienExterne('Réserver', x.reservation.url));
        if (lx.childNodes.length) d.appendChild(lx);
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
    var lieux = lieuxDuJour(j);
    /* Jour sans visite ni nuit (retour) : les lieux du trajet, à commencer par la base qu'on quitte. */
    if (!lieux.some(function (l) { return (l.photos || []).length; })) {
      var r = routeDuJour(j);
      if (r) lieux = referencesEtape(r.etape).map(function (id) { return E.parId.get(id); }).filter(Boolean);
    }
    lieux.forEach(function (l) {
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
    var bandeau = document.getElementById('bandeau-route');
    if (!bandeau) return;
    vide(bandeau);
    var t = (E.pratique || {}).bandeau_etapes;
    bandeau.hidden = !t;
    if (t) bandeau.appendChild(document.createTextNode(t));
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

  var ONGLETS_ETAPE = [
    { id: 'programme', libelle: 'Programme' },
    { id: 'meteo', libelle: 'Météo' },
    { id: 'route', libelle: 'Route' },
    { id: 'courses', libelle: 'Courses' },
    { id: 'contact', libelle: 'Contacter' },
    { id: 'budget', libelle: 'Budget' },
    { id: 'savoir', libelle: 'À savoir' },
    { id: 'explorer', libelle: 'À explorer' },
    { id: 'photos', libelle: 'Photos' }
  ];
  var CLE_ONGLET = 'dolomites.onglet';

  /* Barre résumé, barre d'onglets collante, puis un seul panneau visible à la fois. */
  function montrerOnglets(j, corps, P) {
    var dr = derouleJour(j);
    var n = j.nuit ? E.parId.get(j.nuit) : null;
    var b = calculerBudget();
    var budgetJour = b ? b.lignes.filter(function (x) { return x.jour === j.jour; }).reduce(function (a, x) { return a + x.montant; }, 0) : 0;
    var res = el('div', 'etape-resume');
    [
      dr ? ['Volant', dureeAffiche(dr.volant / 60)] : null,
      dr && dr.place ? ['Sur place', dureeAffiche(dr.place / 60)] : null,
      dr && dr.fin ? ['Fin', dr.fin, dr.alerte] : null,
      dr && dr.coucher ? ['Coucher du soleil', dr.coucher] : null,
      n ? ['Nuit', n.nom.split(' — ')[0]] : ['Nuit', 'retour'],
      budgetJour ? ['Budget', euros(budgetJour)] : null
    ].filter(Boolean).forEach(function (x) {
      var c = el('div', 'etape-resume__case' + (x[2] ? ' etape-resume__case--alerte' : ''));
      c.appendChild(el('span', 'etape-resume__lib', x[0]));
      c.appendChild(el('span', 'etape-resume__val', x[1]));
      res.appendChild(c);
    });
    var barre = el('div', 'onglets');
    barre.setAttribute('role', 'tablist');
    var dispo = ONGLETS_ETAPE.filter(function (o) { return P[o.id].childNodes.length; });
    var voulu = null;
    try { voulu = sessionStorage.getItem(CLE_ONGLET); } catch (e) { /* stockage indisponible */ }
    if (!dispo.some(function (o) { return o.id === voulu; })) voulu = 'programme';
    var zone = el('div', 'onglets-zone');
    function choisir(id) {
      Array.prototype.forEach.call(barre.children, function (bt) { bt.setAttribute('aria-selected', String(bt.dataset.onglet === id)); });
      Array.prototype.forEach.call(zone.children, function (pn) { pn.hidden = pn.dataset.onglet !== id; });
      try { sessionStorage.setItem(CLE_ONGLET, id); } catch (e) { /* ignore */ }
    }
    dispo.forEach(function (o) {
      var bt = el('button', 'onglet', o.libelle + (o.id === 'photos' ? ' (' + P.photos.querySelectorAll('figure').length + ')' : ''));
      bt.type = 'button';
      bt.setAttribute('role', 'tab');
      bt.dataset.onglet = o.id;
      bt.addEventListener('click', function () { choisir(o.id); corps.scrollTop = Math.min(corps.scrollTop, res.offsetTop); });
      barre.appendChild(bt);
      zone.appendChild(P[o.id]);
    });
    corps.appendChild(res);
    corps.appendChild(barre);
    corps.appendChild(zone);
    choisir(voulu);
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
      var galerieEtape = g;
    }

    /* Onglets : l'essentiel d'abord, le reste rangé. */
    var P = {};
    ONGLETS_ETAPE.forEach(function (o) { P[o.id] = el('div', 'onglet-panneau'); P[o.id].dataset.onglet = o.id; });
    var principal = P.programme, cote = P.route;   // compatibilité des blocs existants
    if (j.note) P.programme.appendChild(el('p', 'modale__desc', j.note));

    dessinerMeteoEtape(j, P.meteo);
    dessinerBudgetEtape(j, P.budget);

    /* Route */
    var r = routeDuJour(j);
    if (r) {
      var tr = el('button', 'jour__trajet');
      tr.type = 'button';
      tr.style.setProperty('--trace', r.meta.couleur);
      tr.appendChild(el('span', 'jour__trajet-num', 'E' + r.ordre));
      var tc = el('span', 'jour__trajet-corps');
      tc.appendChild(el('span', 'jour__trajet-parcours', referencesEtape(r.etape).map(nomRef).join(' → ')));
      var avecPeages = r.etape.autoroute ? null : r.etape.avec_peages;
      tc.appendChild(el('span', 'jour__trajet-meta',
        [r.meta.libelle, r.km ? r.km + ' km' : '',
          r.h ? dureeAffiche(r.h) + (r.etape.autoroute ? ' de volant par l’autoroute, péages compris au budget' : (avecPeages ? ' sans péage' : '')) : '',
          avecPeages ? dureeAffiche(avecPeages.duree_h) + ' par l’autoroute' : '', 'voir sur la carte'].filter(Boolean).join(' · ')));
      var hors = visitesHorsRoute(r.etape);
      if (hors.length) tc.appendChild(el('span', 'jour__trajet-detour', 'Hors route voiture : ' + hors.map(nomRef).join(', ')));
      tr.appendChild(tc);
      tr.addEventListener('click', function () {
        fermerPanneau();
        focusEtape(r.etape);
        document.getElementById('section-carte').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      P.route.appendChild(bloc('Route', tr));
    }

    /* Programme : chaque visite ouvre sa fiche complète. */
    if ((j.activites || []).length) {
      var ul = el('div', 'programme');
      var dr = derouleJour(j);
      if (j.depart) ul.appendChild(el('p', 'programme__route', j.depart + ' · départ' + (j.depart_de ? ' de ' + nomRef(j.depart_de) : '')));
      j.activites.forEach(function (a) {
        var l = resoudre(a.lieu);
        if (a.trajet_min) ul.appendChild(el('p', 'programme__route', 'Route : ' + dureeAffiche(a.trajet_min / 60)));
        var b = el('button', 'programme__item');
        b.type = 'button';
        var fin = a.heure && a.duree_min ? ajouterMinutes(a.heure, a.duree_min) : null;
        b.appendChild(el('span', 'jour__heure', (a.heure || '—') + (fin ? '\n' + fin : '')));
        var txt = el('span', 'programme__corps');
        txt.appendChild(el('span', 'jour__lieu', (l ? l.nom : a.lieu) + (l && aVerifier(l) ? ' ⚠' : '')));
        var px = l ? prixAffiche(l) : null;
        if (px) txt.appendChild(el('span', 'programme__prix', px));
        if (a.duree_min) txt.appendChild(el('span', 'programme__duree', 'Sur place : ' + dureeAffiche(a.duree_min / 60) + (a.duree_confort_min && a.duree_confort_min !== a.duree_min ? ' (confortable : ' + dureeAffiche(a.duree_confort_min / 60) + ')' : '')));
        if (a.note) txt.appendChild(el('span', 'jour__note', a.note));
        b.appendChild(txt);
        b.addEventListener('click', function () { if (l) ouvrirPanneau(l.id, { retour: j.jour }); });
        ul.appendChild(b);
      });
      if (j.trajet_nuit_min) ul.appendChild(el('p', 'programme__route', 'Route vers la nuit : ' + dureeAffiche(j.trajet_nuit_min / 60) + (j.arrivee_nuit ? ' · arrivée ' + j.arrivee_nuit : '')));
      P.programme.appendChild(bloc('Programme', ul));
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
      var ech = Array.isArray(n.echanges) && n.echanges[n.echanges.length - 1];
      if (ech) tn.appendChild(el('span', 'echange-court', 'E-mail : ' + ech.etat + ' (' + dateCourte(ech.date) + ')'));
      bn.appendChild(tn);
      bn.addEventListener('click', function () { ouvrirPanneau(n.id, { retour: j.jour }); });
      dn.appendChild(bn);
      var gh = groupeDe(pr.groupes_hebergement, n.id);
      var autres = gh ? gh.lieux.filter(function (id) { return id !== n.id && E.parId.has(id); }) : [];
      if (autres.length) {
        var repli = el('details', 'repli');
        repli.appendChild(el('summary', null, 'Si c’est plein ou fermé (' + autres.length + ')'));
        var ra = el('div', 'puces');
        autres.forEach(function (id) {
          var l = E.parId.get(id);
          var b = el('button', 'puce', l.nom);
          b.type = 'button';
          b.addEventListener('click', function () { ouvrirPanneau(id, { retour: j.jour }); });
          ra.appendChild(b);
        });
        repli.appendChild(ra);
        dn.appendChild(repli);
      }
      P.programme.appendChild(bloc('Nuit', dn));

    }

    /* Données en direct : routes, carburant, webcams. Absentes hors ligne : bloc masqué ou message. */
    dessinerRoutesEtape(j, P.route);
    dessinerCarburantEtape(j, P.route);
    dessinerWebcamsEtape(j, P.route);

    dessinerRavitaillementEtape(j, P.courses);
    dessinerContactsEtape(j, P.contact);

    /* Randonnées et adresses de la zone : repliées, pour ne pas noyer la journée. */
    var nbRandos = randosPourJour(j).reduce(function (s, g) { return s + (g.randos || []).length; }, 0);
    if (nbRandos) {
      var dr = el('details', 'volet volet--interne');
      dr.appendChild(el('summary', null, 'Autres randonnées dans la zone (' + nbRandos + ')'));
      dessinerRandosJour(j, dr);
      dr.open = true;
      P.explorer.appendChild(dr);
    }
    var nbDec = decouvertesPourJour(j).reduce(function (s, g) { return s + (g.items || []).length; }, 0);
    if (nbDec) {
      var dd = el('details', 'volet volet--interne');
      dd.appendChild(el('summary', null, 'À faire, remontées et bonnes adresses (' + nbDec + ')'));
      dessinerDecouvertesJour(j, dd);
      dd.open = true;
      P.explorer.appendChild(dd);
    }

    dessinerReglesEtape(j, P.savoir);
    if (galerieEtape) P.photos.appendChild(galerieEtape);

    montrerOnglets(j, corps, P);

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

  /* Plan de ravitaillement du jour (config/commun/ravitaillement.json) : conseil,
     magasins avec l'horaire du jour et l'accueil du chien, pleins conseillés, eau, laverie.
     Sans plan pour ce jour, repli sur les magasins à moins de 25 km de la nuit. */
  function ajouterMinutes(hhmm, min) {
    var p = String(hhmm).split(':');
    var t = Number(p[0]) * 60 + Number(p[1] || 0) + Math.round(min);
    return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2);
  }
  function enMinutes(hhmm) { var p = String(hhmm).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }

  /* Résumé chiffré de la journée : volant, temps sur place, heure de fin face au coucher du soleil. */
  function derouleJour(j) {
    var acts = j.activites || [];
    if (!acts.some(function (a) { return a.duree_min || a.trajet_min; })) return null;
    var volant = (j.trajet_nuit_min || 0) + acts.reduce(function (s, a) { return s + (a.trajet_min || 0); }, 0);
    var place = acts.reduce(function (s, a) { return s + (a.duree_min || 0); }, 0);
    var fin = j.arrivee_nuit || null;
    if (!fin) { var der = acts[acts.length - 1]; if (der && der.heure && der.duree_min) fin = ajouterMinutes(der.heure, der.duree_min); }
    var n = j.nuit ? E.parId.get(j.nuit) : null;
    var sol = n && Array.isArray(n.gps) && j.date ? soleil(n.gps[0], n.gps[1], j.date) : null;
    var coucher = sol ? heureLocale(sol.coucher) : null;
    var txt = 'Volant ' + dureeAffiche(volant / 60) + ' · sur place ' + dureeAffiche(place / 60) + (fin ? ' · fin vers ' + fin : '') + (coucher ? ' · coucher du soleil ' + coucher : '');
    var alerte = fin && coucher && enMinutes(fin) > enMinutes(coucher);
    var r = el('p', 'programme__resume' + (alerte ? ' programme__resume--alerte' : ''), txt + (alerte ? ' — fin après la nuit tombée' : ''));
    return { resume: r, volant: volant, place: place, fin: fin, coucher: coucher, alerte: alerte };
  }

  /* ---------- Onglet Contacter : qui, par quel moyen, quel message ---------- */

  var MOIS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var MOIS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function dateLangue(iso, langue) {
    var d = new Date(iso + 'T12:00:00'), j = d.getDate(), m = d.getMonth();
    if (langue === 'de') return j + '. ' + MOIS_DE[m];
    if (langue === 'it') return j + ' ' + MOIS_IT[m];
    return j + ' ' + MOIS_FR[m];
  }
  function lendemain(iso) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }

  /* Haut-Adige (germanophone et italophone) : message en allemand et en italien ; ailleurs en Italie : italien. */
  function languesDe(l) {
    var m = E.messages || {};
    if (Array.isArray(l.langues)) return l.langues;
    var prov = /\(([A-Z]{2})\)/.exec(l.commune || '');
    if (prov && m.langues_par_province && m.langues_par_province[prov[1]]) return m.langues_par_province[prov[1]];
    return m.langue_par_defaut || ['it'];
  }

  /* Messages de contact : modèles de config/commun/messages.json, remplis avec le profil des voyageurs. */
  function remplirMessage(type, langue, c) {
    var m = E.messages || {}, v = E.voyageurs || {};
    var modele = ((m[type] || {})[langue]) || '';
    var mots = (m.mots_nuit || {})[langue] || ['', ''];
    var vars = {
      arrivee: dateLangue(c.arrivee, langue), depart: dateLangue(c.depart, langue), nuits: c.nuits,
      nuits_mot: c.nuits > 1 ? mots[1] : mots[0], heure: c.heure || '17:00', adultes: v.adultes || 2,
      poids: (v.chien && v.chien.poids) || '', hauteur: String((E.vehicule && E.vehicule.hauteur_tente_fermee_m) || '').replace('.', ',')
    };
    return modele.replace(/\{(\w+)\}/g, function (x, k) { return vars[k] !== undefined ? vars[k] : x; });
  }
  function messageSejour(langue, c) { return remplirMessage('sejour', langue, c); }
  function messageDeplacement(langue, c) { return remplirMessage('deplacement', langue, c); }

  function blocMessage(titre, texte, traduction) {
    var d = el('details', 'message');
    d.appendChild(el('summary', null, titre));
    var pre = el('pre', 'message__texte', texte);
    d.appendChild(pre);
    var bt = el('button', 'action', 'Copier le message');
    bt.type = 'button';
    bt.addEventListener('click', function () {
      var ok = function () { bt.textContent = 'Copié'; setTimeout(function () { bt.textContent = 'Copier le message'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(texte).then(ok, function () {});
    });
    d.appendChild(bt);
    if (traduction) { d.appendChild(el('p', 'jour__note', 'En français :')); d.appendChild(el('pre', 'message__texte message__texte--trad', traduction)); }
    return d;
  }

  function moyensContact(l) {
    var out = [], vus = {};
    function ajoute(lib, url) { if (url && !vus[url]) { vus[url] = 1; out.push([lib, url]); } }
    (l.liens || []).forEach(function (x) {
      var t = (x.libelle + ' ' + x.url).toLowerCase();
      if (/contact|kontakt|anfrage|request|richiesta|demande/.test(t) && !/campercontact|park4night|pitchup|campspace/.test(t)) ajoute('Page de contact', x.url);
    });
    if (l.page_contact) ajoute('Page de contact', l.page_contact);
    if (l.reserver && l.reserver.url) ajoute(l.reserver.obligatoire ? 'Réservation (obligatoire)' : 'Réservation en ligne', l.reserver.url);
    return out;
  }

  function carteContact(l, c) {
    var d = el('div', 'contact');
    d.appendChild(el('p', 'contact__nom', l.nom));
    if (c.pourquoi) d.appendChild(el('p', 'jour__note', c.pourquoi));
    var ech = Array.isArray(l.echanges) && l.echanges[l.echanges.length - 1];
    if (ech) d.appendChild(el('p', 'echange echange--' + (ech.etat || '').replace(/[^a-z]+/gi, '-'), 'Dernier échange (' + dateCourte(ech.date) + ', ' + ech.etat + ') : ' + ech.resume));
    var m = moyensContact(l);
    if (m.length) {
      var pm = el('div', 'puces');
      m.forEach(function (x) { pm.appendChild(lienExterne(x[0], x[1])); });
      d.appendChild(pm);
    } else {
      d.appendChild(el('p', 'jour__note', 'Aucun moyen de contact en ligne connu : se présenter sur place.'));
    }
    if (c.nuits) {
      var langues = languesDe(l);
      var fr = messageSejour('fr', c);
      var nomLg = function (lg) { return lg === 'de' ? 'allemand' : lg === 'it' ? 'italien' : 'français'; };
      langues.forEach(function (lg, k) {
        d.appendChild(blocMessage('Demander une place ou réserver — ' + nomLg(lg), messageSejour(lg, c), lg === 'fr' || k ? null : fr));
      });
      if (ech && /réservation/.test(ech.etat || '')) {
        var frDep = messageDeplacement('fr', c);
        langues.filter(function (lg) { return lg !== 'fr'; }).forEach(function (lg, k) {
          d.appendChild(blocMessage('Déplacer ou annuler la réservation — ' + nomLg(lg), messageDeplacement(lg, c), k ? null : frDep));
        });
      }
    }
    var q = (l.verification && l.verification.a_demander) || [];
    if (q.length) {
      var dq = el('details', 'message');
      dq.appendChild(el('summary', null, 'Questions encore sans réponse (' + q.length + ')'));
      q.forEach(function (x) { dq.appendChild(el('p', null, '• ' + x.question)); });
      d.appendChild(dq);
    }
    return d;
  }

  function dessinerContactsEtape(j, conteneur) {
    var cartes = [];
    if (j.nuit) {
      var n = E.parId.get(j.nuit);
      var plan = E.planning || [];
      var i = plan.indexOf(j), debut = i;
      while (debut > 0 && plan[debut - 1].nuit === j.nuit) debut--;
      var fin = i;
      while (fin + 1 < plan.length && plan[fin + 1].nuit === j.nuit) fin++;
      if (n && debut === i) {
        cartes.push(carteContact(n, {
          arrivee: j.date, depart: lendemain(plan[fin].date), nuits: fin - debut + 1, heure: j.arrivee_nuit,
          pourquoi: 'Nuit' + (fin > debut ? 's du jour ' + plan[debut].jour + ' au jour ' + plan[fin].jour : ' de ce jour') + ' : ' + (fin - debut + 1) + ' nuit' + (fin > debut ? 's' : '') + ', arrivée prévue vers ' + (j.arrivee_nuit || '?') + '.'
        }));
      } else if (n) {
        conteneur.appendChild(el('p', 'jour__note', 'Nuit à ' + n.nom + ' : contact et messages au jour ' + plan[debut].jour + ', jour d’arrivée.'));
      }
    }
    (j.activites || []).forEach(function (a) {
      var l = E.parId.get(a.lieu);
      if (l && l.reserver && l.reserver.obligatoire && l.categorie !== 'camping') {
        cartes.push(carteContact(l, { pourquoi: 'Réservation obligatoire pour ce jour. ' + ((l.pratique || []).filter(function (x) { return /réserv/i.test(x.libelle + x.valeur); }).map(function (x) { return x.valeur; })[0] || '') }));
      }
    });
    cartes.forEach(function (c) { conteneur.appendChild(c); });
  }

  function dessinerRavitaillementEtape(j, conteneur) {
    var plan = E.ravitaillement && E.ravitaillement.jours && E.ravitaillement.jours[String(j.jour)];
    var d = el('div', 'ravito');
    function bouton(ref) {
      var l = E.parId.get(ref.lieu);
      if (!l) return null;
      var b = el('button', 'programme__item');
      b.type = 'button';
      var t = el('span', 'programme__corps');
      var chien = l.chien && l.chien.admis === true ? ' · chien admis' : (l.chien && l.chien.admis === false ? ' · sans chien' : '');
      t.appendChild(el('span', 'jour__lieu', l.nom));
      t.appendChild(el('span', 'programme__prix', (ref.note || l.resume || '') + chien));
      b.appendChild(t);
      b.addEventListener('click', function () { ouvrirPanneau(l.id, { retour: j.jour }); });
      return b;
    }
    if (plan) {
      if (plan.conseil) d.appendChild(el('p', null, plan.conseil));
      var mg = (plan.magasins || []).map(bouton).filter(Boolean);
      if (mg.length) { d.appendChild(el('p', 'regle-etape__titre', 'Magasins')); mg.forEach(function (b) { d.appendChild(b); }); }
      var stt = (plan.stations || []).map(bouton).filter(Boolean);
      if (stt.length) { d.appendChild(el('p', 'regle-etape__titre', 'Pleins conseillés')); stt.forEach(function (b) { d.appendChild(b); }); }
      var autres = [];
      (plan.eau || []).forEach(function (x) { autres.push({ libelle: 'Eau potable', valeur: [x.nom, x.adresse, x.note].filter(Boolean).join(' · ') }); });
      (plan.laverie || []).forEach(function (x) { autres.push({ libelle: 'Laverie', valeur: [x.nom, x.adresse, texteListe(x.horaires), x.prix, x.note].filter(Boolean).join(' · ') }); });
      if (plan.douche) autres.push({ libelle: 'Douche', valeur: plan.douche });
      if (autres.length) d.appendChild(tableauCle(autres));
    } else if (j.nuit) {
      var n = resoudre(j.nuit);
      (E.lieux || []).filter(function (l) { return l.categorie === 'supermarche' && distanceKm(l.gps, n.gps) < 25; }).forEach(function (l) {
        var b = bouton({ lieu: l.id }); if (b) d.appendChild(b);
      });
    }
    if (d.childNodes.length) conteneur.appendChild(bloc('Ravitaillement', d));
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
    if (haut && haut !== nuit && (!nuit || (haut.altitude || 0) > (nuit.altitude || 0) + 300)) {
      pts.push({ lieu: haut, role: 'Point haut' });
    } else if (nuit) {
      /* Altitude inconnue : le lieu visité le plus éloigné de la nuit (> 10 km) a sa propre météo ;
         Open-Meteo prend alors l'altitude de son modèle de terrain. */
      var visites = (j.activites || []).map(function (a) { return E.parId.get(a.lieu); })
        .filter(function (l) { return l && Array.isArray(l.gps) && l.categorie !== 'supermarche' && l.categorie !== 'carburant'; });
      var loin = visites.sort(function (a, b) { return distanceKm(b.gps, nuit.gps) - distanceKm(a.gps, nuit.gps); })[0];
      if (loin && distanceKm(loin.gps, nuit.gps) > 10) pts.push({ lieu: loin, role: 'Lieu visité' });
    }
    if (!pts.length && lieux.length) pts.push({ lieu: lieux[0], role: 'Étape' });
    return pts;
  }

  function dansZone(l, z) {
    return !!(z && l && Array.isArray(l.gps) && l.gps[0] >= z.lat_min && l.gps[0] <= z.lat_max && l.gps[1] >= z.lng_min && l.gps[1] <= z.lng_max);
  }

  function prevision(l, date) {
    /* Open-Meteo ne prévoit qu'à 16 jours : au-delà, ne pas appeler (réponse 400). */
    var ecart = (new Date(date + 'T12:00:00') - Date.now()) / 86400000;
    if (ecart > 15.5 || ecart < -1) return Promise.reject(new Error('hors fenêtre'));
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
    var pointHaut = pts.slice().sort(function (a, b) { return (b.lieu.altitude || 0) - (a.lieu.altitude || 0); })[0];
    pts.forEach(function (pt) {
      var ligne = el('div', 'meteo-etape__point');
      ligne.appendChild(el('p', 'meteo-etape__lieu', pt.role + ' · ' + pt.lieu.nom + (pt.lieu.altitude ? ' (' + pt.lieu.altitude + ' m)' : '')));
      var val = el('p', 'meteo-etape__val', 'Prévision en cours de chargement…');
      ligne.appendChild(val);
      d.appendChild(ligne);
      var nm = el('p', 'jour__note');
      ligne.appendChild(nm);
      if (j.date && window.fetch) {
        normaleApi(pt.lieu, j.date).then(function (x) {
          nm.textContent = 'Normale du ' + dateCourte(j.date).replace(/^\S+\s/, '') + ' à ' + (pt.lieu.altitude ? pt.lieu.altitude + ' m' : 'ce point') + ' : ' +
            Math.round(x.min) + ' / ' + Math.round(x.max) + ' °C, moyenne ' + x.de + '–' + x.a + ' de l’archive Open-Meteo (' + x.ans + ' ans).';
        }).catch(function () { ligne.removeChild(nm); });
      }
      var sol = j.date ? soleil(pt.lieu.gps[0], pt.lieu.gps[1], j.date) : null;
      if (sol) {
        var jourMin = Math.round((sol.coucher - sol.lever) / 60000);
        ligne.appendChild(el('p', 'meteo-etape__soleil', 'Soleil : lever ' + heureLocale(sol.lever) + ' · coucher ' + heureLocale(sol.coucher) +
          ' · ' + Math.floor(jourMin / 60) + ' h ' + String(jourMin % 60).padStart(2, '0') + ' de jour'));
      }
      var courbesIci = el('div');
      ligne.appendChild(courbesIci);
      dessinerCourbesMeteo(pt, pt === pointHaut, courbesIci);
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
    d.appendChild(el('p', 'jour__note', 'Prévision Open-Meteo à l’altitude du lieu, actualisée à chaque ouverture ; fiable à 3–5 jours seulement. Lever et coucher du soleil calculés sur la page, à l’horizon dégagé : au fond d’une vallée, le soleil passe derrière les sommets plus tôt.'));
    var enDolomites = pts.some(function (pt) { return dansZone(pt.lieu, (m.normales_reference || {}).zone); });
    if (enDolomites) {
      if (pts.some(function (pt) { return (pt.lieu.altitude || 0) >= 1800; }) && m.note_altitude) d.appendChild(el('p', 'jour__note', m.note_altitude));
      var liens = el('div', 'puces');
      (m.sources || []).forEach(function (s) { if (s && s.url) liens.appendChild(lienExterne(s.libelle, s.url)); });
      if (liens.childNodes.length) d.appendChild(liens);
    }
    conteneur.appendChild(bloc('Météo du jour', d));
  }

  /* ---------- Courbes des 15 derniers jours : SVG en ligne, sans bibliothèque ---------- */

  var NS_SVG = 'http://www.w3.org/2000/svg';
  var JOURS_HISTO = 15;

  function isoDecale(iso, n) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* Du jour J-15 à aujourd'hui, recalculé à chaque ouverture. */
  function fenetreHisto() {
    var auj = aujourdhuiIso(), out = [];
    for (var i = -JOURS_HISTO; i <= 0; i++) out.push(isoDecale(auj, i));
    return out;
  }

  function jjmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  function noeudSvg(tag, attrs, parent) {
    var n = document.createElementNS(NS_SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function pasRond(brut) {
    var p = Math.pow(10, Math.floor(Math.log10(brut)));
    var f = brut / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function moyenne(l) {
    var v = l.filter(function (x) { return typeof x === 'number'; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }

  /* o : { titre, dates, series: [{ nom, couleur: 1|2, type: 'ligne'|'barres'|'aire', valeurs }], format, zero }.
     Un jour sans valeur reste vide : ni interpolation, ni zéro inventé. */
  function courbe(o) {
    var fig = el('figure', 'courbe');
    fig.appendChild(el('figcaption', 'courbe__titre', o.titre));
    if (o.series.length > 1) {
      var leg = el('div', 'courbe__legende');
      o.series.forEach(function (s) {
        var it = el('span', 'courbe__cle');
        it.appendChild(el('span', 'courbe__marque courbe__marque--' + (s.type === 'barres' ? 'barre' : 'ligne') + ' courbe__serie-' + s.couleur));
        it.appendChild(document.createTextNode(s.nom));
        leg.appendChild(it);
      });
      fig.appendChild(leg);
    }
    var zone = el('div', 'courbe__zone');
    var bulle = el('div', 'courbe__bulle');
    bulle.hidden = true;
    fig.appendChild(zone);

    var n = o.dates.length;
    var auj = aujourdhuiIso();
    var tout = [];
    o.series.forEach(function (s) { s.valeurs.forEach(function (v) { if (typeof v === 'number') tout.push(v); }); });
    var vmin = Math.min.apply(null, tout), vmax = Math.max.apply(null, tout);
    if (o.zero || o.series.some(function (s) { return s.type !== 'ligne'; })) vmin = Math.min(0, vmin);
    if (vmin === vmax) { vmax += 1; if (!o.zero) vmin -= 1; }
    /* Une variation minuscule ne doit pas ressembler à un effondrement : l'axe couvre au moins 5 % de la valeur. */
    var marge = Math.abs(vmax) * 0.05 - (vmax - vmin);
    if (marge > 0 && vmin > 0) { vmin = Math.max(0, vmin - marge / 2); vmax += marge / 2; }
    var pas = pasRond((vmax - vmin) / 4);
    var bas = Math.floor(vmin / pas) * pas, haut = Math.ceil(vmax / pas) * pas;
    var ticks = [];
    for (var t = bas; t <= haut + pas / 2; t += pas) ticks.push(Math.round(t * 1000) / 1000);

    var dernier = 0;
    function dessiner(largeur) {
      vide(zone);
      var H = 150, bandeX = 22;
      var libY = ticks.map(function (x) { return o.format(x, pas); });
      var gauche = 12 + Math.max.apply(null, libY.map(function (x) { return x.length; })) * 7;
      var droite = 52, hautM = 12;
      var lp = Math.max(60, largeur - gauche - droite);
      var bande = lp / n;
      var X = function (i) { return gauche + (i + 0.5) * bande; };
      var Y = function (v) { return hautM + (haut - v) / (haut - bas) * H; };
      var s = noeudSvg('svg', { width: largeur, height: hautM + H + bandeX, viewBox: '0 0 ' + largeur + ' ' + (hautM + H + bandeX), tabindex: '0', role: 'img', 'class': 'courbe__svg' });
      noeudSvg('title', {}, s).textContent = o.titre + ' — valeurs dans le tableau sous le graphique';
      ticks.forEach(function (v, k) {
        noeudSvg('line', { x1: gauche, x2: gauche + lp, y1: Y(v), y2: Y(v), 'class': 'courbe__grille' }, s);
        var tx = noeudSvg('text', { x: gauche - 6, y: Y(v) + 4, 'text-anchor': 'end', 'class': 'courbe__axe' }, s);
        tx.textContent = libY[k];
      });
      /* Dates : une sur k, en partant d'aujourd'hui, pour qu'aucune ne se chevauche. */
      var tous = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(lp / 46))));
      for (var i = n - 1; i >= 0; i -= tous) {
        var lx = noeudSvg('text', { x: X(i), y: hautM + H + 16, 'text-anchor': i === n - 1 ? 'end' : 'middle', 'class': 'courbe__axe' + (o.dates[i] === auj ? ' courbe__axe--jour' : '') }, s);
        if (i === n - 1) lx.setAttribute('x', X(i) + Math.min(bande / 2, 10));
        lx.textContent = o.dates[i] === auj ? 'auj.' : jjmm(o.dates[i]);
      }
      var etiquettes = [];
      var nbBarres = o.series.filter(function (x) { return x.type === 'barres'; }).length;
      o.series.forEach(function (se) {
        var cls = 'courbe__serie-' + se.couleur;
        if (se.type === 'barres') {
          var lb = Math.min(24, Math.max(2, bande - 2) / nbBarres);
          se.valeurs.forEach(function (v, i) {
            if (typeof v !== 'number' || v <= 0) return;
            var x0 = X(i) - lb / 2, y0 = Y(v), yb = Y(0), h = yb - y0;
            if (h < 0.5) return;
            var r = Math.min(4, h, lb / 2);
            noeudSvg('path', {
              d: 'M' + x0 + ' ' + yb + 'V' + (y0 + r) + 'Q' + x0 + ' ' + y0 + ' ' + (x0 + r) + ' ' + y0 + 'H' + (x0 + lb - r) +
                'Q' + (x0 + lb) + ' ' + y0 + ' ' + (x0 + lb) + ' ' + (y0 + r) + 'V' + yb + 'Z',
              'class': 'courbe__barre ' + cls + (o.dates[i] === auj ? '' : ' courbe__passe')
            }, s);
          });
          return;
        }
        var d = '', aire = '', debut = -1;
        se.valeurs.forEach(function (v, i) {
          var ok = typeof v === 'number';
          if (ok) {
            d += (debut < 0 ? 'M' : 'L') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
            if (debut < 0) debut = i;
          }
          if ((!ok || i === n - 1) && debut >= 0) {
            var fin = ok ? i : i - 1;
            if (se.type === 'aire') {
              aire += 'M' + X(debut) + ' ' + Y(0);
              for (var k = debut; k <= fin; k++) aire += 'L' + X(k) + ' ' + Y(se.valeurs[k]);
              aire += 'L' + X(fin) + ' ' + Y(0) + 'Z';
            }
            /* Point isolé : un segment de longueur nulle ne se voit pas, on pose un point. */
            if (fin === debut) noeudSvg('circle', { cx: X(debut), cy: Y(se.valeurs[debut]), r: 3, 'class': 'courbe__point ' + cls }, s);
            debut = -1;
          }
        });
        if (aire) noeudSvg('path', { d: aire, 'class': 'courbe__aire ' + cls }, s);
        if (d) noeudSvg('path', { d: d, 'class': 'courbe__ligne ' + cls }, s);
        for (var dern = n - 1; dern >= 0 && typeof se.valeurs[dern] !== 'number'; dern--);
        if (dern >= 0) etiquettes.push({ i: dern, v: se.valeurs[dern], cls: cls });
      });
      /* Valeur du jour mise en évidence : point cerclé et valeur écrite à droite. */
      var poses = [];
      etiquettes.forEach(function (e) {
        noeudSvg('circle', { cx: X(e.i), cy: Y(e.v), r: 4.5, 'class': 'courbe__fin ' + e.cls }, s);
        var y = Y(e.v) + 4;
        if (poses.some(function (p) { return Math.abs(p - y) < 13; })) return;   // proches : la bulle et le tableau suffisent
        poses.push(y);
        var tx = noeudSvg('text', { x: X(e.i) + 8, y: y, 'class': 'courbe__val' }, s);
        tx.textContent = o.format(e.v);
      });
      var barresDuJour = o.series.filter(function (x) { return x.type === 'barres'; });
      if (!etiquettes.length && barresDuJour.length) {
        var vj = barresDuJour[0].valeurs[n - 1];
        if (typeof vj === 'number') {
          var tj = noeudSvg('text', { x: X(n - 1) + 8, y: Math.min(Y(vj), Y(0) - 4), 'class': 'courbe__val' }, s);
          tj.textContent = o.format(vj);
        }
      }
      var viseur = noeudSvg('line', { y1: hautM, y2: hautM + H, 'class': 'courbe__viseur', visibility: 'hidden' }, s);
      var capte = noeudSvg('rect', { x: gauche, y: 0, width: lp, height: hautM + H + bandeX, fill: 'transparent' }, s);
      zone.appendChild(s);
      zone.appendChild(bulle);

      function montrer(i) {
        i = Math.max(0, Math.min(n - 1, i));
        viseur.setAttribute('x1', X(i)); viseur.setAttribute('x2', X(i));
        viseur.setAttribute('visibility', 'visible');
        vide(bulle);
        bulle.appendChild(el('p', 'courbe__bulle-date', dateCourte(o.dates[i])));
        o.series.forEach(function (se) {
          var l = el('p', 'courbe__bulle-ligne');
          l.appendChild(el('span', 'courbe__marque courbe__marque--ligne courbe__serie-' + se.couleur));
          var v = se.valeurs[i];
          l.appendChild(el('strong', null, typeof v === 'number' ? o.format(v) : 'pas de donnée'));
          l.appendChild(el('span', 'courbe__bulle-nom', se.nom));
          bulle.appendChild(l);
        });
        bulle.hidden = false;
        var bx = X(i) + 10;
        if (bx + bulle.offsetWidth > largeur) bx = X(i) - 10 - bulle.offsetWidth;
        bulle.style.left = Math.max(0, bx) + 'px';
        s.__i = i;
      }
      function cacher() { viseur.setAttribute('visibility', 'hidden'); bulle.hidden = true; }
      function indice(ev) {
        var r = s.getBoundingClientRect();
        return Math.floor((ev.clientX - r.left - gauche) / bande);
      }
      capte.addEventListener('pointermove', function (ev) { montrer(indice(ev)); });
      capte.addEventListener('pointerdown', function (ev) { montrer(indice(ev)); });
      s.addEventListener('pointerleave', cacher);
      s.addEventListener('focus', function () { montrer(n - 1); });
      s.addEventListener('blur', cacher);
      s.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          montrer((s.__i == null ? n - 1 : s.__i) + (ev.key === 'ArrowLeft' ? -1 : 1));
        }
      });
    }
    function ajuster() {
      var w = Math.floor(zone.clientWidth);
      if (w && w !== dernier) { dernier = w; dessiner(w); }
    }
    if (window.ResizeObserver) new ResizeObserver(ajuster).observe(zone);
    else { window.addEventListener('resize', ajuster); setTimeout(ajuster, 0); }

    /* Le tableau : chaque valeur lisible sans survol. */
    var det = el('details', 'courbe__tableau');
    det.appendChild(el('summary', null, 'Valeurs jour par jour'));
    var tab = el('table');
    var tr = el('tr');
    tr.appendChild(el('th', null, 'Date'));
    o.series.forEach(function (se) { tr.appendChild(el('th', null, se.nom)); });
    tab.appendChild(tr);
    o.dates.slice().reverse().forEach(function (dt) {
      var i = o.dates.indexOf(dt);
      var ligne = el('tr');
      ligne.appendChild(el('td', null, dateCourte(dt) + (dt === auj ? ' (aujourd’hui)' : '')));
      o.series.forEach(function (se) { ligne.appendChild(el('td', null, typeof se.valeurs[i] === 'number' ? o.format(se.valeurs[i]) : '—')); });
      tab.appendChild(ligne);
    });
    det.appendChild(tab);
    fig.appendChild(det);
    return fig;
  }

  /* Décimales d'un axe : juste assez pour que deux graduations ne se ressemblent pas. */
  function decAxe(pas) { return pas >= 1 ? 0 : pas >= 0.1 ? 1 : 2; }

  function nombreFr(v, dec) { return v.toFixed(dec).replace('.', ',').replace('-', '−'); }

  /* ---------- Météo des 15 derniers jours et normale, lues chez Open-Meteo ---------- */

  var cacheHisto = {};

  function jsonDirect(u) {
    return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function memoire(cle, fabrique) {
    if (!cacheHisto[cle]) {
      cacheHisto[cle] = fabrique();
      cacheHisto[cle].catch(function () { delete cacheHisto[cle]; });
    }
    return cacheHisto[cle];
  }

  function coordonnees(l) {
    return 'latitude=' + l.gps[0] + '&longitude=' + l.gps[1] + (l.altitude ? '&elevation=' + l.altitude : '') + '&timezone=Europe%2FRome';
  }

  function histoMeteo(l) {
    return memoire('meteo|' + l.id + '|' + aujourdhuiIso(), function () {
      return jsonDirect('https://api.open-meteo.com/v1/forecast?' + coordonnees(l) +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,snow_depth_max&past_days=' + JOURS_HISTO + '&forecast_days=1')
        .then(function (d) {
          var x = d.daily;
          if (!x || !x.time) throw new Error('vide');
          var dates = fenetreHisto();
          var serie = function (cle, f) {
            return dates.map(function (dt) {
              var i = x.time.indexOf(dt);
              var v = i < 0 || !x[cle] ? null : x[cle][i];
              return typeof v === 'number' ? (f ? f(v) : v) : null;
            });
          };
          return {
            dates: dates,
            tmax: serie('temperature_2m_max'), tmin: serie('temperature_2m_min'),
            pluie: serie('precipitation_sum'), neige: serie('snowfall_sum'),
            sol: serie('snow_depth_max', function (m) { return Math.round(m * 100); })
          };
        });
    });
  }

  /* Normale : moyenne du même jour sur les 10 dernières années, au point et à l'altitude du lieu.
     Dix appels d'un jour (une longue plage compte pour des centaines d'appels chez Open-Meteo),
     résultat gardé sur l'appareil : une normale ne change pas. */
  var CLE_NORMALES = 'dolomites.normales.v1';
  function normaleApi(l, date) {
    var cle = l.id + '|' + (l.altitude || '') + '|' + date;
    var garde = lireStockage(CLE_NORMALES)[cle];
    if (garde && typeof garde.min === 'number') return Promise.resolve(garde);
    return memoire('normale|' + cle, function () {
      var an = Number(date.slice(0, 4)), md = date.slice(5), annees = [];
      for (var a = an - 10; a < an; a++) annees.push(a);
      return Promise.all(annees.map(function (a) {
        return jsonDirect('https://archive-api.open-meteo.com/v1/archive?' + coordonnees(l) +
          '&daily=temperature_2m_max,temperature_2m_min&start_date=' + a + '-' + md + '&end_date=' + a + '-' + md)
          .then(function (d) { var x = d.daily || {}; return [(x.temperature_2m_min || [])[0], (x.temperature_2m_max || [])[0]]; });
      })).then(function (res) {
        var mins = res.map(function (r) { return r[0]; }), maxs = res.map(function (r) { return r[1]; });
        var mn = moyenne(mins), mx = moyenne(maxs);
        if (mn === null || mx === null) throw new Error('vide');
        var out = { min: mn, max: mx, ans: mins.filter(function (v) { return typeof v === 'number'; }).length, de: an - 10, a: an - 1 };
        var tout = lireStockage(CLE_NORMALES);
        tout[cle] = out;
        try { localStorage.setItem(CLE_NORMALES, JSON.stringify(tout)); } catch (e) { /* gardée pour la visite seulement */ }
        return out;
      });
    });
  }

  function phraseCourbe(conteneur, texte) {
    vide(conteneur);
    conteneur.appendChild(el('p', 'jour__note', texte));
  }

  function toutNul(l) { return !l.some(function (v) { return typeof v === 'number' && v > 0; }); }

  function dessinerCourbesMeteo(pt, avecNeige, conteneur) {
    var c = el('div', 'courbes');
    c.appendChild(el('p', 'jour__note', 'Courbes des 15 derniers jours en cours de chargement…'));
    conteneur.appendChild(c);
    if (!window.fetch) { phraseCourbe(c, 'Courbes des 15 derniers jours indisponibles hors ligne.'); return; }
    histoMeteo(pt.lieu).then(function (h) {
      if (!h.tmax.some(function (v) { return typeof v === 'number'; })) throw new Error('vide');
      vide(c);
      var lieu = pt.lieu.nom + (pt.lieu.altitude ? ' (' + pt.lieu.altitude + ' m)' : '');
      var deg = function (v, axe) { return nombreFr(v, axe ? decAxe(axe) : 1) + ' °C'; };
      c.appendChild(courbe({
        titre: 'Températures des 15 derniers jours — ' + lieu,
        dates: h.dates, format: deg,
        series: [
          { nom: 'Maximum', couleur: 2, type: 'ligne', valeurs: h.tmax },
          { nom: 'Minimum', couleur: 1, type: 'ligne', valeurs: h.tmin }
        ]
      }));
      c.appendChild(el('p', 'jour__note', 'Du ' + dateCourte(h.dates[0]) + ' à aujourd’hui, relu chez Open-Meteo à chaque ouverture : valeurs du modèle météo à l’altitude du lieu, pas le relevé d’une station.'));
      /* Une courbe visible, les autres repliées. */
      var repli = el('details', 'repli');
      repli.appendChild(el('summary', null, avecNeige ? 'Pluie et neige des 15 derniers jours' : 'Pluie des 15 derniers jours'));
      c.appendChild(repli);
      var mm = function (v, axe) { return nombreFr(v, axe ? decAxe(axe) : v >= 10 || v === 0 ? 0 : 1) + ' mm'; };
      if (toutNul(h.pluie)) repli.appendChild(el('p', 'jour__note', 'Aucune précipitation sur les 15 derniers jours à ce point.'));
      else repli.appendChild(courbe({ titre: 'Précipitations par jour — ' + lieu, dates: h.dates, format: mm, zero: true,
        series: [{ nom: 'Précipitations', couleur: 1, type: 'barres', valeurs: h.pluie }] }));
      if (avecNeige) {
        var cm = function (v, axe) { return nombreFr(v, axe ? decAxe(axe) : v >= 10 || v === 0 ? 0 : 1) + ' cm'; };
        if (toutNul(h.neige) && toutNul(h.sol)) repli.appendChild(el('p', 'jour__note', 'Neige au point le plus haut : ni chute ni neige au sol sur les 15 derniers jours.'));
        else repli.appendChild(courbe({ titre: 'Neige au point le plus haut — ' + lieu, dates: h.dates, format: cm, zero: true,
          series: [
            { nom: 'Hauteur au sol', couleur: 1, type: 'aire', valeurs: h.sol },
            { nom: 'Chute du jour', couleur: 2, type: 'barres', valeurs: h.neige }
          ] }));
      }
    }).catch(function () {
      phraseCourbe(c, 'Courbes des 15 derniers jours indisponibles (hors ligne ou service Open-Meteo injoignable).');
    });
  }

  /* ---------- Carburant : historique officiel (France) ou relevés mémorisés sur l'appareil (Italie) ---------- */

  var CLE_RELEVES_IT = 'dolomites.releves-italie.v1';
  var CLE_ARCHIVES_FR = 'dolomites.archives-france.v1';
  var URL_ARCHIVE_FR = 'https://donnees.roulez-eco.fr/opendata/jour/';

  function lireStockage(cle) {
    try { return JSON.parse(localStorage.getItem(cle) || '{}') || {}; } catch (e) { return {}; }
  }

  /* Garde les 30 derniers jours ; un stockage plein ou refusé ne casse rien. */
  function ecrireStockage(cle, obj) {
    var limite = isoDecale(aujourdhuiIso(), -30);
    Object.keys(obj).forEach(function (d) { if (d < limite) delete obj[d]; });
    try { localStorage.setItem(cle, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  /* L'Italie ne publie ni archive quotidienne ni API lisible depuis le navigateur :
     chaque ouverture mémorise ici les prix du jour du fichier, une valeur par jour et par station. */
  function memoriserRelevesItalie() {
    var c = E.carbuLive;
    var ext = c && c.sources && c.sources.IT && c.sources.IT.extraction;
    if (!ext || !c.stations) return;
    var r = lireStockage(CLE_RELEVES_IT);
    var jour = r[ext] || {};
    Object.keys(c.stations).forEach(function (k) {
      var s = c.stations[k];
      if (s.pays === 'IT' && typeof s.gazole === 'number') jour[k] = [s.gazole, typeof s.sp95 === 'number' ? s.sp95 : null];
    });
    r[ext] = jour;
    ecrireStockage(CLE_RELEVES_IT, r);
  }

  /* Archive quotidienne officielle : un zip d'un seul fichier XML, décompressé dans le navigateur. */
  function lireZip(buf) {
    var v = new DataView(buf);
    for (var fin = buf.byteLength - 22; fin >= 0 && v.getUint32(fin, true) !== 0x06054b50; fin--);
    if (fin < 0) throw new Error('zip illisible');
    var cd = v.getUint32(fin + 16, true);
    var methode = v.getUint16(cd + 10, true), taille = v.getUint32(cd + 20, true), loc = v.getUint32(cd + 42, true);
    var debut = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
    var brut = new Blob([new Uint8Array(buf, debut, taille)]);
    if (methode === 0) return brut.arrayBuffer();
    return new Response(brut.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  }

  function prixDansArchive(xml, id, date) {
    var i = xml.indexOf('<pdv id="' + id + '"');
    if (i < 0) return null;
    var bloc = xml.slice(i, xml.indexOf('</pdv>', i));
    var out = {};
    var re = /<prix nom="([^"]+)"[^>]*maj="([^"]+)"[^>]*valeur="([\d.]+)"/g, m;
    while ((m = re.exec(bloc))) {
      /* Même règle que la page : un prix de plus de 8 jours n'est pas un prix du jour. */
      if ((Date.parse(date + 'T23:59:59') - Date.parse(m[2])) / 86400000 > 8) continue;
      var v = Number(m[3]);
      if (v > 10) v = v / 1000;   // anciennes archives en millièmes d'euro
      if (m[1] === 'Gazole') out.g = v;
      else if (m[1] === 'E10') out.e10 = v;
      else if (m[1] === 'SP95') out.sp95 = v;
    }
    return typeof out.g === 'number' ? [out.g, out.e10 != null ? out.e10 : null, out.sp95 != null ? out.sp95 : null] : null;
  }

  var archivesEnCours = {};

  /* Deux archives à la fois : chacune fait 15 Mo une fois décompressée, un téléphone n'en tient pas quinze. */
  var fileAttente = [], actives = 0;
  function file(tache) {
    return new Promise(function (ok, ko) {
      fileAttente.push(function () {
        actives++;
        tache().then(ok, ko).then(function () { actives--; if (fileAttente.length) fileAttente.shift()(); });
      });
      if (actives < 2) fileAttente.shift()();
    });
  }
  function archiveFrance(date, ids) {
    var cache = lireStockage(CLE_ARCHIVES_FR)[date];
    if (cache && ids.every(function (id) { return cache.ids.indexOf(id) !== -1; })) return Promise.resolve(cache.p);
    if (!window.DecompressionStream) return Promise.reject(new Error('décompression indisponible'));
    if (archivesEnCours[date]) return archivesEnCours[date];
    /* Le serveur n'envoie l'en-tête CORS qu'aux requêtes portant un « Range » : on demande tout le fichier. */
    var p = file(function () {
      return fetch(URL_ARCHIVE_FR + date.replace(/-/g, ''), { headers: { Range: 'bytes=0-99999999' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(lireZip)
      .then(function (buf) {
        var xml = new TextDecoder('iso-8859-1').decode(buf);
        var res = {};
        ids.forEach(function (id) { var x = prixDansArchive(xml, id, date); if (x) res[id] = x; });
        var tout = lireStockage(CLE_ARCHIVES_FR);
        tout[date] = { ids: ids, p: res };
        ecrireStockage(CLE_ARCHIVES_FR, tout);
        return res;
      });
    });
    archivesEnCours[date] = p;
    p.then(function () { delete archivesEnCours[date]; }, function () { delete archivesEnCours[date]; });
    return p;
  }

  /* Toutes les stations françaises du scénario, pour qu'une archive téléchargée serve à tous les jours. */
  function idsFranceScenario() {
    var c = E.carbuLive, ids = [];
    Object.keys((c && c.jours && c.jours[E.scenarioId]) || {}).forEach(function (jour) {
      (c.jours[E.scenarioId][jour] || []).forEach(function (x) {
        var s = c.stations[x.id];
        if (s && s.pays === 'FR' && ids.indexOf(s.id) === -1) ids.push(s.id);
      });
    });
    return ids.sort();
  }

  /* Par date : [gazole, essence] de chaque station suivie ce jour-là, ou rien. */
  function histoCarburantPays(stations, pays) {
    var dates = fenetreHisto(), auj = aujourdhuiIso();
    if (pays === 'FR') {
      var ids = idsFranceScenario();
      return rafraichirPrixFrance().then(function () {
        return Promise.all(dates.map(function (d) {
          if (d === auj) {
            var jour = {};
            stations.forEach(function (s) {
              var x = E.prixFranceDirect[s.id];
              if (x && typeof x.gazole === 'number') jour[s.id] = [x.gazole, typeof x.e10 === 'number' ? x.e10 : null, typeof x.sp95 === 'number' ? x.sp95 : null];
            });
            return jour;
          }
          return archiveFrance(d, ids).catch(function () { return null; });
        }));
      }).then(function (jours) {
        return { dates: dates, jours: jours.map(function (j) {
          if (!j) return null;
          var o = {};
          stations.forEach(function (s) { if (j[s.id]) o[s.id] = [j[s.id][0], j[s.id][1] != null ? j[s.id][1] : j[s.id][2]]; });
          return Object.keys(o).length ? o : null;
        }), source: 'archives' };
      });
    }
    var r = lireStockage(CLE_RELEVES_IT);
    return Promise.resolve({ dates: dates, jours: dates.map(function (d) {
      var j = r[d];
      if (!j) return null;
      var o = {};
      stations.forEach(function (s) { var k = 'IT-' + s.id; if (j[k]) o[s.id] = j[k]; });
      return Object.keys(o).length ? o : null;
    }), source: 'appareil', depuis: Object.keys(r).sort()[0] });
  }

  function moyenneJour(jour, rang) {
    if (!jour) return null;
    var m = moyenne(Object.keys(jour).map(function (k) { return jour[k][rang]; }));
    return m === null ? null : Math.round(m * 1000) / 1000;
  }

  /* Prix retenu pour le budget ce jour-là : moyenne des 3 gazoles les moins chers, comme aujourd'hui. */
  function prixBudgetJour(jour) {
    if (!jour) return null;
    var v = Object.keys(jour).map(function (k) { return jour[k][0]; }).filter(function (x) { return typeof x === 'number'; }).sort(function (a, b) { return a - b; }).slice(0, 3);
    return v.length ? moyenne(v) : null;
  }

  var NOMS_PAYS = { FR: 'France', IT: 'Italie', AT: 'Autriche' };

  function dessinerCourbesCarburant(j, st, conteneur) {
    var pays = [];
    var r = routeDuJour(j);
    if (r && r.etape.pays && st.some(function (s) { return s.pays === r.etape.pays; })) pays.push(r.etape.pays);
    st.forEach(function (s) { if (pays.indexOf(s.pays) === -1) pays.push(s.pays); });
    if (!pays.length) return;
    var c0 = el('div', 'courbes');
    c0.appendChild(el('p', 'jour__note', 'Courbes des prix des 15 derniers jours en cours de chargement…'));
    conteneur.appendChild(c0);
    var euroL = function (v, axe) { return axe ? nombreFr(v, Math.max(2, decAxe(axe))) + ' €' : prixLitreAffiche(v); };
    Promise.all(pays.map(function (p) {
      return histoCarburantPays(st.filter(function (s) { return s.pays === p; }), p).catch(function () { return null; });
    })).then(function (histos) {
      vide(c0);
      var parPays = {};
      /* Le pays de l'étape visible ; les autres pays et le coût de l'étape repliés. */
      var repli = el('details', 'repli');
      var resume = el('summary');
      repli.appendChild(resume);
      histos.forEach(function (h, k) {
        var p = pays[k];
        var c = k ? repli : c0;
        var nb = h ? h.jours.filter(Boolean).length : 0;
        if (!h || !nb) {
          c.appendChild(el('p', 'jour__note', p === 'IT'
            ? 'Italie : pas encore d’historique sur cet appareil. Le ministère italien ne publie aucune archive quotidienne lisible depuis la page : chaque ouverture mémorise le prix du jour ici, et la courbe se remplit jour après jour.'
            : NOMS_PAYS[p] + ' : historique des prix indisponible (hors ligne ou archive officielle injoignable).'));
          return;
        }
        parPays[p] = h;
        var n = st.filter(function (s) { return s.pays === p; }).length;
        c.appendChild(courbe({
          titre: 'Prix moyen à la pompe, ' + (NOMS_PAYS[p] || p) + ' — 15 derniers jours',
          dates: h.dates, format: euroL,
          series: [
            { nom: 'Gazole', couleur: 1, type: 'ligne', valeurs: h.jours.map(function (x) { return moyenneJour(x, 0); }) },
            { nom: p === 'FR' ? 'Essence (E10, sinon SP95)' : 'Essence (SP95)', couleur: 2, type: 'ligne', valeurs: h.jours.map(function (x) { return moyenneJour(x, 1); }) }
          ]
        }));
        c.appendChild(el('p', 'jour__note', h.source === 'archives'
          ? 'Moyenne des ' + n + ' stations suivies à moins de ' + ((E.carbuLive || {}).rayon_km || 5) + ' km du tracé. Jours passés : archives quotidiennes officielles (donnees.roulez-eco.fr), téléchargées une fois puis gardées sur cet appareil ; aujourd’hui : prix lus en direct. ' + nb + ' jour' + (nb > 1 ? 's' : '') + ' disponible' + (nb > 1 ? 's' : '') + ' sur 16.'
          : 'Moyenne des ' + n + ' stations suivies. Relevés mémorisés sur cet appareil depuis le ' + jjmm(h.depuis) + ' : ' + nb + ' jour' + (nb > 1 ? 's' : '') + ' disponible' + (nb > 1 ? 's' : '') + ' sur 16. L’Italie ne publie pas d’archive quotidienne : aucun jour manquant n’est reconstitué.'));
      });
      var cout = dessinerCourbeCout(j, parPays, repli);
      var noms = pays.slice(1).map(function (p) { return NOMS_PAYS[p] || p; }).concat(cout ? ['coût de l’étape jour par jour'] : []);
      resume.textContent = 'Autres courbes : ' + noms.join(', ');
      if (noms.length) c0.appendChild(repli);
    });
  }

  /* Coût du carburant de l'étape si on l'avait roulée chacun des 15 derniers jours. */
  function dessinerCourbeCout(j, parPays, c) {
    var etapes = ((E.itineraire && E.itineraire.etapes) || []).filter(function (e) { return e.jour === j.jour && e.distance_km; });
    if (!etapes.length) return false;
    var defaut = (E.carburant || {}).defaut;
    var dates = fenetreHisto();
    var conso = consoReelle();
    var valeurs = dates.map(function (d, i) {
      var total = 0;
      for (var k = 0; k < etapes.length; k++) {
        var h = parPays[etapes[k].pays || defaut];
        var prix = h ? prixBudgetJour(h.jours[i]) : null;
        if (prix === null) return null;   // un pays sans prix ce jour-là : pas de coût inventé
        total += etapes[k].distance_km / 100 * conso * prix;
      }
      return Math.round(total * 100) / 100;
    });
    var nb = valeurs.filter(function (v) { return v !== null; }).length;
    if (!nb) return false;
    var km = etapes.reduce(function (a, e) { return a + e.distance_km; }, 0);
    c.appendChild(courbe({
      titre: 'Coût du carburant de l’étape selon le prix de chaque jour',
      dates: dates, format: function (v, axe) { return axe ? nombreFr(v, decAxe(axe)) + ' €' : euros(v); },
      series: [{ nom: 'Coût de l’étape', couleur: 1, type: 'ligne', valeurs: valeurs }]
    }));
    c.appendChild(el('p', 'jour__note', km + ' km à ' + nombreFr(conso, 1) + ' L/100 km, au prix moyen des 3 stations les moins chères du tracé ce jour-là. ' + nb + ' jour' + (nb > 1 ? 's' : '') + ' calculable' + (nb > 1 ? 's' : '') + ' sur 16 : un jour sans prix dans l’un des pays traversés reste vide.'));
    return true;
  }

  function dessinerBudgetEtape(j, conteneur) {
    var d = el('div');
    function remplir() {
      vide(d);
      var b = calculerBudget();
      if (!b) return;
      var base = b.lignes.filter(function (x) { return x.jour === j.jour; });
      var opts = b.options.filter(function (o) { return o.jour === j.jour; });
      var libPoste = {};
      (b.postes || []).forEach(function (p) { libPoste[p.id] = p.libelle; });
      /* Base du jour : les lignes retenues moins celles des options cochées. */
      var lignesOpt = [];
      opts.forEach(function (o) { if (o.choisie) lignesOpt = lignesOpt.concat(o.lignes); });
      base = base.filter(function (x) { return lignesOpt.indexOf(x) === -1; });
      if (!base.length && !opts.length) return;
      var totalBase = base.reduce(function (a, x) { return a + x.montant; }, 0);
      var totalOpt = opts.reduce(function (a, o) { return a + (o.choisie ? o.montant : 0); }, 0);
      d.appendChild(tableauCle(base.map(function (x) {
        return { libelle: (libPoste[x.poste] || x.poste) + ' — ' + x.libelle, valeur: euros(x.montant) };
      }).concat([{ libelle: 'Total de base du jour', valeur: euros(totalBase) }])));
      if (opts.length) {
        d.appendChild(el('p', 'options__jour', 'Options, non comptées sauf si cochées'));
        opts.forEach(function (o) {
          d.appendChild(ligneOption(o, true, function () { remplir(); dessinerBudget(); }));
        });
        d.appendChild(tableauCle([{ libelle: 'Total du jour avec les options cochées', valeur: euros(totalBase + totalOpt) }]));
      }
    }
    remplir();
    if (!d.firstChild) return;
    conteneur.appendChild(bloc('Budget du jour', d));
  }

  /* Une règle s'affiche dans les étapes que décrit son champ « quand » :
     catégories de lieux visités, zone du jour, lieux précis, cols, route longue,
     départ (papiers et équipement à avoir avant de passer la frontière). */
  function reglesPourJour(j) {
    var lieux = lieuxDuJour(j);
    var r = routeDuJour(j);
    var refs = r ? referencesEtape(r.etape).map(function (x) { return E.parId.get(x); }).filter(Boolean) : [];
    var tous = lieux.concat(refs);
    var ids = tous.map(function (l) { return l.id; });
    var cats = tous.map(function (l) { return l.categorie; });
    var zone = j.zone || '';
    var premier = (E.planning || [])[0] === j;
    return (E.regles || []).filter(function (rg) {
      if (lieux.some(function (l) { return l.reglement === rg.id; })) return true;
      var q = rg.quand;
      if (!q) return false;
      if (q.nuit && j.nuit) return true;
      if (q.passage_frontiere && premier) return true;
      if (q.route_longue && r && r.km >= 150) return true;
      if (q.cols && tous.some(function (l) { return (l.altitude || 0) >= 1800 && /passo|pass|col|joch/i.test(l.nom); })) return true;
      if (q.randos && randosPourJour(j).length) return true;
      if ((q.categories || []).some(function (c) { return cats.indexOf(c) !== -1; })) return true;
      if ((q.lieux || []).some(function (id) { return ids.indexOf(id) !== -1; })) return true;
      if ((q.zones_contient || []).some(function (z) { return zone.indexOf(z) !== -1; })) return true;
      return false;
    });
  }

  function dessinerReglesEtape(j, conteneur) {
    var regles = reglesPourJour(j);
    if (!regles.length) return;
    var d = el('div', 'regles-etape');
    regles.forEach(function (r) {
      var det = el('details', 'regle-etape' + (r.gravite ? ' regle-etape--' + r.gravite : ''));
      var sm = el('summary', null);
      sm.appendChild(el('span', 'regle-etape__titre', r.titre));
      if (r.resume) sm.appendChild(el('span', 'jour__note', r.resume));
      det.appendChild(sm);
      if (r.detail) det.appendChild(el('p', null, r.detail));
      if (r.amende) det.appendChild(el('p', 'jour__note', 'Amende : ' + r.amende));
      var srcs = Array.isArray(r.sources) && r.sources.length ? r.sources : (r.source ? [{ libelle: 'Source', url: r.source }] : []);
      var dl = el('div', 'puces');
      srcs.forEach(function (x) { if (x && x.url) dl.appendChild(lienExterne(x.libelle || 'Source', x.url)); });
      if (dl.childNodes.length) det.appendChild(dl);
      d.appendChild(det);
    });
    conteneur.appendChild(bloc('Règles du jour (' + regles.length + ')', d));
  }

  /* ---------- Données en direct d'une étape : carburant, routes, webcams ---------- */

  var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  /* « 26 sept. 22:01 ». Une date avec fuseau est ramenée à l'heure de Paris et Rome. */
  function dateHeure(iso) {
    if (!iso) return '';
    if (/[zZ]$|[+-]\d\d:\d\d$/.test(iso)) {
      var d = new Date(iso);
      if (!isNaN(d)) {
        return d.toLocaleString('fr-FR', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      }
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
    if (!m) return iso;
    return Number(m[3]) + ' ' + MOIS_COURTS[Number(m[2]) - 1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
  }

  function prixLitreAffiche(n) {
    return typeof n === 'number' ? n.toFixed(3).replace('.', ',') + ' €/L' : '—';
  }

  function aujourdhuiIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Distance en km d'un point à un segment, en projection locale : juste à quelques kilomètres près. */
  function distanceSegmentKm(p, a, b) {
    var k = Math.cos(p[0] * Math.PI / 180) * 111.32;
    var ax = a[1] * k, ay = a[0] * 110.57, bx = b[1] * k, by = b[0] * 110.57, px = p[1] * k, py = p[0] * 110.57;
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }

  /* Tracés routiers du jour, plus le point de la nuit. */
  function lignesDuJour(j) {
    var out = [];
    ((E.itineraire && E.itineraire.etapes) || []).forEach(function (e) {
      if (e.jour !== j.jour) return;
      var t = E.trace && E.trace.etapes && E.trace.etapes[e.id];
      if (t && Array.isArray(t.points) && t.points.length) out.push(t.points);
    });
    var n = j.nuit && E.parId.get(j.nuit);
    if (n && Array.isArray(n.gps)) out.push([n.gps]);
    return out;
  }

  function distanceAuxLignes(p, lignes) {
    var min = Infinity;
    lignes.forEach(function (l) {
      if (l.length === 1) min = Math.min(min, distanceSegmentKm(p, l[0], l[0]));
      for (var i = 1; i < l.length; i++) min = Math.min(min, distanceSegmentKm(p, l[i - 1], l[i]));
    });
    return min;
  }

  /* Position d'un point le long du tracé du jour : km parcourus depuis le départ jusqu'au
     sommet du tracé le plus proche, ramenés à la distance officielle de l'étape. */
  function kmDepuisDepart(j, gps) {
    var r = routeDuJour(j);
    var t = r && E.trace && E.trace.etapes && E.trace.etapes[r.etape.id];
    if (!t || !Array.isArray(t.points) || t.points.length < 2) return null;
    var pts = t.points, cumul = 0, meilleur = Infinity, pos = 0, total = 0, i;
    var cum = [0];
    for (i = 1; i < pts.length; i++) { total += distanceKm(pts[i - 1], pts[i]); cum.push(total); }
    for (i = 0; i < pts.length; i++) {
      var dd = distanceKm(pts[i], gps);
      if (dd < meilleur) { meilleur = dd; pos = cum[i]; }
    }
    var officiel = r.km || total;
    return total ? Math.round(pos / total * officiel) : null;
  }

  /* Pour une longue étape, la station la moins chère de chaque tranche de 150 km :
     avec 650 km d'autonomie, la moins chère de toute l'étape peut être hors d'atteinte. */
  function stationsParTranche(st, kmJour) {
    if (!kmJour || kmJour < 300) return st.slice(0, 3);
    var parTranche = {};
    st.forEach(function (s) {
      if (s.depuis_depart == null) return;
      var t = Math.floor(s.depuis_depart / 150);
      if (!parTranche[t] || s.gazole < parTranche[t].gazole) parTranche[t] = s;
    });
    return Object.keys(parTranche).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return parTranche[t]; });
  }

  /* Stations retenues pour le jour, prix français relus en direct s'ils sont arrivés. */
  function stationsDuJour(j) {
    var c = E.carbuLive;
    if (!c || !c.jours || !c.stations) return null;
    var liste = (c.jours[E.scenarioId] || {})[j.jour] || [];
    return liste.map(function (x) {
      var s = c.stations[x.id];
      if (!s || !Array.isArray(s.gps)) return null;
      var o = {};
      Object.keys(s).forEach(function (k) { o[k] = s[k]; });
      o.km = x.km;
      o.depuis_depart = kmDepuisDepart(j, s.gps);
      var d = s.pays === 'FR' ? E.prixFranceDirect[s.id] : null;
      if (d) {
        o.gazole = d.gazole; o.releve = d.releve; o.direct = true;
        if (typeof d.sp95 === 'number') o.sp95 = d.sp95;
        if (typeof d.e10 === 'number') o.e10 = d.e10;
      }
      return typeof o.gazole === 'number' ? o : null;
    }).filter(Boolean).sort(function (a, b) { return (a.gazole - b.gazole) || (a.km - b.km); });
  }

  /* Prix retenu pour le budget : moyenne des 3 stations les moins chères du tracé, dans le pays de l'étape. */
  function prixCarburantDuJour(jour, pays) {
    var j = (E.planning || []).find(function (x) { return x.jour === jour; });
    var st = j ? stationsDuJour(j) : null;
    if (!st) return null;
    var memes = st.filter(function (s) { return !pays || s.pays === pays; }).slice(0, 3);
    if (!memes.length) return null;
    var somme = memes.reduce(function (a, s) { return a + s.gazole; }, 0);
    var releve = memes.map(function (s) { return s.releve || ''; }).sort()[0];
    return { prix: Math.round(somme / memes.length * 1000) / 1000, releve: releve, n: memes.length };
  }

  var URL_PRIX_FRANCE = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

  /* Le flux français autorise l'appel depuis le navigateur : on relit les stations françaises du scénario. */
  function rafraichirPrixFrance() {
    var c = E.carbuLive;
    if (!c || !c.jours || !c.stations || !window.fetch) return Promise.resolve(0);
    var ids = [];
    Object.keys(c.jours[E.scenarioId] || {}).forEach(function (jour) {
      (c.jours[E.scenarioId][jour] || []).forEach(function (x) {
        var s = c.stations[x.id];
        if (s && s.pays === 'FR' && /^\d+$/.test(s.id) && !E.prixFranceDirect[s.id] && ids.indexOf(s.id) === -1) ids.push(s.id);
      });
    });
    if (!ids.length) return Promise.resolve(0);
    var u = URL_PRIX_FRANCE + '?limit=100&select=' + encodeURIComponent('id,gazole_prix,gazole_maj,sp95_prix,e10_prix') +
      '&where=' + encodeURIComponent('id in (' + ids.join(',') + ')');
    return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var n = 0;
        (d.results || []).forEach(function (x) {
          var t = Date.parse(x.gazole_maj);
          if (typeof x.gazole_prix !== 'number' || isNaN(t) || Date.now() - t > 8 * 86400000) return;
          E.prixFranceDirect[String(x.id)] = { gazole: x.gazole_prix, releve: x.gazole_maj, sp95: x.sp95_prix, e10: x.e10_prix };
          n++;
        });
        return n;
      })
      .catch(function () { return 0; });   // hors ligne : on garde les prix du fichier
  }

  function dessinerCarburantEtape(j, conteneur) {
    var c = E.carbuLive;
    var st = stationsDuJour(j);
    if (!c || st === null || !routeDuJour(j)) return;
    var d = el('div', 'carbu');
    if (!st.length) {
      d.appendChild(el('p', 'jour__note', 'Aucun prix récent relevé à moins de ' + (c.rayon_km || 5) + ' km du tracé de ce jour.'));
    }
    var rj = routeDuJour(j);
    var kmJour = rj && rj.km;
    if (kmJour >= 300) d.appendChild(el('p', 'jour__note', 'Étape de ' + kmJour + ' km pour 650 km d’autonomie : la moins chère de chaque tranche de 150 km, avec sa position depuis le départ. Partir le plein fait, ou le faire dans la première tranche.'));
    stationsParTranche(st, kmJour).forEach(function (s) {
      var ligne = el('div', 'carbu__station');
      var tete = el('p', 'carbu__tete');
      tete.appendChild(el('span', 'carbu__prix', prixLitreAffiche(s.gazole)));
      tete.appendChild(el('span', 'carbu__nom', [s.marque, s.nom].filter(Boolean).join(' · ')));
      ligne.appendChild(tete);
      ligne.appendChild(el('p', 'carbu__detail', [
        'gazole' + (s.pays === 'IT' ? (s.gazole_mode === 'servito' ? ' servi' : ' libre-service') : ''),
        s.gazole_servito && s.gazole_servito !== s.gazole ? 'servi ' + prixLitreAffiche(s.gazole_servito) : '',
        typeof s.sp95 === 'number' ? 'SP95 ' + prixLitreAffiche(s.sp95) : (typeof s.e10 === 'number' ? 'E10 ' + prixLitreAffiche(s.e10) : ''),
        s.autoroute ? 'sur autoroute' : '',
        String(s.km).replace('.', ',') + ' km du tracé',
        s.depuis_depart != null ? '≈ ' + s.depuis_depart + ' km après le départ' : ''
      ].filter(Boolean).join(' · ')));
      ligne.appendChild(el('p', 'carbu__detail', [s.adresse, 'relevé le ' + dateHeure(s.releve) + (s.direct ? ' (lu en direct)' : '')].filter(Boolean).join(' · ')));
      var lien = el('div', 'puces');
      lien.appendChild(lienExterne('Google Maps', 'https://www.google.com/maps/search/?api=1&query=' + s.gps[0] + ',' + s.gps[1]));
      ligne.appendChild(lien);
      d.appendChild(ligne);
    });
    var r = routeDuJour(j);
    var pb = prixCarburantDuJour(j.jour, r && r.etape.pays);
    if (pb) d.appendChild(el('p', 'jour__note', 'Le budget du jour compte ' + prixLitreAffiche(pb.prix) + ', moyenne des ' + pb.n + ' stations les moins chères du tracé' + (r.etape.pays ? ' (' + r.etape.pays + ')' : '') + '.'));
    if (st.length) {
      /* Les archives françaises pèsent ≈ 1 Mo par jour : on ne les télécharge que si l'on ouvre la courbe. */
      var avecFrance = st.some(function (s) { return s.pays === 'FR'; });
      var dc = el('details', 'repli');
      dc.appendChild(el('summary', null, 'Courbes des prix sur 15 jours' + (avecFrance ? ' (≈ 17 Mo au premier affichage, puis gardées sur cet appareil)' : '')));
      var charge = false;
      dc.addEventListener('toggle', function () { if (dc.open && !charge) { charge = true; dessinerCourbesCarburant(j, st, dc); } });
      d.appendChild(dc);
    }
    var src = c.sources || {};
    var morceaux = [];
    if (src.FR) morceaux.push('France : flux officiel, dernier relevé ' + dateHeure(src.FR.releve));
    if (src.IT) morceaux.push('Italie : extraction MIMIT du ' + dateHeure(src.IT.extraction));
    d.appendChild(el('p', 'jour__note', morceaux.join(' · ') + ' — stations à moins de ' + (c.rayon_km || 5) + ' km du tracé ou de la nuit ; fichier mis à jour chaque jour.'));
    var liens = el('div', 'puces');
    ['FR', 'IT'].forEach(function (p) { if (src[p] && src[p].url) liens.appendChild(lienExterne(p === 'FR' ? 'prix-carburants.gouv.fr' : 'Osservaprezzi (MIMIT)', src[p].url)); });
    if (liens.childNodes.length) d.appendChild(liens);
    conteneur.appendChild(bloc('Carburant sur la route', d));
  }

  var URL_TRAFIC_BZ = 'https://static-verkehr.provinz.bz.it/publications/traffic/traffic.json';
  var URL_AVIS_VENETO = 'https://www.venetostrade.it/myportal/VSSPA/api/content?type=rve_avviso&pageIndex=1&onlyNotHidden=true&parent=/Avvisi&includeSubFolders=true&sortBy=pubDate&desc=true&pageSize=10';
  var cacheFlux = {};

  function texteSimple(html) {
    var t = String(html || '').replace(/<br\s*\/?>|<\/(p|li|div)>/gi, ' ').replace(/<[^>]+>/g, ' ');
    var n = document.createElement('textarea');
    n.innerHTML = t;   // décode les entités (&agrave; …) sans rien exécuter
    return n.value.replace(/\s+/g, ' ').trim();
  }

  function couper(t, n) { return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }

  /* Même conversion que scripts/routes-live.js (messageBz), qui produit la copie de secours. */
  function messageBz(x) {
    if (!x || typeof x.X !== 'number' || typeof x.Y !== 'number') return null;
    if (/piste ciclabili|radwege/i.test(x.messageStreetInternetDescIt || x.messageStreetInternetDescDe || '')) return null;
    var grade = String(x.messageGradId || '');
    return {
      source: 'bz', id: String(x.messageId),
      route: [String(x.messageStreetNr || '').trim(), x.messageStreetInternetDescIt].filter(Boolean).join(' — '),
      niveau: grade === '3' ? 'fermeture' : grade === '4' ? 'gene' : 'info',
      etat: x.messageGradDescIt || '',
      texte: couper(texteSimple(x.placeIt || x.placeDe), 400),
      debut: x.beginDate || '', fin: x.endDate || '',
      gps: [x.Y, x.X]
    };
  }

  /* Même conversion que scripts/routes-live.js (avisVeneto). */
  function avisVeneto(ent) {
    var a = (ent && ent.attributes) || {};
    return {
      titre: texteSimple(a.sys_title),
      texte: couper(texteSimple(a.sys_testo_incorporamento || a.sys_description), 500),
      date: String(a.sys_start_pub_date || a.def_date_last_modified || '').slice(0, 16),
      url: a.sys_canonical_url ? 'https://www.venetostrade.it/myportal/VSSPA' + a.sys_canonical_url : 'https://www.venetostrade.it/'
    };
  }

  /* Lecture directe d'une source (autorisée depuis le navigateur), gardée 5 minutes. */
  function fluxDirect(cle, url, convertir) {
    if (!window.fetch) return Promise.reject(new Error('fetch absent'));
    var c = cacheFlux[cle];
    if (c && Date.now() - c.t < 300000) return c.p;
    var p = fetch(url, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(convertir);
    p.catch(function () { delete cacheFlux[cle]; });
    cacheFlux[cle] = { t: Date.now(), p: p };
    return p;
  }

  function fluxBz() {
    return fluxDirect('bz', URL_TRAFIC_BZ, function (l) {
      return { messages: (l || []).map(messageBz).filter(Boolean), maj: ((l && l[0] && l[0].publishDateTime) || '').slice(0, 16) };
    });
  }

  function fluxVeneto() {
    return fluxDirect('veneto', URL_AVIS_VENETO, function (d) {
      var limite = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 16);
      return ((d && d.page && d.page.entities) || []).map(avisVeneto).filter(function (a) { return a.date >= limite; });
    });
  }

  /* Veneto Strade publie des communiqués sans coordonnées pour la province de Belluno. */
  function passeParBelluno(j, lignes) {
    if (lieuxDuJour(j).some(function (l) { return /\(BL\)/.test(l.commune || ''); })) return true;
    return lignes.some(function (l) {
      return l.some(function (p) { return p[0] > 46.45 && p[0] < 46.62 && p[1] > 12.0 && p[1] < 12.4; });
    });
  }

  var RANG_NIVEAU = { fermeture: 0, gene: 1, info: 2 };
  var SOURCE_ROUTE = { bz: 'Province de Bolzano', anas: 'ANAS' };

  function dessinerRoutesEtape(j, conteneur) {
    var lignes = lignesDuJour(j);
    if (!lignes.length || !routeDuJour(j)) return;
    var copie = E.routesLive;
    if (!copie && !window.fetch) return;
    var rayon = (copie && copie.rayon_km) || 5;
    /* Date de référence : le jour du trajet, ou aujourd'hui si le jour est passé. */
    var ref = j.date && j.date > aujourdhuiIso() ? j.date : aujourdhuiIso();
    var belluno = passeParBelluno(j, lignes);
    var d = el('div', 'routes');
    var corps = el('div');
    var etat = el('p', 'jour__note');
    d.appendChild(corps);
    d.appendChild(etat);

    function carte(m) {
      var it = el('div', 'route-msg route-msg--' + m.niveau);
      it.appendChild(el('p', 'route-msg__route', (m.route || 'Route') + (m.etat ? ' · ' + m.etat : '')));
      if (m.texte) it.appendChild(el('p', 'route-msg__texte', m.texte));
      it.appendChild(el('p', 'route-msg__meta', [
        m.debut ? 'depuis le ' + dateHeure(m.debut) : '',
        m.fin ? 'jusqu’au ' + dateHeure(m.fin) : 'sans date de fin',
        SOURCE_ROUTE[m.source] || m.source
      ].filter(Boolean).join(' · ')));
      return it;
    }

    function afficher(bz, veneto, direct) {
      vide(corps);
      var anas = ((copie && copie.messages) || []).filter(function (m) { return m.source === 'anas'; });
      var msgs = (bz || []).concat(anas).filter(function (m) {
        return Array.isArray(m.gps) && (!m.debut || m.debut <= ref) && (!m.fin || m.fin >= ref) && distanceAuxLignes(m.gps, lignes) <= rayon;
      });
      msgs.sort(function (a, b) { return (RANG_NIVEAU[a.niveau] - RANG_NIVEAU[b.niveau]) || String(a.route).localeCompare(String(b.route)); });
      if (!msgs.length) corps.appendChild(el('p', null, 'Aucun message de circulation en vigueur le ' + dateCourte(ref) + ' à moins de ' + rayon + ' km du tracé.'));
      msgs.slice(0, 6).forEach(function (m) { corps.appendChild(carte(m)); });
      if (msgs.length > 6) {
        var plus = el('details', 'volet volet--interne');
        plus.appendChild(el('summary', null, (msgs.length - 6) + ' autre' + (msgs.length > 7 ? 's messages' : ' message')));
        msgs.slice(6).forEach(function (m) { plus.appendChild(carte(m)); });
        corps.appendChild(plus);
      }
      if (belluno && veneto && veneto.length) {
        corps.appendChild(el('p', 'route-msg__sous', 'Province de Belluno — derniers avis Veneto Strade (non localisés)'));
        veneto.slice(0, 3).forEach(function (a) {
          var it = el('div', 'route-msg route-msg--info');
          var t = el('p', 'route-msg__route');
          t.appendChild(lienExterne(dateHeure(a.date) + ' — ' + couper(a.titre, 90), a.url));
          it.appendChild(t);
          if (a.texte) it.appendChild(el('p', 'route-msg__texte', a.texte));
          corps.appendChild(it);
        });
      }
      var srcs = (copie && copie.sources) || {};
      etat.textContent = (direct
        ? 'Province de Bolzano lue en direct' + (direct.maj ? ' (publication du ' + dateHeure(direct.maj) + ')' : '')
        : (copie ? 'Copie du ' + dateHeure(copie.genere_le) + ' (source directe injoignable ou hors ligne)' : '')) +
        (srcs.anas ? ' ; ANAS relu toutes les 3 heures' : '') +
        '. Messages en vigueur le ' + dateCourte(ref) + ', à moins de ' + rayon + ' km du tracé ; textes officiels en italien.';
    }

    if (copie) afficher((copie.messages || []).filter(function (m) { return m.source === 'bz'; }), copie.veneto || [], null);
    else corps.appendChild(el('p', null, 'Messages de circulation en cours de chargement…'));

    var bzDirect = fluxBz().catch(function () { return null; });
    var venDirect = belluno ? fluxVeneto().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([bzDirect, venDirect]).then(function (r) {
      if (!r[0] && !r[1]) {
        if (!copie) { vide(corps); corps.appendChild(el('p', null, 'Messages de circulation indisponibles hors ligne.')); }
        return;
      }
      afficher(r[0] ? r[0].messages : (copie ? (copie.messages || []).filter(function (m) { return m.source === 'bz'; }) : []),
        r[1] || (copie && copie.veneto) || [], r[0]);
    });

    var liens = el('div', 'puces');
    liens.appendChild(lienExterne('Centrale trafic Bolzano', 'https://verkehr.provinz.bz.it/it/'));
    liens.appendChild(lienExterne('ANAS VAI', 'https://www.stradeanas.it/it/vai-traffico-in-tempo-reale'));
    if (belluno) liens.appendChild(lienExterne('Veneto Strade', 'https://www.venetostrade.it/myportal/VSSPA/home'));
    d.appendChild(liens);
    conteneur.appendChild(bloc('Routes et cols', d));
  }

  function dessinerWebcamsEtape(j, conteneur) {
    var w = E.webcams && E.webcams.lieux;
    if (!w) return;
    var vues = {}, liste = [];
    lieuxDuJour(j).forEach(function (l) {
      (w[l.id] || []).forEach(function (c) {
        if (!c || !c.image || vues[c.image]) return;
        vues[c.image] = true;
        liste.push({ cam: c, lieu: l });
      });
    });
    if (!liste.length) return;
    var g = el('div', 'galerie galerie--etape webcams');
    var tranche = Math.floor(Date.now() / 600000);   // change toutes les 10 minutes : pas d'image périmée en cache
    liste.forEach(function (x) {
      var fig = el('figure', 'photo webcam');
      var a = document.createElement('a');
      a.href = x.cam.page || x.cam.image;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      var img = document.createElement('img');
      img.src = x.cam.image + (x.cam.image.indexOf('?') === -1 ? '?' : '&') + 't=' + tranche;
      img.alt = 'Webcam ' + x.cam.nom;
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        if (img.parentNode) a.replaceChild(el('span', 'webcam__absente', 'Image indisponible hors ligne — ouvrir la webcam'), img);
      });
      a.appendChild(img);
      fig.appendChild(a);
      fig.appendChild(el('figcaption', null, x.lieu.nom + ' — ' + x.cam.nom +
        (x.cam.distance_km >= 1 ? ' (' + String(x.cam.distance_km).replace('.', ',') + ' km)' : '')));
      g.appendChild(fig);
    });
    var d = el('div');
    d.appendChild(g);
    var fournisseurs = [];
    liste.forEach(function (x) { if (x.cam.fournisseur && fournisseurs.indexOf(x.cam.fournisseur) === -1) fournisseurs.push(x.cam.fournisseur); });
    d.appendChild(el('p', 'jour__note', 'Images en direct' + (fournisseurs.length ? ' (' + fournisseurs.join(', ') + ')' : '') +
      ', renouvelées toutes les 10 minutes environ ; distance entre le lieu et la caméra entre parenthèses.'));
    conteneur.appendChild(bloc('Webcams (' + liste.length + ')', d));
  }

  /* Lever et coucher du soleil à l'horizon dégagé (équation du lever, précision de l'ordre de la minute). */
  function soleil(lat, lon, dateIso) {
    var rad = Math.PI / 180;
    var p = dateIso.split('-').map(Number);
    var jd = Date.UTC(p[0], p[1] - 1, p[2], 12) / 86400000 + 2440587.5;
    var n = Math.ceil(jd - 2451545.0 + 0.0008);
    var jEtoile = n - lon / 360;
    var M = (357.5291 + 0.98560028 * jEtoile) % 360;
    var C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    var lambda = (M + C + 180 + 102.9372) % 360;
    var transit = 2451545.0 + jEtoile + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
    var sinDecl = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
    var cosDecl = Math.cos(Math.asin(sinDecl));
    var cosOmega = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDecl) / (Math.cos(lat * rad) * cosDecl);
    if (cosOmega < -1 || cosOmega > 1) return null;
    var omega = Math.acos(cosOmega) / rad;
    var versDate = function (j) { return new Date((j - 2440587.5) * 86400000); };
    return { lever: versDate(transit - omega / 360), coucher: versDate(transit + omega / 360) };
  }

  function heureLocale(d) {
    return d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Budget ---------- */

  /* Sans station relevée près du tracé : moyenne nationale du jour, lue en direct (France)
     ou calculée chaque jour par le workflow sur le fichier officiel (Italie, illisible depuis la page). */
  function moyennePays(paysCode) {
    var code = paysCode || (E.carburant || {}).defaut;
    var type = (E.vehicule && E.vehicule.carburant) || 'gazole';
    var direct = (E.moyennesDirect || {})[code];
    var fichier = ((E.carbuLive || {}).moyennes || {})[code];
    var m = direct || fichier;
    var prix = m && (m[type] || m.gazole);
    if (typeof prix !== 'number') return null;
    return { prix: prix, origine: direct ? 'lue en direct' : 'du ' + dateHeure(m.date || '').replace(/,?\s\d\d:\d\d$/, '') };
  }

  var URL_MOYENNE_FRANCE = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=1&select=' +
    encodeURIComponent('avg(gazole_prix) as gazole, avg(e10_prix) as e10, avg(sp95_prix) as sp95, count(*) as n') +
    '&where=' + encodeURIComponent('gazole_maj >= now(days=-8)');

  function rafraichirMoyenneFrance() {
    if (!window.fetch) return Promise.resolve(false);
    return jsonDirect(URL_MOYENNE_FRANCE).then(function (d) {
      var x = (d.results || [])[0];
      if (!x || typeof x.gazole !== 'number') return false;
      var r3 = function (v) { return typeof v === 'number' ? Math.round(v * 1000) / 1000 : undefined; };
      E.moyennesDirect.FR = { gazole: r3(x.gazole), e10: r3(x.e10), sp95: r3(x.sp95), n: x.n, date: aujourdhuiIso() };
      return true;
    }).catch(function () { return false; });
  }

  function consoReelle() {
    var v = E.vehicule || {};
    if (typeof v.conso_reelle_100km === 'number') return v.conso_reelle_100km;
    var base = v.conso_base_100km || 0;
    var sur = v.surconso_tente_pct || 0;
    return base * (1 + sur / 100);
  }

  /* ---------- Options : payant mais pas indispensable, non compté par défaut ---------- */

  var CLE_OPTIONS = 'dolomites.options';

  function chargerChoix() {
    E.choix = {};
    try {
      var brut = localStorage.getItem(CLE_OPTIONS);
      if (brut) E.choix = JSON.parse(brut) || {};
    } catch (e) { E.choix = {}; }   // navigation privée ou valeur illisible : aucune option cochée
  }

  function basculerOption(cle, cochee) {
    if (cochee) E.choix[cle] = true;
    else delete E.choix[cle];
    try { localStorage.setItem(CLE_OPTIONS, JSON.stringify(E.choix)); } catch (e) { /* le choix vaut pour la visite */ }
  }

  function troncon(id) {
    return ((E.peages && E.peages.troncons) || []).find(function (t) { return t.id === id; }) || null;
  }

  function heuresLisibles(h) {
    return dureeAffiche(h) || '0 min';
  }

  function detailPeage(t) {
    var morceaux = [t.verdict];
    if (typeof t.heures_gagnees === 'number') morceaux.push(heuresLisibles(t.heures_gagnees) + ' gagnées');
    if (typeof t.net_par_heure === 'number') morceaux.push(euros(t.net_par_heure) + ' net par heure gagnée');
    if (t.carburant_ecart) morceaux.push('net ' + euros(t.net) + ' avec l’écart de carburant');
    return morceaux.join(' · ');
  }

  /* Type lisible d'une dépense liée à un lieu. */
  function typeDepense(l) {
    var c = l.categorie || '';
    if (c === 'parking' || /parking|stationnement/i.test((l.prix && l.prix.unite) || '')) return 'Stationnement';
    if (c === 'lac' || c === 'plateau' || c === 'vue' || c === 'village') return 'Stationnement';
    if (c === 'remontee') return 'Remontée mécanique';
    if (c === 'supermarche') return 'Courses alimentaires';
    return cat(c).libelle || 'Activité';
  }

  function calculerBudget() {
    var b = E.budget;
    if (!b) return null;
    var postes = b.postes || [];
    var base = [];      // { jour, poste, libelle, montant } toujours comptés
    var options = [];   // { cle, jour, libelle, detail, verdict, montant, lignes: [...] }
    var sc = E.scenarioId + '|';

    function option(o) {
      o.montant = o.lignes.reduce(function (a, x) { return a + x.montant; }, 0);
      o.choisie = !!(E.choix && E.choix[o.cle]);
      options.push(o);
    }

    (b.calcule || []).forEach(function (r) {
      if (r.depuis === 'planning.nuit') {
        (E.planning || []).forEach(function (j) {
          if (!j.nuit) return;
          var l = resoudre(j.nuit);
          var m = montantDe(l);
          if (m) base.push({ jour: j.jour, poste: r.poste, type: 'Nuit (camping, ferme)', libelle: l.nom, montant: m,
            evitable: ((E.budget || {}).evitable || {}).nuit });
        });
      } else if (r.depuis === 'planning.activites') {
        /* Une activité payante est une option, sauf si sa fiche la déclare indispensable. */
        (E.planning || []).forEach(function (j) {
          (j.activites || []).forEach(function (a) {
            var l = resoudre(a.lieu);
            var m = montantDe(l);
            if (!m || a.sans_frais) return;   // visite faite à pied depuis la nuit : rien à payer
            var ligne = { jour: j.jour, poste: r.poste, type: typeDepense(l), libelle: l.nom + (l.prix && l.prix.unite ? ' — ' + l.prix.unite : ''), montant: m,
              evitable: l.prix && l.prix.alternative_gratuite ? 'Oui : ' + l.prix.alternative_gratuite + ' (économie ' + euros(m) + ')'
                : 'Non' + (l.prix && l.prix.raison_budget ? ' : ' + l.prix.raison_budget : '') };
            if (a.evitable) ligne.evitable = a.evitable;
            if (l.prix && l.prix.budget === 'indispensable') { base.push(ligne); return; }
            option({
              cle: sc + 'activite|' + j.jour + '|' + l.id, jour: j.jour, libelle: l.nom,
              detail: l.prix && l.prix.alternative_gratuite ? 'Sans payer : ' + l.prix.alternative_gratuite : '',
              lignes: [ligne]
            });
          });
        });
      } else if (r.depuis === 'itineraire.peages') {
        /* Étape de transit par l'autoroute (aller, retour) : ses péages sont indispensables, comptés d'office.
           Ailleurs, chaque tronçon à péage reste une option : prix du péage, moins le carburant que l'autoroute économise. */
        ((E.itineraire && E.itineraire.etapes) || []).forEach(function (e) {
          (e.troncons_peage || []).forEach(function (id, i) {
            var t = troncon(id);
            if (!t) { anomalies.push('Tronçon à péage inconnu : ' + id + ' (étape ' + e.id + ')'); return; }
            if (e.autoroute) {
              base.push({ jour: e.jour, poste: r.poste, type: 'Péage d’autoroute', libelle: t.libelle + ' (' + t.autoroutes + ')', montant: t.prix,
                evitable: 'Oui : route gratuite, mais ' + dureeAffiche(t.heures_gagnees || 0) + ' de volant en plus' + (t.verdict ? ' — verdict : ' + t.verdict : '') + (t.alerte ? ' ; ' + t.alerte : '') });
              return;
            }
            var lignes = [{ jour: e.jour, poste: r.poste, libelle: 'Péage ' + t.libelle, montant: t.prix }];
            if (t.carburant_ecart) lignes.push({ jour: e.jour, poste: 'carburant', libelle: 'Écart de carburant par l’autoroute, ' + t.libelle, montant: -t.carburant_ecart });
            option({
              cle: sc + 'peage|' + e.id + '|' + i + '|' + id, jour: e.jour,
              libelle: 'Péage ' + t.libelle + ' (' + t.autoroutes + ') — ' + euros(t.prix) + ' au péage',
              detail: detailPeage(t), verdict: t.verdict, alerte: t.alerte, lignes: lignes
            });
          });
        });
      } else if (r.depuis === 'itineraire.carburant') {
        var conso = consoReelle();
        ((E.itineraire && E.itineraire.etapes) || []).forEach(function (e) {
          if (!e.distance_km) return;
          /* Prix du jour relevé sur le tracé quand il existe, sinon le prix indicatif du pays. */
          var live = prixCarburantDuJour(e.jour, e.pays);
          var moy = live ? null : moyennePays(e.pays);
          var pl = live ? live.prix : (moy ? moy.prix : 0);
          var m = e.distance_km / 100 * conso * pl;
          if (m) base.push({
            jour: e.jour, poste: r.poste, type: 'Carburant', evitable: ((E.budget || {}).evitable || {}).carburant,
            libelle: e.distance_km + ' km' + (e.autoroute ? ' par l’autoroute' : (e.troncons_peage && e.troncons_peage.length ? ' sans péage' : '')) +
              (e.pays ? ' (' + e.pays + ')' : '') + ' à ' + euros(pl) + '/L' +
              (live ? ', prix relevé sur le tracé le ' + dateHeure(live.releve).replace(/,?\s\d\d:\d\d$/, '') : '') +
              (moy ? ', moyenne nationale ' + moy.origine : ''),
            montant: m
          });
        });
      }
    });

    (b.saisi || []).forEach(function (s, i) {
      var ligne = { jour: s.jour, poste: s.poste, type: s.type || null, libelle: s.libelle, detail: s.detail, montant: s.montant || 0, evitable: s.evitable };
      if (s.option) option({ cle: sc + 'saisi|' + i, jour: s.jour, libelle: s.libelle, detail: s.note || '', lignes: [ligne] });
      else base.push(ligne);
    });

    /* Options dans l'ordre des jours, les options hors jour à la fin. */
    options.forEach(function (o, i) { o.rang = i; });
    options.sort(function (a, b) {
      var ja = typeof a.jour === 'number' ? a.jour : 999, jb = typeof b.jour === 'number' ? b.jour : 999;
      return (ja - jb) || (a.rang - b.rang);
    });

    /* Lignes retenues : la base, plus les options cochées. */
    var lignes = base.slice();
    options.forEach(function (o) { if (o.choisie) lignes = lignes.concat(o.lignes); });

    var somme = function (l) { return l.reduce(function (a, x) { return a + x.montant; }, 0); };
    var parPoste = {};
    postes.forEach(function (p) { parPoste[p.id] = 0; });
    lignes.forEach(function (x) { parPoste[x.poste] = (parPoste[x.poste] || 0) + x.montant; });

    return { lignes: lignes, base: somme(base), total: somme(lignes), options: options, parPoste: parPoste, postes: postes };
  }

  /* Case à cocher d'une option : libellé, verdict ou alternative gratuite, prix net. */
  function ligneOption(o, avecAlerte, apres) {
    var lab = el('label', 'option' + (o.verdict ? ' option--' + o.verdict.replace(/\s+/g, '-') : ''));
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = o.choisie;
    cb.addEventListener('change', function () { basculerOption(o.cle, cb.checked); apres(); });
    lab.appendChild(cb);
    var corps = el('span', 'option__corps');
    corps.appendChild(el('span', 'option__libelle', o.libelle));
    if (o.detail) corps.appendChild(el('span', 'option__detail' + (o.verdict ? ' option__verdict' : ''), o.detail));
    if (avecAlerte && o.alerte) corps.appendChild(el('span', 'option__detail', 'Sans péage : ' + o.alerte));
    lab.appendChild(corps);
    lab.appendChild(el('span', 'option__prix', (o.montant >= 0 ? '+ ' : '− ') + euros(Math.abs(o.montant))));
    return lab;
  }

  function dessinerBudget() {
    var zone = document.getElementById('budget');
    vide(zone);
    var r = calculerBudget();
    if (!r) { zone.appendChild(el('p', 'jour__note', 'Budget indisponible.')); return; }

    var nbJours = (E.planning || []).length || 1;
    var nbCochees = r.options.filter(function (o) { return o.choisie; }).length;

    var ch = el('div', 'chiffres');
    [
      [euros(r.base), 'Total de base, sans option'],
      [euros(r.total), nbCochees ? 'Avec ' + nbCochees + (nbCochees > 1 ? ' options cochées' : ' option cochée') : 'Aucune option cochée'],
      [euros(r.total / nbJours), 'Par jour en moyenne'],
      [E.budget.objectif_par_jour ? euros(E.budget.objectif_par_jour) : '—', 'Objectif par jour']
    ].forEach(function (x) {
      var c = el('div', 'chiffre');
      c.appendChild(el('div', 'chiffre__val', x[0]));
      c.appendChild(el('div', 'chiffre__lib', x[1]));
      ch.appendChild(c);
    });
    zone.appendChild(ch);

    /* Où part l'argent : total par type, puis chaque dépense avec « peut-on s'en passer ? ». */
    var types = {};
    r.lignes.forEach(function (x) {
      var t = x.type || ((r.postes.find(function (p) { return p.id === x.poste; }) || {}).libelle) || x.poste;
      (types[t] = types[t] || []).push(x);
    });
    var rap = el('div', 'rapport');
    rap.appendChild(el('h3', 'rapport__titre', 'Où part l’argent'));
    Object.keys(types).sort(function (a, b) {
      var sa = types[a].reduce(function (s2, x) { return s2 + x.montant; }, 0), sb = types[b].reduce(function (s2, x) { return s2 + x.montant; }, 0);
      return sb - sa;
    }).forEach(function (t) {
      var ls = types[t];
      var tot = ls.reduce(function (a, x) { return a + x.montant; }, 0);
      var det = el('details', 'rapport__type');
      var sm = el('summary', null);
      sm.appendChild(el('span', 'rapport__nom', t + ' (' + ls.length + ')'));
      sm.appendChild(el('span', 'rapport__montant', euros(tot) + ' · ' + Math.round(tot / (r.total || 1) * 100) + ' %'));
      det.appendChild(sm);
      ls.slice().sort(function (a, b) { return (a.jour || 99) - (b.jour || 99); }).forEach(function (x) {
        var li = el('div', 'rapport__ligne');
        var tete = el('p', 'rapport__ligne-tete');
        tete.appendChild(el('span', null, (x.jour ? 'J' + x.jour + ' · ' : '') + x.libelle));
        tete.appendChild(el('strong', null, euros(x.montant)));
        li.appendChild(tete);
        if (x.detail) li.appendChild(el('p', 'jour__note', x.detail));
        if (x.evitable) li.appendChild(el('p', 'rapport__evitable' + (/^Oui/.test(x.evitable) ? ' rapport__evitable--oui' : ''), 'Peut-on s’en passer ? ' + x.evitable));
        det.appendChild(li);
      });
      rap.appendChild(det);
    });
    if (E.budget.reserve) rap.appendChild(el('p', 'jour__note', 'Hors budget : ' + E.budget.reserve.libelle + ' — ' + euros(E.budget.reserve.montant) + ' à garder de côté, non dépensés sauf imprévu.'));
    zone.appendChild(rap);

    /* Options : péages, remontées, activités payantes. Non comptées tant qu'elles ne sont pas cochées. */
    if (r.options.length) {
      var somOpt = r.options.reduce(function (a, o) { return a + o.montant; }, 0);
      var dv = el('details', 'volet volet--interne options');
      dv.open = true;
      dv.appendChild(el('summary', null, 'Options payantes (' + r.options.length + ', ' + euros(somOpt) + ' si tout est coché)'));
      dv.appendChild(el('p', 'jour__note', 'Aucune option n’est au programme : remontées mécaniques, routes et parkings qui ont une alternative gratuite, visites payantes. Les péages de l’aller et du retour sont comptés dans la base.'));
      var peagesEnOption = r.options.some(function (o) { return o.verdict; });
      if (peagesEnOption && E.peages && E.peages.seuils && E.peages.seuils.raison) dv.appendChild(el('p', 'jour__note', 'Verdict des péages : ' + E.peages.seuils.raison));
      var jourCourant = null;
      r.options.forEach(function (o) {
        if (o.jour !== jourCourant) {
          jourCourant = o.jour;
          var j = (E.planning || []).find(function (x) { return x.jour === o.jour; });
          dv.appendChild(el('p', 'options__jour', o.jour ? 'J' + o.jour + (j && j.titre ? ' · ' + j.titre : '') : 'Hors jour'));
        }
        dv.appendChild(ligneOption(o, false, dessinerBudget));
      });
      zone.appendChild(dv);
    }

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
    trf.appendChild(el('td', null, nbCochees ? 'Total, options cochées comprises' : 'Total de base'));
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
    if (!zone) return;
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
    if (!zone) return;
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
      lire(d + 'trace.json'), lireOptionnel(d + 'ravitaillement.json')
    ]).then(function (r) {
      E.reglages = r[0] || {};
      E.planning = r[1] || [];
      E.itineraire = r[2] || { etapes: [] };
      E.budget = r[3] || null;
      E.trace = r[4] || null;
      E.ravitaillement = r[5] || null;
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
    /* Prix français relus en direct : le budget se recalcule quand ils arrivent. */
    rafraichirPrixFrance().then(function (n) { if (n) dessinerBudget(); });

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
      lire('commun/pratique.json'),
      lire('commun/peages.json'),
      lireOptionnel('commun/carburant-live.json'),
      lireOptionnel('commun/routes-live.json'),
      lireOptionnel('commun/webcams.json'),
      lire('commun/voyageurs.json'), lire('commun/messages.json')
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
      E.peages = r[11] || { troncons: [] };
      E.carbuLive = r[12];
      E.routesLive = r[13];
      E.webcams = r[14];
      E.voyageurs = r[15] || {};
      E.messages = r[16] || {};
      E.prixFranceDirect = {};
      E.moyennesDirect = {};
      chargerChoix();
      memoriserRelevesItalie();

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
        rafraichirMoyenneFrance().then(function (ok) { if (ok) dessinerBudget(); });

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

  /* Zoom de page bloqué sur mobile. Safari ignore « user-scalable=no » depuis iOS 10 :
     on annule ses gestes de pincement, et tout mouvement à deux doigts hors de la carte. */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1 && !(e.target.closest && e.target.closest('#carte'))) e.preventDefault();
  }, { passive: false });

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
