const TABS = [
  { href: '#/', label: 'Home', icon: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { href: '#/matches', label: 'Matches', icon: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' },
  { href: '#/me', label: 'Me', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6' },
];

export function TabBar({ active }: { active: string }) {
  return (
    <nav class="tabs" aria-label="Main">
      {TABS.map((t) => (
        <a class="tab" href={t.href} aria-current={active === t.href ? 'page' : undefined}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={t.icon} />
          </svg>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
