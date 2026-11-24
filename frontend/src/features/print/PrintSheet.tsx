/** One shelf's print sheet: one wrap per A4 landscape page at exactly 100%, with
 *  trim crop marks, spine fold marks and a 100 mm test ruler. Millimetres only. */
import { useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { usePrintPlan } from '../../api/queries';
import type { PrintPlan } from '../../api/types';
import { Button, ButtonLink, EmptyState, ErrorPanel, PageHeader, Skeleton } from '../../components/ui';
import { SHEET, sheetGeometry, type SheetGeometry } from '../../lib/print';

export function PrintSheet() {
  const { projectId = '' } = useParams();
  const plan = usePrintPlan(projectId);

  if (plan.isError) return <ErrorPanel message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />;
  if (!plan.data) return <Skeleton className="h-96" />;
  const { pages, project, trimMm, panelsMm, bleedMm, instructions } = plan.data;
  const geo = sheetGeometry(trimMm, panelsMm, bleedMm);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div className="no-print flex flex-col gap-4">
        <PageHeader
          title={`Print sheet · ${project.name}`}
          subtitle={`${pages.length} page${pages.length === 1 ? '' : 's'} · wrap ${trimMm.width} × ${trimMm.height} mm (back ${panelsMm.back} + spine ${panelsMm.spine} + front ${panelsMm.front}) + ${bleedMm} mm bleed · A4 landscape.`}
          actions={
            <Button variant="primary" icon={<Printer size={16} aria-hidden />} disabled={!pages.length} onClick={() => window.print()}>
              Print {pages.length ? `(${pages.length})` : ''}
            </Button>
          }
        />
        <p role="note" className="rounded-card border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning-text">
          Print at 100% / Actual size, do not fit to page.
        </p>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted" aria-label="Before you cut">
          <li>Measure the printed ruler: it must be exactly 100 mm</li>
          <li>Trim marks are 270 mm apart</li>
          <li>Fold at the two dashed spine marks</li>
        </ul>
        <p className="text-xs text-faint">{instructions}</p>
      </div>

      {pages.length === 0 ? (
        <EmptyState title="No approved covers on this shelf" action={<ButtonLink variant="primary" to={`/review?shelf=${project.id}`}>Open review</ButtonLink>}>
          Approving a cover in review (or letting it auto-approve) puts it on this sheet.
        </EmptyState>
      ) : (
        <div className="scroll-thin flex flex-col items-center gap-6 overflow-x-auto">
          {pages.map((p) => (
            <Sheet key={p.coverId} page={p} geo={geo} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sheet({ page, geo }: { page: PrintPlan['pages'][number]; geo: SheetGeometry }) {
  const { image, trim, folds, ruler } = geo;
  const mark = { stroke: '#000', strokeWidth: 0.2 };
  const top = image.y;
  const bottom = image.y + image.height;
  return (
    <figure
      className="print-page relative shrink-0 bg-white"
      data-testid="print-page"
      style={{ width: `${SHEET.width}mm`, height: `${SHEET.height}mm` }}
    >
      <img
        src={page.wrapUrl}
        alt={`Print wrap for ${page.title}, ${page.platform}, version ${page.version}`}
        className="absolute"
        style={{ left: `${image.x}mm`, top: `${image.y}mm`, width: `${image.width}mm`, height: `${image.height}mm` }}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0"
        width={`${SHEET.width}mm`}
        height={`${SHEET.height}mm`}
        viewBox={`0 0 ${SHEET.width} ${SHEET.height}`}
      >
        {/* Trim: 270 × 148 mm. Not drawn as a box — marks only, so nothing prints on the cover. */}
        <rect data-trim x={trim.x} y={trim.y} width={trim.width} height={trim.height} fill="none" stroke="none" />
        {/* Crop marks: vertical ticks above and below the bleed at each trim edge … */}
        {[trim.x, trim.x + trim.width].map((x) => (
          <g key={`v${x}`} data-crop>
            <line x1={x} y1={0.5} x2={x} y2={top - 0.5} {...mark} />
            <line x1={x} y1={bottom + 0.5} x2={x} y2={bottom + 5.5} {...mark} />
          </g>
        ))}
        {/* … and horizontal ticks in the side margins at the trim height. */}
        {[trim.y, trim.y + trim.height].map((y) => (
          <g key={`h${y}`} data-crop>
            <line x1={0} y1={y} x2={image.x - 0.3} y2={y} {...mark} />
            <line x1={image.x + image.width + 0.3} y1={y} x2={SHEET.width} y2={y} {...mark} />
          </g>
        ))}
        {/* Spine fold marks, dashed, above and below. */}
        {folds.map((x) => (
          <g key={`f${x}`} data-fold={x}>
            <line x1={x} y1={0.5} x2={x} y2={top - 0.5} {...mark} strokeDasharray="0.8 0.6" />
            <line x1={x} y1={bottom + 0.5} x2={x} y2={bottom + 5.5} {...mark} strokeDasharray="0.8 0.6" />
          </g>
        ))}
        {/* 100 mm test ruler: 1 mm ticks, longer every 5 and 10. */}
        <g data-ruler={ruler.length}>
          <line x1={ruler.x} y1={ruler.y} x2={ruler.x + ruler.length} y2={ruler.y} {...mark} strokeWidth={0.25} />
          {Array.from({ length: ruler.length + 1 }, (_, i) => (
            <line key={i} x1={ruler.x + i} y1={ruler.y} x2={ruler.x + i} y2={ruler.y - (i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1.1)} {...mark} strokeWidth={0.12} />
          ))}
          {[0, 50, 100].map((i) => (
            <text key={i} x={ruler.x + i} y={ruler.y + 3} fontSize={2.2} textAnchor="middle" fontFamily="sans-serif" fill="#000">
              {i}
            </text>
          ))}
          <text x={ruler.x + ruler.length + 4} y={ruler.y + 0.8} fontSize={2.4} fontFamily="sans-serif" fill="#000">
            100 mm test ruler — if this does not measure exactly 100 mm, the page was scaled. Reprint at 100% / Actual size.
          </text>
        </g>
      </svg>
      <figcaption className="no-print absolute -bottom-6 left-0 text-xs text-muted">
        {page.title} · {page.platform} · v{page.version}
      </figcaption>
    </figure>
  );
}
