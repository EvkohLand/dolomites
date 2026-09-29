# Carnet Dolomites — règles pour les agents

Ce dépôt publie https://evkohland.github.io/dolomites/. Il est lu surtout sur
téléphone, en voyage, d'un coup d'œil. Ces règles priment sur toute envie
d'ajouter de l'information.

## 1. Présentation : sobre, claire, agréable

**Un œil humain doit comprendre la page en quelques secondes.** Jamais de données
entassées les unes sur les autres, jamais de mur de texte, jamais de page qui défile
sans fin.

- **Divulgation progressive.** L'essentiel est visible ; le reste se déplie à la
  demande (onglets, `<details>`, volets repliés). On ne supprime pas l'information :
  on la range. Une zone s'ouvre quand on a envie de la lire.
- **Un seul endroit par information.** Aucune donnée affichée deux fois. La page
  principale montre un bloc par étape ; le détail vit dans la vue de l'étape ou dans
  la fiche du lieu.
- **Hiérarchie visible.** Dans chaque vue : un titre, une barre résumé (quelques
  chiffres clés), puis des onglets ou des sections repliées. Pas plus de 5 à 7
  éléments visibles au même niveau.
- **Sobriété visuelle.** Peu de couleurs (celles des jetons CSS existants), une
  couleur d'alerte réservée à ce qui change l'action, pas de décoration gratuite,
  des espacements généreux. Sur un grand écran, la largeur sert à mettre des blocs
  côte à côte (colonnes), pas à allonger les lignes de texte.
- **Lisibilité.** Texte de base ≥ 15 px, jamais sous 12 px ; contraste suffisant
  (WCAG AA) ; libellés en français clair, sans jargon ni identifiant technique.
- **Esthétique et agréable à manipuler.** Cibles tactiles d'au moins 44 px, retour
  visuel au toucher, transitions discrètes, aucune action surprise.

## 2. Mobile d'abord, responsive, sans zoom

- **Conçu pour un téléphone standard** (360 à 430 px de large : Galaxy S23,
  iPhone 15 Pro), puis adapté à l'ordinateur (mise en page plus large, jamais plus
  chargée).
- **Zoom de page bloqué sur mobile** : balise viewport (`maximum-scale=1,
  user-scalable=no`), `touch-action` et blocage des gestes de pincement pour iOS
  Safari. La carte garde son propre zoom.
- **100 % de la largeur de l'écran**, sur ordinateur comme sur mobile : pas de
  colonne centrée avec des marges vides sur les côtés. Sur grand écran, les blocs se
  répartissent en plusieurs colonnes.
- **Aucun débordement horizontal** : la page fait exactement la largeur de l'écran.
  Un texte trop long se coupe ou revient à la ligne, il n'élargit jamais la page.
- **Champs de saisie en 16 px** minimum (sinon Safari zoome dessus).
- Vérifier chaque changement visuel au navigateur headless à 360 px, 393 px et
  1400 px de large : `document.documentElement.scrollWidth` doit égaler la largeur
  de l'écran, et la console ne doit contenir aucune erreur.

## 3. Données : en direct depuis le navigateur, rien de figé

- **Tout chiffre qui évolue** (météo, prix du carburant, état des routes, neige…)
  vient d'une API appelée **directement par le navigateur** du visiteur, à chaque
  ouverture. Pas de valeur calculée une fois et écrite en dur.
- **Pas de proxy CORS tiers.** Si la source refuse l'appel navigateur, le prouver
  (en-têtes renvoyés) ; une copie planifiée par GitHub Actions n'est alors qu'un
  secours, et la page affiche la date du relevé.
- **Historique : dans le navigateur, jamais sur le serveur.** Si une API ne fournit
  pas les 15 derniers jours, la page mémorise ses propres relevés dans le navigateur
  (localStorage ou IndexedDB, dans un try/catch, purge au-delà de 30 jours) et le dit
  (« relevés mémorisés sur cet appareil depuis le … »). La page doit fonctionner si
  le stockage est indisponible.
- **Une courbe sur 15 jours** accompagne chaque métrique qui évolue : la fenêtre
  part de la date du jour et remonte de 15 jours, recalculée à chaque ouverture.
  Graphiques en SVG en ligne, sans bibliothèque externe, lisibles à 360 px.
- **Ce qui n'a pas d'API** (tarifs de camping, de parking, de péage) reste un relevé
  daté, avec sa source, et l'écran le dit.
- **Rien d'inventé.** Deux sources pour une donnée qui compte, l'officielle d'abord ;
  une donnée introuvable est absente et signalée, jamais estimée en silence.

## 4. Le voyage

- Voyage le plus économique possible : tout ce qui est payant et non indispensable
  est une option, non comptée dans le budget de base.
- Aucune remontée mécanique au programme (chien, vertige, coût) ; aucune randonnée
  exposée (câbles, échelles, vide).
- Autoroute seulement pour l'aller et le retour Saint-Gély ↔ Dolomites ; sur place,
  jamais d'autoroute.
- Le budget détaille chaque dépense : type, montant, et « peut-on s'en passer ? ».
  Aucun poste fourre-tout.

## 5. Chercher systématiquement ce qui cloche et ce qui coûte

À chaque intervention, sans attendre qu'on le demande, relire le planning, le budget
et les fiches pour trouver :

- **les incohérences** : une date, un prix, un horaire ou une règle qui diffère entre
  deux endroits ; un lieu fermé le jour prévu ; une nuit dont la réception ferme avant
  l'heure d'arrivée ; un magasin fermé le dimanche prévu ; une journée qui finit après
  la nuit tombée ; une donnée sans source ;
- **les allers-retours inutiles** : un lieu visité loin de la base alors qu'une autre
  base est sur le chemin ; un ordre de visite qui repasse deux fois par la même vallée ;
- **les économies de route et de carburant** : bases qui réduisent les kilomètres,
  visites groupées le même jour quand le temps le permet, pleins aux stations les
  moins chères du tracé ;
- **les économies sur toute dépense** : parking gratuit à distance de marche, nuit
  moins chère au même endroit, option payante qui a une alternative gratuite,
  réservation qui évite un surcoût.

Corriger ce qui est sûr ; signaler ce qui demande un choix de l'utilisateur, avec
l'économie ou le gain de temps chiffré. Le but : les vacances les plus agréables
possibles, au moindre coût.

## 6. Travail dans ce dépôt

- ChatGPT dépose ses recherches uniquement dans `by-chatgpt/` : les relire, vérifier,
  puis intégrer ce qui tient.
- `node validate.js` doit rendre 0 : tester le **code de retour**, jamais à travers
  un `| grep` ou un `| tail` qui masquerait l'échec.
- Dépôt public : aucun numéro de téléphone, e-mail ni plaque dans `config/` (la
  validation refuse aussi les clés nommées `contact`, `telephone`, `email`).
- Après chaque publication, vérifier la page en ligne, pas seulement la version
  locale.
