import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Slider from '@radix-ui/react-slider';
import { RefreshCw, Save } from 'lucide-react';
import { Button, Field } from '../../components/ui';
import { overrideSchema, type OverrideValues } from '../../lib/schemas';
import type { Overrides } from '../../api/types';

function defaults(title: string, overrides: Overrides): OverrideValues {
  return {
    title: overrides.title ?? title,
    titleSize: overrides.titleSize ?? 18,
    titleAnchor: overrides.titleAnchor ?? 'top',
    titleAlign: overrides.titleAlign ?? 'left',
    zoom: overrides.zoom ?? 1,
    offX: overrides.offX ?? 0,
    offY: overrides.offY ?? 0,
    ribbon: overrides.ribbon ?? '',
    subtitle: overrides.subtitle ?? '',
  };
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <div className="range-field__head">
        <span className="field__label">{label}</span>
        <code>{value.toFixed(step < 1 ? 2 : 0)} {unit}</code>
      </div>
      <Slider.Root
        className="slider"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        aria-label={label}
      >
        <Slider.Track className="slider__track"><Slider.Range className="slider__range" /></Slider.Track>
        <Slider.Thumb className="slider__thumb" aria-label={label} />
      </Slider.Root>
    </div>
  );
}

export function OverridePanel({
  coverId,
  title,
  overrides,
  busy,
  onRender,
  onSave,
}: {
  coverId: string;
  title: string;
  overrides: Overrides;
  busy: boolean;
  onRender: (values: OverrideValues) => void;
  onSave: (values: OverrideValues) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<OverrideValues>({ resolver: zodResolver(overrideSchema), defaultValues: defaults(title, overrides) });

  useEffect(() => {
    reset(defaults(title, overrides));
    // Re-seed only when the selected cover changes; edits must not be stomped by polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverId, reset]);

  const anchor = watch('titleAnchor');
  const align = watch('titleAlign');

  return (
    <form className="inspector__section form-grid" onSubmit={(event) => void handleSubmit(onRender)(event)}>
      <div className="field field--wide">
        <span className="inspector__section-title">Adjustments</span>
      </div>
      <Field label="Title text" error={errors.title?.message} className="field--wide">
        <input maxLength={200} {...register('title')} />
      </Field>
      <div className="field field--wide">
        <Controller
          name="titleSize"
          control={control}
          render={({ field }) => (
            <RangeField label="Title size" value={field.value} min={12} max={24} step={1} unit="mm" onChange={field.onChange} />
          )}
        />
      </div>
      <div className="field">
        <span className="field__label">Anchor</span>
        <div className="segment" role="group" aria-label="Title anchor">
          {(['top', 'bottom'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={anchor === option ? 'active' : ''}
              aria-pressed={anchor === option}
              onClick={() => setValue('titleAnchor', option, { shouldValidate: true })}
            >
              {option === 'top' ? 'Top' : 'Foot'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">Align</span>
        <div className="segment" role="group" aria-label="Title alignment">
          {(['left', 'center'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={align === option ? 'active' : ''}
              aria-pressed={align === option}
              onClick={() => setValue('titleAlign', option, { shouldValidate: true })}
            >
              {option === 'left' ? 'Left' : 'Centre'}
            </button>
          ))}
        </div>
      </div>
      <div className="field field--wide">
        <Controller
          name="zoom"
          control={control}
          render={({ field }) => (
            <RangeField label="Art zoom" value={field.value} min={1} max={2.5} step={0.05} unit="×" onChange={field.onChange} />
          )}
        />
      </div>
      <div className="field field--wide">
        <Controller
          name="offX"
          control={control}
          render={({ field }) => (
            <RangeField label="Offset X" value={field.value} min={-30} max={30} step={1} unit="mm" onChange={field.onChange} />
          )}
        />
      </div>
      <div className="field field--wide">
        <Controller
          name="offY"
          control={control}
          render={({ field }) => (
            <RangeField label="Offset Y" value={field.value} min={-30} max={30} step={1} unit="mm" onChange={field.onChange} />
          )}
        />
      </div>
      <Field label="Edition line" error={errors.subtitle?.message} hint="Small line under the title." className="field--wide">
        <input maxLength={200} placeholder="Personal edition" {...register('subtitle')} />
      </Field>
      <Field label="Ribbon text" error={errors.ribbon?.message} className="field--wide">
        <input maxLength={200} placeholder="Optional strip under the art" {...register('ribbon')} />
      </Field>
      <div className="inline-row field--wide">
        <Button type="submit" variant="primary" icon={<RefreshCw size={15} />} disabled={busy}>
          Re-render (free)
        </Button>
        <Button icon={<Save size={15} />} disabled={busy} onClick={() => void handleSubmit(onSave)()}>
          Save without render
        </Button>
        <span className="subtle">Re-renders never use quota.</span>
      </div>
    </form>
  );
}
