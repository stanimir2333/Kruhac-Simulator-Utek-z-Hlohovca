# assets/textures — textúry hry

Textúry sú **voliteľné**: každý slot si v `buildTextures()` (index.html) vytvorí
procedurálnu `CanvasTexture` a až potom sa pokúsi načítať súbor z disku. Ak súbor
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
| rozmery | **iba** 256 / 512 / 1024 na oboch stranách (power-of-two) |
| farebný priestor | `*_diffuse` = sRGB, `*_normal` / `*_roughness` = **lineárny** |
| formát | ľubovoľný, ktorý prehliadač prečíta (PNG odporúčaný) |
| anizotropia | nastavuje sa z `renderer.capabilities.getMaxAnisotropy()` (16× desktop, 4× mobil) |
| mipmapy | `generateMipmaps = true`, trilinear — nechaj ich zapnuté |

## road/ — dlažba každé 4 m (512 px / 4 m = 128 px/m)

| súbor | slot | zdroj |
|---|---|---|
| `asphalt_diffuse.jpg` | `asphalt` | ambientCG `asphalt_02` 1k, zmenšené na 512 |
| `asphalt_normal.png` | `asphaltN` | `asphalt_02_nor_gl` (EXR → straight uint8) |
| `asphalt_roughness.png` | `asphaltR` | `asphalt_02_rough` (raw lineárna hodnota) |

## terrain/ — dlažba každých 16 m (1024 px / 16 m = 64 px/m)

| súbor | slot | zdroj |
|---|---|---|
| `grass_diffuse.jpg` | `grass` | ambientCG `leafy_grass` 1k, 1024 |
| `dirt_diffuse.png` | `dirt` | placeholder (2. vrstva terénu + nespevnené cesty) |
| `terrain_normal.png` | `terrainN` | placeholder (nízkoamplitúdové zvlnenie, `normalScale` 0,35) |

## buildings/ — fasády (8 m/dlažbu), komíny (tehla 3×12), stromy

| súbor | slot | poznámka |
|---|---|---|
| `wall.png` | `wall` (`TEX.winGrid`) | fasáda, ľubovoľná fotka; ostatné 3 mapy sa odvidia z nej |
| `concrete_diffuse.png` | `concrete` | zdieľajú komíny, vežu, stĺpy, pamätník |
| `concrete_normal.png` | `concreteN` | |
| `wood.png` / `wood_normal.png` | `wood` / `woodN` | kôra kmeňov stromov |
| `brick.jpg` / `brick_normal.png` | `brick` / `brickN` | ambientCG `dark_brick_wall` 1k → 512 (tehlové komíny) |
| `gravel.png` | `gravel` | placeholder (ploché strechy) |

`buildings/` má ešte dva čisto procedurálne sloty bez súboru: `sheet` (vlnitý
plech, Kat. C) a `bridge` (mostovka). Ak ich chceš z disku, stačí doplniť cestu
do `texSlot*()` v `index.html`.

### `wall.png` môže byť ľubovoľná fasáda

Fasáda je difúzia + dve sprievodné mapy, ale **tie sprievodné sa nedrážujú v
ruká — odvodia sa z jasu difúzie** (`facadeAux()` v `index.html`):

| odvodená mapa | pravidlo |
|---|---|
| `winRough` | sklo (tmavšie ako okolie) = 0,28 · stena = 0,88 |
| `winNormal` | sklo vyrezané do steny + zvlnenie z vlastného reliéfu fotky |

Preto sa **netreba držať mriežky 3×2 ani žiadneho konkrétneho rozvodu okien** —
vlož ľubovoľnú fotku fasády a okná sa nájdu, zahladia a vyrežu samy.
`winLayout()` ostáva už len pre procedurálny fallback (`paintFacade`).

Keď `wall.png` dobehne z disku, `facadeAux()` sa spustí znova (`slot.onAdopt`)
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