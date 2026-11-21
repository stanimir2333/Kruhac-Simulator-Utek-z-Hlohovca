// src/fx/night.js — zdieľaný faktor noci pre materiálové shadery.
// daynight.js do neho každý snímok zapisuje 0 (deň) … 1 (noc). Materiály si ho
// čítajú cez onBeforeCompile (uniform dostane referenciu na tento objekt), takže
// sa nemusí prechádzať celá scéna ani prepisovať emissiveIntensity po objektoch.
// Jeden zdroj pravdy: noc je definovaná len v daynight.js, nikde inde.
export const NIGHT = { value: 0 };
