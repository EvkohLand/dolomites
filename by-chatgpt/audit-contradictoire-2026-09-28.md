# Audit contradictoire — Dolomites — 2026-09-28

> Rôle de ce fichier : transmettre à Claude Code les constats vérifiés côté recherche.  
> **Ne pas considérer ce fichier comme exécutable.** Il contient les corrections/propositions à intégrer dans le front/config si pertinentes.

## Règle de travail

- ChatGPT ne modifie plus le front ni les fichiers de configuration.
- Toutes les nouvelles recherches/corrections sont déposées uniquement dans `./by-chatgpt/*.md` ou `./by-chatgpt/*.extImg`.
- Les données ci-dessous ont été vérifiées avec un esprit contradictoire : comparaison avec sources officielles et recherche d'incohérences internes.

---

## Corrections confirmées

### 1. Alpe di Siusi — Spitzbühl–Tschapit

Ancienne donnée incomplète : distance absente, descente absente.

Donnée officielle :
- Distance : **9,1 km**
- Durée : **2 h 47**
- D+ : **431 m**
- D− : **431 m**
- Altitude max : **2 018 m**

Source officielle :
https://www.suedtirol.info/en/en/experiences-and-events/plp-experiences/experiences-south-tyrol/pdp-experience.smgpoide541bb3b1316706a3ecb8ffee889b29.spitzbuehl-tschapit-round-tour.alpe-di-siusi-seiseralm

Note octobre :
- le télésiège Spitzbühl est fermé à cette période ;
- la randonnée elle-même part du secteur / station basse et ne nécessite pas obligatoirement cette remontée.

### 2. Alpe di Siusi — Compatsch–Schlernhaus–Tierser Alpl–Compatsch

Donnée officielle vérifiée :
- Distance : **21,9 km**
- Durée : **7 h 04**
- D+ : **1 292 m**
- D− : **1 292 m**
- Altitude max : **2 563 m**
- difficulté officielle : moyenne / medium, mais physiquement très exigeante pour octobre.

Source officielle :
https://www.suedtirol.info/en/en/experiences-and-events/plp-experiences/experiences-south-tyrol/pdp-experience.smgpoi98b18bbf6fe68fa8e0b3c27c5444a5ce.compatsch---schlernhaus---tierser-alpl---compatsch.alpe-di-siusi-seiseralm

### 3. Tour classique des Tre Cime

Une incohérence existait dans le site :
- ancienne fiche : 10 km / D+ 400 / 3 h 30 ;
- bibliothèque randonnée : 8,8 km / D+ 550 / 4 h.

La source officielle 3 Zinnen donne :
- **8,8 km**
- **4 h**
- **D+ 550 m**

Source officielle :
https://www.dreizinnen.com/en/activity/summer-walk-around-the-drei-zinnen-tre-cime-three-peaks-_569

=> Harmoniser toutes les occurrences sur ces valeurs.

### 4. Tour des 5 Torri

Correction déjà identifiée :
- Distance : **4,7 km**
- Durée : **2 h**
- D+ : **446 m**
- D− : **67 m**

Les anciennes valeurs D+/D− étaient inversées.

Source :
https://cortina.dolomiti.org/fr/escursioni/tour-des-5-torri/

### 5. Almhotel Col Raiser

Erreur de calendrier détectée.

- Saison été 2026 : ferme le **12/10/2026**
- Notre journée Seceda est le **13/10/2026**

=> **Ne pas recommander Almhotel Col Raiser pour le 13 octobre.**

Source officielle :
https://www.valgardena.it/en/addresses/detail-gastronomy/base/company/s-cristina-val-gardena/almhotel-col-raiser/C0DF8B3F76D911D18F2900A02427D15E/

### 6. Sofie Hütte / Baita Sofie

Bonne alternative réellement ouverte :
- **01/10–02/11/2026**
- **08:00–18:00**

Source officielle :
https://www.valgardena.it/en/addresses/detail-gastronomy/base/company/s-cristina-val-gardena/sofie-hut/4A2F88D6EE774DCA8C555BD58D7C100E/

