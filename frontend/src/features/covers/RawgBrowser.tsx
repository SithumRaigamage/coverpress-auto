import { useState, type FormEvent } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { useImportTitles, useRawgSearch } from '../../api/mutations';
import { errorMessage } from '../../api/client';
import { Button, Chip, Field } from '../../components/ui';
import { Dialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import type { Platform } from '../../api/types';

type RawgBrowserProps = {
  projectId: string;
  platform: Platform;
  onImported: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Search the RAWG catalog with the account's key, pick titles, and import them.
 *  Imported titles go through the same automatic pipeline as typed entries. */
export function RawgBrowser({ projectId, platform, onImported, open, onOpenChange }: RawgBrowserProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rawgSearch = useRawgSearch();
  const importTitles = useImportTitles(projectId);
  const { toast } = useToast();

  const games = rawgSearch.data?.games ?? [];

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    rawgSearch.mutate(
      { q: query, platform },
      {
        onSuccess: () => setSelected(new Set()),
        onError: (error) => toast('RAWG search failed', { description: errorMessage(error), tone: 'error' }),
      },
    );
  };

  const toggleGame = (id: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    const chosen = games.filter((game) => selected.has(game.id));
    if (!chosen.length) return;
    const titles = chosen.map((game) => `${game.name} | ${platform} | auto`).join('\n');
    importTitles.mutate(titles, {
      onSuccess: (result) => {
        toast('Games added from RAWG', { description: result.message, tone: 'success' });
        setSelected(new Set());
        setQuery('');
        onImported();
        onOpenChange(false);
      },
      onError: (error) => toast('Import failed', { description: errorMessage(error), tone: 'error' }),
    });
  };

  const footer = (
    <>
      <Chip tone="accent" className="rawg-count">
        {selected.size} selected
      </Chip>
      <Button onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button
        variant="primary"
        icon={<ArrowRight size={15} />}
        disabled={selected.size === 0 || importTitles.isPending}
        onClick={submit}
      >
        {importTitles.isPending ? 'Importing…' : 'Import games'}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Browse RAWG"
      description="Search the RAWG catalog with your key, pick games, then import them for automatic cover builds."
      wide
      footer={footer}
    >
      <form className="rawg-search" onSubmit={handleSearch}>
        <Field label="Search games" className="rawg-search__field">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Elden Ring, Hollow Knight, Celeste"
            autoFocus
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          icon={<Search size={15} />}
          disabled={!query.trim() || rawgSearch.isPending}
        >
          {rawgSearch.isPending ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {rawgSearch.isError && (
        <div className="error-panel" role="alert" style={{ marginTop: 14 }}>
          <div>
            <strong>RAWG search failed</strong>
            <p>{errorMessage(rawgSearch.error)}</p>
          </div>
        </div>
      )}

      {rawgSearch.isSuccess && games.length === 0 && (
        <p className="subtle" style={{ marginTop: 16, textAlign: 'center' }}>
          No games found. Try a different search.
        </p>
      )}

      {games.length > 0 && (
        <div className="rawg-grid">
          {games.map((game) => {
            const checked = selected.has(game.id);
            return (
              <button
                key={game.id}
                type="button"
                className={`rawg-card${checked ? ' rawg-card--selected' : ''}`}
                aria-pressed={checked}
                onClick={() => toggleGame(game.id)}
              >
                <span className="rawg-card__art">
                  {game.backgroundImage ? (
                    <img src={game.backgroundImage} alt="" loading="lazy" />
                  ) : (
                    <span className="rawg-card__placeholder">No art</span>
                  )}
                </span>
                <span className="rawg-card__body">
                  <strong className="rawg-card__name">{game.name}</strong>
                  <span className="rawg-card__meta">
                    {game.released && <span>{game.released}</span>}
                    {game.rating && <Chip tone="neutral">{game.rating}</Chip>}
                    {game.metacritic != null && <span>MC {game.metacritic}</span>}
                  </span>
                  <span className={`rawg-card__state${checked ? ' rawg-card__state--on' : ''}`}>
                    {checked ? '✓ Selected' : '+ Add'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
