import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Check } from 'lucide-react';
import { useUpdateProject } from '../../api/mutations';
import { errorMessage } from '../../api/client';
import { Button, Field } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { styleSchema, type StyleValues } from '../../lib/schemas';
import type { Project } from '../../api/types';

export function HouseStylePanel({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StyleValues>({
    resolver: zodResolver(styleSchema),
    defaultValues: {
      accent: project.accent,
      mark: project.mark,
      edition: project.edition,
      address: project.address,
      layout: project.layout,
      platform: project.platform,
    },
  });

  useEffect(() => {
    reset({
      accent: /^#[0-9a-f]{6}$/i.test(project.accent || '') ? project.accent : '#14607A',
      mark: project.mark || '',
      edition: project.edition || '',
      address: project.address || '',
      layout: project.layout || 'auto',
      platform: project.platform || 'PS5',
    });
  }, [project.id, project.accent, project.mark, project.edition, project.address, project.layout, project.platform, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
      toast('House style saved', { description: 'Rebuild covers to apply it.', tone: 'success' });
    } catch (error) {
      toast('Could not save style', { description: errorMessage(error), tone: 'error' });
    }
  });

  return (
    <details className="collapsible">
      <summary className="collapsible__head">
        <span className="collapsible__title">House style</span>
        <span className="collapsible__hint">Accent, mark, edition and address for new builds</span>
      </summary>
      <form className="collapsible__body form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field label="Accent colour" error={errors.accent?.message}>
          <input type="color" aria-label="Accent colour" {...register('accent')} />
        </Field>
        <Field label="Mark (2 characters)" error={errors.mark?.message}>
          <input maxLength={2} placeholder="CP" {...register('mark')} />
        </Field>
        <Field label="Edition" error={errors.edition?.message}>
          <input maxLength={80} placeholder="Personal edition" {...register('edition')} />
        </Field>
        <Field label="Layout">
          <select {...register('layout')}>
            <option value="auto">Auto</option>
            <option value="ps5">PS5 — white band</option>
            <option value="ps4">PS4 — accent band</option>
          </select>
        </Field>
        <Field label="Default platform">
          <select {...register('platform')}>
            <option value="PS5">PS5</option>
            <option value="PS4">PS4</option>
          </select>
        </Field>
        <Field label="Address block" className="field--wide" error={errors.address?.message}>
          <textarea rows={3} placeholder={'Your name\nCity, Country'} {...register('address')} />
        </Field>
        <div className="inline-row field--wide">
          <span className="subtle">Existing covers keep their look until rebuilt.</span>
          <Button type="submit" variant="primary" icon={<Check size={15} />} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save style'}
          </Button>
        </div>
      </form>
    </details>
  );
}
