import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Kruháč Simulator — Vite build pipeline.
//
//  npm run dev   → rýchly modulárny dev (ESM, HMR, fetch mapData.json + audio lazy)
//  npm run build → dist/index.html = JEDEN inline súbor (JS+CSS), data ostávajú externe
//
// DÔLEŽITÉ: audio (23 MB) a mapData.json (0.5 MB) sa NIKDY neinlinujú do HTML.
// - Načítavajú sa cez fetch() za behu (pozri src/world/mapData.js, src/audio/radio.js).
// - `public/` sa kopíruje do dist/ 1:1 → distribúcia = dist/index.html + dist/data + dist/audio.
// - Výsledné dist/index.html má ~0.5–1 MB (namiesto 32 MB), parsuje sa v ms, nefreezeuje main thread.
//
// Ak naozaj chceš 100 % single-file aj s muzikou (neodporúča sa — 25 MB HTML),
// použi `npm run build:portable` (pozri portable profil dolu).
export default defineConfig(({ mode }) => {
  const portable = mode === 'portable';
  return {
    // Relatívne cesty → dist/ funguje aj z file:// a z hocijakého podadresára.
    base: './',
    publicDir: 'public',
    build: {
      target: 'es2020',
      cssCodeSplit: false,
      // Nikdy neinlinuj veľké binárky. Všetko nad 4 kB ostáva súborom.
      // (public/* sa aj tak neinlinuje nikdy — toto kryje importované assety.)
      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // Jeden bundle = jeden <script> na inlinovanie.
          inlineDynamicImports: true,
          manualChunks: undefined,
        },
      },
      // Portable profil: povoľ inlinovanie všetkého (vrátane mp3/wav/json).
      // POZOR: výsledok má ~25 MB a návratne zamrzne parser — len na explicitné vyžiadanie.
      ...(portable ? { assetsInlineLimit: 100 * 1024 * 1024 } : {}),
    },
    plugins: [
      viteSingleFile({
        // Odporúčané nastavenie (inline JS+CSS, odstráň prázdne <script> tagy).
        useRecommendedBuildConfig: !portable,
        // Odstráni vite preload polyfill — hra nemá lazy chunky, netreba ho.
        removeViteModuleLoader: true,
      }),
    ],
    server: {
      // Dev beží na http:// → fetch + Audio + canvas readback bez CORS problémov.
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin' },
    },
  };
});
