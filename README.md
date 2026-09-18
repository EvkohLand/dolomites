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

Adapter les quatre fichiers du nouveau dossier, puis ajouter une entrée dans
`config/scenarios.json`. Les lieux, catégories, équipements, météo et règles restent
communs à tous les scénarios : ils ne sont jamais dupliqués.

## L'itinéraire par la route

Le tracé suit les vraies routes, calculé une fois et figé dans
`config/scenarios/<scénario>/trace.json`. Après avoir modifié les étapes :

```bash
node trace-route.js            # recalcule tous les scénarios
node trace-route.js 14-jours   # un seul
```

Sans ce fichier, la carte affiche une ligne droite en pointillés et le signale dans
le panneau d'anomalies en bas de page.

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

## Ce qui reste à revérifier avant de partir

Les tarifs et dates de fermeture sont ceux de la saison 2025 : les calendriers 2026 ne
sont pas tous publiés. Les fiches concernées portent `"a_reverifier": true` et
affichent une pastille orange. À reprendre une par une avant le départ — en particulier
la fermeture du téléphérique du Lagazuoi, qui tombe pendant le séjour.
