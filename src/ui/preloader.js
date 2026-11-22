// src/ui/preloader.js — loading screen s reálnym progresom (fetch + init kroky).
// Obrázky v public/loading/ sa striedajú na pozadí, hudba stanica 1 hrá od
// začiatku (spustená v main.js, tu len UI).
const IMG_NAMES = ['loading-1.png', 'loading-2.png', 'loading-3.png', 'loading-4.png', 'loading-5.png'];
const IMG_BASES = [
  '/loading/', './loading/', 'loading/',
  '/public/loading/', './public/loading/', 'public/loading/',
];

function candidatesFor(name) {
  return IMG_BASES.map((b) => b + name);
}

async function resolveImage(name) {
  for (const url of candidatesFor(name)) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return url;
    } catch { /* skús ďalej */ }
  }
  return candidatesFor(name)[0];
}

export function createPreloader() {
  const root = document.getElementById('preloader');
  const bar = document.querySelector('#pre-bar>i');
  const log = document.getElementById('pre-log');
  const bg = document.getElementById('pre-bg');
  let done = false;
  let timer = null;
  let current = 0;

  // Stiahni a zobraz slideshow (neblokujúco — progres beží ďalej).
  (async () => {
    try {
      const urls = await Promise.all(IMG_NAMES.map(resolveImage));
      if (!bg) return;
      urls.forEach((u, i) => {
        const im = document.createElement('img');
        im.src = u;
        im.className = 'pre-slide' + (i === 0 ? ' on' : '');
        im.alt = '';
        bg.appendChild(im);
      });
      timer = setInterval(() => {
        const slides = bg.querySelectorAll('img.pre-slide');
        if (slides.length < 2) return;
        slides[current].classList.remove('on');
        current = (current + 1) % slides.length;
        slides[current].classList.add('on');
      }, 1200);
    } catch { /* obrázky sú voliteľné */ }
  })();

  return {
    step(p, msg) {
      if (done) return;
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      if (log && msg) log.textContent = msg;
    },
    finish() {
      if (done) return; done = true;
      if (timer) { clearInterval(timer); timer = null; }
      root?.classList.add('done');
      setTimeout(() => root?.remove(), 600);
    },
  };
}
