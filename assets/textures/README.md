# assets/textures — textúry hry

Textúry sú **voliteľné**: každý slot si v `buildTextures()` (`src/world/textures.js`)
vytvorí procedurálnu `CanvasTexture` a až potom sa pokúsi načítať súbor z disku. Ak súbor
chýba, je pokazený alebo nemá power-of-two rozmery, ostane procedúra — hra nikdy
nečierne, nikdy nespadne, build nikdy neblikne.

V tomto repozitári sú **skutočné textúry** (ambientCG 1k sady `asphalt_02`,
`leafy_grass`, `dark_brick_wall` + generované placeholdery na zvyšok), takže
loader sa cvičí na načítaní z disku a v konzole svieti `subor`.

Ak ten súbor **zmažeš**, slot sa ticho prepadne na procedurálny fallback — hra
nikdy neostane bez textúry.

## Ako vymeniť textúru za vlastnú

**Áno, stačí prepísať súbor rovnakým menom** — `index.html` na cestu ani na
rozmery nepozerá, iba na to, či súbor načíta a či má power-of-two rozmery.
Nie je nutné nič v kóde hry meniť.

1. Prepíš súbor **rovnakým menom** (alebo uprav cestu v `texSlot*()` v `index.html`,
   ak chceš iný názov).
2. Dodrž pravidlá nižšie.
3. Refresh. Konzola vypíše `[TEX] <slot> nahradené fallbackom súborom ...`.
   Ak tam nie je tvoj slot, spusti si `tools/gen_placeholders.mjs`, ktorý
   znovu vygeneruje placeholdery z aktuálneho kódu hry.

Kontrola v konzole: `texReport()` vypíše tabuľku všetkých slotov so zdrojom
(`subor` / `proc`), rozmermi, tilingom, farebným priestorom, mipmapami
a anizotropiou.

## Pravidlá

| pravidlo | hodnota |
|---|---|
| rozmery | **iba** 256 / 512 / 1024 / 2048 na oboch stranách (power-of-two) |
| strop | 2048 desktop; na mobil/Raspberry sa väčšie súbory pri načítaní zmenšujú na 1024 |
| farebný priestor | `*_diffuse` = sRGB, `*_normal` / `*_roughness` = **lineárny** |
| formát | JPEG pre nepriehľadné mapy (q92; normály 4:2:2, drsnosť sivá), PNG len tam, kde treba alfa |
| anizotropia | nastavuje sa z `renderer.capabilities.getMaxAnisotropy()` (16× desktop, 4× mobil) |
| mipmapy | `generateMipmaps = true`, trilinear — nechaj ich zapnuté |

## road/ — dlažba každé 4 m (512 px / 4 m = 128 px/m)

| súbor | slot | zdroj |
|---|---|---|
| `asphalt_diffuse.jpg` | `asphalt` | GTA SA kamenný asfalt: trhliny, zrno, opotrebovanie, tire tread — obsadiť bez akéhokoľvek dát, stačí prepísať rovným menom |
| `asphalt_normal.jpg` | `asphaltN` | normálová mapa z výškového poľa (tzv. tire tread + trhlinky) |
| `asphalt_roughness.jpg` | `asphaltR` | drsnosť (trhlinky 0,62, opotrebované jamky) |
| `pave_diffuse.jpg` | `pave` | betónové dlaždice chodníkov (8×8 na dlažbu 2,4 m) |
| `pave_normal.jpg` | `paveN` | škáry a zaoblené hrany kociek |
| `pave_roughness.jpg` | `paveR` | mokré škvrny hladšie, kocky matné |
| `tiremark.png` | `tireMark` | opotrebovanie asfaltu — biele výstupky od pneumatíkov s radiacou alfa (inštancované v `decals.js`) |
| `crosswalk.png` | `crosswalk` | biely crosswalk — štrajky perfekulárne na cestu (inštancované v `decals.js`) |

Regenerovanie cez `python3 tools/gen_gta_textures.py` (idempotentné).

## terrain/ — dlažba každých 16 m (1024 px / 16 m = 64 px/m)

| súbor | slot | zdroj |
|---|---|---|
| `grass_diffuse.jpg` | `grass` | trávnik: steblá, suché fľaky, holá pôda, kvety |
| `grass_roughness.jpg` | `grassR` | holé fľaky matnejšie, husté zhluky hladšie |
| `terrain_normal.jpg` | `terrainN` | nízkoamplitúdové zvlnenie (`normalScale` 0,7) |
| `dirt_diffuse.jpg` | `dirt` | nespevnené cesty (hlina, koľaje, kamienky) |
| `dirt_normal.jpg` | `dirtN` | kamienky a koľaje |
| `dirt_roughness.jpg` | `dirtR` | mokré koľaje hladšie, prach matný |

## veg/ — zelená vedľa ciest (`buildShrubs()` v `src/world/shrubs.js`)

| súbor | slot | použitie |
|---|---|---|
| `shrubs.png` | `shrubs` | sprite záhoniak (trstiny + kvetináče, štýl GTA SA) |

## buildings/ — fasády (8 m/dlažbu), komíny (tehla 3×12), stromy

