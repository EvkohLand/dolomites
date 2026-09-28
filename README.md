# Dolomites — carnet de voyage

Une page unique qui rassemble tout le séjour : carte de l'itinéraire par la route,
lieux où dormir avec leurs prix, randonnées, remontées mécaniques, budget par poste,
météo attendue et règles à connaître.

**Tout le contenu vit dans `config/`.** Ajouter une étape, un lieu ou une dépense se
fait en modifiant un fichier JSON — jamais une ligne de code.

## Voir la page

```bash
./go.sh          # valide, construit, ouvre le navigateur
./go.sh build    # valide et construit seulement
```

Après un `git push` sur `main`, GitHub Actions valide, construit et publie.
La page en ligne propose un bouton **Version hors ligne** : un fichier `.html` unique
à garder sur le téléphone, qui fonctionne sans réseau dans les vallées.

## Ajouter un lieu sur la carte

Dans `config/commun/lieux.json`, ajouter un objet. Seuls `id`, `nom`, `categorie` et
`gps` sont obligatoires ; tout le reste est facultatif et ne s'affiche que s'il existe.

```json
{
  "id": "rifugio-fanes",
  "nom": "Rifugio Fanes",
  "categorie": "plateau",
  "gps": [46.6431, 12.0417],
  "commune": "Parc Fanes-Sennes (BZ)",
  "altitude": 2060,
  "resume": "Refuge sur le haut plateau, une ligne qui apparaît dans la liste.",
  "description": "Texte long, affiché seulement dans la fiche plein écran.",
  "niveau_prix": "€€",
  "prix": { "type": "payant", "montant": 25, "unite": "nuit", "annee_tarif": 2025 },
  "ouverture": { "fin_saison": "2026-10-05", "a_reverifier": true },
  "chien": { "admis": true, "supplement": 0, "note": "Laisse obligatoire." },
  "equipements": ["refuge", "restaurant", "douches", "chien"],
  "liens": [{ "libelle": "Site du refuge", "url": "https://exemple.it" }],
  "photos": [{ "fichier": "fanes.jpg", "legende": "Le plateau", "credit": "photo perso" }],
  "source": "https://exemple.it/tarifs"
}
```

L'identifiant `id` sert de référence partout ailleurs : dans le planning, le budget et
l'itinéraire, on écrit `"rifugio-fanes"`, jamais le nom ni le prix. Un prix n'est donc
saisi qu'à un seul endroit.

`prix.type` vaut `gratuit`, `payant`, `inclus` ou `variable`.
`niveau_prix` va de `€` à `€€€€`.
Les valeurs possibles d'`equipements` sont listées dans `config/commun/equipements.json`.

Une catégorie inconnue s'affiche en gris et apparaît quand même dans les filtres ;
pour lui donner une couleur et un nom, l'ajouter à `config/commun/categories.json`.

## Ajouter une étape au planning

Dans `config/scenarios/<scénario>/planning.json` :

```json
{
  "date": "2026-10-15", "jour": 6,
  "titre": "Alpe di Fanes",
  "zone": "Braies",
  "nuit": "camping-olympia",
  "activites": [
    { "lieu": "alpe-fanes", "heure": "09:00", "note": "Monter tôt." }
  ],
  "note": "Journée calme."
}
```

`nuit` et `lieu` contiennent un `id` de `lieux.json`. Le budget s'actualise seul :
la nuit alimente l'hébergement, les activités payantes la ligne activités.

## Changer le budget

Le budget de base ne compte que l'indispensable : nuits, carburant, nourriture,
marge, et les accès payants qu'une fiche de lieu déclare `"budget": "indispensable"`
avec sa raison (`raison_budget`). Tout le reste est une **option**, affichée avec son
prix et une case à cocher : chaque remontée ou activité payante, et toute ligne
saisie marquée `"option": true`. Les péages de l'aller et du retour, faits par
l'autoroute, sont comptés d'office. Aucune remontée mécanique ni randonnée classée
vertige « fort » ne peut figurer au programme : `node validate.js` le refuse. Les
cases cochées sont mémorisées dans le navigateur.

`config/scenarios/<scénario>/budget.json` ne recopie aucun prix. Il contient des règles
qui vont les chercher, et des lignes saisies pour ce qui ne vient d'aucun lieu
(courses, forfaits, marge).

Le carburant se calcule à partir de deux fichiers dédiés :
`config/commun/vehicule.json` (consommation, surconsommation due à la tente de toit)
et `config/commun/carburant.json` (prix du litre par pays). Chaque étape de
l'itinéraire porte son `pays`, donc un plein en France et un plein en Italie ne sont
pas comptés au même prix.

## Ajouter un scénario

Un scénario est une durée de séjour. Pour en créer un :

```bash
cp -r config/scenarios/14-jours config/scenarios/7-jours
```

Adapter les cinq fichiers du nouveau dossier, puis ajouter une entrée dans
`config/scenarios.json`. Les lieux, catégories, équipements, météo et règles restent
communs à tous les scénarios : ils ne sont jamais dupliqués.

## L'itinéraire par la route

