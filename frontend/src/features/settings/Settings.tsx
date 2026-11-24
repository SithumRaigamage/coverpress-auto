/** Settings — read-only status. Keys and models live in .env; the browser never sees a key. */
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import { useLlmSettings, useSettings } from '../../api/queries';
import { Card, ErrorPanel, Meter, PageHeader, Pill, Skeleton } from '../../components/ui';
import { compact } from '../../lib/status';

export function Settings() {
  const settings = useSettings();
  const llm = useLlmSettings();
  if (settings.isError) return <ErrorPanel message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <Skeleton className="h-96" />;
  const { account, keys, restrictions, storage } = settings.data;
  const sgdbRule = restrictions.find((r) => r.name === 'sgdb');

  const rows: Array<{ name: string; env: string; set: boolean; note: string }> = [
    { name: 'RAWG', env: 'RAWG_KEY', set: keys.rawg, note: 'Metadata, screenshots, the game library. 20,000 requests a month free.' },
    { name: 'SteamGridDB', env: 'SGDB_KEY', set: keys.sgdb, note: sgdbRule?.reason || 'Personal use only.' },
  ];

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <PageHeader
        title="Settings"
        subtitle="Local mode: one account, no sign-in, bound to 127.0.0.1. Keys and models are read from .env at start-up — edit it and restart to change them."
      />

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Plan and usage</h2>
          {account.devMode && (
            <Pill tone="accent" dot>
              Developer mode · no cover or shelf limits
            </Pill>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {!account.devMode && (
            <Meter label={`Covers this month · ${account.plan.label}`} value={account.usage.used} max={account.usage.limit} display={`${account.usage.used} / ${account.usage.limit}`} />
          )}
          {account.usage.rawg && (
            <Meter label="RAWG requests this month" value={account.usage.rawg.used} max={account.usage.rawg.limit} display={`${compact(account.usage.rawg.used)} / ${compact(account.usage.rawg.limit)}`} />
          )}
        </div>
        <p className="mt-3 text-xs text-faint">
          {account.devMode ? (
            <>
              <code className="font-mono">DEV_MODE=true</code> skips every plan check. RAWG’s 20,000 requests a month is an external limit and still applies.
            </>
          ) : (
            <>
              A cover is counted once, when it is created. Re-running and re-rendering are free. Change the plan with <code className="font-mono">npm run plan</code>.
            </>
          )}
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Providers</h2>
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.env} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.name} <code className="ml-1 font-mono text-xs text-faint">{r.env}</code>
                </p>
                <p className="text-xs text-muted">{r.note}</p>
              </div>
              <Pill tone={r.set ? 'success' : 'neutral'} dot>
                {r.set ? 'Set' : 'Not set'}
              </Pill>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Language model</h2>
        {llm.data ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Host</dt>
            <dd className="font-mono text-[13px] break-all">{llm.data.ollama.host}</dd>
            <dt className="text-muted">Back-cover copy</dt>
            <dd className="font-mono text-[13px]">{llm.data.ollama.textModel}</dd>
            <dt className="text-muted">QC review</dt>
            <dd className="font-mono text-[13px]">{llm.data.vision ? llm.data.ollama.visionModel : 'off (VISION_REVIEW=false)'}</dd>
            <dt className="text-muted">Status</dt>
            <dd>
              <Pill tone={llm.data.status?.connected ? 'success' : 'warning'} dot>
                {llm.data.status?.connected ? 'Connected' : 'Not reachable'}
              </Pill>
              <span className="ml-2 text-xs text-faint">{llm.data.status?.detail}</span>
            </dd>
          </dl>
        ) : (
          <Skeleton className="h-24" />
        )}
        <p className="mt-3 text-xs text-faint">Without a model, back-cover copy is built from the RAWG description, so every cover still completes.</p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-[15px] font-semibold">Data</h2>
        <p className="text-sm text-muted">
          Everything stays on this machine, in <code className="font-mono">{storage.dataDir}/</code> ({storage.database}). Back that folder up.
        </p>
        <p className="mt-3 text-sm">
          <Link to="/legal" className="text-accent underline underline-offset-2">Acceptable use</Link>
        </p>
      </Card>
    </div>
  );
}
