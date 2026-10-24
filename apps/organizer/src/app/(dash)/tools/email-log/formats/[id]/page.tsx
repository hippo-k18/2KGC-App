import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { EMAIL_LOG_PATH, GROUP_LABEL, TEMPLATE_INFO } from '@/lib/email-log-core';
import { SAMPLE_CODE, findFormat, renderFormat } from '@kgc/scripts/src/lib/email-catalogue';
import { Banner, DetailList, PageHeader, Panel, Tabs, Tag } from '../../../../ui';
import { EmailFrame } from '../../email-frame';

export const dynamic = 'force-dynamic';

/**
 * One email format, with sample data (T292). Rendered by the same builder its
 * sender uses, so it reads exactly as the real email does apart from the
 * sample names, links and codes.
 *
 * ⚠️ Nothing here sends or writes. There is no server action, no Firestore
 * read, and the catalogue it renders from has no access to `send()`.
 */
export default async function EmailFormatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const { id } = await params;
  const sp = await searchParams;
  const format = findFormat(id);
  if (!format) notFound();
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const part = one('part') === 'text' ? 'text' : 'html';
  const { variant, email } = renderFormat(format, one('v'));
  const base = `${EMAIL_LOG_PATH}/formats/${format.id}`;
  const href = (v: string, p: 'html' | 'text') => {
    const q = new URLSearchParams();
    if (v !== format.variants[0].id) q.set('v', v);
    if (p === 'text') q.set('part', 'text');
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const isCode = format.template.includes('sign-in-code');

  return (
    <>
      <PageHeader
        title="Email Log"
        links={[
          <Link key="b" href={`${EMAIL_LOG_PATH}?tab=formats`}>
            Back to all email formats
          </Link>,
        ]}
      />
      <Panel>
        <DetailList
          items={[
            { label: 'Email', value: <strong>{format.name}</strong> },
            { label: 'Area', value: GROUP_LABEL[TEMPLATE_INFO[format.template].group] },
            { label: 'When it is sent', value: format.when },
            { label: 'Who gets it', value: format.to },
            { label: 'From', value: email.from },
            { label: 'Replies go to', value: email.replyTo },
            { label: 'Subject', value: email.subject },
            ...(format.variants.length > 1 ? [{ label: 'Version shown', value: variant.label }] : []),
          ]}
        />
      </Panel>

      <Panel>
        <Banner kind="info">
          A sample, filled with made-up details such as {email.to}
          {isCode ? ` and the code ${SAMPLE_CODE}` : ''}. The real email has the recipient&apos;s own details. Nothing on
          this page sends an email.
        </Banner>
        {format.variants.length > 1 ? (
          <Tabs tabs={format.variants.map((v) => ({ label: v.label, href: href(v.id, part), active: v.id === variant.id }))} />
        ) : null}
        <EmailFrame
          from={email.from}
          to={email.to}
          replyTo={email.replyTo}
          subject={email.subject}
          when="Sample"
          html={email.html}
          text={email.text}
          part={part}
          partHref={(p) => href(variant.id, p)}
          badge={<Tag color="blue">Sample, not sent</Tag>}
        />
      </Panel>
    </>
  );
}
