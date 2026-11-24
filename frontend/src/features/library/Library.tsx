/** Screen 1 — Game library. RAWG browse/search with filters, infinite scroll and batch generation. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Sparkles } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useBatchCovers, useCreateGameCover } from '../../api/mutations';
import { useCovers, useLibrary, useSettings } from '../../api/queries';
import type { LibraryFilters, Platform, RawgGame } from '../../api/types';
import { Button, ButtonLink, EmptyState, ErrorPanel, PageHeader, Segmented, Select, Skeleton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { primaryPlatform } from '../../lib/status';
import { GameCard } from './GameCard';

/** RAWG genre slugs. Static, so the filter costs no API call. */
const GENRES = [
  ['action', 'Action'],
  ['adventure', 'Adventure'],
  ['role-playing-games-rpg', 'RPG'],
  ['shooter', 'Shooter'],
  ['platformer', 'Platformer'],
  ['fighting', 'Fighting'],
  ['racing', 'Racing'],
  ['sports', 'Sports'],
  ['puzzle', 'Puzzle'],
  ['strategy', 'Strategy'],
  ['simulation', 'Simulation'],
  ['indie', 'Indie'],
] as const;

const SORTS = [
  ['', 'Most popular'],
  ['-released', 'Newest'],
  ['-metacritic', 'Metacritic'],
  ['-rating', 'User rating'],
  ['name', 'A–Z'],
] as const;

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2012 }, (_, i) => String(THIS_YEAR - i));

export function Library() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const filters: LibraryFilters = {
    q: params.get('q') || '',
    platform: (['PS5', 'PS4'].includes(params.get('platform') || '') ? params.get('platform') : '') as '' | Platform,
    genre: params.get('genre') || '',
    year: params.get('year') || '',
    ordering: params.get('ordering') || '',
  };
  const library = useLibrary(filters);
  const settings = useSettings();
  const covers = useCovers();
  const createCover = useCreateGameCover();
  const batch = useBatchCovers();
  const [selected, setSelected] = useState<Map<number, { rawgId: number; name: string; platform: Platform }>>(new Map());
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  const games = useMemo(() => {
    const seen = new Set<number>();
    const out: RawgGame[] = [];
    for (const page of library.data?.pages || []) for (const g of page.games) if (!seen.has(g.id) && seen.add(g.id)) out.push(g);
    return out;
  }, [library.data]);

  const setFilter = (key: keyof LibraryFilters, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Infinite scroll: a sentinel below the grid, with a real button as the fallback.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !library.hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !library.isFetchingNextPage) void library.fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [library.hasNextPage, library.isFetchingNextPage, library.fetchNextPage, library]);

  const toggle = (g: RawgGame) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(g.id)) next.delete(g.id);
      else next.set(g.id, { rawgId: g.id, name: g.name, platform: primaryPlatform(g.platforms, filters.platform) });
      return next;
    });

  const generate = (g: RawgGame) => {
    setGeneratingId(g.id);
    createCover.mutate(
      { rawgId: g.id, input: { platform: primaryPlatform(g.platforms, filters.platform), style: 'standard' } },
      {
        onSuccess: (r) => navigate(`/runs/${r.cover.id}`),
        onError: (e) => toast(errorMessage(e), 'error'),
        onSettled: () => setGeneratingId(null),
      },
    );
  };

  const runBatch = () => {
    batch.mutate(
      { games: [...selected.values()] },
      {
        onSuccess: (r) => {
          setSelected(new Map());
          toast(r.message, r.skipped ? 'info' : 'success');
          const ids = [...r.created, ...r.rerun];
          navigate(ids.length === 1 ? `/runs/${ids[0]}` : '/runs');
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    );
  };

  const reviewCount = covers.data?.covers.filter((c) => c.status === 'needs_review').length ?? 0;
  const sgdbEnabled = Boolean(settings.data?.keys.sgdb);
  const heading = filters.q ? `Results for “${filters.q}”` : 'Popular PS5 and PS4 games, straight from RAWG.';

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Game library"
        subtitle={`${heading} Pick one to open its art, or select several and generate them in one go.`}
        actions={
          <>
            <ButtonLink to="/review">Open review queue{reviewCount ? ` (${reviewCount})` : ''}</ButtonLink>
            <Button variant="primary" icon={<Sparkles size={16} aria-hidden />} disabled={!selected.size || batch.isPending} onClick={runBatch}>
              {batch.isPending ? 'Queuing…' : `Batch-generate selected (${selected.size})`}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <Segmented
          label="Platform"
          value={filters.platform || 'all'}
          options={[
            { value: 'all', label: 'All' },
            { value: 'PS5', label: 'PS5' },
            { value: 'PS4', label: 'PS4' },
          ]}
          onChange={(v) => setFilter('platform', v === 'all' ? '' : v)}
        />
        <Select label="Genre" value={filters.genre} onChange={(e) => setFilter('genre', e.target.value)}>
          <option value="">All genres</option>
          {GENRES.map(([slug, name]) => (
            <option key={slug} value={slug}>
              {name}
            </option>
          ))}
        </Select>
        <Select label="Release year" value={filters.year} onChange={(e) => setFilter('year', e.target.value)}>
          <option value="">Any year</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Select label="Sort" value={filters.ordering} onChange={(e) => setFilter('ordering', e.target.value)}>
          {SORTS.map(([value, name]) => (
            <option key={value} value={value}>
              Sort: {name}
            </option>
          ))}
        </Select>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
            Clear selection
          </Button>
        )}
      </div>

      {library.isError ? (
        <ErrorPanel message={errorMessage(library.error)} onRetry={() => void library.refetch()} />
      ) : library.isLoading ? (
        <Grid>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[128/148]" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </Grid>
      ) : games.length === 0 ? (
        <EmptyState title="No games match">Try a shorter search, or clear the genre and year filters.</EmptyState>
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {games.length} game{games.length === 1 ? '' : 's'} shown{selected.size ? `, ${selected.size} selected` : ''}
          </p>
          <Grid>
            {games.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                platform={primaryPlatform(g.platforms, filters.platform)}
                selected={selected.has(g.id)}
                onToggle={() => toggle(g)}
                onGenerate={() => generate(g)}
                generating={generatingId === g.id}
                sgdbEnabled={sgdbEnabled}
              />
            ))}
          </Grid>
          <div ref={sentinel} className="flex justify-center py-4">
            {library.hasNextPage ? (
              <Button onClick={() => void library.fetchNextPage()} disabled={library.isFetchingNextPage}>
                {library.isFetchingNextPage ? 'Loading more…' : 'Load more games'}
              </Button>
            ) : (
              <p className="text-xs text-faint">End of results.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(188px,1fr))] sm:gap-4">{children}</div>;
}
