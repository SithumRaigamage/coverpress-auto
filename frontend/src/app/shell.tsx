/** Sidebar + top bar + main region. Stacks to a top bar with scrolling nav on phones. */
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams, Link } from 'react-router';
import {
  Activity,
  BookOpen,
  Bell,
  ClipboardCheck,
  Library,
  Printer,
  Search,
  Settings as SettingsIcon,
  Layers,
} from 'lucide-react';
import { useCovers, useLlmSettings, useMe, useRuns, useSettings } from '../api/queries';
import { Meter } from '../components/ui';
import { cn } from '../lib/cn';
import { compact, initials, relative, STATUS_META } from '../lib/status';

export function Shell() {
  return (
    <div className="flex min-h-screen flex-col bg-bg md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="print-root flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sidebar */

function Sidebar() {
  const runs = useRuns();
  const covers = useCovers();
  const reviewCount = covers.data?.covers.filter((c) => c.status === 'needs_review').length ?? 0;
  const active = runs.data?.active ?? 0;

  const NAV = [
    { to: '/', label: 'Game library', icon: Library, end: true },
    { to: '/shelves', label: 'My shelves', icon: Layers },
    {
      to: '/runs',
      label: 'Pipeline runs',
      icon: Activity,
      badge: active > 0 ? <span className="font-mono text-xs font-semibold text-accent">{active}</span> : null,
      badgeLabel: active > 0 ? `${active} running` : undefined,
    },
    {
      to: '/review',
      label: 'Review queue',
      icon: ClipboardCheck,
      badge:
        reviewCount > 0 ? (
          <span className="rounded-full bg-warning/15 px-1.5 font-mono text-[11px] font-semibold text-warning-text">{reviewCount}</span>
        ) : null,
      badgeLabel: reviewCount > 0 ? `${reviewCount} need review` : undefined,
    },
    { to: '/print', label: 'Print sheets', icon: Printer },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className="no-print flex shrink-0 flex-col border-b border-line bg-sidebar md:sticky md:top-0 md:h-screen md:w-[var(--cp-sidebar-w)] md:border-r md:border-b-0">
      <Link to="/" className="flex items-center gap-2.5 px-4 pt-4 pb-3 md:px-5 md:pt-5" aria-label="Coverpress home">
        <span className="flex size-8 items-center justify-center rounded-control bg-accent text-accent-ink">
          <BookOpen size={17} strokeWidth={2.25} aria-hidden />
        </span>
        <span className="font-display text-[17px] font-semibold tracking-tight">Coverpress</span>
      </Link>

      <nav aria-label="Main" className="scroll-thin overflow-x-auto px-2 pb-2 md:flex-1 md:overflow-visible md:px-3 md:pt-2">
        <ul className="flex gap-1 md:flex-col">
          {NAV.map(({ to, label, icon: Icon, end, badge, badgeLabel }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                aria-label={badgeLabel ? `${label}, ${badgeLabel}` : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-2.5 rounded-button px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-[var(--cp-fast)]',
                    isActive ? 'bg-raised text-text' : 'text-muted hover:bg-raised/60 hover:text-text',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={17} aria-hidden className={isActive ? 'text-accent' : undefined} />
                    <span className="flex-1">{label}</span>
                    {badge}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  const me = useMe();
  const llm = useLlmSettings();
  const usage = me.data?.account.usage;
  const rawg = usage?.rawg;
  const connected = llm.data?.status?.connected;
  const statusText = llm.isLoading ? 'Checking Ollama…' : connected ? 'Ollama connected' : 'Ollama not reachable';

  return (
    <div className="hidden flex-col gap-4 border-t border-line px-5 py-4 md:flex">
      {rawg && <Meter label="RAWG requests" value={rawg.used} max={rawg.limit} display={`${compact(rawg.used)} / ${compact(rawg.limit)}`} />}
      {usage && <Meter label="Covers this month" value={usage.used} max={usage.limit} display={`${usage.used} / ${usage.limit}`} />}
      <p className="flex items-center gap-2 text-xs text-muted" title={llm.data?.status?.detail}>
        <span
          aria-hidden
          className={cn('size-2 rounded-full', connected ? 'bg-success' : llm.isLoading ? 'bg-faint' : 'bg-warning')}
        />
        <span>
          Local mode · {statusText}
        </span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- top bar */

function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onLibrary = location.pathname === '/';
  const [value, setValue] = useState(onLibrary ? params.get('q') || '' : '');
  const input = useRef<HTMLInputElement>(null);
  // Only keystrokes navigate. Without this, leaving the library with a query in
  // the field would bounce straight back to it.
  const typed = useRef(false);
  const me = useMe();

  // Keep the field in step with the URL (back button, filter links, other pages).
  useEffect(() => {
    typed.current = false;
    setValue(onLibrary ? params.get('q') || '' : '');
  }, [onLibrary, params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced: typing drives the library's ?q=, from any page.
  useEffect(() => {
    if (!typed.current) return;
    const current = onLibrary ? params.get('q') || '' : '';
    if (value === current || (!onLibrary && !value)) return;
    const t = window.setTimeout(() => {
      typed.current = false;
      const next = new URLSearchParams(onLibrary ? params : undefined);
      if (value) next.set('q', value);
      else next.delete('q');
      navigate({ pathname: '/', search: next.toString() }, { replace: onLibrary });
    }, 300);
    return () => window.clearTimeout(t);
  }, [value, onLibrary, params, navigate]);

  return (
    <div className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur md:px-8">
      <form
        role="search"
        className="relative flex max-w-xl flex-1 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ pathname: '/', search: value ? `?q=${encodeURIComponent(value)}` : '' });
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search games on RAWG
        </label>
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 text-faint" />
        <input
          ref={input}
          id="global-search"
          type="search"
          value={value}
          onChange={(e) => {
            typed.current = true;
            setValue(e.target.value);
          }}
          placeholder="Search games on RAWG…"
          autoComplete="off"
          className="min-h-11 w-full rounded-button border border-line bg-surface pr-14 pl-9 text-sm text-text placeholder:text-faint hover:border-line-strong"
        />
        <kbd className="pointer-events-none absolute right-3 hidden rounded-control border border-line-strong px-1.5 font-mono text-[11px] text-faint sm:block">
          ⌘K
        </kbd>
      </form>
      <div className="ml-auto flex items-center gap-1">
        <Notifications />
        <span
          role="img"
          aria-label={`Local account ${me.data?.account.email ?? ''}`.trim()}
          className="flex size-9 items-center justify-center rounded-full bg-raised font-display text-xs font-semibold text-text"
        >
          {initials(me.data?.account.email)}
        </span>
      </div>
    </div>
  );
}

const SEEN_KEY = 'coverpress.notifications.seen';

function Notifications() {
  const runs = useRuns();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => localStorage.getItem(SEEN_KEY) || '');
  const panel = useRef<HTMLDivElement>(null);
  const finished = (runs.data?.runs || []).filter((r) => r.finishedAt).slice(0, 8);
  const unseen = finished.filter((r) => (r.finishedAt || '') > seen).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    const latest = finished[0]?.finishedAt;
    if (latest) {
      localStorage.setItem(SEEN_KEY, latest);
      setSeen(latest);
    }
  };

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        aria-label={unseen ? `Notifications, ${unseen} new` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={toggle}
        className="relative inline-flex size-11 items-center justify-center rounded-button text-muted hover:bg-raised hover:text-text"
      >
        <Bell size={18} aria-hidden />
        {unseen > 0 && <span aria-hidden className="absolute top-2.5 right-2.5 size-2 rounded-full bg-accent" />}
      </button>
      {open && (
        <div
          id="notifications-panel"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line-strong bg-raised p-2 shadow-xl"
        >
          <p className="px-2 py-1.5 text-xs font-medium text-muted">Recent runs</p>
          {finished.length === 0 ? (
            <p className="px-2 py-3 text-sm text-faint">No finished runs yet.</p>
          ) : (
            <ul>
              {finished.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/runs/${r.coverId}`}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 flex-col justify-center rounded-control px-2 py-1.5 hover:bg-surface"
                  >
                    <span className="truncate text-sm">{r.title}</span>
                    <span className="text-xs text-faint">
                      {r.state === 'failed' ? 'Failed' : STATUS_META[r.coverStatus].label} · {relative(r.finishedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- footer */

function Footer() {
  const settings = useSettings();
  return (
    <footer className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-xs text-faint md:px-8">
      <span>
        Game data by{' '}
        <a href="https://rawg.io" className="text-muted underline underline-offset-2 hover:text-text" rel="noreferrer" target="_blank">
          RAWG.io
        </a>
      </span>
      {settings.data?.keys.sgdb && (
        <span>
          Art from{' '}
          <a href="https://www.steamgriddb.com" className="text-muted underline underline-offset-2 hover:text-text" rel="noreferrer" target="_blank">
            SteamGridDB
          </a>{' '}
          (personal use only)
        </span>
      )}
      <span>Personal-use inserts — not official, not for sale.</span>
      <Link to="/legal" className="text-muted underline underline-offset-2 hover:text-text">
        Acceptable use
      </Link>
    </footer>
  );
}