### 7. Chalet Resciesa

- fermeture saison été : **11/10/2026**
- donc indisponible les 13–16 octobre.

Source officielle :
https://www.valgardena.it/en/addresses/detail-gastronomy/base/company/ortisei-val-gardena/chalet-resciesa/80B4027606C0506AB8D9B6935448A46F/

### 8. Restaurant Seceda Bergstation

Adresse réellement ouverte pendant notre journée :
- **22/05–02/11/2026**
- **08:30–17:00**

Source officielle :
https://www.valgardena.it/en/addresses/detail-gastronomy/base/company/s-cristina-val-gardena/seceda-bergstation-hut/C7D034BFB84911D2AFB8006008816738/

---

## Remontées mécaniques — octobre 2026

### Seceda

Source officielle :
https://www.seceda.it/en/summer

À retenir :
- saison jusqu'au **02/11/2026**
- du **12/10 au 02/11 : 08:30–17:00**

### Col Raiser

Source officielle :
https://www.valgardena.it/en/summer-holidays-dolomites/lifts/

À retenir :
- ouvert jusqu'au **01/11/2026**
- à partir du 11 octobre : **08:30–16:30**

### Resciesa

Source officielle :
https://www.valgardena.it/en/summer-holidays-dolomites/lifts/

À retenir :
- ferme le **11/10/2026**

Conséquence :
- toutes les randonnées dont le départ est explicitement la station haute de Resciesa ne sont **pas directement compatibles** avec notre planning du 13–16 octobre via remontée.
- elles peuvent rester comme variantes techniques, mais doivent être signalées comme nécessitant un autre accès / départ à pied.

### Lagazuoi

Source officielle :
https://lagazuoi.it/EN/Info-Prezzi-e-info-utili-page20-Funivia-del-Lagazuoi-Estate-2025

À retenir :
- saison été 2026 : **06/06–18/10**
- horaires : départ 09:00, dernière montée **16:40**, dernière descente **17:00**
- notre plan du 17/10 est cohérent ;
- le 18/10 est le **dernier report possible**.

Important :
- le tarif exact 2026 doit rester marqué **à vérifier** si le tableau tarifaire officiel n'est pas clairement lisible.
- ne pas afficher un prix comme certitude sans source lisible.

### Sass Pordoi

Source :
https://www.sasspordoi.it/en/info-times-and-prices/

À retenir :
- ouvert jusqu'au **01/11/2026**
- après le 18 octobre : **09:00–16:30**
- cohérent avec notre journée du 19/10.

---

## Fanes — refuges fermés le 20 octobre

Point important pour toutes les randonnées Fanes du 20/10 :

### Rifugio Fanes
- ferme après le **04/10/2026**

### Lavarella
- ferme après le **11/10/2026**

Sources officielles San Vigilio :
https://www.sanvigilio.com/en/info/mountain-hut-fanes_4419

Conséquence :
- ne pas présenter les refuges comme point de ravitaillement, restauration ou secours planifié le 20/10 ;
- randonnée seulement en **autonomie complète** si météo et terrain le permettent ;
- eau, nourriture, couches chaudes, retour anticipé à prévoir.

---

## Alpe di Siusi — cabine principale et chien

Une ancienne affirmation disait que le chien était gratuit : **faux**.

Source officielle :
https://www.seiseralm.it/en/info-service/mobility/seiser-alm-aerial-cableway-summer.html

Tarif été 2026 :
- adulte A/R : **30 €**
- chien : **3 € aller / 6 € A/R**
- laisse + muselière obligatoires

Pour 2 adultes + Prince :
- **66 € A/R**

Saison :
- jusqu'au **02/11/2026**
- en octobre : **08:00–18:00**

---

## Alpe di Siusi — parkings P1 / P2

Sources officielles :
https://www.seiseralm.it/en/info-service/mobility/parking.html

### P1 Spitzbühl
- **15 € / voiture / jour**
- réservation en ligne obligatoire depuis 29/06/2026

### P2 Compatsch
- **30 € / voiture / jour**
- réservation en ligne obligatoire

