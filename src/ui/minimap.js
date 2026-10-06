// src/ui/minimap.js — 2D canvas minimapa + bigmap (bez Three.js alokácií).
// TODO(migrácia): presuň sem drawMap/drawMapStatic/loadMapTiles z monolitu.
export function createMinimap(state) {
  const mini = document.getElementById('minimap');
  const ctx = mini?.getContext('2d');
  return {
    update() {
      if (!ctx || !state.map) return;
      const { player } = state;
      ctx.fillStyle = '#0b0906'; ctx.fillRect(0, 0, 170, 170);
      ctx.fillStyle = '#39ff6a';
      ctx.fillRect(83, 83, 4, 4);
      // policajti ako modré bodky (heat overlay)
      const sys = state.police;
      if (sys) {
        ctx.fillStyle = '#4aa8ff';
        for (const u of sys.units) {
          const dx = (u.x - player.x) * 0.15 + 85, dz = (u.z - player.z) * 0.15 + 85;
          if (dx > 0 && dx < 170 && dz > 0 && dz < 170) ctx.fillRect(dx, dz, 3, 3);
        }
      }
    },
  };
}
