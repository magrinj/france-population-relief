<a href="https://www.linkedin.com/in/jeremy-magrin/">
  <img src=".github/assets/reliefs-banner.jpg" alt="Reliefs — la France dessinée par ses habitants" width="100%" />
</a>

[![en](https://img.shields.io/badge/lang-english-informational.svg)](README.md)
[![fr](https://img.shields.io/badge/lang-fran%C3%A7ais-blue.svg)](README.fr.md)

# Reliefs — la France dessinée par ses habitants

[![licence](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![données](https://img.shields.io/badge/INSEE-Licence%20Ouverte-orange.svg)](#licences)
[![données](https://img.shields.io/badge/Cassini-CC%20BY-orange.svg)](#licences)
[![site](https://img.shields.io/badge/en%20ligne-france--population--relief.pages.dev-3b82f6.svg)](https://france-population-relief.pages.dev)
[![Deploy](https://github.com/magrinj/france-population-relief/actions/workflows/deploy.yml/badge.svg)](https://github.com/magrinj/france-population-relief/actions/workflows/deploy.yml)

Chacune des **34 746 communes** de France métropolitaine, Corse comprise, dessinée par ses habitants, du **premier recensement de 1793** à **2023**. Une carte en relief : la hauteur et la couleur sont la densité de chaque commune, sur une seule échelle fixe pour toute la période, si bien que le pays se remplit sous vos yeux. En 1793, presque tout est sous l’eau et les villes sont des îles ; en 2023, les plaines ont émergé, les campagnes vidées sont retombées sous l’eau et Paris est dans la neige.

Tout vient des chiffres publics des recensements, rien d’un modèle. L’idée et le rendu suivent [Germany, drawn by its people](https://chillchamp1.github.io/lab/bevoelkerung-kreise/) de chillchamp1, adaptés à la France à l’échelle communale et prolongés jusqu’à la Révolution.

<video src="https://github.com/user-attachments/assets/placeholder" width="100%"></video>

## Ce que la carte montre

Chiffres tirés des données embarquées (`npm test` les vérifie).

| | |
|---|---|
| Communes | **34 746** (géographie 2025, Paris en une commune, hors outre-mer) |
| Recensements | **51**, de l’an II (1793) à 2023 ; annuels depuis 2006 |
| 1793 | 28,2 M comptés dans 33 097 communes ; Paris 656 000 |
| 1876 | 38,4 M ; l’Alsace-Moselle est comptée par les recensements allemands jusqu’en 1911 |
| 1911 | 41,4 M, Paris à son sommet (2,89 M) |
| 1921 | 39,2 M, moins qu’en 1911 |
| 2023 | 66,2 M en métropole |
| Cassini contre INSEE, 1999 | 34 534 communes identiques sur 34 688, écart total 0,04 % |

Survolez la carte pour le département sous le curseur : son contour, sa population à l’année en cours, sa densité, sa part de la France, sa croissance depuis 1793 et toute sa série, plus la commune elle-même. Cliquez sur un département pour zoomer dessus (nouveau clic, ou clic dans la mer, pour revenir), molette pour zoomer sous le curseur, `+`, `−` et Échap au clavier. Lecture à 1×, 2× ou 4×, inclinaison et rotation du relief (ou glissez-le), noms des villes, bascule français / anglais (langue du navigateur par défaut, `?lang=en` ou `?lang=fr` pour forcer). Les périodes historiques défilent à gauche au fil des années, et chacune clignote quelques secondes là où elle s’est jouée : Roubaix et ses filatures, Verdun, Le Havre rasé, Sarcelles, Longwy.

## Lancer

```sh
npm install
npm run dev
```

Ouvrir http://localhost:5173. `npm run build` produit un site statique dans `dist/` (sans serveur ni clé d’API), `npm run preview` le sert, `npm test` vérifie les calculs, les données embarquées et, si Chrome est installé, le rendu lui-même.

## Données et méthode

`public/data/` contient trois fichiers produits par `npm run data` (environ 4 Mo, sources en cache dans `.cache/`) :

- `meta.json` : les communes (code, nom, département, superficie en km², point d’étiquette), les départements et les années de recensement.
- `pop.bin` : la population de chaque commune à chaque recensement, en varints delta ; un chiffre absent reste absent.
- `grid.bin` : une grille de 1 km en Lambert-93 (1224 × 1145 cellules), chaque cellule portant sa commune, en codage par plages.

Sources :

- **INSEE, Séries historiques de population 1876-2023** ([statistiques/3698339](https://www.insee.fr/fr/statistiques/3698339)) : 37 recensements par commune, déjà en géographie au 1er janvier 2025. La Corse manque avant 1936 et il n’y a pas de chiffre 1946.
- **EHESS / LaDéHiS, *Des villages de Cassini aux communes d’aujourd’hui*** ([Didómena](https://didomena.ehess.fr/concern/data_sets/6395wb092)) : 33 recensements de l’an II à 1999 pour 43 792 lieux, chacun rattaché à son code commune de mars 2021. Les lieux sont sommés par commune, puis ramenés aux codes 2025 par la table des mouvements de communes de l’INSEE. L’INSEE l’emporte quand les deux existent ; Cassini comble 1793-1872, 1946 et la Corse avant 1936.
- **INSEE, Code officiel géographique 2025** (noms, mouvements) et **Etalab / IGN Admin Express 2025** (contours à 100 m, projetés en Lambert-93 puis rastérisés).

Les deux séries concordent : en 1876, 98 % des communes ont exactement le même chiffre dans les deux ; en 1999, 99,6 %. Détail dans `public/data/qa.json`.

Interprétation :

- La **densité** est le chiffre divisé par la superficie actuelle de la commune : une commune fusionnée est comparée à elle-même dans le temps.
- L’échelle est **logarithmique et fixe** : de 8 à 16 000 habitants au km² sur 25 bandes. La terre commence à la sixième bande, environ 40 au km² ; les rouges commencent au-dessus de 4 000, que les grandes villes atteignent, et les deux bandes les plus hautes (roche et neige) au-dessus de 9 000, que seuls Paris et son cœur atteignent. Une même couleur veut dire une même densité quelle que soit l’année.
- Entre deux recensements, le chiffre suit une **cubique monotone en échelle logarithmique** (Fritsch-Carlson) : chaque recensement est conservé exactement, rien ne dépasse, et la vitesse de croissance ne saute pas à chaque recensement. Une commune sans chiffre à un recensement garde le plus proche, d’où un total national en 1793 (29,4 M) un peu au-dessus des 28,2 M réellement comptés.
- Le relief est le champ de densité lissé à deux échelles (5 km et 36 km), éclairé du nord-ouest, avec une courbe de niveau à chaque limite de bande. Le lissage abaisse un peu les sommets : le champ à Paris vaut environ 0,95 fois sa propre valeur.

## Rendu

WebGL2 via three.js. La grille des communes et les valeurs de l’instant vont sur le GPU sous forme de textures ; à chaque image où l’année change, une passe brute, deux flous séparables et une passe de combinaison reconstruisent le champ de hauteurs (1224 × 1145, demi-flottant), et un plan de 350 000 sommets s’y déplace. Couleur, éclairage, courbes de niveau et département survolé sont calculés dans le fragment shader. Une copie au quart de résolution du champ revient sur le CPU de façon asynchrone : les noms des villes s’y posent et le survol y lance un rayon, si bien que rien n’attend jamais le GPU. Les 35 000 séries sont échantillonnées dans des tableaux typés plats en 3 ms environ ; la page ne se redessine que quand quelque chose a changé. 60 images par seconde à 4× sur un portable de 2021, aucune image au-dessus de 16 ms.

## Enregistrer une vidéo

`?record` affiche la carte seule, bord à bord, avec l’année et une petite légende ; `?year=`, `?tilt=` (0-100), `?turn=` (0-360), `?speed=` et `?lang=` préréglent la vue. `node scripts/record-video.mjs http://localhost:5173/?lang=fr out/ [inclinaison=0.5] [rotation=0] [vitesse=2]` pilote un Chrome sans fenêtre en 2160 × 2160, joue toute la relecture (environ 22 s à 2×) et écrit les images ; puis `ffmpeg -f concat -safe 0 -i out/frames.txt -vf "scale=1080:1080:flags=lanczos,format=yuv420p" -r 60 -c:v libx264 -crf 16 out.mp4`. `node scripts/shot.mjs <url> out.png [année] [inclinaison] [rotation]` prend une capture.

## Automatisation

- `Check` : tests et build à chaque pull request.
- `Deploy` : tests, build et publication sur Cloudflare Pages à chaque push sur `main`. Secrets : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` ; variable : `CF_PAGES_PROJECT`.

## Licences

- **Le code** est sous [licence MIT](LICENSE).
- **Les données INSEE** (populations 1876-2023, code géographique) sont réutilisées sous [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- **Les données Cassini** (populations 1793-1999) sont © EHESS / LaDéHiS, [CC BY 3.0 FR](https://creativecommons.org/licenses/by/3.0/fr/) : *Motte, Claude ; Vouloir, Marie-Christine, Des chefs-lieux de Cassini aux communes de France (1756-1999)*, Didómena, 2021.
- **Les contours** dérivent d’IGN Admin Express via Etalab, Licence Ouverte 2.0.

## Limites connues

- France métropolitaine seulement ; les départements d’outre-mer ne sont pas sur la carte.
- Les chiffres de 1793 et 1800 sont grossiers par nature ; quelques milliers de communes n’ont pas de chiffre à certains recensements anciens et gardent le plus proche.
- La densité utilise les contours actuels ; la population ancienne d’une commune est répartie sur toute sa superficie d’aujourd’hui.
- Le lissage échange un peu de hauteur contre de la lisibilité : une commune très petite et très dense est plus basse sur la carte que sa seule densité ne le voudrait.

## Soutien

Si ce projet vous est utile, vous pouvez soutenir son développement :

<a href="https://buymeacoffee.com/magrinj" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50">
</a>

---

<p align="center">
  Vibe-codé avec ♥ par <a href="https://www.linkedin.com/in/jeremy-magrin/">Jérémy Magrin</a>
</p>

<p align="center">
  Si ça vous est utile, mettez une étoile ⭐ — ça aide beaucoup !
</p>
