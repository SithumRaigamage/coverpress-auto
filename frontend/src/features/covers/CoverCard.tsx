import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { ExternalLink, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useBuildCover, useDeleteCover, useUploadArt } from '../../api/mutations';
import { errorMessage } from '../../api/client';
import { Button, Chip, StatusChip } from '../../components/ui';
import { Hint } from '../../components/Tooltip';
import { useToast } from '../../components/Toast';
import { isBusy } from '../../lib/format';
import type { Cover } from '../../api/types';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 12 * 1024 * 1024;

export function CoverCard({ cover, projectId, busy }: { cover: Cover; projectId: string; busy: boolean }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const upload = useUploadArt();
  const build = useBuildCover(projectId);
  const remove = useDeleteCover(projectId);

  async function uploadFile(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('Use a PNG, JPEG or WebP image', { tone: 'error' });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast('That image is over 12 MB', { tone: 'error' });
      return;
    }
    setUploading(true);
    try {
      const result = await upload.mutateAsync({ coverId: cover.id, file });
      toast('Front art uploaded', { description: `${result.width} × ${result.height} px`, tone: 'success' });
    } catch (error) {
      toast('Upload failed', { description: errorMessage(error), tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  const image = cover.thumbUrl ?? cover.artUrl;

  return (
    <article
      className={`cover-card ${dragging ? 'cover-card--drag' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="cover-card__art">
        {image ? (
          <img src={image} alt={`Front art for ${cover.title}`} loading="lazy" />
        ) : (
          <div className="cover-placeholder" aria-label={`No art yet for ${cover.title}`}>
            <div className="cover-placeholder__band" />
            <span>{cover.title}</span>
            <div className="cover-placeholder__foot" />
          </div>
        )}
        {isBusy(cover.status) && <span className="cover-card__busy mono">BUILDING</span>}
        {uploading && (
          <div className="progress-bar" role="progressbar" aria-label={`Uploading art for ${cover.title}`}>
            <div className="progress-bar__fill" />
          </div>
        )}
        <div className="cover-card__overlay">
          <Button size="sm" icon={<Upload size={14} />} disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? 'Uploading…' : 'Replace art'}
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          accept="image/png,image/jpeg,image/webp"
          aria-label={`Upload front art for ${cover.title}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
            event.target.value = '';
          }}
        />
      </div>

      <div className="cover-card__body">
        <div className="chip-row">
          <StatusChip status={cover.status} />
          {cover.score !== null && <Chip tone={cover.score >= 90 ? 'ok' : cover.score >= 60 ? 'warn' : 'danger'}>QC {cover.score}</Chip>}
        </div>
        <h3 title={cover.title}>{cover.title}</h3>
        <p className="mono subtle">
          {cover.platform} · {cover.renderVersion ? `v${cover.renderVersion}` : 'no render'}
        </p>
        {cover.error && <p className="cover-card__error" role="alert">{cover.error}</p>}
        <div className="cover-card__actions">
          <Hint label="Queue a fresh render">
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={14} />}
              disabled={busy || isBusy(cover.status)}
              onClick={() => void build.mutateAsync(cover.id).catch((error: unknown) => toast('Build failed', { description: errorMessage(error), tone: 'error' }))}
            >
              Build
            </Button>
          </Hint>
          <Link className="btn btn--ghost btn--sm" to={`/shelves/${projectId}/review?cover=${cover.id}`}>
            Review <ExternalLink size={13} />
          </Link>
          <Hint label="Remove this cover and its files">
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              aria-label={`Remove ${cover.title}`}
              aria-expanded={confirming}
              onClick={() => setConfirming((value) => !value)}
            />
          </Hint>
          {confirming && (
            <div className="confirm-popover" role="group" aria-label={`Confirm removing ${cover.title}`}>
              <p>Remove cover and its renders? Irreversible.</p>
              <div className="confirm-popover__actions">
                <Button size="sm" variant="danger" onClick={() => {
                  setConfirming(false);
                  void remove.mutateAsync(cover.id).catch((error: unknown) => toast('Remove failed', { description: errorMessage(error), tone: 'error' }));
                }}>Remove</Button>
                <Button size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
