import type { CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';
import type { Cover } from '../../api/types';

/** Print geometry from AGENTS.md: 276 × 154 with 3 mm bleed, panel start offsets. */
export type StageView = 'wrap' | 'front' | 'back' | 'spine';
const FULL_W = 276;
const FULL_H = 154;
const DPMM = 300 / 25.4;
const PANELS: Record<Exclude<StageView, 'wrap'>, { start: number; width: number }> = {
  back: { start: 3, width: 128 },
  spine: { start: 131, width: 14 },
  front: { start: 145, width: 128 },
};

export function Stage({
  cover,
  view,
  oneToOne,
  fading,
}: {
  cover: Cover;
  view: StageView;
  oneToOne: boolean;
  fading: boolean;
}) {
  const src = cover.wrapUrl;
  const alt = `${view === 'wrap' ? 'Full wrap' : `${view} panel`} for ${cover.title}, ${cover.platform}${
    cover.renderVersion ? `, version ${cover.renderVersion}` : ''
  }`;

  if (!src) {
    return (
      <div className="review-stage__empty">
        <ImageOff size={26} strokeWidth={1.5} />
        <p>No render yet. Build or re-render this cover to see the wrap here.</p>
      </div>
    );
  }

  const imageClass = `review-stage__image ${fading ? 'review-stage__image--fading' : ''}`;

  if (view === 'wrap') {
    return (
      <img
        className={imageClass}
        src={src}
        alt={alt}
        style={oneToOne ? { width: 3260, maxWidth: 'none', maxHeight: 'none' } : undefined}
      />
    );
  }

  const panel = PANELS[view];
  const wrapperStyle: CSSProperties = oneToOne
    ? { width: panel.width * DPMM, height: FULL_H * DPMM }
    : { height: 'min(56vh, 640px)', aspectRatio: `${panel.width} / ${FULL_H}` };

  const imageStyle: CSSProperties = oneToOne
    ? {
        position: 'absolute',
        width: FULL_W * DPMM,
        height: FULL_H * DPMM,
        left: -panel.start * DPMM,
        top: 0,
        maxWidth: 'none',
        maxHeight: 'none',
      }
    : {
        position: 'absolute',
        height: '100%',
        width: `${(FULL_W / panel.width) * 100}%`,
        left: `${-(panel.start / panel.width) * 100}%`,
        top: 0,
        maxWidth: 'none',
      };

  return (
    <div className={oneToOne ? undefined : 'clip-window'} style={wrapperStyle}>
      <img className={imageClass} src={src} alt={alt} style={imageStyle} />
    </div>
  );
}
