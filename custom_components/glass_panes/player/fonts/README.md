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
