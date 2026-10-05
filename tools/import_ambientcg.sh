#!/usr/bin/env bash
# tools/import_ambientcg.sh - prevedie ambientCG (.mtlx) sady do assets/textures/
#
#   ./tools/import_ambientcg.sh ~/Downloads
#
# ambientCG (Poly Haven) dodáva 1k PBR sadu ako *_diff_1k.jpg, *_nor_gl_1k.exr,
# *_rough_1k.jpg/exr a *_disp_1k.png. Dve veci treba spraviť, kým to sadá do hry:
#
#  1) .EXR NEDOKÁŽE PREHLIADAČ DEKODOVAŤ. Normálové a roughness mapy sa preto
#     kvantizujú oiiotool -d uint8 -o *.png. Overené: dá to STRAIGHT lineárnu
#     kvantizáciu (priemerná nasa normálová mapa = 127,127,248, nie 188,188,251),
#     teda bez sRGB priemienky - presne to, čo three.js chce na normalMap.
#     *_nor_gl je OpenGL konvencia (+Y nahor), čo three.js tiež používa.
#
#  2) JASNOSŤ DIFÚZNYCH MAP MUSÍ SADNÚŤ S PROCEDURÁLNIM FALLBACKOM. Terén násobí
#     farba vo vertexColors (priemerná GCPAL ~1.0) a hra je doladená na priemernú
#     luma fallbacku. Ak by sme vložili fotku svojich síl, terén by raz zbledol
#     a raz stmavol. Preto sa difúzia NORMuje lineárnym ziskom na priemernú
#     luma fallbacku; odtieň fotky (nie jeho silu) zostáva zachovaný.
#
# Závislosti: oiiotool (OpenImageIO, na kvantizáciu .exr) a ImageMagick `magick`.
set -euo pipefail

DL="${1:-$HOME/Downloads}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/textures"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# lineárny zisk, ktorý z priemernej luma zdroja spraví cieľovú (pozri tabuľku)
#   zdroj -> priemerná luma (sRGB 0-255) -> cieľ -> zisk
#   asphalt_02_diff 89.6 -> 61.0 (fallback)  -> 0.475
#   leafy_grass    132.5 -> 81.0 (fallback)  -> 0.387
#   dark_brick_wall 72.4 -> 82.5 (1.35x zdvih: zdroj je zámerne tmavá tehla)
GAIN_ASPHALT=0.475
GAIN_GRASS=0.387
GAIN_BRICK=1.35

# Zdroj mapy: najprv rozbalený priečinok, inak samotný .zip (ten je nedotknutý
# originál - ak niekto presunie súbory z .mtlx/textures, stále sa dajú nájsť).
# ambientCG zip ukladá mapy flat pod "textures/<meno>".
src() { # <set-dir> <basename>
  local f="$DL/$1/textures/$2"
  if [ -f "$f" ]; then echo "$f"; return; fi
  local z
  z=$(ls "$DL/$1.zip" 2>/dev/null | head -1)
  if [ -n "$z" ] && unzip -o -j -q "$z" "textures/$2" -d "$TMP" 2>/dev/null; then
    echo "$TMP/$2"; return
  fi
  echo "CHÝBA: $DL/$1/textures/$2 (ani v $1.zip)" >&2; return 1
}

# difúzia: lineárny zisk -> downscale -> JPEG q92 (fotka, kompresia je bezpečná)
# POZOR: zisk sa musí aplikovať v LINEÁRNOM priestore. Oiiotool --mulc na 8bit JPEG
# násobí hodnoty v ENKODOVANOM (sRGB) priestore, takže by nám posunol stred o
# mocnosť 2.2. ImageMagick to vie explicitne: -colorspace RGB (linearizuje),
# -evaluate multiply (násobí v lineárie), -colorspace sRGB (zasadí).
diffuse() { # <src> <dst-name> <px> <gain>
  magick "$1" -colorspace RGB -evaluate multiply "$4" -colorspace sRGB \
          -filter Lanczos -resize "$3x$3" -quality 92 "$OUT/$2"
  echo "  $2  <- $(basename "$1")  ${3}px  linearny zisk $4"
}
# normála: EXR -> straight uint8 PNG -> downscale (bez akejkoľvek farebnej priemienky)
normal() { # <src.exr> <dst-name> <px>
  oiiotool "$1" -d uint8 -o "$TMP/n.png" 2>/dev/null
  magick "$TMP/n.png" -filter Lanczos -resize "$3x$3" "$OUT/$2"
  echo "  $2  <- $(basename "$1")  ${3}px  (straight lineárna kvantizácia)"
}
# roughness: ambientCG JPG drží RAW lineárnu hodnotu (nie sRGB), preto sa len
# prevedie na bezsivý PNG. three.js násobí material.roughness mapou.
roughJPG() { # <src.jpg> <dst-name> <px>
  magick "$1" -filter Lanczos -resize "$3x$3" -colorspace Gray \
          -define png:color-type=0 "$OUT/$2"
  echo "  $2  <- $(basename "$1")  ${3}px  (raw lineárna hodnota)"
}

AS=asphalt_02_1k.mtlx
BR=dark_brick_wall_1k.mtlx
GR=leafy_grass_1k.mtlx

echo "asphalt_02 -> road/"
diffuse    "$(src $AS asphalt_02_diff_1k.jpg)"     road/asphalt_diffuse.jpg     512 "$GAIN_ASPHALT"
normal     "$(src $AS asphalt_02_nor_gl_1k.exr)"  road/asphalt_normal.png      512
roughJPG   "$(src $AS asphalt_02_rough_1k.jpg)"   road/asphalt_roughness.png  512

echo "leafy_grass -> terrain/"
# trávnik ostáva 1024: dlažba je 16 m, teda 64 px/m - trávnaté steblá musia
# prečítať aj z kabíny. (asphalt/brick stačia 512, lebo ich dlažba je 4 m a 5 m.)
diffuse    "$(src $GR leafy_grass_diff_1k.jpg)"    terrain/grass_diffuse.jpg     1024 "$GAIN_GRASS"

echo "dark_brick_wall -> buildings/"
diffuse    "$(src $BR dark_brick_wall_diff_1k.jpg)" buildings/brick.jpg          512 "$GAIN_BRICK"
normal     "$(src $BR dark_brick_wall_nor_gl_1k.exr)" buildings/brick_normal.png 512

echo
echo "hotovo. Zvyšné sloty (dirt, concrete, wood, wall, gravel, terrain_normal)"
echo "ostávajú na procedurálnom fallbacke / generovaných placeholderoch."
find "$OUT" -type f \( -name "*.png" -o -name "*.jpg" \) -printf "%-50p %9s B\n" | sort