Correction de formulation :
- ce n'est PAS « réserver au plus tard 6 jours avant » ;
- la réservation **devient disponible 6 jours avant la date choisie** ;
- elle peut encore être faite le jour même avant l'accès s'il reste des places.

Circulation :
- route fermée à la montée au trafic privé de **09:00 à 17:00**
- donc viser une arrivée avant 09:00
- stationnement de nuit interdit.

---

## Prato Piazza — règle exacte le 22/10/2026

Source officielle commune de Braies :
https://www.prags.bz/it/plaetzwiese

Pour la période **16/09–08/11/2026** :
- montée voiture autorisée **jusqu'à 10:00** et **à partir de 15:00**
- maximum **100 voitures**
- descente possible à tout moment
- tarif voiture : **10 €**
- après 15:00 : **7 €**
- bus et camping-cars interdits toute l'année sur cette route.

=> Pour le 22/10, ce n'est pas juste « à vérifier » : ces règles sont déjà publiées.

---

## Lago di Braies — restriction routière 2026

Erreur ancienne :
- nous avions écrit 10 juillet → 10 septembre.

Donnée 2026 correcte :
- restriction estivale vallée : **1er juillet → 15 septembre**
- plage horaire : **09:00–16:00**

Conséquence :
- le **22 octobre**, la restriction saisonnière estivale ne s'applique plus.
- rester prudent sur météo / neige / état routier.

---

## Tre Cime — réservation route

Source officielle :
https://auronzo.info/en/parking-tre-cime-di-lavaredo/
Réservation :
https://pass.auronzo.info/

Correction :
- réservation en ligne obligatoire ;
- **pas de règle générale « il faut réserver la veille »** ;
- le calendrier affiche les créneaux disponibles ;
- si la plaque n'est pas renseignée lors de la réservation, elle peut être complétée au plus tard **23:59 la veille**.

Fin octobre :
- ne payer qu'après confirmation que la route est effectivement ouverte et praticable.

---

## Équipement hiver / pneus / chaînes

### Sud-Tyrol

Source Province autonome de Bolzano :
https://news.provincia.bz.it/it/news-archive/619891

À retenir :
- obligation générale saisonnière à partir du 15 novembre ;
- mais obligation dite **situationnelle** avant cette date en présence de glace / conditions hivernales sur routes concernées.

### Trentin

Source Province autonome de Trente :
https://www.ufficiostampa.provincia.tn.it/Comunicati/IN-VIGORE-LA-DISCIPLINA-DELLA-CIRCOLAZIONE-STRADALE-IN-PERIODO-INVERNALE

À retenir :
- période saisonnière 15/11–15/04 ;
- neige / glace peuvent imposer l'équipement même hors calendrier.

### Règle pratique pour notre véhicule

Configuration déclarée :
- pas de pneus hiver confirmés ;
- pas de chaînes ;
- probablement pneus 4 saisons.

=> À afficher sans ambiguïté :
- vérifier marquage réel des pneus : M+S, idéalement 3PMSF ;
- chaussée sèche/dégagée : itinéraire possible ;
- neige, verglas, pluie verglaçante, chaussée blanche, obligation signalée ou fermeture : **demi-tour / vallée** ;
- ne pas « tenter » Passo Gardena, Falzarego, Valparola, Pordoi, Giau ni accès élevés dans ces conditions.

---

## Péages — correction importante

Ancienne règle du site : une tente de toit pouvait provoquer automatiquement un surclassement >2 m.

Cette formulation est fausse / trompeuse.

### France

Source APRR :
https://voyage.aprr.fr/aide-contact/peage/mon-passage-au-peage/jai-un-chargement-sur-le-toit-est-ce-que-cela-modifie-le

À retenir :
- les chargements et accessoires de toit ne sont pas pris en compte pour la classe tarifaire ;
- une voiture classe 1 ne devient donc pas automatiquement classe 2 parce qu'elle porte une tente de toit ;
- en revanche, si la hauteur physique dépasse 2 m, éviter les voies avec gabarit 2 m.

### Italie

