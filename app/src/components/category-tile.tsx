import { View, type ViewStyle } from 'react-native';

import { announced, DECORATIVE } from '@/components/a11y';
import { Icon, type IconName } from '@/components/icon';
import { CategoryTints, Radius } from '@/constants/theme';

/** Whova's tile is a 40pt rounded square — small enough to sit in a list row. */
const TILE = 40;
/** Glyph as a fraction of the tile. Below ~0.5 the tile reads as an empty chip. */
const GLYPH_RATIO = 0.55;

/** Keys of the tint map in `theme.ts`. */
export type CategoryTint = keyof typeof CategoryTints;

interface CategoryTileProps {
  icon: IconName;
  tint: CategoryTint;
  /** Edge length. Defaults to 40 — the size Whova uses in a Community row. */
  size?: number;
  /**
   * Announce the tile with this label instead of hiding it. Only correct where
   * the tile is not sitting beside a title that already says the same thing,
   * which in a list row it always is.
   */
  label?: string;
  style?: ViewStyle;
}

/**
 * The rounded square that leads a Community row: purple storefront, blue chat,
 * red megaphone, green Q&A, amber meet-up, orange article.
 *
 * A pale fill with a saturated glyph, rather than the saturated fill with a
 * white glyph Whova uses for its admin tools. The pale version is what carries
 * six categories side by side without the list turning into a paint chart, and
 * it is the one place this app uses colour to distinguish content at all.
 *
 * The pairs live in `CategoryTints` in `theme.ts`, not here, because each one is
 * a checked contrast pair — the glyph clears 4.5:1 on its own tile — and a tint
 * invented at a call site would not be.
 *
 * ## Two things to know
 *
 * The tile is `DECORATIVE`. Colour is never the only thing carrying a category:
 * the row title beside it says "Exhibitor Showcase", and a screen reader that
 * announced "purple storefront icon" first would be adding noise, not meaning.
 * That also means the tints do not need to survive being read aloud — but they
 * *do* still need to be distinguishable by something other than hue for sighted
 * users, which is what the differing glyphs are for.
 *
 * The tints are deliberately scheme-invariant: they are pale in dark mode too.
 * They read as small coloured labels on a dark surface, which is what Whova does
 * and what the iOS Reminders list-colour chips do. If dark mode ever gets its
 * own set, they belong in `theme.ts` beside these, not here.
 */
export function CategoryTile({ icon, tint, size = TILE, label, style }: CategoryTileProps) {
  const { bg, fg } = CategoryTints[tint];

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: Radius.sm,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      {...(label ? announced(label) : DECORATIVE)}>
      {/*
        The glyph is hidden by `Icon` regardless; when the tile is `announced`
        the label sits on the tile, so the glyph must not speak on top of it.
      */}
      <Icon name={icon} size={Math.round(size * GLYPH_RATIO)} color={fg} weight="semibold" />
    </View>
  );
}
