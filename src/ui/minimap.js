// src/ui/minimap.js — 2D vektorová minimapa z OSM dát (trasa + cesty + hráč + polícia).
import { S } from '../world/shared.js';

export function createMinimap(state) {
  const mini = document.getElementById('minimap');
  const ctx = mini?.getContext('2d');
  const W = 170, C = W / 2;
  const SCALE = 0.055; // ~900 m na 170 px
  const px = (x, z, p) => [(x - p.x) * SCALE + C, (z - p.z) * SCALE + C];
  return {
    update() {
      if (!ctx || !state.map) return;
      const { player } = state;
      ctx.fillStyle = '#0b0906'; ctx.fillRect(0, 0, W, W);
      // vedľajšie cesty (tenké, riedko vzorkované)
      ctx.strokeStyle = 'rgba(255,176,0,.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const R of S.townRoads) {
        const n = R.n || 0, pts = R.pts;
        if (!pts || n < 2) continue;
        for (let i = 0; i < n; i += 2) {
          const [sx, sy] = px(pts[i * 2], pts[i * 2 + 1], player);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
      }
      ctx.stroke();
      // trasa 513 (hrubá oranžová)
      ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= S.ROUTE_N; i += 8) {
        const [sx, sy] = px(S.routeX[i], S.routeZ[i], player);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      // policajti (modré) + roadblocky (červené krížiky)
      const sys = state.police;
      if (sys) {
        ctx.fillStyle = '#4aa8ff';
        for (const u of sys.units) {
          const [dx, dz] = px(u.x, u.z, player);
          if (dx > 0 && dx < W && dz > 0 && dz < W) ctx.fillRect(dx - 1, dz - 1, 3, 3);
        }
        ctx.strokeStyle = '#ff2b2b';
        for (const b of sys.roadblocks) {
          const [dx, dz] = px(b.x, b.z, player);
          if (dx > 0 && dx < W && dz > 0 && dz < W) {
            ctx.beginPath(); ctx.moveTo(dx - 3, dz - 3); ctx.lineTo(dx + 3, dz + 3);
            ctx.moveTo(dx + 3, dz - 3); ctx.lineTo(dx - 3, dz + 3); ctx.stroke();
          }
        }
      }
      // hráč (zelená šípka)
      ctx.fillStyle = '#39ff6a';
      ctx.save();
      ctx.translate(C, C); ctx.rotate(player.h);
      ctx.fillRect(-2, -4, 4, 8);
      ctx.restore();
    },
  };
}
