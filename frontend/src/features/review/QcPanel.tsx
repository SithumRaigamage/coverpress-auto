import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Chip } from '../../components/ui';
import type { QcIssue } from '../../api/types';

export function QcPanel({ issues, score }: { issues: QcIssue[]; score: number | null }) {
  return (
    <section className="inspector__section" aria-label="Quality checks">
      <div className="inspector__section-title">
        <TriangleAlert size={14} /> QC
        {score !== null && <Chip tone={score >= 90 ? 'ok' : score >= 60 ? 'warn' : 'danger'}>SCORE {score}</Chip>}
      </div>
      {issues.length === 0 ? (
        <p className="subtle inline-row"><CircleCheck size={14} /> No checks reported.</p>
      ) : (
        <ul className="issue-list">
          {issues.map((issue, index) => {
            const failed = issue.level === 'fail';
            return (
              <li className={`issue ${failed ? 'issue--fail' : ''}`} key={`${issue.code}-${index}`}>
                {failed ? <OctagonAlert size={14} /> : <TriangleAlert size={14} />}
                <span>{issue.msg}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
