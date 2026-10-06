// src/ui/preloader.js — loading screen s reálnym progresom (fetch + init kroky).
export function createPreloader() {
  const root = document.getElementById('preloader');
  const bar = document.querySelector('#pre-bar>i');
  const log = document.getElementById('pre-log');
  let done = false;
  return {
    step(p, msg) {
      if (done) return;
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      if (log && msg) log.textContent = msg;
    },
    finish() {
      if (done) return; done = true;
      root?.classList.add('done');
      setTimeout(() => root?.remove(), 500);
    },
  };
}
