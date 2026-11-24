import { Link } from 'react-router';
import { Check, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useLegal } from '../../api/queries';
import { Chip, ErrorPanel, Skeleton } from '../../components/ui';

export function Legal() {
  const query = useLegal();

  if (query.isPending) {
    return (
      <div className="screen">
        <Skeleton className="skeleton--title" />
        <Skeleton className="skeleton--panel" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="screen">
        <ErrorPanel message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const { title, summary, sections, contact } = query.data;

  return (
    <div className="screen">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/settings">Settings</Link> / <span>Legal</span>
      </nav>
      <header className="screen-header">
        <div>
          <p className="eyebrow">Acceptable use</p>
          <h1>{title}</h1>
          <p className="legal-summary">{summary}</p>
        </div>
        <Chip tone="accent"><ShieldCheck size={13} /> Personal use only</Chip>
      </header>

      <div className="legal-sections">
        {sections.map((section) => (
          <section className="panel legal-card" key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((paragraph, index) => <p key={`p-${index}`}>{paragraph}</p>)}
            {section.bullets && (
              <ul>
                {section.bullets.map((bullet, index) => (
                  <li key={`b-${index}`}><Check size={14} /> <span>{bullet}</span></li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {contact && (
        <p className="legal-contact">Takedown contact: <a href={`mailto:${contact}`}>{contact}</a></p>
      )}
    </div>
  );
}
