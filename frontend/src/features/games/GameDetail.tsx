/** Screen 2 — Game detail & art picker. Picks the best-fit art automatically; one click runs every step. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronRight, Play, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useCreateGameCover, useDeleteAiArt, useDraftCopy, useGenerateArt } from '../../api/mutations';
import { useAiPrompt, useGame, useGameArt, useLlmSettings, useMe, useProjects } from '../../api/queries';
import type { ArtItem, BackCopy, CoverStyle, GameArt, Platform } from '../../api/types';
import { Button, Card, Chip, ErrorPanel, IconButton, Pill, Segmented, Select, Skeleton } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { cn } from '../../lib/cn';
import { fitTone, primaryPlatform, STATUS_META } from '../../lib/status';

type Tab = 'all' | 'RAWG' | 'SteamGridDB' | 'AI';

export function GameDetail() {
  const { rawgId = '' } = useParams();
  const game = useGame(rawgId);
  const art = useGameArt(rawgId);

  if (game.isError) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <Breadcrumb name="Game" />
        <ErrorPanel message={errorMessage(game.error)} onRetry={() => void game.refetch()} />
      </div>
    );
  }
  if (!game.data) return <DetailSkeleton />;
  return <Detail key={rawgId} rawgId={rawgId} data={game.data} art={art.data} artError={art.error} artLoading={art.isLoading} />;
}

function Detail({
  rawgId,
  data,
  art,
  artError,
  artLoading,
}: {
  rawgId: string;
  data: NonNullable<ReturnType<typeof useGame>['data']>;
  art: GameArt | undefined;
  artError: unknown;
  artLoading: boolean;
}) {
  const { game, covers } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const projects = useProjects();
  const llm = useLlmSettings();
  const create = useCreateGameCover();
  const draft = useDraftCopy(rawgId);

  const [platform, setPlatform] = useState<Platform>(primaryPlatform(game.platforms, ''));
  const [style, setStyle] = useState<CoverStyle>('standard');
  const [tab, setTab] = useState<Tab>('all');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [copy, setCopy] = useState<BackCopy>(data.copy);
  const [edited, setEdited] = useState(false);
  const [projectId, setProjectId] = useState('');

  // Auto-select the highest fit as Front until the user clicks a tile.
  // A picked image that was deleted falls back to the automatic best pick.
  const frontId = (pickedId && art?.items.some((i) => i.id === pickedId) ? pickedId : null) ?? art?.best ?? null;
  const deleteAi = useDeleteAiArt(rawgId);
  const removeAi = (item: ArtItem) =>
    deleteAi.mutate(
      { url: item.url },
      { onSuccess: () => toast('AI image deleted.', 'success'), onError: (e) => toast(errorMessage(e), 'error') },
    );
  const front = art?.items.find((i) => i.id === frontId) || null;

  // Draft copy with the language model once, if it is reachable and nothing is cached yet.
  const drafted = useRef(false);
  useEffect(() => {
    if (drafted.current || data.copy.source !== 'rawg' || !llm.data?.status?.connected) return;
    drafted.current = true;
    draft.mutate(false, {
      onSuccess: (c) => {
        if (!edited) setCopy(c);
      },
    });
  }, [data.copy.source, llm.data?.status?.connected, draft, edited]);

  const shelves = projects.data?.projects || [];
  // One cover per game + platform: switching platform means a new cover.
  const existing = covers.find((c) => c.platform === platform) || null;
  const usage = me.data?.account.usage;
  const left = usage ? Math.max(0, usage.limit - usage.used) : null;

  const submit = (mode: 'run' | 'add') => {
    create.mutate(
      {
        rawgId,
        input: { platform, style, artId: frontId, copy: edited ? copy : undefined, projectId: projectId || undefined },
      },
      {
        onSuccess: (r) => {
          if (mode === 'run') navigate(`/runs/${r.cover.id}`);
          else
            toast(`${game.name} added to ${r.cover.projectName || 'your shelf'} and queued.`, 'success', {
              to: `/runs/${r.cover.id}`,
              label: 'View run',
            });
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    );
  };

  const visible = (art?.items || []).filter((i) => tab === 'all' || i.source === tab);
  const metaLine = [game.developer, game.year, game.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <Breadcrumb name={game.name} />

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,420px)_1fr]">
        {/* Front preview */}
        <div className="flex flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
          <div className="cover-frame relative rounded-card border border-line">
            {front ? (
              <img src={front.url} alt={`Front art for ${game.name}: ${front.source} ${front.kind}`} />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-faint">
                {artLoading ? 'Finding art…' : 'No art found for this game.'}
              </div>
            )}
          </div>
          <p className="text-sm">
            <span className="text-muted">Front art</span>
            {front && (
              <>
                {' · '}
                {front.source} · <span className="font-mono text-[13px]">{front.width} × {front.height}</span>
              </>
            )}
          </p>
          <p className="text-xs text-faint">Printed at 128 × 148 mm at 300 DPI (1512 × 1748 px). Art is cropped to fill the panel.</p>
        </div>

        {/* Settings and actions */}
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <h1 className="text-[28px] leading-tight font-semibold">{game.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {metaLine}
              {metaLine && ' · '}Metadata from RAWG
            </p>
            {covers.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                Already on {covers.length === 1 ? 'a shelf' : `${covers.length} shelves`}:
                {covers.map((c) => (
                  <Link key={c.id} to={`/runs/${c.id}`} className="inline-flex items-center gap-1.5 hover:text-text">
                    <Pill tone={STATUS_META[c.status].tone} dot>
                      {STATUS_META[c.status].label}
                    </Pill>
                    <span className="underline underline-offset-2">{c.projectName}</span>
                  </Link>
                ))}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-6">
            <Segmented
              label="Platform"
              hideLabel={false}
              value={platform}
              options={[
                { value: 'PS5', label: 'PS5' },
                { value: 'PS4', label: 'PS4' },
              ]}
              onChange={setPlatform}
            />
            <Segmented
              label="Layout"
              hideLabel={false}
              value={style}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'minimal', label: 'Minimal' },
                { value: 'raw', label: 'Raw image' },
              ]}
              onChange={setStyle}
            />
          </div>

          <CopyCard
            copy={copy}
            drafting={draft.isPending}
            onChange={(c) => {
              setCopy(c);
              setEdited(true);
            }}
            onRedraft={
              llm.data?.status?.connected
                ? () =>
                    draft.mutate(true, {
                      onSuccess: (c) => {
                        setCopy(c);
                        setEdited(false);
                      },
                      onError: (e) => toast(errorMessage(e), 'error'),
                    })
                : undefined
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Play size={16} aria-hidden />} onClick={() => submit('run')} disabled={create.isPending || !art}>
              {create.isPending ? 'Starting…' : existing ? 'Run all steps again' : 'Run all steps'}
            </Button>
            <Button icon={<Plus size={16} aria-hidden />} onClick={() => submit('add')} disabled={create.isPending || !art}>
              Add to shelf
            </Button>
            {shelves.length > 1 && (
              <Select label="Shelf" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">First shelf</option>
                {shelves.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <p className="-mt-2 text-xs text-faint">
            {existing
              ? `Already a ${platform} cover — running again adds a version and uses no quota.`
              : me.data?.account.devMode
                ? 'Developer mode: no cover limit.'
                : left !== null
                ? `Uses 1 of your ${left} remaining covers this month. Re-runs are free.`
                : 'Uses 1 cover from your monthly quota. Re-runs are free.'}{' '}
            Fetch, render and checks run automatically; most covers finish in under a minute.
          </p>

          {/* Available art */}
          <AiArtCard
            rawgId={rawgId}
            onMade={(id) => {
              setPickedId(id);
              setTab('all');
            }}
          />

          <section aria-labelledby="art-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="art-heading" className="text-lg font-semibold">
                Available art
              </h2>
              {art && art.counts.ai > 0 && (
                <ConfirmDialog
                  title={`Delete all ${art.counts.ai} AI image${art.counts.ai === 1 ? '' : 's'} for ${data.game.name}?`}
                  description="Every AI draft for this game goes. Your prompt stays, and covers already built keep their copy of the art."
                  confirmLabel="Delete AI images"
                  onConfirm={() =>
                    deleteAi.mutate('all', {
                      onSuccess: (r) => toast(`${r.deleted} AI image${r.deleted === 1 ? '' : 's'} deleted.`, 'success'),
                      onError: (e) => toast(errorMessage(e), 'error'),
                    })
                  }
                  trigger={
                    <Button size="sm" variant="ghost" className="ml-auto hover:text-danger" icon={<Trash2 size={14} aria-hidden />}>
                      Clear AI drafts
                    </Button>
                  }
                />
              )}
              {art && (
                <Segmented
                  label="Art source"
                  value={tab}
                  options={[
                    { value: 'all', label: 'All', count: art.counts.all },
                    { value: 'RAWG', label: 'RAWG', count: art.counts.rawg },
                    { value: 'SteamGridDB', label: 'SteamGridDB', count: art.counts.sgdb },
                    { value: 'AI', label: 'AI', count: art.counts.ai },
                  ]}
                  onChange={setTab}
                />
              )}
            </div>
            {art && !art.sgdb.enabled && (
              <p className="text-xs text-faint">
                SteamGridDB is off. Set <code className="font-mono">SGDB_KEY</code> in <code className="font-mono">.env</code> for portrait
                grids (personal use only).
              </p>
            )}
            {art?.sgdb.error && <p className="text-xs text-warning-text">{art.sgdb.error}</p>}
            {artError ? (
              <ErrorPanel message={errorMessage(artError)} />
            ) : !art ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-40" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted">No art from this source.</p>
            ) : (
              <ArtGrid items={visible} frontId={frontId} onPick={setPickedId} onDeleteAi={removeAi} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ArtGrid({
  items,
  frontId,
  onPick,
  onDeleteAi,
}: {
  items: ArtItem[];
  frontId: string | null;
  onPick: (id: string) => void;
  onDeleteAi: (item: ArtItem) => void;
}) {
  // Masonry-ish: columns keep each tile at its true aspect ratio.
  return (
    <ul className="columns-2 gap-3 sm:columns-3 xl:columns-4" aria-label="Art candidates">
      {items.map((item) => {
        const isFront = item.id === frontId;
        const tone = fitTone(item.fit);
        return (
          <li key={item.id} className="relative mb-3 break-inside-avoid">
            <button
              type="button"
              onClick={() => onPick(item.id)}
              aria-pressed={isFront}
              aria-label={`Use ${item.source} ${item.kind}, ${item.width} by ${item.height}, fit ${item.fit}, as front art`}
              className={cn(
                'group relative block w-full overflow-hidden rounded-card border bg-raised text-left transition-[border-color,box-shadow]',
                isFront ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-line-strong',
              )}
            >
              <img
                src={item.thumb}
                alt=""
                loading="lazy"
                className="block w-full"
                style={{ aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9' }}
              />
              <span className="absolute top-2 left-2 flex gap-1">
                <span className="rounded-control bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {item.source === 'SteamGridDB' ? 'SGDB' : item.source}
                </span>
                {isFront && <span className="rounded-control bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-ink">Front</span>}
              </span>
              <span className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-xs text-text capitalize">{item.kind}</span>
                  <span className="block font-mono text-[11px] text-faint">
                    {item.width} × {item.height}
                  </span>
                </span>
                <Chip tone={tone} title="How well this fills the 1512 × 1748 px front panel">
                  Fit {item.fit}
                </Chip>
              </span>
            </button>
            {item.source === 'AI' && (
              <ConfirmDialog
                title="Delete this AI image?"
                description="Only this draft goes. Covers already built with it keep their own copy."
                confirmLabel="Delete image"
                onConfirm={() => onDeleteAi(item)}
                trigger={
                  <IconButton label={`Delete AI image ${item.width} by ${item.height}`} className="absolute top-1 right-1 bg-black/70 text-white hover:bg-danger hover:text-white">
                    <Trash2 size={15} aria-hidden />
                  </IconButton>
                }
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** AI art: llama3.2 drafts the prompt from RAWG data; edit it, then Generate art (Gemini). */
function AiArtCard({ rawgId, onMade }: { rawgId: string; onMade: (artId: string) => void }) {
  const prompt = useAiPrompt(rawgId);
  const generate = useGenerateArt(rawgId);
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [count, setCount] = useState(2);
  const value = text ?? prompt.data?.prompt ?? '';
  const enabled = prompt.data?.enabled;
  const SOURCE = { ollama: 'Drafted by llama3.2 from RAWG data', rawg: 'Built from RAWG data (Ollama is offline)', user: 'Your saved prompt' } as const;

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles size={16} aria-hidden className="text-accent" /> AI generated art
        </h2>
        <span className="text-xs text-faint">{prompt.data ? `${SOURCE[prompt.data.source]} · ${prompt.data.model}` : 'Drafting a prompt…'}</span>
      </div>
      {prompt.data && !enabled && (
        <p className="text-xs text-warning-text">
          Set <code className="font-mono">GEMINI_API_KEY</code> in <code className="font-mono">.env</code> and restart to generate art. Gemini image
          generation is billed by Google.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Prompt</span>
        <textarea
          value={value}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          disabled={!prompt.data}
          className="min-h-24 resize-y rounded-control border border-line bg-bg px-2 py-1.5 text-sm leading-relaxed text-text hover:border-line-strong"
        />
      </label>
      <p className="text-xs text-faint">Always added: portrait, no text, no logos, no trademarks. Images are fitted to 1512 × 1748 px (128 × 148 mm at 300 DPI).</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<Sparkles size={16} aria-hidden />}
          disabled={!enabled || !value.trim() || generate.isPending}
          onClick={() =>
            generate.mutate(
              { prompt: value, count },
              {
                onSuccess: (r) => {
                  toast(`${r.items.length} AI image${r.items.length === 1 ? '' : 's'} added${r.errors.length ? ` (${r.errors.length} failed)` : ''}.`, r.errors.length ? 'info' : 'success');
                  if (r.items[0]) onMade(r.items[0].id);
                },
                onError: (e) => toast(errorMessage(e), 'error'),
              },
            )
          }
        >
          {generate.isPending ? `Generating ${count}…` : 'Generate art'}
        </Button>
        <Select label="Images per press" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} image{n === 1 ? '' : 's'}
            </option>
          ))}
        </Select>
        {text !== null && text !== prompt.data?.prompt && (
          <Button size="sm" variant="ghost" onClick={() => setText(null)}>
            Reset prompt
          </Button>
        )}
      </div>
    </Card>
  );
}

function CopyCard({
  copy,
  onChange,
  drafting,
  onRedraft,
}: {
  copy: BackCopy;
  onChange: (c: BackCopy) => void;
  drafting: boolean;
  onRedraft?: () => void;
}) {
  const source =
    drafting ? 'Drafting with Ollama…' : copy.source === 'ollama' ? 'Drafted by Ollama' : 'From the RAWG description';
  const features = useMemo(() => copy.features.join('\n'), [copy.features]);
  const field =
    'w-full rounded-control border border-transparent bg-transparent px-2 py-1.5 text-text hover:border-line focus:border-line-strong focus:bg-bg';

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Back-cover copy</h2>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs', drafting ? 'progress-indeterminate text-accent' : 'text-faint')} aria-live="polite">
            {source}
          </span>
          {onRedraft && (
            <Button size="sm" variant="ghost" onClick={onRedraft} disabled={drafting} icon={<RefreshCw size={14} aria-hidden />}>
              Redraft
            </Button>
          )}
        </div>
      </div>
      <label className="flex flex-col">
        <span className="px-2 text-[11px] font-medium tracking-wide text-faint uppercase">Tagline</span>
        <input
          className={cn(field, 'font-display text-[15px] font-semibold uppercase')}
          value={copy.tagline}
          maxLength={80}
          onChange={(e) => onChange({ ...copy, tagline: e.target.value })}
        />
      </label>
      <label className="flex flex-col">
        <span className="px-2 text-[11px] font-medium tracking-wide text-faint uppercase">Blurb</span>
        <textarea
          className={cn(field, 'min-h-24 resize-y text-sm leading-relaxed text-muted')}
          value={copy.blurb}
          maxLength={1200}
          onChange={(e) => onChange({ ...copy, blurb: e.target.value })}
        />
      </label>
      <label className="flex flex-col">
        <span className="px-2 text-[11px] font-medium tracking-wide text-faint uppercase">Feature bullets (one per line, up to 4)</span>
        <textarea
          className={cn(field, 'min-h-28 resize-y text-sm')}
          value={features}
          onChange={(e) => onChange({ ...copy, features: e.target.value.split('\n').slice(0, 4) })}
        />
      </label>
    </Card>
  );
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 text-sm text-muted">
        <li>
          <Link to="/" className="hover:text-text">
            Game library
          </Link>
        </li>
        <li aria-hidden>
          <ChevronRight size={14} />
        </li>
        <li aria-current="page" className="truncate text-text">
          {name}
        </li>
      </ol>
    </nav>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[minmax(280px,420px)_1fr]" aria-busy="true" aria-label="Loading game">
      <Skeleton className="aspect-[128/148]" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