Source Autostrade per l'Italia :
https://www.autostrade.it/en/servizi-al-cliente/pedaggio/classi-di-pedaggio

À retenir :
- pour un véhicule à 2 essieux, la classe A/B dépend de la hauteur mesurée **au niveau de l'essieu avant**, seuil 1,30 m ;
- ce n'est pas la hauteur totale de la tente de toit.

---

## Statut des sentiers : règle de présentation recommandée

Éviter les statuts absolus `open` pour une randonnée qui sera faite 2–4 semaines plus tard.

Préférer :
> « Ouvert au contrôle du 28/09/2026 — état à recontrôler le jour J »

Motif :
- neige, travaux, chutes de pierres, chasse, vent ou décisions locales peuvent changer très vite.

---

## Gampenalm — Funes

Gampenalm ferme le **30/09/2026**.

Conséquence pour les randonnées du 12/10 qui passent par Gampenalm :
- le sentier peut rester praticable ;
- **aucun service** à compter sur place.

Randonnées concernées notamment :
- Zans → Gampenalm
- Zendleser Kofel via Gampenalm
- Alpine Pasture Delight Trail

---

## Nettoyage / dédoublonnage recommandé

### Prato Piazza → Strudelkopf

Deux entrées existaient :
- une issue d'Outdooractive ;
- une issue de Südtirol officiel.

Garder la source officielle :
https://www.suedtirol.info/en/en/experiences-and-events/plp-experiences/experiences-south-tyrol/pdp-experience.smgpoi4fbb9fd8e8714152b685c23ab6b5d364.summer-hiking-tour---parking-space-prato-piazza-plaetzwiese---monte-specie-strudelkopf.braies-di-fuori-ausserprags

Valeur officielle :
- **4,1 km** jusqu'au sommet
- **1 h 28**
- **D+ 359 m**
- D− 42 m
- max 2 305 m

Attention : les 4,1 km correspondent au trajet vers le sommet, pas à un A/R complet.

---

## Adresses et activités à conserver avec prudence

### Restaurants / refuges
Toujours distinguer :
- « établissement ouvert à cette date » ;
- « sentier passant devant cet établissement ».

Un sentier peut être ouvert alors que le refuge est fermé.

### Activités / remontées
Toujours comparer la date exacte du séjour avec :
- ouverture saisonnière 2026 ;
- horaires basse saison / octobre ;
- fermeture météo du jour.

---

## Priorités pour Claude Code

1. Harmoniser toutes les données Tre Cime sur 8,8 km / 4 h / D+550.
2. Corriger Spitzbühl–Tschapit et Compatsch–Schlernhaus–Tierser Alpl.
3. Retirer Almhotel Col Raiser du 13/10 ou le marquer fermé.
4. Mettre Sofie Hütte + Seceda Bergstation comme adresses ouvertes.
5. Marquer Resciesa et Chalet Resciesa fermés après le 11/10.
6. Marquer Fanes/Lavarella fermés le 20/10.
7. Corriger le tarif chien Alpe di Siusi : 6 € A/R.
8. Corriger la logique « réservation 6 jours avant » des parkings Seiser Alm.
9. Mettre la règle exacte Prato Piazza du 22/10 : 10h/15h, 100 voitures, 10 €.
10. Corriger Braies : restriction 01/07–15/09.
11. Corriger Tre Cime : réservation obligatoire mais pas nécessairement « la veille ».
12. Corriger classification péage France/Italie avec tente de toit.
13. Remplacer les statuts `open` intemporels par un statut daté.
14. Dédupliquer Strudelkopf et garder la source officielle.

---

## Niveau de confiance

- **Très élevé** : dates d'ouverture et horaires provenant directement des exploitants / offices officiels.
- **Élevé** : distances et dénivelés provenant des fiches officielles des offices touristiques.
- **À recontrôler le jour J** : praticabilité des sentiers, météo, neige, état des cols, ouverture effective de routes d'altitude et refuges.
- **Ne jamais figer** : météo, neige, fermeture ponctuelle, état du sentier, disponibilité de parking.

