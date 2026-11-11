import { Linking, Text as RNText, View } from 'react-native';

import { parseRichText, type InlineSpan, type RichBlock } from '@kgc/shared';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * An organizer's page body, on a phone.
 *
 * There is no HTML on React Native and no WebView in this app, which is why the
 * parser in `@kgc/shared` returns blocks rather than markup: the website walks
 * the same array and only the leaf components differ. A Markdown-to-HTML
 * library would have needed a second renderer here, and two renderers drift
 * until a bullet list is a paragraph on one of them.
 *
 * Every piece of the author's text below is a `<Text>` child, so there is
 * nothing for markup to be interpreted by even in principle. See the header of
 * `rich-text-core.ts` for why that is the whole safety argument.
 *
 * ## Links open in the browser, and a link that cannot open is not drawn
 *
 * `Linking.openURL` rejects on a malformed or non-http address, and an
 * unhandled rejection from a press handler is a crash rather than a shrug. The
 * parser has already refused every scheme but http, https, mailto and tel, so
 * what arrives here is openable — the `catch` is the belt to that braces, and
 * matches what `lib/data/documents.ts` does for the same reason.
 *
 * ## A span carries only its own difference
 *
 * The spans below are react-native's plain `Text`, not this app's, and an
 * unstyled run is the string itself rather than a wrapper. The app's `Text`
 * defaults to the body variant, so a run nested inside a heading reset it from
 * 20pt semibold back to 17pt regular — which set every heading on an organizer
 * page exactly like the paragraphs around it and left the FAQ with nothing to
 * scan. A span says bold, italic, code or link, and inherits the rest from its
 * block.
 */
function Spans({ spans }: { spans: InlineSpan[] }) {
  const colors = useTheme();

  return (
    <>
      {spans.map((s, i) => {
        switch (s.kind) {
          case 'strong':
            return (
              <RNText key={i} style={{ fontWeight: '600' }}>
                {s.text}
              </RNText>
            );
          case 'em':
            return (
              <RNText key={i} style={{ fontStyle: 'italic' }}>
                {s.text}
              </RNText>
            );
          case 'code':
            return (
              <RNText key={i} style={{ fontFamily: 'Courier' }}>
                {s.text}
              </RNText>
            );
          case 'link':
            return (
              <RNText
                key={i}
                style={{ color: colors.tint, textDecorationLine: 'underline' }}
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(s.href).catch(() => {});
                }}>
                {s.text}
              </RNText>
            );
          default:
            return s.text;
        }
      })}
    </>
  );
}

function Block({ block }: { block: RichBlock }) {
  if (block.kind === 'heading') {
    return (
      <Text
        variant={block.level === 2 ? 'title3' : 'heading'}
        accessibilityRole="header"
        style={{ marginTop: Spacing.sm }}>
        <Spans spans={block.spans} />
      </Text>
    );
  }

  if (block.kind === 'list') {
    /*
     * A bullet or a number in its own column, so a wrapped second line lines up
     * under the text rather than under the marker. React Native has no list
     * element and no `list-style`, so the marker is a sibling `<Text>` and the
     * hanging indent is a flex row.
     */
    return (
      <View style={{ gap: Spacing.xs }}>
        {block.items.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <Text tone="secondary" style={{ minWidth: 18 }}>
              {block.ordered ? `${i + 1}.` : '•'}
            </Text>
            <Text style={{ flex: 1 }}>
              <Spans spans={item} />
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <Text>
      <Spans spans={block.spans} />
    </Text>
  );
}

export function RichText({ body }: { body: string }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      {parseRichText(body).map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </View>
  );
}