L'aller et le retour depuis Saint-Gély se font **par l'autoroute** (étapes marquées
`"autoroute": true` dans le planning, avec leurs `troncons_peage` comptés au budget ;
`"sans_autoroute_apres"` reprend les routes gratuites après une sortie). Dans les
Dolomites, le tracé suit les vraies routes **sans péage**. Il est calculé une fois et figé dans
`config/scenarios/<scénario>/trace.json`. Le calcul passe par Valhalla (serveur
public FOSSGIS) : l'OSRM public ne sait pas exclure les péages. Une étape peut
imposer des points de passage sans arrêt (`via_gps`), lister ses tronçons à péage
(`troncons_peage`, décrits dans `config/commun/peages.json`) ou garder une route de
montagne payante dont le prix est porté par la fiche d'un lieu (`peage_local`).
Après avoir modifié les étapes :

```bash
node trace-route.js            # recalcule tous les scénarios
node trace-route.js 14-jours   # un seul
```

Sans ce fichier, la carte affiche une ligne droite en pointillés et le signale dans
le panneau d'anomalies en bas de page.

## Données en direct

La vue d'une étape (`#jour-3`) affiche, en plus du programme :

| Bloc | Source | Comment | Fréquence |
|---|---|---|---|
| Carburant sur la route | France : flux officiel prix-carburants ; Italie : Osservaprezzi (MIMIT) | fichier `config/commun/carburant-live.json` ; les prix français sont relus en direct par la page | chaque jour vers 9 h 40 |
| Routes et cols | centrale trafic de la Province de Bolzano, avis Veneto Strade | lus en direct par la page | à chaque ouverture |
| Routes et cols | ANAS (routes nationales) | fichier `config/commun/routes-live.json`, aussi copie de secours des deux autres | toutes les 3 heures |
| Webcams | Panomax, foto-webcam.eu | `config/commun/webcams.json`, par `id` de lieu | images renouvelées toutes les 10 min |
| Lever et coucher du soleil | calcul dans la page | aucune requête | — |

Les deux fichiers sont produits par le workflow « Actualiser les données en direct »,
qui relance la publication quand ils changent. Le prix italien ne peut pas être lu
depuis la page : le ministère n'autorise pas l'appel depuis un navigateur. Pour les
produire à la main :

```bash
node scripts/carburant-live.js   # stations à moins de 5 km du tracé de chaque jour
node scripts/routes-live.js      # messages de circulation près des tracés
```

Quand un prix du jour existe, le budget compte le carburant de l'étape au prix moyen
des trois stations les moins chères du tracé, au lieu du prix indicatif de
`carburant.json`. Hors ligne, la page affiche la dernière copie, ou masque le bloc.

## Photos

Déposer les images dans `photos/`, puis les déclarer dans la fiche du lieu.
Voir `photos/LISEZMOI.md` — en particulier la règle sur les droits, puisque le dépôt
est public.

## Données personnelles

**Le dépôt est public.** La validation refuse de publier si elle détecte une adresse
e-mail, un numéro de téléphone ou une plaque d'immatriculation dans un fichier de
configuration. Le point de départ est donné au niveau de la commune, jamais d'une rue.

Ce qui doit rester privé (numéros de réservation, contacts) va dans
`config/prive.json`, exclu de git. La page fonctionne sans ce fichier.

## Si quelque chose ne marche pas

```bash
node validate.js
```

Le message nomme le fichier et la ligne fautive. C'est la même vérification qui tourne
dans GitHub Actions avant chaque publication : tant qu'elle échoue, rien n'est publié
et la page en ligne reste celle d'avant.

Les anomalies non bloquantes (référence cassée, tracé manquant) apparaissent dans un
panneau repliable en bas de la page.

## Préparer le départ d'octobre 2026

Le [comparatif des campings et des courses](docs/campings-et-ravitaillement-2026.md)
croise les dates des six scénarios (5, 7, 8, 10, 14 et 16 jours) avec les tarifs publiés, les réponses reçues,
les terrains privés, l'accès des chiens aux magasins et la hauteur de 1,95 m du
véhicule. Il distingue devis, estimations et disponibilités encore inconnues.

La [comparaison des durées et des expéditions Vinted](docs/vinted-et-fenetres-octobre-2026.md)
explique les dates choisies : toutes les durées partent le **vendredi 9 octobre à
13 h**. Le parcours de **huit jours, du 9 au 16 octobre**, est sélectionné par
défaut ; aucune durée ne suppose une tolérance supplémentaire de 48 heures pour
envoyer les colis.

Chaque randonnée de `config/commun/randonnees.json` porte un champ `vertige`
(`aucun`, `léger`, `fort`) ; la vue du jour affiche un badge et replie à part
les randonnées « fort », marquées déconseillées.

Plusieurs prix et dates de fermeture 2026 sont désormais vérifiés, notamment le
Lagazuoi et le camping Olympia ; les fiches encore incertaines portent
`"a_reverifier": true`. Recontrôler avant de partir les conditions météo, l'accès
aux cols et le camping de chaque nuit. Aucune place n'est présumée réservée.
