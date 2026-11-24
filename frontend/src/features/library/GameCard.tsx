import { Check } from 'lucide-react';
import { Link } from 'react-router';
import type { Platform, RawgGame } from '../../api/types';
import { Button, ButtonLink, Chip, CoverThumb, Pill } from '../../components/ui';
import { cn } from '../../lib/cn';
import { STATUS_META } from '../../lib/status';

export function GameCard({
  game,
  platform,
  selected,
  onToggle,
  onGenerate,
  generating,
  sgdbEnabled,
}: {
  game: RawgGame;
  platform: Platform;
  selected: boolean;
  onToggle: () => void;
  onGenerate: () => void;
  generating: boolean;
  sgdbEnabled: boolean;
}) {
  const status = game.cover ? STATUS_META[game.cover.status] : null;
  const pillLabel = game.cover?.status === 'needs_review' ? 'In review' : status?.label;
  const meta = [game.year, game.genres[0]].filter(Boolean).join(' · ');
  const rawgCount = game.art?.rawg ?? game.screenshotCount + (game.backgroundImage ? 1 : 0);
  const thumb = game.cover?.thumbUrl || game.backgroundImage;
  const checkboxId = `select-${game.id}`;

  return (
    <article
      aria-label={game.name}
      className={cn(
        'group flex flex-col overflow-hidden rounded-card border bg-surface transition-colors duration-[var(--cp-fast)]',
        selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="relative">
        <CoverThumb src={thumb} alt={`${game.name} artwork`} className="rounded-none" />
        <label
          htmlFor={checkboxId}
          className="absolute top-1 left-1 flex size-11 items-center justify-center"
          title={selected ? 'Remove from batch' : 'Add to batch'}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${game.name} for batch generation`}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className={cn(
              'flex size-6 items-center justify-center rounded-control border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
              selected ? 'border-accent bg-accent text-accent-ink' : 'border-white/40 bg-black/55 text-transparent',
            )}
          >
            <Check size={14} strokeWidth={3} />
          </span>
        </label>
        {/* A rendered front already prints the platform in its band. */}
        {!game.cover?.thumbUrl && (
          <span className="absolute top-2.5 right-2.5 rounded-control bg-black/70 px-1.5 py-0.5 font-display text-[11px] font-semibold tracking-wide text-white">
            {platform}
          </span>
        )}
        {status && (
          <span className="absolute bottom-2 left-2">
            <Pill tone={status.tone} dot className="bg-bg/85">
              {pillLabel}
            </Pill>
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold leading-snug" title={game.name}>
            <Link to={`/games/${game.id}`} className="hover:text-accent focus-visible:text-accent">
              {game.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted">{meta || 'Release date unknown'}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Chip title="Art candidates from RAWG">RAWG {rawgCount}</Chip>
          {sgdbEnabled && (
            <Chip title={game.art ? 'Art candidates from SteamGridDB' : 'Open the game to check SteamGridDB'}>
              SGDB {game.art ? game.art.sgdb : '—'}
            </Chip>
          )}
          {game.art &&
            (game.art.printReady ? (
              <Chip tone="success">Print-ready</Chip>
            ) : (
              <Chip tone="warning">Low-res only</Chip>
            ))}
        </div>
        <div className="mt-auto pt-1">
          {game.cover ? (
            <ButtonLink to={`/runs/${game.cover.id}`} size="sm" className="w-full" aria-label={`Open cover for ${game.name}`}>
              Open cover
            </ButtonLink>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={onGenerate}
              disabled={generating}
              aria-label={`Generate cover for ${game.name}`}
            >
              {generating ? 'Starting…' : 'Generate cover'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
