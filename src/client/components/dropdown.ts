export function closeDropdown(root: Element) {
  root.querySelector<HTMLElement>('.filter-menu')!.hidden = true;
  root.querySelector('.filter-trigger')!.setAttribute('aria-expanded', 'false');
}

// Both inventory filters and dynamically rendered barcode cells use this control.
export function mountDropdowns(doc: Document) {
  const roots = () => [
    ...doc.querySelectorAll<HTMLElement>('.filter-dropdown'),
  ];
  function open(root: HTMLElement) {
    roots()
      .filter((other) => other !== root)
      .forEach(closeDropdown);
    const trigger = root.querySelector<HTMLButtonElement>('.filter-trigger')!;
    const menu = root.querySelector<HTMLElement>('.filter-menu')!;
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(
      Math.max(bounds.width, 220),
      doc.defaultView!.innerWidth - 16,
    );
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, doc.defaultView!.innerWidth - width - 8))}px`;
    menu.hidden = false;
    const below = doc.defaultView!.innerHeight - bounds.bottom - 8;
    const above = bounds.top - 8;
    const upwards = below < Math.min(menu.scrollHeight, 280) && above > below;
    menu.style.maxHeight = `${Math.max(40, Math.min(280, upwards ? above : below))}px`;
    menu.style.top = `${upwards ? Math.max(8, bounds.top - menu.getBoundingClientRect().height - 4) : bounds.bottom + 4}px`;
    trigger.setAttribute('aria-expanded', 'true');
  }
  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const root = target.closest<HTMLElement>('.filter-dropdown');
    roots()
      .filter((other) => other !== root)
      .forEach(closeDropdown);
    if (!root || !target.closest('.filter-trigger')) return;
    const trigger = root.querySelector<HTMLButtonElement>('.filter-trigger')!;
    if (trigger.matches(':disabled') || trigger.closest('[inert]')) return;
    if (root.querySelector<HTMLElement>('.filter-menu')!.hidden) open(root);
    else closeDropdown(root);
  });
  doc.addEventListener('keydown', (event) => {
    const root = (event.target as Element).closest<HTMLElement>(
      '.filter-dropdown',
    );
    if (!root) return;
    if (event.key === 'Escape') {
      closeDropdown(root);
      root.querySelector<HTMLButtonElement>('.filter-trigger')!.focus();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(root);
      const buttons = [
        ...root.querySelectorAll<HTMLButtonElement>('.filter-menu button'),
      ].filter((button) => !button.matches(':disabled'));
      const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      const next =
        index < 0
          ? event.key === 'ArrowDown'
            ? 0
            : buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length;
      buttons[next]?.focus();
    }
  });
  doc.addEventListener('focusout', (event) => {
    const root = (event.target as Element).closest('.filter-dropdown');
    if (root && !root.contains(event.relatedTarget as Node | null))
      closeDropdown(root);
  });
  doc.defaultView!.addEventListener('resize', () =>
    roots().forEach(closeDropdown),
  );
  doc.addEventListener(
    'scroll',
    (event) => {
      if (
        !(event.target instanceof doc.defaultView!.Element) ||
        !(event.target as Element).closest('.filter-menu')
      )
        roots().forEach(closeDropdown);
    },
    true,
  );
}
