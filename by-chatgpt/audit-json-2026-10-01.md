# Audit JSON — 1er octobre 2026

## Périmètre

Contrôle ciblé du scénario par défaut `8-jours`, avec priorité aux contraintes qui peuvent faire rater une journée ou imposer une réservation inutile.

## Corrections intégrées

### Alpe di Siusi — lundi 12 octobre

Source officielle :
https://www.seiseralm.it/en/info-service/mobility/parking.html

Faits vérifiés le 01/10/2026 :
- P1 Spitzbühl : 15 € / voiture / jour ;
- réservation en ligne obligatoire ;
- réservation disponible à partir de J−6 et encore possible le matin même avant 09:00 s’il reste des places ;
- route fermée à la montée aux véhicules privés de 09:00 à 17:00.

Le planning prévoyait une arrivée à 08:47, soit seulement 13 minutes de marge. Le scénario `8-jours` est avancé de 25 minutes : départ 07:15, arrivée P1 08:22, puis horaires aval décalés de 25 minutes. La marge avant 09:00 passe à environ 38 minutes.

### Lago di Braies — jeudi 15 octobre

Source officielle :
https://www.prags.bz/en

Faits vérifiés le 01/10/2026 :
- la réglementation routière 2026 était en vigueur du 01/07 au 15/09, de 09:00 à 16:00 ;
- à partir du 16/09, aucune réservation en ligne n’est nécessaire pour entrer dans la vallée ;
- les parkings au lac restent payants et soumis à disponibilité.

Le planning précise désormais explicitement que le 15 octobre est hors période réglementée et que P2 est payant.

## Point restant à harmoniser

`config/commun/decouvertes.json` contient encore, dans la fiche Alpe di Siusi, une formulation ambiguë du type « réservation en ligne obligatoire jusqu’à 6 jours avant ». La formulation exacte doit être : réservation possible **à partir de J−6**, puis jusqu’au matin même avant 09:00 sous réserve de disponibilité. À corriger lors d’une prochaine édition de ce gros fichier afin d’éviter une réécriture risquée non ciblée.
