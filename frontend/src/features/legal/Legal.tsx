import { Check } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useLegal } from '../../api/queries';
import { Card, ErrorPanel, PageHeader, Pill, Skeleton } from '../../components/ui';

export function Legal() {
  const query = useLegal();
  if (query.isError) return <ErrorPanel message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Skeleton className="h-96" />;
  const { title, summary, sections, contact } = query.data;
  return (
    <div className="mx-auto flex max-w-[800px] flex-col gap-6">
      <PageHeader title={title} subtitle={summary} actions={<Pill tone="accent">Personal use only</Pill>} />
      {sections.map((s) => (
        <Card key={s.heading} className="p-5">
          <h2 className="mb-2 text-[15px] font-semibold">{s.heading}</h2>
          {s.paragraphs?.map((p, i) => (
            <p key={i} className="mb-2 text-sm text-muted">
              {p}
            </p>
          ))}
          {s.bullets && (
            <ul className="flex flex-col gap-1.5">
              {s.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted">
                  <Check size={15} aria-hidden className="mt-0.5 shrink-0 text-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {contact && (
        <p className="text-sm text-muted">
          Takedown contact: <a className="text-accent underline" href={`mailto:${contact}`}>{contact}</a>
        </p>
      )}
    </div>
  );
}
