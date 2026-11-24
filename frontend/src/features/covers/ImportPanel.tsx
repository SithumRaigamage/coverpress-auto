import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowRight, Check } from 'lucide-react';
import { useImportTitles } from '../../api/mutations';
import { errorMessage } from '../../api/client';
import { Button, Chip, Field } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { countTitles } from '../../lib/format';
import { importSchema, type ImportValues } from '../../lib/schemas';

export function ImportPanel({ projectId, onImported }: { projectId: string; onImported: () => void }) {
  const importTitles = useImportTitles(projectId);
  const { toast } = useToast();
  const [message, setMessage] = useState<{ text: string; skipped: number } | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImportValues>({ resolver: zodResolver(importSchema), defaultValues: { titles: '' } });

  const titles = watch('titles') ?? '';
  const count = countTitles(titles);

  const submit = handleSubmit(async (values) => {
    try {
      const result = await importTitles.mutateAsync(values.titles);
      setMessage({ text: result.message, skipped: result.skipped });
      reset();
      onImported();
      toast('Titles added', { tone: 'success' });
    } catch (error) {
      toast('Import failed', { description: errorMessage(error), tone: 'error' });
    }
  });

  return (
    <details className="collapsible">
      <summary className="collapsible__head">
        <span className="collapsible__title">Add titles</span>
        <span className="collapsible__hint">One per line: Title | Platform | auto</span>
      </summary>
      <form className="collapsible__body form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field
          label="Titles to import"
          error={errors.titles?.message}
          hint="Blank lines and lines starting with # are ignored. Auto titles fetch metadata; manual titles wait for your art."
        >
          <textarea
            rows={5}
            spellCheck={false}
            placeholder={'Hollow Knight | PS5 | auto\nCeleste | PS4 | auto\n# a note to yourself'}
            {...register('titles')}
          />
        </Field>
        <div className="inline-row">
          <Chip tone={count ? 'accent' : 'neutral'}>{count} title{count === 1 ? '' : 's'} ready</Chip>
          <Button variant="primary" icon={<ArrowRight size={15} />} disabled={!count || isSubmitting} type="submit">
            {isSubmitting ? 'Adding…' : `Add ${count} cover${count === 1 ? '' : 's'}`}
          </Button>
        </div>
        {message && (
          <p className="import-message" role="status">
            <Check size={14} /> {message.text}
            {message.skipped > 0 && <span className="subtle"> · {message.skipped} held back by the plan limit</span>}
          </p>
        )}
      </form>
    </details>
  );
}
