(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const selectors = [
    '.hero-copy', '.hero-art', '.service-card', '.track-card', '.step-grid article',
    '.page-heading', '.prototype-banner', '.stat-card', '.list-panel', '.detail-panel',
    '.form-card', '.request-card', '.history-card', '.status-card', '.info-card',
    '.login-card', '.role-card'
  ];
  const items = [...document.querySelectorAll(selectors.join(','))];
  if (!items.length || reduceMotion || !('IntersectionObserver' in window)) return;

  items.forEach((item, index) => {
    item.classList.add('motion-item');
    const siblingIndex = item.parentElement ? [...item.parentElement.children].filter((node) => node.matches(selectors.join(','))).indexOf(item) : 0;
    item.style.transitionDelay = `${Math.min(Math.max(siblingIndex, 0) * 55, 220)}ms`;
  });
  document.documentElement.classList.add('motion-ready');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('motion-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -18px 0px' });
  items.forEach((item) => observer.observe(item));

  const dynamicObserver = new MutationObserver((changes) => {
    changes.forEach((change) => {
      const candidates = change.type === 'attributes'
        ? [change.target]
        : [...change.addedNodes].filter((node) => node.nodeType === Node.ELEMENT_NODE)
            .flatMap((node) => [node, ...node.querySelectorAll('.timeline li,.table-scroll tbody tr,.step-panel')]);
      candidates.forEach((node) => {
        if (!(node instanceof Element) || node.hidden) return;
        if (node.matches('.timeline li,.table-scroll tbody tr,.step-panel')) {
          node.classList.remove('motion-appearing');
          void node.offsetWidth;
          node.classList.add('motion-appearing');
          window.setTimeout(() => node.classList.remove('motion-appearing'), 380);
        }
      });
    });
  });
  dynamicObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
