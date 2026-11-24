/** Print sheets — pick a shelf; its approved covers print one per A4 landscape page. */
import { errorMessage } from '../../api/client';
import { useProjects } from '../../api/queries';
import { ButtonLink, EmptyState, ErrorPanel, PageHeader, Skeleton } from '../../components/ui';

export function PrintSheets() {
  const projects = useProjects();
  const list = projects.data?.projects || [];
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <PageHeader title="Print sheets" subtitle="Approved covers print at real size, one wrap per A4 landscape page. Pick a shelf." />
      {projects.isError ? (
        <ErrorPanel message={errorMessage(projects.error)} />
      ) : projects.isLoading ? (
        <Skeleton className="h-40" />
      ) : list.length === 0 ? (
        <EmptyState title="Nothing to print yet" action={<ButtonLink variant="primary" to="/">Open the game library</ButtonLink>}>
          Generate covers, approve them in review, and they appear here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="text-xs text-muted">
                  {p.readyCount ?? 0} approved of {p.coverCount ?? 0}
                </span>
              </span>
              <ButtonLink size="sm" variant={p.readyCount ? 'primary' : 'secondary'} to={`/print/${p.id}`}>
                Open sheet
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
