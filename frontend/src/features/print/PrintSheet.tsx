import { Link, useParams } from 'react-router';
import { Check, FileWarning, Printer } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { usePrintPlan, useProject } from '../../api/queries';
import { Button, Chip, EmptyState, ErrorPanel, Skeleton } from '../../components/ui';

export function PrintSheet() {
  const { id = '' } = useParams();
  const projectQuery = useProject(id);
  const planQuery = usePrintPlan(id);

  if (projectQuery.isPending || planQuery.isPending) {
    return (
      <div className="screen">
        <Skeleton className="skeleton--title" />
        <Skeleton className="skeleton--sheet" />
      </div>
    );
  }
  if (planQuery.isError || !planQuery.data) {
    return (
      <div className="screen">
        <ErrorPanel message={errorMessage(planQuery.error)} onRetry={() => void planQuery.refetch()} />
      </div>
    );
  }

  const plan = planQuery.data;

  return (
    <div className="screen print-screen">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Shelves</Link> / <Link to={`/shelves/${id}`}>{projectQuery.data?.project.name ?? 'Shelf'}</Link> / <span>Print</span>
      </nav>

      <header className="screen-header">
        <div>
          <p className="eyebrow">Print workshop</p>
          <h1>Print sheet</h1>
          <div className="chip-row">
            <Chip tone="accent">A4 landscape</Chip>
            <Chip><span className="mono">{plan.paper.scale}% scale</span></Chip>
            <Chip>{plan.pages.length} approved page{plan.pages.length === 1 ? '' : 's'}</Chip>
          </div>
        </div>
        <div className="screen-header__actions">
          <Link className="btn btn--secondary btn--md" to={`/shelves/${id}/review`}>Back to review</Link>
          <Button variant="primary" icon={<Printer size={16} />} disabled={plan.pages.length === 0} onClick={() => window.print()}>
            Print sheet
          </Button>
        </div>
      </header>

      {plan.pages.length === 0 ? (
        <EmptyState
          icon={<FileWarning size={22} />}
          title="Nothing approved yet"
          body="Approving a cover in review means you are happy with the wrap. Approved covers appear here as real-size sheets, one per page."
          action={<Link className="btn btn--primary btn--md" to={`/shelves/${id}/review`}>Go to review</Link>}
        />
      ) : (
        <>
          <section className="panel print-checklist" aria-label="Print checklist">
            <h2>Before you print</h2>
            <p>{plan.instructions}</p>
            <ul className="checklist">
              <li><Check size={14} /> Print at 100% / Actual size</li>
              <li><Check size={14} /> No scaling or “fit to page”</li>
              <li><Check size={14} /> Measure {plan.trimMm.width} mm across the trim marks</li>
              <li><Check size={14} /> {plan.bleedMm} mm bleed on every side</li>
            </ul>
          </section>

          <div className="sheet-list">
            {plan.pages.map((page, index) => (
              <article className="sheet-item" key={page.coverId}>
                <div className="sheet-item__label">
                  <span className="mono">Page {index + 1}</span>
                  <strong>{page.title}</strong>
                  <span className="subtle mono">{page.platform} · {page.version ? `v${page.version}` : 'latest'} · {page.widthMm} mm</span>
                </div>
                <div className="print-page">
                  <img src={page.wrapUrl} alt={`Print-ready wrap for ${page.title}`} />
                  <div className="print-page__trim" aria-hidden="true">
                    <span className="mono">{plan.trimMm.width} × {plan.trimMm.height} mm trim</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
