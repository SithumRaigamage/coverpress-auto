import { useMemo, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { CircleCheck, FolderOpen, Layers3, Plus, ShieldAlert, ScanEye } from 'lucide-react';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateProject } from '../../api/mutations';
import { useMe, useProjects, useShelfStatuses } from '../../api/queries';
import { Button, Chip, EmptyState, ErrorPanel, SkeletonCards } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { ProjectStatus } from '../../api/types';
import { newShelfSchema, type NewShelfValues } from '../../lib/schemas';
import { ShelfCard } from './ShelfCard';

export function Shelves() {
  const projectsQuery = useProjects();
  const meQuery = useMe();
  const projects = projectsQuery.data?.projects ?? [];
  const statuses = useShelfStatuses(projects);
  const statusList = statuses.map((query) => query.data).filter((data): data is ProjectStatus => Boolean(data));

  const stats = useMemo(() => {
    if (statusList.length) {
      return {
        covers: statusList.reduce((sum, item) => sum + item.covers.length, 0),
        ready: statusList.reduce(
          (sum, item) => sum + item.covers.filter((c) => c.status === 'approved' || c.status === 'auto_approved').length,
          0,
        ),
        review: statusList.reduce((sum, item) => sum + item.covers.filter((c) => c.status === 'needs_review').length, 0),
        failed: statusList.reduce((sum, item) => sum + item.covers.filter((c) => c.status === 'failed').length, 0),
      };
    }
    return {
      covers: projects.reduce((sum, project) => sum + (project.coverCount ?? 0), 0),
      ready: projects.reduce((sum, project) => sum + (project.readyCount ?? 0), 0),
      review: 0,
      failed: 0,
    };
  }, [projects, statusList]);

  return (
    <div className="screen">
      <header className="hero">
        <div>
          <p className="eyebrow">Local workshop · personal use only</p>
          <h1>Shelves</h1>
          <p className="hero__lead">
            Gather titles, shape each insert, then print a case that fits. Every cover is a personal-use item —
            not official, not for sale.
          </p>
        </div>
        <div className="hero__case" aria-hidden="true">
          <div className="hero__case-band" />
          <div className="hero__case-art" />
          <div className="hero__case-foot">PERSONAL EDITION</div>
        </div>
      </header>

      <section className="stats" aria-label="Workbench summary">
        <Stat label="Total covers" value={stats.covers} hint="Across every shelf" icon={<Layers3 size={18} />} />
        <Stat label="Ready" value={stats.ready} hint="Approved or auto-approved" icon={<CircleCheck size={18} />} />
        <Stat label="Needs review" value={stats.review} hint="Waiting on your eye" icon={<ScanEye size={18} />} />
        <Stat label="Failed" value={stats.failed} hint="Needs art or a rebuild" icon={<ShieldAlert size={18} />} />
      </section>

      <InlineNewShelf expandedByDefault={projects.length <= 6} />

      <div className="section-heading">
        <div>
          <h2>Your shelves</h2>
          <p>{projects.length ? `${projects.length} in this workspace` : 'Nothing here yet'}</p>
        </div>
        {meQuery.data?.account.plan && <Chip tone="accent">{meQuery.data.account.plan.label} plan</Chip>}
      </div>

      {projectsQuery.isPending ? (
        <SkeletonCards count={3} />
      ) : projectsQuery.isError ? (
        <ErrorPanel message={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={22} />}
          title="Start with a shelf"
          body="A shelf holds the covers for one platform. Add it, paste your titles, then drop in your own artwork."
        />
      ) : (
        <div className="project-grid">
          {projects.map((project) => <ShelfCard project={project} key={project.id} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, icon }: { label: string; value: number; hint: string; icon: ReactNode }) {
  return (
    <div className="stat-card">
      <div style={{ color: 'var(--accent)' }}>{icon}</div>
      <div>
        <span className="stat-card__label">{label}</span>
        <strong className="stat-card__value mono">{value}</strong>
        <span className="stat-card__hint">{hint}</span>
      </div>
    </div>
  );
}

/** Inline by design: creating a shelf is a single line, not a modal. */
function InlineNewShelf({ expandedByDefault }: { expandedByDefault: boolean }) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const navigate = useNavigate();
  const create = useCreateProject();
  const { toast } = useToast();
  const [planHint, setPlanHint] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewShelfValues>({ resolver: zodResolver(newShelfSchema), defaultValues: { name: '', platform: 'PS5', layout: 'auto' } });

  const platform = watch('platform');
  const layout = watch('layout');

  const submit = handleSubmit(async (values) => {
    setPlanHint(null);
    try {
      const result = await create.mutateAsync(values);
      navigate(`/shelves/${encodeURIComponent(result.project.id)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) {
        setPlanHint(error.message);
      } else {
        toast('Could not create the shelf', { description: errorMessage(error), tone: 'error' });
      }
    }
  });

  if (!expanded) {
    return (
      <div className="inline-create">
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setExpanded(true)}>
          New shelf
        </Button>
      </div>
    );
  }

  return (
    <form className="inline-create panel" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="inline-create__field">
        <label className="field__label" htmlFor="shelf-name">New shelf</label>
        <input id="shelf-name" placeholder="e.g. Shelf 2026" aria-invalid={Boolean(errors.name)} {...register('name')} />
        {errors.name && <span className="field__error" role="alert">{errors.name.message}</span>}
      </div>
      <div className="field">
        <span className="field__label">Platform</span>
        <div className="segment" role="group" aria-label="Platform">
          {(['PS5', 'PS4'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={platform === option ? 'active' : ''}
              aria-pressed={platform === option}
              onClick={() => setValue('platform', option, { shouldValidate: true })}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">Layout</span>
        <select value={layout} aria-label="Layout" onChange={(event) => setValue('layout', event.target.value as NewShelfValues['layout'])}>
          <option value="auto">Auto</option>
          <option value="ps5">PS5 — white band</option>
          <option value="ps4">PS4 — accent band</option>
        </select>
      </div>
      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? 'Creating…' : 'Create'}
      </Button>
      {!expandedByDefault && <Button onClick={() => setExpanded(false)}>Cancel</Button>}
      {planHint && <p className="notice notice--info inline-create__hint">{planHint} Re-rendering existing covers stays free.</p>}
    </form>
  );
}
