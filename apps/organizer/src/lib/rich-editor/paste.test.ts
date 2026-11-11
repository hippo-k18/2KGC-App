// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanPastedHtml } from './paste';

const clean = (html: string) => cleanPastedHtml(html).replace(/\n/g, '');

describe('cleanPastedHtml: dropped content', () => {
  it('removes style and meta elements and comments', () => {
    const out = clean('<meta charset="utf-8"><style>p{color:red}</style><!--StartFragment--><p>Hi</p><!--EndFragment-->');
    expect(out).toBe('<p>Hi</p>');
  });

  it('removes office namespace tags', () => {
    expect(clean('<p class="MsoNormal">Hello<o:p></o:p></p>')).toBe('<p>Hello</p>');
    expect(clean('<p>A<o:p>&nbsp;</o:p></p>')).toBe('<p>A</p>');
  });

  it('removes scripts and iframes', () => {
    expect(clean('<p>A</p><script>alert(1)</script><iframe src="x"></iframe>')).toBe('<p>A</p>');
  });
});

describe('cleanPastedHtml: attributes', () => {
  it('strips class, style, id and font attributes', () => {
    expect(clean('<p class="x" style="margin:0" id="p1" align="center">Text</p>')).toBe('<p>Text</p>');
    expect(clean('<h2 face="Arial" size="3">T</h2>')).toBe('<h2>T</h2>');
  });

  it('unwraps <font> and bare spans', () => {
    expect(clean('<p><font face="Arial" color="red">Red</font> and <span class="c1">plain</span></p>')).toBe(
      '<p>Red and plain</p>',
    );
  });

  it('keeps a[href], td colspan/rowspan and ol start', () => {
    expect(clean('<p><a href="https://example.com" class="x" style="color:blue">link</a></p>')).toBe(
      '<p><a href="https://example.com">link</a></p>',
    );
    const table = clean('<table><tbody><tr><td colspan="2" rowspan="3" width="100" class="c">A</td></tr></tbody></table>');
    expect(table).toBe('<table><tbody><tr><td colspan="2" rowspan="3">A</td></tr></tbody></table>');
    expect(clean('<ol start="4" type="a"><li>x</li></ol>')).toBe('<ol start="4"><li>x</li></ol>');
  });

  it('keeps data-rt-* and data-pm-slice', () => {
    const out = clean('<p data-pm-slice="1 1 []"><span data-rt-color="navy" class="x">Navy</span></p>');
    expect(out).toBe('<p data-pm-slice="1 1 []"><span data-rt-color="navy">Navy</span></p>');
  });

  it('drops other data attributes', () => {
    expect(clean('<p data-foo="1">x</p>')).toBe('<p>x</p>');
  });
});

describe('cleanPastedHtml: formatting from styles', () => {
  it('unwraps the Google Docs bold wrapper without making it bold', () => {
    const out = clean(
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-x"><p dir="ltr"><span style="font-weight:400">Plain</span></p></b>',
    );
    expect(out).toBe('<p>Plain</p>');
    expect(out).not.toMatch(/<(b|strong)\b/);
  });

  it('keeps real bold inside the Google Docs wrapper', () => {
    const out = clean(
      '<b style="font-weight:normal" id="docs-internal-guid-x"><p><span style="font-weight:700">Bold</span> text</p></b>',
    );
    expect(out).toBe('<p><strong>Bold</strong> text</p>');
  });

  it('turns styled spans into tags', () => {
    expect(clean('<p><span style="font-weight:700">B</span></p>')).toBe('<p><strong>B</strong></p>');
    expect(clean('<p><span style="font-weight: bold">B</span></p>')).toBe('<p><strong>B</strong></p>');
    expect(clean('<p><span style="font-style:italic">I</span></p>')).toBe('<p><em>I</em></p>');
    expect(clean('<p><span style="text-decoration:underline">U</span></p>')).toBe('<p><u>U</u></p>');
    expect(clean('<p><span style="text-decoration-line:line-through">S</span></p>')).toBe('<p><s>S</s></p>');
    expect(clean('<p><span style="vertical-align:super">2</span></p>')).toBe('<p><sup>2</sup></p>');
    expect(clean('<p><span style="vertical-align:sub">2</span></p>')).toBe('<p><sub>2</sub></p>');
  });

  it('nests combined styles', () => {
    const out = clean('<p><span style="font-weight:700;font-style:italic;text-decoration:underline">X</span></p>');
    // Each later style wraps innermost, so the order reads outside-in as u, em, strong.
    expect(out).toBe('<p><u><em><strong>X</strong></em></u></p>');
  });

  it('does not bold font-weight 400 spans', () => {
    expect(clean('<p><span style="font-weight:400">N</span></p>')).toBe('<p>N</p>');
  });
});

describe('cleanPastedHtml: Word lists', () => {
  const para = (cls: string, glyph: string, text: string) =>
    `<p class="${cls}" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${glyph}<span>&nbsp;&nbsp;</span></span>${text}</p>`;

  it('rebuilds bulleted paragraphs as <ul>', () => {
    const html = para('MsoListParagraphCxSpFirst', '·', 'One') + '\n' + para('MsoListParagraphCxSpLast', '·', 'Two');
    expect(clean(html)).toBe('<ul><li>One</li><li>Two</li></ul>');
  });

  it('rebuilds numbered paragraphs as <ol>', () => {
    const html = para('MsoListParagraphCxSpFirst', '1.', 'One') + para('MsoListParagraphCxSpLast', '2.', 'Two');
    expect(clean(html)).toBe('<ol><li>One</li><li>Two</li></ol>');
  });

  it('leaves surrounding paragraphs alone', () => {
    const html =
      '<p class="MsoNormal">Before</p>' +
      para('MsoListParagraphCxSpFirst', '·', 'One') +
      para('MsoListParagraphCxSpLast', '·', 'Two') +
      '<p class="MsoNormal">After</p>';
    expect(clean(html)).toBe('<p>Before</p><ul><li>One</li><li>Two</li></ul><p>After</p>');
  });
});
