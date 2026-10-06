// src/world/terrain.js — analytický výškový model z OSM (trend + ele + koryto + koridory).
// Port z monolitu (buildElevModel + heightAtAnalytic), bez zmien fyziky —
// len vyčlenený do modulu, aby sa dal testovať a chunkovať.
export function buildElevModel(osm) {
  // TODO(migrácia): skopíruj sem telo `buildElevModel` z index.monolith.legacy.html
  // (riadky ~3537–3670). Vstup: osm.elev (8 bodov), osm.water, bbox. Výstup: { base(x,z), ... }
  // Dočasný stub, aby hra nabehla aj pred dokončením migrácie:
  const pts = osm.elev || [];
  return {
    points: pts,
    at(x, z) {
      // regionálny trend + najbližší ele bod (C2 bump príde s plnou migráciou)
      let h = 140 + x * 0.004 - z * 0.006;
      for (const [px, pz, ele] of pts) {
        const dx = x - px, dz = z - pz;
        const d2 = dx * dx + dz * dz;
        const w = Math.exp(-d2 / (900 * 900));
        h += (ele - 140) * w * 0.25;
      }
      return h;
    },
  };
}

export function heightAtAnalytic(elevModel, x, z) {
  return elevModel.at(x, z);
}

// Fyzika číta renderovanú sieť (nulová odchýlka mesh vs. collider) —
// po buildGround sa sem injektuje raycast na GPU mesh (pozri buildGround v terrain.js).
export let meshHeightReader = null;
export function getTerrainHeight(x, z, fallbackModel) {
  if (meshHeightReader) return meshHeightReader(x, z);
  return fallbackModel ? fallbackModel.at(x, z) : 0;
}
