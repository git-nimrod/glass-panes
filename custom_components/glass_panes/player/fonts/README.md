# Bundled fonts

Glass Panes bundles ten open-licence font families, so panes look the same on every display and nothing is fetched from the internet. A font file is downloaded by the browser only when a pane on screen uses that family, so a pane that uses none of them costs nothing.

All ten are licensed under the **SIL Open Font License 1.1**. Each family's licence text is in this folder as `LICENSE-<name>.txt`.

| Family | Upstream project |
|---|---|
| Inter | https://github.com/rsms/inter |
| Outfit | https://github.com/Outfitio/Outfit-Fonts |
| Jost | https://github.com/indestructible-type/Jost |
| Space Grotesk | https://github.com/floriankarsten/space-grotesk |
| JetBrains Mono | https://github.com/JetBrains/JetBrainsMono |
| Cormorant Garamond | https://github.com/CatharsisFonts/Cormorant |
| Playfair Display | https://github.com/clauseggers/Playfair-Display |
| Montserrat | https://github.com/JulietaUla/Montserrat.Git |
| Lora | https://github.com/cyrealtype/Lora-Cyrillic |
| DM Serif Display | https://fonts.google.com/specimen/DM+Serif+Display |

The files are Latin-subset WOFF2. The first five come in light (300) and regular (400), and Inter also in semibold (600). The other five are variable fonts, so one file covers a whole weight range. Any other weight in a pane is the nearest one available, adjusted by the browser.

Lora and Playfair Display carry a Reserved Font Name, and the files are unmodified copies as the fonts' distributor serves them (subset to Latin). DM Serif Display's licence names Adobe's "Source" as its Reserved Font Name, because it was derived from Source Serif. The licence text is bundled exactly as published.

## Lookalike fonts (`looks/`)

