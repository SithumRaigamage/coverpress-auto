/** My shelves — each shelf with a mosaic of its latest covers, counts and shortcuts. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateProject, useDeleteProject } from '../../api/mutations';
import { useMe, useProjects } from '../../api/queries';
import type { Platform } from '../../api/types';
import { Button, ButtonLink, Card, EmptyState, ErrorPanel, PageHeader, Segmented, Skeleton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function Shelves() {
  const projects = useProjects();
  const create = useCreateProject();
  const remove = useDeleteProject();
  const toast = useToast();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<Platform>('PS5');
  const list = projects.data?.projects || [];
  const plan = projects.data?.plan;
  const me = useMe();
  const dev = me.data?.account.devMode;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), platform },
      {
        onSuccess: () => {
          setName('');
          toast('Shelf created.', 'success');
        },
        onError: (err) => toast(err instanceof ApiError && err.status === 402 ? `${err.message} Change the plan with npm run plan.` : errorMessage(err), err instanceof ApiError && err.status === 402 ? 'info' : 'error'),
      },
    );
  };

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title="My shelves"
        subtitle={plan && !dev ? `Shelves group covers for review and printing. ${list.length} of ${plan.projects} on the ${plan.label} plan.` : 'Shelves group covers for review and printing.'}
      />

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="New shelf">
        <label className="flex min-w-56 flex-1 flex-col gap-1 sm:max-w-sm">
          <span className="text-xs font-medium text-muted">New shelf</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Living room"
            className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm placeholder:text-faint hover:border-line-strong"
          />
        </label>
        <Segmented label="Default platform" value={platform} options={[{ value: 'PS5', label: 'PS5' }, { value: 'PS4', label: 'PS4' }]} onChange={setPlatform} />
        <Button type="submit" variant="primary" icon={<Plus size={16} aria-hidden />} disabled={!name.trim() || create.isPending}>
          Create shelf
        </Button>
      </form>

      {projects.isError ? (
        <ErrorPanel message={errorMessage(projects.error)} onRetry={() => void projects.refetch()} />
      ) : projects.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="No shelves yet" action={<ButtonLink variant="primary" to="/">Open the game library</ButtonLink>}>
          Generating a cover from the library creates “My library” automatically, or name one above.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
          {list.map((p) => (
            <li key={p.id}>
              <Card as="article" className="flex h-full flex-col gap-3 p-4">
                <div className="grid grid-cols-3 gap-1.5" aria-hidden>
                  {[0, 1, 2].map((i) =>
                    p.mosaics?.[i] ? (
                      <div key={i} className="cover-frame rounded-control">
                        <img src={p.mosaics[i]} alt="" loading="lazy" />
                      </div>
                    ) : (
                      <div key={i} className="cover-frame rounded-control border border-dashed border-line-strong bg-transparent" />
                    ),
                  )}
                </div>
                <div>
                  <h2 className="text-base font-semibold">{p.name}</h2>
                  <p className="text-xs text-muted">
                    {p.platform} · {p.coverCount ?? 0} cover{p.coverCount === 1 ? '' : 's'} · {p.readyCount ?? 0} ready to print
                  </p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <ButtonLink size="sm" to={`/review?shelf=${p.id}`}>Review</ButtonLink>
                  <ButtonLink size="sm" to={`/print/${p.id}`}>Print sheet</ButtonLink>
                  <ConfirmDialog
                    title={`Delete the shelf “${p.name}”?`}
                    description={`The shelf goes with ${p.coverCount ? `its ${p.coverCount} cover${p.coverCount === 1 ? '' : 's'}, every version and every run` : 'nothing else: it is empty'}. This can’t be undone.`}
                    requireText={p.coverCount ? 'DELETE' : undefined}
                    confirmLabel="Delete shelf"
                    onConfirm={() =>
                      remove.mutate(p.id, {
                        onSuccess: (r) => toast(`“${p.name}” deleted${r.covers ? ` with ${r.covers} cover${r.covers === 1 ? '' : 's'}` : ''}.`, 'success'),
                        onError: (e) => toast(errorMessage(e), 'error'),
                      })
                    }
                    trigger={
                      <Button size="sm" variant="ghost" className="ml-auto hover:text-danger" icon={<Trash2 size={14} aria-hidden />}>
                        Delete
                      </Button>
                    }
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">
        Prefer a list? <Link to="/review" className="text-muted underline underline-offset-2">The review queue</Link> shows every cover on every shelf.
      </p>
    </div>
  );
}
