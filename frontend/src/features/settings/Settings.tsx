import { useEffect, useState, type FormEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Database, KeyRound, Layers3, ScrollText, ShieldCheck, Sparkles } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useSaveLlm, useSetKey } from '../../api/mutations';
import { useLlmSettings, useSettings } from '../../api/queries';
import { Button, Chip, ErrorPanel, Field, Meter, Skeleton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { keySchema, llmSchema, type KeyValues, type LlmValues } from '../../lib/schemas';

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

export function Settings() {
  const settingsQuery = useSettings();
  const llmQuery = useLlmSettings();
  const setKeyMutation = useSetKey();
  const saveLlm = useSaveLlm();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const keyForm = useForm<KeyValues>({ resolver: zodResolver(keySchema), defaultValues: { value: '' } });
  const llmForm = useForm<LlmValues>({
    resolver: zodResolver(llmSchema),
    defaultValues: {
      provider: 'ollama',
      ollama: { host: 'http://127.0.0.1:11434', textModel: 'llama3.2', visionModel: 'llava' },
      openrouter: { textModel: 'openrouter/free', visionModel: 'openrouter/free' },
    },
  });

  useEffect(() => {
    if (llmQuery.data) llmForm.reset(llmQuery.data);
  }, [llmQuery.data, llmForm]);

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

  async function saveKey(name: 'rawg' | 'openrouter', value: string, reset: () => void) {
    try {
      await setKeyMutation.mutateAsync({ name, value });
      reset();
      toast(value ? `${name.toUpperCase()} key saved` : `${name.toUpperCase()} key cleared`, { tone: 'success' });
    } catch (error) {
      toast('Could not save the key', { description: errorMessage(error), tone: 'error' });
    }
  }

  async function checkConnection() {
    setChecking(true);
    setCheckMessage(null);
    try {
      await api.health();
      const models = await api.llmModels();
      setCheckMessage(
        models?.length
          ? `Local API reachable. Model discovery: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '…' : ''}`
          : 'Local API reachable. No models were returned by this provider.',
      );
    } catch (error) {
      setCheckMessage(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }

  function submitLlm(event: FormEvent) {
    void llmForm.handleSubmit(async (values) => {
      try {
        await saveLlm.mutateAsync(values);
        toast('LLM settings saved', { tone: 'success' });
      } catch (error) {
        toast('Could not save LLM settings', { description: errorMessage(error), tone: 'error' });
      }
    })(event);
  }

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
            <div><h2>Provider keys</h2><p>Keys are sealed server-side and never shown to the browser.</p></div>
          </div>
          <form className="key-row" onSubmit={(event) => void keyForm.handleSubmit((values) => saveKey('rawg', values.value, () => keyForm.reset()))(event)}>
            <div className="key-row__head"><strong>RAWG</strong><Chip tone={keys.rawg ? 'ok' : 'neutral'}>{keys.rawg ? 'Saved' : 'Not set'}</Chip></div>
            <Field label="API key" error={keyForm.formState.errors.value?.message}>
              <input type="password" autoComplete="off" placeholder={keys.rawg ? 'Replace key…' : 'Paste key…'} {...keyForm.register('value')} />
            </Field>
            <div className="inline-row">
              <Button type="submit" variant="primary" disabled={!keyForm.watch('value') || setKeyMutation.isPending}>Save</Button>
              <Button
                disabled={!keys.rawg || setKeyMutation.isPending}
                onClick={() => void saveKey('rawg', '', () => keyForm.reset())}
              >Clear</Button>
            </div>
          </form>
          <form className="key-row" onSubmit={(event) => void keyForm.handleSubmit((values) => saveKey('openrouter', values.value, () => keyForm.reset()))(event)}>
            <div className="key-row__head"><strong>OpenRouter</strong><Chip tone={keys.openrouter ? 'ok' : 'neutral'}>{keys.openrouter ? 'Saved' : 'Not set'}</Chip></div>
            <Field label="API key" error={keyForm.formState.errors.value?.message}>
              <input type="password" autoComplete="off" placeholder={keys.openrouter ? 'Replace key…' : 'Paste key…'} {...keyForm.register('value')} />
            </Field>
            <div className="inline-row">
              <Button type="submit" variant="primary" disabled={!keyForm.watch('value') || setKeyMutation.isPending}>Save</Button>
              <Button
                disabled={!keys.openrouter || setKeyMutation.isPending}
                onClick={() => void saveKey('openrouter', '', () => keyForm.reset())}
              >Clear</Button>
            </div>
          </form>
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
            <div><h2>Language model</h2><p>Optional: cover copy works with deterministic fallbacks if unset.</p></div>
          </div>
          <form className="form-grid" onSubmit={submitLlm}>
            <Field label="Provider">
              <select {...llmForm.register('provider')}>
                <option value="ollama">Ollama (local)</option>
                <option value="openrouter">OpenRouter (:free)</option>
              </select>
            </Field>
            <Field label="Ollama host" error={llmForm.formState.errors.ollama?.host?.message}>
              <input {...llmForm.register('ollama.host')} />
            </Field>
            <Field label="Text model" error={llmForm.formState.errors.ollama?.textModel?.message}>
              <input {...llmForm.register('ollama.textModel')} />
            </Field>
            <Field label="Vision model" error={llmForm.formState.errors.ollama?.visionModel?.message}>
              <input {...llmForm.register('ollama.visionModel')} />
            </Field>
            <Field label="OpenRouter text model">
              <input {...llmForm.register('openrouter.textModel')} />
            </Field>
            <Field label="OpenRouter vision model">
              <input {...llmForm.register('openrouter.visionModel')} />
            </Field>
            <div className="inline-row field--wide">
              <Button type="submit" variant="primary" disabled={saveLlm.isPending}>Save model settings</Button>
              <Button disabled={checking} onClick={() => void checkConnection()}>{checking ? 'Checking…' : 'Check connection'}</Button>
            </div>
          </form>
          {checkMessage && <p className="notice notice--info" role="status">{checkMessage}</p>}
          {llm?.openrouter.configured && <p className="subtle">OpenRouter key: set. Its value is never sent to this page.</p>}
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
