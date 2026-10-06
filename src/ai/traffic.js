// src/ai/traffic.js — civilná doprava (kolóna 513 + protismer + ambient), Distance LOD.
// Port z monolitu (updateTraffic), heat-systém ju len spomaľuje v zátarasoch.
export function createTraffic(n = 24) {
  const pool = [];
  for (let i = 0; i < n; i++) pool.push({ x: 0, y: 0, z: 0, h: 0, s: i * 40, speed: 0, d2: 1e9, lod: 2, hidden: false });
  return { pool, aiTick: 0 };
}

export function updateTraffic(traffic, dt, t, player) {
  traffic.aiTick++;
  for (const c of traffic.pool) {
    const dx = c.x - player.x, dz = c.z - player.z;
    c.d2 = dx * dx + dz * dz;
    c.lod = c.d2 < 22500 ? 0 : c.d2 < 122500 ? 1 : 2;
    if (c.lod === 2) continue;
    // kinematický waypoint lerp (plná verzia príde migráciou)
    c.s += 8 * dt;
  }
}
