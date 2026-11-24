import { Link } from 'react-router';
import { ArrowUpRight, Image } from 'lucide-react';
import { Chip } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { Project } from '../../api/types';

export function ShelfCard({ project }: { project: Project }) {
  return (
    <Link to={`/shelves/${project.id}`} className="project-card">
      <div className="mosaic">
        {[0, 1, 2].map((index) => {
          const src = project.mosaics?.[index];
          return src ? (
            <img src={src} alt="" loading="lazy" key={src} />
          ) : (
            <div className="mosaic__empty" key={index}>
              <Image size={18} strokeWidth={1.5} />
            </div>
          );
        })}
      </div>
      <div className="project-card__body">
        <div className="project-card__top">
          <h3>{project.name}</h3>
          <Chip tone="accent">{project.platform}</Chip>
        </div>
        <p className="mono project-card__meta">
          {project.platform} · {project.coverCount ?? 0} covers · {project.readyCount ?? 0} ready
        </p>
        <p className="project-card__date">Created {formatDate(project.createdAt)}</p>
        <span className="subtle inline-row" style={{ marginTop: 8 }}>
          Open shelf <ArrowUpRight size={14} />
        </span>
      </div>
    </Link>
  );
}
