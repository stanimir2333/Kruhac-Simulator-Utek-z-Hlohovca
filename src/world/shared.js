// src/world/shared.js — STAGE-1 migration bridge (verbatim state z monolitu).
// Každá vlastnosť S.* zodpovedá jednej top-level `let/const` z monolitu
// (git HEAD:index.html; poradie = pôvodné; OSM_DATA → S.osm, scene → S.scene).
// Nový kód má čítať S.*, ale STAVU ubúdať: cieľom je S. postupne rozpustiť do modulov.
import * as THREE from 'three';

export const S = {
  osm: null,   // public/data/mapData.json (nastavuje main.js pred build*)
  scene: null, // THREE.Scene (nastavuje main.js pred build*)
  ROAD_HW: 3.5, // <- legacy @2933
  groundHoleOK: true, // <- legacy @2938
  TER_SEG: 256, // <- legacy @2963
  TER_CELL: 20, // <- legacy @2966
  TER_FBM_F: 1/498, // <- legacy @2966
  TER_DET_F: 1/166, // <- legacy @2966
  DECK_Y: 0.16, // <- legacy @2968
  RAMP_LEN: 55, // <- legacy @2969
  CASTLE_X: -1810, // <- legacy @2973
  CASTLE_Z: -140, // <- legacy @2973
  ELE_DATUM: 130.2, // <- legacy @2974
  URBAN_X: -1759, // <- legacy @2976
  URBAN_Z: 483, // <- legacy @2976
  URBAN_R: 760, // <- legacy @2976
  ROUTE_SUB: null, // <- legacy @3033
  WGRID: { cs:0, nx:0, nz:0, head:null, next:null }, // <- legacy @3041
  WPT: { x:null, z:null, hw:null, big:null }, // <- legacy @3043
  meshGrid: null, // <- legacy @3492
  meshReady: false, // <- legacy @3492
  terrMinY: 0, // <- legacy @3493
  terrMaxY: 60, // <- legacy @3493
  terrainMesh: null, // <- legacy @3608
  SUN_OFF: { x:170, y:120, z:-95 }, // <- legacy @3637
  IS_MOBILE: (typeof window !== "undefined" && typeof window.matchMedia === "function") && window.matchMedia("(pointer: coarse)").matches, // <- legacy @3762
  LABEL_MAX: 40, // <- legacy @3779 (hodnota sa dopočíta nižšie — S nesmie čítať samo seba v literáli!)
  SKY_ZENITH: 0x6fa9dc, // <- legacy @3781
  SKY_HORIZON: 0xece7d6, // <- legacy @3782
  SKY_FOG: 0xdfe0d2, // <- legacy @3783
  SKY_SUN: 0xfff3d6, // <- legacy @3784
  _v1: new THREE.Vector3(), // <- legacy @3832
  _hWrap: { v: 0 }, // <- legacy @3837
  GEO: {}, // <- legacy @3843
  MAT: {}, // <- legacy @3844
  TEX: {}, // <- legacy @3845
  DYN_GEO: [], // <- legacy @3846
  ROUTE_N: 1600, // <- legacy @3855
  routeX: null, // <- legacy @3856 (alokuje sa nižšie — S nesmie čítať S.ROUTE_N v literáli!)
  routeZ: null, // <- legacy @3857
  routeH: null, // <- legacy @3858
  routeLen: 1, // <- legacy @3859
  bridgeS0: 0, // <- legacy @3861
  bridgeS1: 0, // <- legacy @3861
  bridgeLen: 362, // <- legacy @3861
  roundS: [], // <- legacy @3862
  streetS: [], // <- legacy @3863
  TEX_ANISO: 4, // <- legacy @4114
  GB: { x0:0, z0:0, x1:0, z1:0 }, // <- legacy @5094
  GQ: new Int32Array(160), // <- legacy @5127
  townRoads: [], // <- legacy @5494
  BGRID: { cs:12, nx:0, nz:0, head:null, next:null }, // <- legacy @5876
  BX: { x:null, z:null, hw:null, hl:null, rot:null, by:null, bh:null, n:0 }, // <- legacy @5877
  BF: { p:null, o:null, n:null }, // <- legacy @5878
  CHUNKS: [], // <- legacy @5952
  VEG_GREENS: [0x5da24a, 0x4a8f3f, 0x3f7a3f, 0x2d5022], // <- legacy @6438
  VEG_OLIVE: [0x6b7a3a, 0x5a6b35, 0x7a8a45], // <- legacy @6439
  VEGW: { map:null }, // <- legacy @6440
  DYN_IM: [], // <- legacy @6694
  CAR_COLORS: [], // <- legacy @6698
  BLOOM: {
      ready:false, mode:1, strength:0.28, radius:0.4, threshold:0.92, scale:0, lowRes:false,
      finalComp:null, bloomPass:null, mixPass:null, occMat:null,
      srcRT:null, tex:null, list:[], occ:[], lampMesh:null, badT:0, fxaaPass:null, aaSticky:false,
      _size:new THREE.Vector2(), _cc:new THREE.Color()
    }, // <- legacy @7476
};

// Odvodené hodnoty AŽ po literáli (vnútri literálu by S čítalo samo seba = TDZ!).
S.LABEL_MAX = S.IS_MOBILE ? 10 : 40;
S.routeX = new Float32Array(S.ROUTE_N + 1);
S.routeZ = new Float32Array(S.ROUTE_N + 1);
S.routeH = new Float32Array(S.ROUTE_N + 1);
