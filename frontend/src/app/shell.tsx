import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { LayoutGrid, Plus, Settings2, ShieldCheck } from 'lucide-react';
import { useHealth, useMe, useProjects } from '../api/queries';
import { Chip, UsageMeter } from '../components/ui';
import { cn } from '../lib/cn';

const NAV = [
  { to: '/', label: 'Shelves', icon: LayoutGrid },
  { to: '/settings', label: 'Settings', icon: Settings2 },
  { to: '/legal', label: 'Legal', icon: ShieldCheck },
];

function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Coverpress home">
      <span className="wordmark__mark" aria-hidden="true">CP</span>
      <span className="wordmark__text">
        <strong>COVERPRESS</strong>
        <small>PRINT WORKSHOP</small>
      </span>
    </Link>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const projectsQuery = useProjects();
  const meQuery = useMe();
  const healthQuery = useHealth();
  const projects = projectsQuery.data?.projects ?? [];
  const usage = projectsQuery.data?.usage ?? meQuery.data?.account.usage;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="sidebar">
        <div className="sidebar__head">
          <Wordmark />
          <nav className="sidebar__nav" aria-label="Main navigation">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => cn('nav-link', isActive && 'nav-link--active')}
              >
                <item.icon size={18} strokeWidth={1.8} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="sidebar__shelves">
          <div className="sidebar__label">
            <span>Shelves</span>
            <Link to="/" aria-label="All shelves"><Plus size={14} /></Link>
          </div>
          {projects.length === 0 ? (
            <p className="sidebar__empty">No shelves yet.</p>
          ) : (
            projects.slice(0, 7).map((project) => {
              const active = pathname.startsWith(`/shelves/${project.id}`);
              return (
                <Link key={project.id} to={`/shelves/${project.id}`} className={cn('shelf-link', active && 'shelf-link--active')}>
                  <span className="shelf-link__dot" style={{ backgroundColor: project.accent || '#14607A' }} />
                  <span className="shelf-link__name">{project.name}</span>
                  <span className="mono">{project.coverCount ?? 0}</span>
                </Link>
              );
            })
          )}
        </div>

        <div className="sidebar__foot">
          <UsageMeter usage={usage} />
          <div className="sidebar__chips">
            {meQuery.data?.account.plan && <Chip tone="accent">{meQuery.data.account.plan.label}</Chip>}
            <Chip tone={healthQuery.data?.ok ? 'ok' : 'danger'}>
              {healthQuery.data?.ok ? 'API online' : 'API offline'}
            </Chip>
          </div>
          <p className="sidebar__account mono">{meQuery.data?.account.email ?? 'local account'}</p>
        </div>
      </aside>

      <div className="shell__main">
        <div className="topbar">
          <Wordmark />
          <nav className="topbar__nav" aria-label="Main navigation">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => cn('topbar__link', isActive && 'active')}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <main id="main" className="main">
          <Outlet />
        </main>

        <footer className="app-footer">
          <span>Coverpress · personal use only · not official, not for sale</span>
          <Link to="/legal">Acceptable use</Link>
        </footer>
      </div>
    </div>
  );
}
