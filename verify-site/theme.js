(() => {
  const key = 'deeptruck.theme';
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const apply = value => {
    const theme = value === 'light' ? 'light' : 'dark';
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#dfe5ec' : '#090b0e');
    document.querySelectorAll('[data-theme-logo]').forEach(image => {
      image.setAttribute('src', theme === 'light' ? '/shield-mark-light.svg' : '/shield-mark.svg');
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-checked', String(theme === 'light'));
      button.querySelector('[data-theme-label]').textContent = theme === 'light' ? 'Light' : 'Dark';
    });
  };
  // Runs before styles load, so a saved light theme never flashes dark.
  apply(read());
  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(key, theme); } catch { /* Switching still works without storage. */ }
      apply(theme);
    }));
  });
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(read()); });
})();
