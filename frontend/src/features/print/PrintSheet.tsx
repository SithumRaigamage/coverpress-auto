/** One shelf's print sheet: 276 × 154 mm pages (270 × 148 mm trim + 3 mm bleed), printed at 100%. */
import { useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { usePrintPlan } from '../../api/queries';
import { Button, ButtonLink, EmptyState, ErrorPanel, PageHeader, Skeleton } from '../../components/ui';

export function PrintSheet() {
  const { projectId = '' } = useParams();
  const plan = usePrintPlan(projectId);

  if (plan.isError) return <ErrorPanel message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />;
  if (!plan.data) return <Skeleton className="h-96" />;
  const { pages, project, pageWidthMm, pageHeightMm, instructions } = plan.data;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div className="no-print flex flex-col gap-4">
        <PageHeader
          title={`Print sheet · ${project.name}`}
          subtitle={`${pages.length} page${pages.length === 1 ? '' : 's'}, ${pageWidthMm} × ${pageHeightMm} mm each.`}
          actions={
            <Button variant="primary" icon={<Printer size={16} aria-hidden />} disabled={!pages.length} onClick={() => window.print()}>
              Print {pages.length ? `(${pages.length})` : ''}
            </Button>
          }
        />
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted" aria-label="Before you print">
          <li>Print at 100% / Actual size</li>
          <li>No scaling, no “fit to page”</li>
          <li>Measure 270 mm across the trim marks</li>
        </ul>
        <p className="text-xs text-faint">{instructions}</p>
      </div>

      {pages.length === 0 ? (
        <EmptyState title="No approved covers on this shelf" action={<ButtonLink variant="primary" to={`/review?shelf=${project.id}`}>Open review</ButtonLink>}>
          Approving a cover in review (or letting it auto-approve) puts it on this sheet.
        </EmptyState>
      ) : (
        <div className="flex flex-col items-center gap-6 overflow-x-auto">
          {pages.map((p) => (
            <figure key={p.coverId} className="print-page shrink-0 bg-white" style={{ width: `${pageWidthMm}mm`, height: `${pageHeightMm}mm` }}>
              <img src={p.wrapUrl} alt={`Print wrap for ${p.title}, ${p.platform}, version ${p.version}`} style={{ width: `${pageWidthMm}mm`, height: `${pageHeightMm}mm` }} />
              <figcaption className="no-print mt-2 text-xs text-muted">
                {p.title} · {p.platform} · v{p.version}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