Free fonts that give the feel of famous paid or company-only fonts and screen looks (the builder's font menu shows what each looks like). Latin subsets as served by Google Fonts and Fontsource, unmodified by us; each family's licence text is `looks/LICENSE-<id>.txt`. Fonts with a Reserved Font Name keep the name because the files are exactly as their distributor publishes them. They download only when a pane uses them.

| Family (looks like) | Licence | Files | Source |
|---|---|---|---|
| Arimo (Helvetica / Arial) | SIL Open Font License 1.1 | `looks/arimo-latin-wght.woff2` | https://fontsource.org/fonts/arimo |
| GFS Didot (Didot) | SIL Open Font License 1.1 | `looks/gfs-didot-latin-400.woff2` | https://fontsource.org/fonts/gfs-didot |
| Bodoni Moda (Bodoni) | SIL Open Font License 1.1 | `looks/bodoni-moda-latin-wght.woff2` | https://fontsource.org/fonts/bodoni-moda |
| Libre Baskerville (Baskerville) | SIL Open Font License 1.1 | `looks/libre-baskerville-latin-wght.woff2` | https://fontsource.org/fonts/libre-baskerville |
| EB Garamond (Garamond) | SIL Open Font License 1.1 | `looks/eb-garamond-latin-wght.woff2` | https://fontsource.org/fonts/eb-garamond |
| Tinos (Times New Roman) | SIL Open Font License 1.1 | `looks/tinos-latin-400.woff2, tinos-latin-700.woff2` | https://fontsource.org/fonts/tinos |
| Gelasio (Georgia) | SIL Open Font License 1.1 | `looks/gelasio-latin-wght.woff2` | https://fontsource.org/fonts/gelasio |
| Crimson Pro (Minion) | SIL Open Font License 1.1 | `looks/crimson-pro-latin-wght.woff2` | https://fontsource.org/fonts/crimson-pro |
| Source Serif 4 (New York) | SIL Open Font License 1.1 | `looks/source-serif-4-latin-wght.woff2` | https://fontsource.org/fonts/source-serif-4 |
| Libre Franklin (Franklin Gothic) | SIL Open Font License 1.1 | `looks/libre-franklin-latin-wght.woff2` | https://fontsource.org/fonts/libre-franklin |
| News Cycle (News Gothic) | SIL Open Font License 1.1 | `looks/news-cycle-latin-400.woff2, news-cycle-latin-700.woff2` | https://fontsource.org/fonts/news-cycle |
| Nunito Sans (Avenir) | SIL Open Font License 1.1 | `looks/nunito-sans-latin-wght.woff2` | https://fontsource.org/fonts/nunito-sans |
| Hind (Frutiger (loose)) | SIL Open Font License 1.1 | `looks/hind-latin-400.woff2, hind-latin-700.woff2` | https://fontsource.org/fonts/hind |
| Hanken Grotesk (Univers (loose)) | SIL Open Font License 1.1 | `looks/hanken-grotesk-latin-wght.woff2` | https://fontsource.org/fonts/hanken-grotesk |
| Cinzel (Trajan) | SIL Open Font License 1.1 | `looks/cinzel-latin-wght.woff2` | https://fontsource.org/fonts/cinzel |
| Source Sans 3 (Myriad) | SIL Open Font License 1.1 | `looks/source-sans-3-latin-wght.woff2` | https://fontsource.org/fonts/source-sans-3 |
| Fira Sans (Officina / Meta) | SIL Open Font License 1.1 | `looks/fira-sans-latin-400.woff2, fira-sans-latin-700.woff2` | https://fontsource.org/fonts/fira-sans |
| Arvo (Lubalin Graph) | SIL Open Font License 1.1 | `looks/arvo-latin-400.woff2, arvo-latin-700.woff2` | https://fontsource.org/fonts/arvo |
| Stardos Stencil (stencil) | SIL Open Font License 1.1 | `looks/stardos-stencil-latin-400.woff2, stardos-stencil-latin-700.woff2` | https://fontsource.org/fonts/stardos-stencil |
| DM Sans (Circular) | SIL Open Font License 1.1 | `looks/dm-sans-latin-wght.woff2` | https://fontsource.org/fonts/dm-sans |
| Poppins (Product Sans) | SIL Open Font License 1.1 | `looks/poppins-latin-400.woff2, poppins-latin-700.woff2` | https://fontsource.org/fonts/poppins |
| Bebas Neue (tall condensed caps) | SIL Open Font License 1.1 | `looks/bebas-neue-latin-400.woff2` | https://fontsource.org/fonts/bebas-neue |
| Anton (Impact) | SIL Open Font License 1.1 | `looks/anton-latin-400.woff2` | https://fontsource.org/fonts/anton |
| Oswald (Knockout) | SIL Open Font License 1.1 | `looks/oswald-latin-wght.woff2` | https://fontsource.org/fonts/oswald |
| Pinyon Script (Spencerian pen script) | SIL Open Font License 1.1 | `looks/pinyon-script-latin-400.woff2` | https://fontsource.org/fonts/pinyon-script |
| Antonio (starship console) | SIL Open Font License 1.1 | `looks/antonio-latin-wght.woff2` | https://fontsource.org/fonts/antonio |
| Michroma (Microgramma / Eurostile) | SIL Open Font License 1.1 | `looks/michroma-latin-400.woff2` | https://fontsource.org/fonts/michroma |
| Orbitron (space age) | SIL Open Font License 1.1 | `looks/orbitron-latin-wght.woff2` | https://fontsource.org/fonts/orbitron |
| Monoton (80s neon) | SIL Open Font License 1.1 | `looks/monoton-latin-400.woff2` | https://fontsource.org/fonts/monoton |
| Audiowide (retro future) | SIL Open Font License 1.1 | `looks/audiowide-latin-400.woff2` | https://fontsource.org/fonts/audiowide |
| Press Start 2P (arcade pixels) | SIL Open Font License 1.1 | `looks/press-start-2p-latin-400.woff2` | https://fontsource.org/fonts/press-start-2p |
| VT323 (CRT terminal) | SIL Open Font License 1.1 | `looks/vt323-latin-400.woff2` | https://fontsource.org/fonts/vt323 |
| Share Tech Mono (hacker monospace) | SIL Open Font License 1.1 | `looks/share-tech-mono-latin-400.woff2` | https://fontsource.org/fonts/share-tech-mono |
| Cinzel Decorative (fantasy title) | SIL Open Font License 1.1 | `looks/cinzel-decorative-latin-400.woff2, cinzel-decorative-latin-700.woff2` | https://fontsource.org/fonts/cinzel-decorative |
| Lobster (diner sign) | SIL Open Font License 1.1 | `looks/lobster-latin-400.woff2` | https://fontsource.org/fonts/lobster |
| Pacifico (surf shop) | SIL Open Font License 1.1 | `looks/pacifico-latin-400.woff2` | https://fontsource.org/fonts/pacifico |
| Yellowtail (retro script) | Apache License 2.0 | `looks/yellowtail-latin-400.woff2` | https://fontsource.org/fonts/yellowtail |
| Allura (wedding script) | SIL Open Font License 1.1 | `looks/allura-latin-400.woff2` | https://fontsource.org/fonts/allura |
| Alex Brush (brush script) | SIL Open Font License 1.1 | `looks/alex-brush-latin-400.woff2` | https://fontsource.org/fonts/alex-brush |
| Great Vibes (formal script) | SIL Open Font License 1.1 | `looks/great-vibes-latin-400.woff2` | https://fontsource.org/fonts/great-vibes |
| Rock Salt (marker hand) | Apache License 2.0 | `looks/rock-salt-latin-400.woff2` | https://fontsource.org/fonts/rock-salt |
| Cookie (bakery script) | SIL Open Font License 1.1 | `looks/cookie-latin-400.woff2` | https://fontsource.org/fonts/cookie |
| Grape Nuts (handwriting) | SIL Open Font License 1.1 | `looks/grape-nuts-latin-400.woff2` | https://fontsource.org/fonts/grape-nuts |
| Croissant One (cafe) | SIL Open Font License 1.1 | `looks/croissant-one-latin-400.woff2` | https://fontsource.org/fonts/croissant-one |
| Amita (calligraphic) | SIL Open Font License 1.1 | `looks/amita-latin-400.woff2, amita-latin-700.woff2` | https://fontsource.org/fonts/amita |
| League Spartan (heavy geometric) | SIL Open Font License 1.1 | `looks/league-spartan-latin-wght.woff2` | https://fontsource.org/fonts/league-spartan |
| Josefin Sans (vintage geometric) | SIL Open Font License 1.1 | `looks/josefin-sans-latin-wght.woff2` | https://fontsource.org/fonts/josefin-sans |
| Shrikhand (fat retro) | SIL Open Font License 1.1 | `looks/shrikhand-latin-400.woff2` | https://fontsource.org/fonts/shrikhand |
| Megrim (thin tech) | SIL Open Font License 1.1 | `looks/megrim-latin-400.woff2` | https://fontsource.org/fonts/megrim |
| Racing Sans One (speed) | SIL Open Font License 1.1 | `looks/racing-sans-one-latin-400.woff2` | https://fontsource.org/fonts/racing-sans-one |
| Fredoka (rounded, friendly) | SIL Open Font License 1.1 | `looks/fredoka-latin-wght.woff2` | https://fontsource.org/fonts/fredoka |
| Abril Fatface (magazine headline) | SIL Open Font License 1.1 | `looks/abril-fatface-latin-400.woff2` | https://fontsource.org/fonts/abril-fatface |
| Vast Shadow (wild-west slab) | SIL Open Font License 1.1 | `looks/vast-shadow-latin-400.woff2` | https://fontsource.org/fonts/vast-shadow |
| Limelight (art deco) | SIL Open Font License 1.1 | `looks/limelight-latin-400.woff2` | https://fontsource.org/fonts/limelight |
| Chango (chunky) | SIL Open Font License 1.1 | `looks/chango-latin-400.woff2` | https://fontsource.org/fonts/chango |
| Raleway (elegant sans) | SIL Open Font License 1.1 | `looks/raleway-latin-wght.woff2` | https://fontsource.org/fonts/raleway |
| Merriweather (reading serif) | SIL Open Font License 1.1 | `looks/merriweather-latin-wght.woff2` | https://fontsource.org/fonts/merriweather |

## Galactic (an alien alphabet for fun looks)

| Family | Licence | Upstream project |
|---|---|---|
| Aurebesh by SilvinoR, a fan-made font (`Aurebesh.ttf`, version 1.1, the author's own file, unmodified; the player calls it `GP Galactic`) | SIL Open Font License 1.1, Reserved Font Name "AUREBESH" (`LICENSE-aurebesh.md`) | https://github.com/silvinor/font-aurebesh |

Because the font carries a Reserved Font Name, it is shipped exactly as its author publishes it (no subsetting or conversion).

## Scorebug fonts (`sports/`)

The broadcast-style scorebugs of the sports widget use a few more open-licence fonts, kept in `sports/` and loaded only when a pane shows a scorebug that needs them.

| Family | Licence | Upstream project |
|---|---|---|
| Archivo (expanded, extra bold; Latin subset, as served by Google Fonts) | SIL Open Font License 1.1 (`sports/LICENSE-archivo.txt`) | https://github.com/Omnibus-Type/Archivo |
| Barlow Condensed (bold; Latin subset, as served by Google Fonts) | SIL Open Font License 1.1 (`sports/LICENSE-barlow.txt`) | https://github.com/jpt/barlow |
| DSEG7 Classic (bold; a seven-segment LCD face for the retro clocks, version 0.46, unmodified) | SIL Open Font License 1.1, Reserved Font Name "DSEG" (`sports/LICENSE-dseg.txt`) | https://github.com/keshikan/DSEG |

Scorebugs also reuse the Montserrat file above.
