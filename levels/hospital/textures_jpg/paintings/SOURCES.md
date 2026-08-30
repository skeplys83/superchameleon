# The seven paintings

**Temporary stand-ins.** The seven canvases that shipped with the hospital kit
were replaced with public-domain pictures so the repo carries nothing it has no
licence to. Same filenames, same pixel dimensions — the `.blend` links to these
paths, so a re-export needs no change, and `public/maps/hospital.glb` already
has the new bytes embedded.

The set is deliberately the art a real waiting room hangs: flowers, fruit, a
garden, a calm sea. Nothing in it looks back at the player, which keeps the
walls quiet for a chameleon lying against them.

All seven are from the **Metropolitan Museum of Art Open Access** collection,
released under **CC0 1.0** (public domain dedication, no attribution required).
Each was auto-trimmed of its photographic surround, centre-cropped to the slot's
aspect ratio, and resampled to the exact original size.

| file | size | artist | work | Met object |
| ---- | ---- | ------ | ---- | ---------- |
| `painting_01.jpg` | 1024x1024 | Gustave Courbet | *The Calm Sea*, 1869 | [436005](https://www.metmuseum.org/art/collection/search/436005) |
| `painting_02.jpg` | 1018x1024 | Camille Pissarro | *The Public Garden at Pontoise*, 1874 | [437301](https://www.metmuseum.org/art/collection/search/437301) |
| `painting_03.jpg` | 727x1024 | Clara Peeters | *A Bouquet of Flowers*, ca. 1612 | [827660](https://www.metmuseum.org/art/collection/search/827660) |
| `painting_04.jpg` | 758x1024 | Adolphe Monticelli | *Flowers in a Blue Vase*, 1879–1883 | [437148](https://www.metmuseum.org/art/collection/search/437148) |
| `painting_05.jpg` | 777x1024 | Margareta Haverman | *A Vase of Flowers*, 1716 | [436634](https://www.metmuseum.org/art/collection/search/436634) |
| `painting_06.jpg` | 791x1024 | Henri Fantin-Latour | *Still Life with Flowers and Fruit*, 1866 | [436293](https://www.metmuseum.org/art/collection/search/436293) |
| `painting_07.jpg` | 769x1024 | Thomas Doughty | *A River Glimpse*, ca. 1843–50 | [10769](https://www.metmuseum.org/art/collection/search/10769) |

`painting_01` and `painting_02` were trimmed another ~1.5% top and bottom to
drop the frame lip the Met photograph includes.

## Putting the originals back

The seven that shipped with the kit are kept, unaltered, in `originals/`.
Nothing reads that folder — the `.blend` links to the files beside it — so it is
inert until you copy them up:

```
cp originals/*.jpg .
```

That restores the source textures, but **not** the map: `public/maps/hospital.glb`
carries its own embedded copies, so it has to be re-exported from the `.blend`
afterwards (or the whole change reverted with git).
