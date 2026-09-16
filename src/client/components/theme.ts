type Theme = 'light' | 'dark';

const STORAGE_KEY = 'inventory-theme';

export function mountThemeToggle(doc: Document) {
  const button = doc.getElementById('themeToggle') as HTMLButtonElement;
  let theme: Theme = 'light';
  try {
    if (doc.defaultView?.localStorage.getItem(STORAGE_KEY) === 'dark')
      theme = 'dark';
  } catch {}

  function apply(next: Theme) {
    theme = next;
    doc.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute(
      'aria-label',
      `Switch to ${dark ? 'light' : 'dark'} mode`,
    );
    button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
  }

  button.addEventListener('click', () => {
    apply(theme === 'light' ? 'dark' : 'light');
    try {
      doc.defaultView?.localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  });
  apply(theme);
}
