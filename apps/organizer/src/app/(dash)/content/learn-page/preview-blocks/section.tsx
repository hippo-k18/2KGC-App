import type { CSSProperties, ReactNode } from 'react';
import { sectionColumns, sectionOptionClasses, type LearnBlock, type LearnSection } from '@kgc/shared';
import { FillPicture, type BlockCtx } from './parts';

/**
 * The v2 section options (T319) as the band's extra classes and style: device
 * visibility, a brand or custom band colour (`--lp-band`, which the band
 * already paints), white text on a dark band, and a photo behind it.
 */
export function sectionShell(section: LearnSection): { classes: string[]; style: Record<string, string> } {
  const opts = sectionOptionClasses(section);
  return { classes: opts.classes, style: opts.band ? { '--lp-band': opts.band } : {} };
}

/** The photo behind a band and its dark overlay; the band must carry `lp-has-bgimg`. */
export function SectionBackground({ section, ctx }: { section: LearnSection; ctx: BlockCtx }) {
  if (!section.backgroundImage) return null;
  return (
    <div className="lp-band-bg" aria-hidden="true">
      <FillPicture image={section.backgroundImage} ctx={ctx} />
      {section.overlay ? <div className="lp-band-overlay" style={{ opacity: section.overlay } as CSSProperties} /> : null}
    </div>
  );
}

/**
 * Blocks side by side in a multi-column section; one column under 860px, the
 * first column first. `render` draws one block, so the website and the
 * dashboard each pass their own.
 */
export function SectionLayout({
  section,
  blocks,
  render,
}: {
  section: LearnSection;
  blocks: LearnBlock[];
  render: (block: LearnBlock) => ReactNode;
}) {
  const cols = sectionColumns(section.layout, blocks, section.blockColumn);
  return (
    <div className={`lp-layout lp-layout-${section.layout ?? 'single'}`}>
      {cols.map((col, i) => (
        <div key={i} className="lp-layout-col" data-column={i}>
          {col.map(render)}
        </div>
      ))}
    </div>
  );
}
