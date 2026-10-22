(() => {
  'use strict';
  const intro = document.querySelector('.school-intro');
  if (!intro) return;
  if (document.documentElement.classList.contains('school-intro-skip') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    intro.remove(); return;
  }
  let leaving = false;
  const leave = () => {
    if (leaving) return;
    leaving = true;
    if (window.getComputedStyle(intro).visibility === 'hidden') { intro.remove(); return; }
    intro.classList.add('is-leaving');
    window.setTimeout(() => intro.remove(), 850);
  };
  // CSS owns the complete entrance, hold, and exit so script/network timing
  // cannot cut the animation short. It also hides itself without JavaScript.
  intro.addEventListener('animationend', event => {
    if (event.target === intro && ['school-intro-fallback','school-intro-exit'].includes(event.animationName)) intro.remove();
  });
  if (window.getComputedStyle(intro).visibility === 'hidden') { intro.remove(); return; }
  window.setTimeout(() => intro.remove(), 3700);
  window.addEventListener('pageshow', event => { if (event.persisted) leave(); });
  for (const event of ['pointerdown','keydown']) window.addEventListener(event, leave, {once:true,passive:true});
})();
