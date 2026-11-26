// src/workers/elevation.worker.js — Web Worker for heavy elevation computation
// Offloads buildElevModel + limitSlope from main thread (~25M ops, 1-2s boot)

// --- Shared math (duplicated from height.js for worker independence) ---
const SX_P = new Uint8Array(512);
(function(){
  let s = 1337;
  const p = new Uint8Array(256);
  for(let i=0;i<256;i++) p[i]=i;
  function rnd(){ s = (s*1103515245 + 12345) & 0x7fffffff; return s/0x7fffffff; }
  for(let i=255;i>0;i--){ const j = (rnd()*(i+1))|0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for(let i=0;i<512;i++) SX_P[i] = p[i&255];
})();
const SX_G = new Float32Array([1,1,-1,1,1,-1,-1,-1,1,0,-1,0,0,1,0,-1]);

function sxNoise(x, z){
  const F = 0.3660254037844386, G = 0.21132486540518713;
  const s = (x+z)*F, i = Math.floor(x+s), j = Math.floor(z+s);
  const t = (i+j)*G, x0 = x-(i-t), z0 = z-(j-t);
  const i1 = (x0 > z0) ? 1 : 0, j1 = (x0 > z0) ? 0 : 1;
  const x1 = x0-i1+G, z1 = z0-j1+G, x2 = x0-1+2*G, z2 = z0-1+2*G;
  const ii = i & 255, jj = j & 255;
  let n = 0, t0 = 0.5-x0*x0-z0*z0;
  if(t0 > 0){ t0 *= t0; const g = (SX_P[ii+SX_P[jj]] & 7)*2; n += t0*t0*(SX_G[g]*x0+SX_G[g+1]*z0); }
  let t1 = 0.5-x1*x1-z1*z1;
  if(t1 > 0){ t1 *= t1; const g = (SX_P[ii+i1+SX_P[jj+j1]] & 7)*2; n += t1*t1*(SX_G[g]*x1+SX_G[g+1]*z1); }
  let t2 = 0.5-x2*x2-z2*z2;
  if(t2 > 0){ t2 *= t2; const g = (SX_P[ii+1+SX_P[jj+1]] & 7)*2; n += t2*t2*(SX_G[g]*x2+SX_G[g+1]*z2); }
  return 70*n;
}

function smooth01(t){ t = t < 0 ? 0 : (t > 1 ? 1 : t); return t*t*(3-2*t); }

function bumpK(d2, R){
  const q = 1-d2/(R*R);
  if(q <= 0) return 0;
  const q2 = q*q;
  return q2*q2*(4*q+1);
}

// --- Message handlers ---
self.onmessage = function(e){
  const { type, payload } = e.data;
  if(type === 'buildElevModel'){
    const result = buildElevModelWorker(payload);
    self.postMessage({ type: 'buildElevModelDone', payload: result });
  }else if(type === 'limitSlope'){
    const result = limitSlopeWorker(payload);
    self.postMessage({ type: 'limitSlopeDone', payload: result });
  }
};

function buildElevModelWorker(payload){
  const { raw, bbox, ELE_DATUM, ELE_FLOOR, ELE_CEIL, ELE_OUTLIER, ELE_RAD, ELE_MAX_FIX, demGrid, demW, demH, gb } = payload;
  
  // demAt for worker (bilinear interpolation)
  function demAt(x, z){
    if(!demGrid) return 0;
    const x0 = gb.x0, z0 = gb.z0;
    const cw = (gb.x1-x0)/(demW-1), cd = (gb.z1-z0)/(demH-1);
    let fx = (x-x0)/cw, fz = (z-z0)/cd;
    if(fx < 0) fx = 0; else if(fx > demW-1.001) fx = demW-1.001;
    if(fz < 0) fz = 0; else if(fz > demH-1.001) fz = demH-1.001;
    const ix = fx|0, iz = fz|0;
    const u = fx-ix, v = fz-iz;
    const a = demGrid[iz*demW+ix], b = demGrid[iz*demW+ix+1];
    const c = demGrid[(iz+1)*demW+ix], d = demGrid[(iz+1)*demW+ix+1];
    return (a+(c-a)*v)*(1-u) + (b+(d-b)*v)*u;
  }
  
  // --- 1) Filtrovanie OSM uzlov ---
  const ok = [];
  for(let i=0;i<raw.length;i++){
    const e = raw[i][2];
    if(!(e > ELE_FLOOR && e < ELE_CEIL)) continue;
    ok.push([raw[i][0], raw[i][1], e, raw[i][3] || ""]);
  }
  if(ok.length){
    const sv = ok.map(p => p[2]).sort((a, b) => a-b);
    const med = sv[sv.length >> 1];
    let iw = ok.length;
    for(let i=ok.length-1;i>=0;i--){
      if(Math.abs(ok[i][2]-med) <= ELE_OUTLIER) continue;
      ok[i] = ok[iw-1]; iw--;
    }
    ok.length = iw;
  }
  
  const ELE_N = ok.length;
  const ELE_PX = new Float32Array(ELE_N);
  const ELE_PZ = new Float32Array(ELE_N);
  const ELE_TY = new Float32Array(ELE_N);
  const ELE_R = new Float32Array(ELE_N);
  const b = new Float64Array(ELE_N);
  
  for(let i=0;i<ELE_N;i++){
    ELE_PX[i] = ok[i][0];
    ELE_PZ[i] = ok[i][1];
    ELE_TY[i] = ok[i][2]-ELE_DATUM;
    ELE_R[i] = ELE_RAD;
    b[i] = ELE_TY[i]-demAt(ELE_PX[i], ELE_PZ[i]);
  }
  
  // Symetrická sústava KᵀKa = Kᵀb
  const K = [];
  for(let i=0;i<ELE_N;i++){
    const row = new Float64Array(ELE_N);
    for(let j=0;j<ELE_N;j++){
      const dx = ELE_PX[j]-ELE_PX[i], dz = ELE_PZ[j]-ELE_PZ[i];
      row[j] = bumpK(dx*dx+dz*dz, ELE_R[j]);
    }
    K.push(row);
  }
  
  const AtA = [];
  const Atb = new Float64Array(ELE_N);
  for(let i=0;i<ELE_N;i++){ AtA.push(new Float64Array(ELE_N)); }
  
  for(let i=0;i<ELE_N;i++){
    for(let j=0;j<ELE_N;j++){
      let s = 0;
      for(let k=0;k<ELE_N;k++) s += K[k][i]*K[k][j];
      AtA[i][j] = s;
    }
    let t = 0;
    for(let k=0;k<ELE_N;k++) t += K[k][i]*b[k];
    Atb[i] = t;
  }
  
  // ridge stabilizácia
  let tr = 0;
  for(let i=0;i<ELE_N;i++) tr += AtA[i][i];
  const lam = tr*1e-7;
  for(let i=0;i<ELE_N;i++) AtA[i][i] += lam;
  
  const M = [];
  for(let i=0;i<ELE_N;i++){ 
    const row = new Float64Array(ELE_N+1); 
    row.set(AtA[i]); 
    row[ELE_N] = Atb[i]; 
    M.push(row); 
  }
  
  for(let c=0;c<ELE_N;c++){
    let piv = c;
    for(let r=c;r<ELE_N;r++) if(Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    const trow = M[c]; M[c] = M[piv]; M[piv] = trow;
    const d = M[c][c];
    if(Math.abs(d) < 1e-9) continue;
    for(let k=c;k<=ELE_N;k++) M[c][k] /= d;
    for(let r=0;r<ELE_N;r++){
      if(r === c) continue;
      const f = M[r][c];
      if(f === 0) continue;
      for(let k=c;k<=ELE_N;k++) M[r][k] -= f*M[c][k];
    }
  }
  
  const ELE_A = new Float32Array(ELE_N);
  for(let i=0;i<ELE_N;i++) ELE_A[i] = M[i][ELE_N];
  
  // Overenie interpolácie
  let worst = 0;
  for(let i=0;i<ELE_N;i++){
    let got = demAt(ELE_PX[i], ELE_PZ[i]);
    for(let j=0;j<ELE_N;j++){
      const dx = ELE_PX[j]-ELE_PX[i], dz = ELE_PZ[j]-ELE_PZ[i];
      got += ELE_A[j]*bumpK(dx*dx+dz*dz, ELE_R[j]);
    }
    const e = Math.abs(got-ELE_TY[i]);
    if(e > worst) worst = e;
  }
  
  return { ELE_N, ELE_PX, ELE_PZ, ELE_TY, ELE_R, ELE_A, worst, okCount: ok.length };
}

function limitSlopeWorker(payload){
  const { H, G, MGW, MGD, iters, maxK } = payload;
  const lx = maxK*MGW, lz = maxK*MGD;
  const Hout = new Float32Array(H); // copy
  
  for(let it=0;it<iters;it++){
    let moved = 0;
    for(let iz=1;iz<G-1;iz++){
      const row = iz*G;
      for(let ix=1;ix<G-1;ix++){
        const i0 = row+ix, h0 = Hout[i0];
        let nb, d, lim, t;
        nb = i0-1; d = Hout[nb]-h0; lim = lx;
        if(d > lim){ t = (d-lim)*0.25; Hout[i0] += t; Hout[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; Hout[i0] -= t; Hout[nb] += t; moved++; }
        nb = i0+1; d = Hout[nb]-Hout[i0]; lim = lx;
        if(d > lim){ t = (d-lim)*0.25; Hout[i0] += t; Hout[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; Hout[i0] -= t; Hout[nb] += t; moved++; }
        nb = row-G+ix; d = Hout[nb]-Hout[i0]; lim = lz;
        if(d > lim){ t = (d-lim)*0.25; Hout[i0] += t; Hout[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; Hout[i0] -= t; Hout[nb] += t; moved++; }
        nb = row+G+ix; d = Hout[nb]-Hout[i0]; lim = lz;
        if(d > lim){ t = (d-lim)*0.25; Hout[i0] += t; Hout[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; Hout[i0] -= t; Hout[nb] += t; moved++; }
      }
    }
    if(!moved) break;
  }
  return { H: Hout };
}