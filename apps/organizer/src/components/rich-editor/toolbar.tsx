'use client';

import { useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { ColorValue, TextAlign, TextSize } from '@kgc/shared';
import { isColorValue } from '../../lib/rich-editor/convert';
import { Icon, type IconName } from './icons';
import { Separator, ToolButton, useRovingToolbar } from './controls';
import { CharMenu, ColorMenu, TableMenu } from './menus';
import { clearFormatting } from './extensions';

export type ParagraphStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'code';

const STYLES: { value: ParagraphStyle; label: string; keys: string }[] = [
  { value: 'normal', label: 'Normal text', keys: 'Cmd+Alt+0' },
  { value: 'h1', label: 'Heading 1', keys: 'Cmd+Alt+1' },
  { value: 'h2', label: 'Heading 2', keys: 'Cmd+Alt+2' },
  { value: 'h3', label: 'Heading 3', keys: 'Cmd+Alt+3' },
  { value: 'h4', label: 'Heading 4', keys: 'Cmd+Alt+4' },
  { value: 'quote', label: 'Quote', keys: 'Cmd+Shift+B' },
  { value: 'code', label: 'Code', keys: 'Cmd+Alt+C' },
];

const SIZES: { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'x-large', label: 'Extra large' },
];

const ALIGNS: { value: TextAlign; label: string; icon: IconName; keys: string }[] = [
  { value: 'left', label: 'Align left', icon: 'alignLeft', keys: 'Cmd+Shift+L' },
  { value: 'center', label: 'Align center', icon: 'alignCenter', keys: 'Cmd+Shift+E' },
  { value: 'right', label: 'Align right', icon: 'alignRight', keys: 'Cmd+Shift+R' },
  { value: 'justify', label: 'Justify', icon: 'alignJustify', keys: 'Cmd+Shift+J' },
];

export function setParagraphStyle(editor: Editor, style: ParagraphStyle) {
  const c = editor.chain().focus();
  const inQuote = editor.isActive('blockquote');
  switch (style) {
    case 'normal':
      c.setParagraph();
      if (inQuote) c.lift('blockquote');
      break;
    case 'quote':
      if (!inQuote) c.setParagraph().setBlockquote();
      break;
    case 'code':
      c.setCodeBlock();
      break;
    default:
      c.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 });
  }
  c.run();
}

