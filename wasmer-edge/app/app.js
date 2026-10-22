(() => {
  document.querySelectorAll('[data-open="apply-dialog"]').forEach((button) => {
    button.addEventListener('click', () => { window.location.href = 'pengajuan.html'; });
  });

  const menuToggle = document.querySelector('#menu-toggle');
  const navLinks = document.querySelector('#nav-links');
  menuToggle?.addEventListener('click', () => {
    const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!expanded));
    navLinks?.classList.toggle('open', !expanded);
  });
  navLinks?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  }));

})();
