import type { ReactNode } from "react";
import {
  autolinkParts,
  isSafeHref,
  sanitizeCallText,
  type CallTextBlock,
  type CallTextDoc,
  type CallTextInline,
} from "@kgc/shared";

/**
 * A call's formatted text on `/submit/{callId}` (T277).
 *
 * Every string reaches the page as a React child or a checked attribute: no
 * `dangerouslySetInnerHTML`, so nothing an organizer typed can become markup.
 * The document is sanitised again here whatever the caller passed, and every
 * link is checked again as it is drawn.
 *
 * Bare email addresses and web addresses in the text become links, so an
 * address pasted without the link button still works on the page.
 */
export function CallText({ doc }: { doc: CallTextDoc }) {
  const clean = sanitizeCallText(doc);
  return (
    <div className="call-text">
      {clean.content.map((b, i) => block(b, i, i === 0))}
    </div>
  );
}

function anchor(href: string, children: ReactNode, key: number): ReactNode {
  const external = /^https?:/i.test(href);
  return (
    <a
      key={key}
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      {children}
    </a>
  );
}

function text(
  n: Extract<CallTextInline, { type: "text" }>,
  key: number,
): ReactNode {
  const link = n.marks?.find((m) => m.type === "link");
  const bold = n.marks?.some((m) => m.type === "bold");
  const italic = n.marks?.some((m) => m.type === "italic");

  const style = (content: ReactNode): ReactNode => {
    let out = content;
    if (italic) out = <em>{out}</em>;
    if (bold) out = <strong>{out}</strong>;
    return out;
  };

  if (link && link.type === "link" && isSafeHref(link.attrs.href)) {
    return anchor(link.attrs.href, style(n.text), key);
  }
  const parts = autolinkParts(n.text);
  if (parts.length === 1 && !parts[0].href)
    return <span key={key}>{style(n.text)}</span>;
  return (
    <span key={key}>
      {parts.map((p, i) =>
        p.href ? (
          anchor(p.href, style(p.text), i)
        ) : (
          <span key={i}>{style(p.text)}</span>
        ),
      )}
    </span>
  );
}

function inline(nodes: CallTextInline[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) =>
    n.type === "hardBreak" ? <br key={i} /> : text(n, i),
  );
}

function block(b: CallTextBlock, key: number, first = false): ReactNode {
  switch (b.type) {
    case "paragraph":
      // The first paragraph is the lede, as it was when the text was plain.
      return (
        <p key={key} className={first ? "lede" : undefined}>
          {inline(b.content)}
        </p>
      );
    case "heading":
      return b.attrs.level === 2 ? (
        <h2 key={key}>{inline(b.content)}</h2>
      ) : (
        <h3 key={key}>{inline(b.content)}</h3>
      );
    case "bulletList":
      return (
        <ul key={key}>
          {b.content.map((item, i) => (
            <li key={i}>{itemBody(item.content)}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={b.attrs?.start}>
          {b.content.map((item, i) => (
            <li key={i}>{itemBody(item.content)}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return (
        <blockquote key={key}>
          {b.content.map((c, i) => block(c, i))}
        </blockquote>
      );
  }
}

/**
 * A list item. Its first paragraph is drawn without a `<p>`, as the plain-text
 * bullets were, so it does not pick up the site's paragraph style; anything
 * after it (a second paragraph, a nested list) is drawn as a block.
 */
function itemBody(content: CallTextBlock[]): ReactNode {
  const [head, ...rest] = content;
  return (
    <>
      {head?.type === "paragraph"
        ? inline(head.content)
        : head
          ? block(head, 0)
          : null}
      {rest.map((c, i) => block(c, i + 1))}
    </>
  );
}
