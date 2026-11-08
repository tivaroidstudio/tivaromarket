'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Pulpit', icon: '◧' },
  { href: '/markets', label: 'Rynki', icon: '◈' },
  { href: '/decisions', label: 'Decyzje AI', icon: '◆' },
  { href: '/forward-test', label: 'Forward test', icon: '◔' },
  { href: '/agents', label: 'Agenci', icon: '◉' },
  { href: '/calendar', label: 'Kalendarz', icon: '▦' },
  { href: '/news', label: 'Newsy i on-chain', icon: '≋' },
  { href: '/settings', label: 'Ustawienia', icon: '⚙' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 h-screen w-16 shrink-0 border-r border-line bg-panel/70 backdrop-blur md:w-56">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-up text-sm font-bold text-white">T</div>
        <div className="hidden md:block">
          <div className="text-sm font-semibold tracking-wide">TivaroMarket</div>
          <div className="text-[11px] text-muted">AI · paper · forward test</div>
        </div>
      </div>
      <ul className="space-y-1 px-2">
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? 'bg-accent/15 text-text' : 'text-muted hover:bg-white/5 hover:text-text'}`}
              >
                <span className={`w-4 text-center ${active ? 'text-accent' : ''}`}>{l.icon}</span>
                <span className="hidden md:inline">{l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="absolute bottom-4 hidden px-4 text-[11px] leading-snug text-muted md:block">
        Paper trading. Wyniki z przeszłości nie gwarantują przyszłych zysków.
      </div>
    </nav>
  );
}
