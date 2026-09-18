# Photos des lieux

Déposer les images ici, puis les déclarer dans la fiche du lieu, dans
`config/commun/lieux.json` :

```json
"photos": [
  { "fichier": "lagazuoi-vue.jpg", "legende": "Vue depuis la terrasse du refuge", "credit": "photo perso" },
  { "url": "https://upload.wikimedia.org/…/Lagazuoi.jpg", "legende": "Le téléphérique", "credit": "Wikimedia, CC BY-SA 4.0" }
]
```

`fichier` désigne une image de ce dossier, `url` une image distante. Les deux
peuvent cohabiter dans la même liste.

## Deux règles, parce que le dépôt est public

**Ne verser ici que des photos dont on a le droit.** Les siennes, ou des images
sous licence libre — Wikimedia Commons et Unsplash conviennent. Une photo prise
sur un site de tourisme ou un blog est protégée : la republier dans un dépôt
public est une contrefaçon.

**Toujours renseigner `credit`.** Une licence libre impose presque toujours de
citer l'auteur. La page affiche ce champ sous la photo.

## Poids

Les images de ce dossier sont **embarquées dans le fichier hors ligne**, encodées
en base64 : elles pèsent alors un tiers de plus. Le build refuse de dépasser
15 Mo au total et affiche le détail.

Redimensionner avant de déposer — 1600 px de large suffisent largement :

```bash
mogrify -resize 1600x -quality 82 photos/*.jpg     # ImageMagick
```

Une photo déclarée par `url` n'alourdit pas le fichier hors ligne, mais ne
s'affiche pas sans réseau.