export interface ToolbarProps {
  editor: Editor;
  singleLine: boolean;
  /** The inline bubble: the common tools, with the rest behind More. */
  compact?: boolean;
  focusMode: boolean;
  findOpen: boolean;
  onLink: () => void;
  onFind: () => void;
  onHelp: () => void;
  onFocusMode: () => void;
  onPastePlain: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const { editor, singleLine, compact } = props;
  const ref = useRef<HTMLDivElement>(null);
  const roving = useRovingToolbar(ref);
  const [more, setMore] = useState(false);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const heading = [1, 2, 3, 4].find((l) => e.isActive('heading', { level: l }));
      const style: ParagraphStyle = e.isActive('codeBlock')
        ? 'code'
        : heading
          ? (`h${heading}` as ParagraphStyle)
          : e.isActive('blockquote')
            ? 'quote'
            : 'normal';
      const color = e.getAttributes('textColor').color as unknown;
      const highlight = e.getAttributes('highlight').color as unknown;
      const size = (e.getAttributes('fontSize').size as TextSize | undefined) ?? 'normal';
      const align = (ALIGNS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? 'left') as TextAlign;
      return {
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        style,
        size,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        superscript: e.isActive('superscript'),
        subscript: e.isActive('subscript'),
        code: e.isActive('code'),
        color: isColorValue(color) ? color : null,
        highlight: isColorValue(highlight) ? highlight : null,
        align,
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        start: (e.getAttributes('orderedList').start as number | undefined) ?? 1,
        canSink: e.can().sinkListItem('listItem'),
        canLift: e.can().liftListItem('listItem'),
        link: e.isActive('link'),
        inTable: e.isActive('table'),
        inCode: e.isActive('codeBlock'),
      };
    },
  });

  const c = () => editor.chain().focus();
  const showRest = !compact || more;

  return (
    <div
      ref={ref}
      className={`rt-toolbar${compact ? ' rt-toolbar-compact' : ''}`}
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      onFocus={roving.onFocus}
      onKeyDown={roving.onKeyDown}
    >
      {!compact && (
        <div className="rt-group">
          <ToolButton label="Undo" keys="Cmd+Z" disabled={!s.canUndo} onClick={() => c().undo().run()}>
            <Icon name="undo" />
          </ToolButton>
          <ToolButton label="Redo" keys="Cmd+Shift+Z" disabled={!s.canRedo} onClick={() => c().redo().run()}>
            <Icon name="redo" />
          </ToolButton>
          <Separator />
        </div>
      )}

      {!singleLine && (
        <div className="rt-group">
          <select
            className="rt-select rt-style-select"
            aria-label="Paragraph style"
            data-tip="Paragraph style"
            data-rt-item=""
            value={s.style}
            onChange={(e) => setParagraphStyle(editor, e.target.value as ParagraphStyle)}
          >
            {STYLES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {showRest && (
        <div className="rt-group">
          <select
            className="rt-select rt-size-select"
            aria-label="Text size"
            data-tip="Text size"
            data-rt-item=""
            value={s.size}
            disabled={s.inCode}
            onChange={(e) => c().setFontSize(e.target.value as TextSize).run()}
          >
            {SIZES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Separator />
        </div>
      )}

      <div className="rt-group">
        <ToolButton label="Bold" keys="Cmd+B" pressed={s.bold} disabled={s.inCode} onClick={() => c().toggleBold().run()}>
          <span className="rt-glyph rt-b">B</span>
        </ToolButton>
        <ToolButton label="Italic" keys="Cmd+I" pressed={s.italic} disabled={s.inCode} onClick={() => c().toggleItalic().run()}>
          <span className="rt-glyph rt-i">I</span>
        </ToolButton>
        {showRest && (
          <>
            <ToolButton label="Underline" keys="Cmd+U" pressed={s.underline} disabled={s.inCode} onClick={() => c().toggleUnderline().run()}>
              <span className="rt-glyph rt-u">U</span>
            </ToolButton>
            <ToolButton label="Strikethrough" keys="Cmd+Shift+S" pressed={s.strike} disabled={s.inCode} onClick={() => c().toggleStrike().run()}>
              <span className="rt-glyph rt-s">S</span>
            </ToolButton>
            <ToolButton label="Superscript" keys="Cmd+." pressed={s.superscript} disabled={s.inCode} onClick={() => c().unsetSubscript().toggleSuperscript().run()}>
              <span className="rt-glyph">
                x<sup>2</sup>
              </span>
            </ToolButton>
            <ToolButton label="Subscript" keys="Cmd+," pressed={s.subscript} disabled={s.inCode} onClick={() => c().unsetSuperscript().toggleSubscript().run()}>
              <span className="rt-glyph">
                x<sub>2</sub>
              </span>
            </ToolButton>
            <ToolButton label="Inline code" keys="Cmd+E" pressed={s.code} disabled={s.inCode} onClick={() => c().toggleCode().run()}>
              <Icon name="code" />
            </ToolButton>
          </>
        )}
        <Separator />
      </div>

      <div className="rt-group">
        <ColorMenu editor={editor} kind="text" current={s.color as ColorValue | null} />
        {showRest && <ColorMenu editor={editor} kind="highlight" current={s.highlight as ColorValue | null} />}
        <ToolButton label={s.link ? 'Edit link' : 'Link'} keys="Cmd+K" pressed={s.link} disabled={s.inCode} onClick={props.onLink}>
          <Icon name="link" />
        </ToolButton>
        {/* The short bubble over selected words: the common tools, the rest behind More (T329). */}
        {compact && !more && !singleLine && (
          <ToolButton label="Bulleted list" keys="Cmd+Shift+8" pressed={s.bullet} onClick={() => c().toggleBulletList().run()}>
            <Icon name="bulletList" />
          </ToolButton>
        )}
        <Separator />
      </div>

      {showRest && !singleLine && (
        <div className="rt-group">
          {ALIGNS.map((a) => (
            <ToolButton key={a.value} label={a.label} keys={a.keys} pressed={s.align === a.value} onClick={() => c().setTextAlign(a.value).run()}>
              <Icon name={a.icon} />
            </ToolButton>
          ))}
          <Separator />
        </div>
      )}

      {showRest && !singleLine && (
        <div className="rt-group">
          <ToolButton label="Bulleted list" keys="Cmd+Shift+8" pressed={s.bullet} onClick={() => c().toggleBulletList().run()}>
            <Icon name="bulletList" />
          </ToolButton>
          <ToolButton label="Numbered list" keys="Cmd+Shift+7" pressed={s.ordered} onClick={() => c().toggleOrderedList().run()}>
            <Icon name="orderedList" />
          </ToolButton>
          <ToolButton label="Decrease indent" keys="Shift+Tab" disabled={!s.canLift} onClick={() => c().liftListItem('listItem').run()}>
            <Icon name="outdent" />
          </ToolButton>
          <ToolButton label="Increase indent" keys="Tab" disabled={!s.canSink} onClick={() => c().sinkListItem('listItem').run()}>
            <Icon name="indent" />
          </ToolButton>
          {s.ordered && (
            <label className="rt-start" data-tip="Number the list from">
              <span>Start</span>
              <input
                type="number"
                min={0}
                max={9999}
                className="rt-input rt-start-input"
                aria-label="Numbered list starts at"
                value={s.start}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(9999, Math.floor(Number(e.target.value) || 0)));
                  editor.chain().updateAttributes('orderedList', { start: n }).run();
                }}
              />
            </label>
          )}
          <Separator />
        </div>
      )}

      {showRest && !singleLine && (
        <div className="rt-group">
          <ToolButton label="Quote" keys="Cmd+Shift+B" pressed={s.style === 'quote'} onClick={() => c().toggleBlockquote().run()}>
            <Icon name="quote" />
          </ToolButton>
          <ToolButton label="Divider line" keys="---" onClick={() => c().setHorizontalRule().run()}>
            <Icon name="rule" />
          </ToolButton>
          <TableMenu editor={editor} inTable={s.inTable} />
          <Separator />
        </div>
      )}

      {showRest && (
        <div className="rt-group">
          <CharMenu editor={editor} kind="chars" />
          <CharMenu editor={editor} kind="emoji" />
          <ToolButton label="Paste as plain text" keys="Cmd+Shift+V" onClick={props.onPastePlain}>
            <Icon name="paste" />
          </ToolButton>
          <ToolButton label="Clear formatting" keys="Cmd+\" onClick={() => clearFormatting(editor)}>
            <Icon name="clear" />
          </ToolButton>
          <Separator />
        </div>
      )}

      {showRest && (
        <div className="rt-group">
          <ToolButton label="Find and replace" keys="Cmd+F" pressed={props.findOpen} onClick={props.onFind}>
            <Icon name="search" />
          </ToolButton>
          <ToolButton label="Keyboard shortcuts" keys="Cmd+/" onClick={props.onHelp}>
            <Icon name="help" />
          </ToolButton>
          <ToolButton
            label={props.focusMode ? 'Leave focus mode' : 'Focus mode'}
            keys="Cmd+Shift+F"
            pressed={props.focusMode}
            onClick={props.onFocusMode}
          >
            <Icon name={props.focusMode ? 'minimize' : 'maximize'} />
          </ToolButton>
        </div>
      )}

      {compact && (
        <div className="rt-group">
          <ToolButton label={more ? 'Fewer tools' : 'More tools'} pressed={more} onClick={() => setMore((v) => !v)}>
            <Icon name="more" />
          </ToolButton>
        </div>
      )}
    </div>
  );
}