| súbor | slot | poznámka |
|---|---|---|
| `wall.jpg` | `wall` (`TEX.winGrid`) | fotka bez okien — okná sú samostatná 3D geometria (`src/world/buildings.js`) |
| `concrete_diffuse.jpg` | `concrete` | zdieľajú komíny, vežu, stĺpy, pamätník |
| `concrete_normal.jpg` | `concreteN` | |
| `concrete_roughness.jpg` | `concreteR` | |
| `wood.png` / `wood_normal.jpg` | `wood` / `woodN` | kôra kmeňov stromov |
| `brick.jpg` / `brick_normal.jpg` / `brick_roughness.jpg` | `brick` / `brickN` / `brickR` | tehlové komíny |
| `roof_tile.jpg` / `roof_tile_normal.jpg` / `roof_tile_roughness.jpg` | `roofTile` / `roofTileN` / `roofTileR` | škridlice streakach |
| `gravel.jpg` / `gravel_normal.jpg` / `gravel_roughness.jpg` | `gravel` / `gravelN` / `gravelR` | ploché strechy |

`buildings/` má ešte dva čisto procedurálne sloty bez súboru: `sheet` (vlnitý
plech, Kat. C) a `bridge` (mostovka). Ak ich chceš z disku, stačí doplniť cestu
do `texSlot*()` v `index.html`.

### `wall.jpg` môže byť ľubovoľná fasáda

Fasáda je difúzia + dve sprievodné mapy, ale **tie sprievodné sa nedrážujú v
ruká — odvodia sa z jasu difúzie** (`facadeAux()` v `src/world/textures.js`):

| odvodená mapa | pravidlo |
|---|---|
| `winRough` | sklo (tmavšie ako okolie) = 0,28 · stena = 0,88 |
| `winNormal` | sklo vyrezané do steny + zvlnenie z vlastného reliéfu fotky |

Preto sa **netreba držať mriežky 3×2 ani žiadneho konkrétneho rozvodu okien** —
vlož ľubovoľnú fotku fasády a okná sa nájdu, zahladia a vyrežu samy.
`winLayout()` ostáva už len pre procedurálny fallback (`paintFacade`).

Keď `wall.jpg` dobehne z disku, `facadeAux()` sa spustí znova (`slot.onAdopt`)
a prepíše pixely **tých istých** dvoch canvasov — žiadny nový objekt, žiadny leak.

**Fasády nemajú emisívnu mapu** (rozsvietené okná boli vypnuté) a nie sú preto
zdrojom bloomu — žiarí len pouličné lampy, svetlomety a brzdové svetlá.

**Fasáda je obrátená?** Všetky tri textúry majú `flipY = false`. `ExtrudeGeometry`
dáva bočnej stene `v = 1 - a_z`, takže v **klesá** s výškou; s predvoleným
`flipY = true` by horný riadok obrázka dopadol na pätu steny a fotka by visela
obrátene. Všetky tri musia mať `flipY = 0` naraz, inak by sa mapy rozšli.

Jediná podmienka: hra musí vedieť obrázok prečítať späť cez canvas. Pod
`http://` to ide vždy; cez `file://` to prehliadač blokuje (tainted canvas),
`facadeAux()` to odchytí, vypíše varovanie a nechá sprievodné mapy na fallbacku.

## Dôležité: jas difúzie je znormovaný

Terén násobí farba z `vertexColors` (priemerná ~1,0) a hra je doladená na
priemernú luma fallbacku. `tools/import_ambientcg.sh` preto pri importe aplikuje
**lineárny zisk**, aby priemerná luma novej textúry sedela na tú istú hodnotu
(asfalt 61, trávnik 81, tehla 82,5 zo 0 – 255). Ak vložíš vlastnú textúru bez
tejto korekcie, terén alebo vozovka raz zbledne a raz stmavne. Overiť to vie
jedným príkazom:

```python
python3 -c "from PIL import Image;import numpy as np;m=np.asarray(Image.open('SUBOR').convert('RGB')).astype(float).reshape(-1,3);print(round(float(0.2126*m[:,0]+0.7152*m[:,1]+0.0722*m[:,2]),1))"
```

## tools/import_ambientcg.sh

Prevedie ambientCG (`.mtlx`) sady do `assets/textures/`:

```bash
./tools/import_ambientcg.sh ~/Downloads
```

Robí dve veci, ktoré treba:

1. **`.exr` načítať nedokáže prehliadač.** Normálové a roughness mapy sa preto
   kvantizujú cez `oiiotool -d uint8 -o *.png`. Overené: dá to *straight*
   lineárnu kvantizáciu (priemerná nasa normálová mapa vyjde 127,127,248, nie
   188,188,251), teda bez sRGB priemienky — presne to, čo three.js chce na
   `normalMap`. `*_nor_gl` je OpenGL konvencia (+Y nahor), ktorú three.js
   tiež používa.
2. **Zisk musí ísť cez lineárny priestor.** `oiiotool --mulc` na 8-bit JPEG
   násobí hodnoty v *enkodovanom* (sRGB) priestore a posunul by stred o mocnosť
   2,2. ImageMagick to vie explicitne: `-colorspace RGB` (linearizuje) →
   `-evaluate multiply` → `-colorspace sRGB`.

Závislosti: `oiiotool` (OpenImageIO) a ImageMagick.

## tools/gen_placeholders.mjs

Pregeneruje placeholdery **z kódu hry** (načíta paintery priamo z `index.html`,
takže placeholder je vždy totožný s fallbackom):

```
deno run --allow-read --allow-write tools/gen_placeholders.mjs
```

Beží bez závislostí — PNG zapisuje sám (`CompressionStream("deflate")` dá
zlib kontajner, ktorý IDAT chce).