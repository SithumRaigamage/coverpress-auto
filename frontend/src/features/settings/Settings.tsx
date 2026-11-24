import { Link } from 'react-router';
import { Database, Info, KeyRound, Layers3, ScrollText, ShieldCheck, Sparkles } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useLlmSettings, useSettings } from '../../api/queries';
import { Chip, ErrorPanel, Meter, Skeleton } from '../../components/ui';

function LocalModeNotice() {
  return (
    <div className="notice notice--info" role="note">
      <ShieldCheck size={17} />
      <div>
        <strong>Local mode</strong>
        <p>No sign-in and one account. Everything stays on this machine — do not expose port 3000 to a network.</p>
      </div>
    </div>
  );
}

/** Read-only configuration status. Keys and model settings are set in .env. */
export function Settings() {
  const settingsQuery = useSettings();
  const llmQuery = useLlmSettings();

  if (settingsQuery.isPending || llmQuery.isPending) {
    return (
      <div className="screen">
        <Skeleton className="skeleton--title" />
        <div className="settings-grid"><Skeleton className="skeleton--panel" /><Skeleton className="skeleton--panel" /></div>
      </div>
    );
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="screen">
        <ErrorPanel message={errorMessage(settingsQuery.error)} onRetry={() => void settingsQuery.refetch()} />
      </div>
    );
  }

  const { account, keys, unsupported, storage } = settingsQuery.data;
  const llm = llmQuery.data;

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Settings</h1>
        </div>
        <Chip tone="accent">{account.plan.label}</Chip>
      </header>

      <LocalModeNotice />

      <div className="notice notice--info" role="note">
        <Info size={17} />
        <div>
          <strong>Configuration lives in <code>.env</code></strong>
          <p>
            API keys and Ollama settings are read from your <code>.env</code> file when the server starts.
            Edit that file and restart with <code>npm run dev</code>. Nothing on this page can be changed
            from the browser.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="card-head">
            <span className="card-head__icon"><Layers3 size={17} /></span>
            <div><h2>Plan &amp; usage</h2><p>What this workspace can create each month.</p></div>
          </div>
          <Meter value={account.usage.used} max={account.usage.limit} label="Covers this month" />
          <dl className="detail-list">
            <div><dt>Projects</dt><dd className="mono">{account.usage.projects} / {account.usage.projectLimit}</dd></div>
            <div><dt>Price</dt><dd className="mono">${account.plan.price}/month</dd></div>
            <div><dt>Account</dt><dd className="mono">{account.email}</dd></div>
          </dl>
          <p className="subtle">Quota is charged when titles are added. Re-rendering, adjusting and printing an existing cover cost nothing.</p>
        </section>

        <section className="panel settings-card">
          <div className="card-head">
            <span className="card-head__icon"><KeyRound size={17} /></span>
            <div><h2>Provider keys</h2><p>Read from <code>.env</code> at startup.</p></div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>RAWG <span className="mono">RAWG_KEY</span></dt>
              <dd><Chip tone={keys.rawg ? 'ok' : 'neutral'}>{keys.rawg ? 'Configured' : 'Not set'}</Chip></dd>
            </div>
            <div>
              <dt>OpenRouter <span className="mono">OPENROUTER_KEY</span></dt>
              <dd><Chip tone={keys.openrouter ? 'ok' : 'neutral'}>{keys.openrouter ? 'Configured' : 'Not set'}</Chip></dd>
            </div>
          </dl>
          <div className="notice notice--warn">
            <ShieldCheck size={17} />
            <div>
              <strong>SteamGridDB unavailable</strong>
              <p>{unsupported.find((item) => item.name === 'sgdb')?.reason ?? 'Personal, non-commercial terms only.'} Upload your own art instead.</p>
            </div>
          </div>
        </section>

        <section className="panel settings-card">
          <div className="card-head">
            <span className="card-head__icon"><Sparkles size={17} /></span>
            <div><h2>Language model</h2><p>Read from <code>.env</code> at startup.</p></div>
          </div>
          <dl className="detail-list">
            <div><dt>Provider</dt><dd className="mono">{llm?.provider ?? '—'}</dd></div>
            <div><dt>Ollama host</dt><dd className="mono">{llm?.ollama.host ?? '—'}</dd></div>
            <div><dt>Text model</dt><dd className="mono">{llm?.ollama.textModel ?? '—'}</dd></div>
            <div><dt>Vision model</dt><dd className="mono">{llm?.ollama.visionModel ?? '—'}</dd></div>
          </dl>
          <p className="subtle">Cover copy works with deterministic fallbacks even when no model is reachable.</p>
        </section>

        <section className="panel settings-card">
          <div className="card-head">
            <span className="card-head__icon"><Database size={17} /></span>
            <div><h2>Data</h2><p>Your files never leave this deployment.</p></div>
          </div>
          <dl className="detail-list">
            <div><dt>Database</dt><dd className="mono">{storage.database}</dd></div>
            <div><dt>Data directory</dt><dd className="mono">{storage.dataDir}</dd></div>
          </dl>
          <div className="card-head">
            <span className="card-head__icon"><ScrollText size={17} /></span>
            <div><h2>Legal</h2><p>Personal-use terms and what the renderer refuses to draw.</p></div>
          </div>
          <Link className="btn btn--secondary btn--md" to="/legal">Read acceptable use</Link>
        </section>
      </div>
    </div>
  );
}
