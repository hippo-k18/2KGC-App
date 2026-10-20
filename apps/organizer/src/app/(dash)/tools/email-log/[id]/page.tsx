import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TIME_ZONE } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import {
  EMAIL_LOG_PATH,
  FROM_NOT_RECORDED,
  formatWhen,
  formatWhenLong,
  relatedLink,
  statusDetail,
  templateLabel,
} from '@/lib/email-log-core';
import { getEmailPreview } from '@/lib/email-log';
import { Banner, DetailList, PageHeader, Panel, Tag } from '../../../ui';
import { EmailFrame } from '../email-frame';

export const dynamic = 'force-dynamic';

/**
 * One email, as the recipient got it (T274).
 *
 * Three cases, labelled so nobody mistakes one for another: the stored copy
 * (exactly what was handed to the provider, sign-in codes masked), a
 * re-created preview for a row from before bodies were kept, and nothing at
 * all when the data to rebuild it is gone.
 */
export default async function EmailPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const { id } = await params;
  const sp = await searchParams;
  const part = sp.part === 'text' ? 'text' : 'html';
  const preview = await getEmailPreview(id);
  if (!preview) notFound();
  const { row } = preview;
  const rel = relatedLink(row);
  const detail = statusDetail(row);
  // What the row recorded, else what the stored copy of the message says it
  // went from. Never the address in use today: a re-created preview fills its
  // header that way, but for an old row that would be a guess (T305).
  const from = row.from ?? (preview.kind === 'stored' ? preview.from : undefined);

  return (
    <>
      <PageHeader
        title="Email Log"
        links={[
          <Link key="b" href={EMAIL_LOG_PATH}>
            Back to the log
          </Link>,
        ]}
      />
      <Panel>
        <DetailList
          items={[
            { label: 'Email', value: templateLabel(row.template) },
            {
              label: 'Status',
              value: (
                <span>
                  <Tag color={row.status === 'sent' ? 'green' : row.status === 'failed' ? 'red' : 'orange'} small>
                    {row.status}
                  </Tag>
                  {detail ? <span style={{ marginLeft: 8 }}>{detail}</span> : null}
                </span>
              ),
            },
            {
              label: 'From',
              value: from ? (
                <span style={{ overflowWrap: 'anywhere' }}>{from}</span>
              ) : (
                <span className="muted">{FROM_NOT_RECORDED}</span>
              ),
            },
            { label: 'When (New York)', value: formatWhen(row.atMs, TIME_ZONE) },
            ...(row.actor ? [{ label: 'Sent by', value: row.actor }] : []),
            ...(row.attempts ? [{ label: 'Attempts', value: String(row.attempts) }] : []),
            ...(rel ? [{ label: 'Related', value: <Link href={rel.href}>{rel.label}</Link> }] : []),
          ]}
        />
      </Panel>

      {preview.kind === 'none' ? (
        <Panel>
          <Banner kind="info">
            {preview.storedFromMs !== undefined
              ? `Preview not stored for emails sent before ${formatWhen(preview.storedFromMs, TIME_ZONE)}.`
              : 'Preview not stored for emails sent before the Email Log was switched on.'}{' '}
            {row.template.includes('sign-in-code')
              ? 'Sign-in code emails are never re-created.'
              : 'The data needed to build it again is not there either.'}
          </Banner>
        </Panel>
      ) : (
        <Panel>
          {preview.masked ? (
            <Banner kind="info">The sign-in code in this email is hidden. The recipient saw the real code.</Banner>
          ) : null}
          {preview.htmlDropped ? (
            <Banner kind="warning">This email was too large to keep in full, so only its plain-text part was stored.</Banner>
          ) : null}
          {preview.notes?.length ? (
            <Banner kind="warning">{preview.notes.join(' ')}</Banner>
          ) : null}
          <EmailFrame
            from={preview.from ?? ''}
            to={row.to}
            replyTo={preview.replyTo}
            subject={preview.subject ?? row.subject}
            when={formatWhenLong(row.atMs, TIME_ZONE)}
            html={preview.html ?? ''}
            text={preview.text ?? ''}
            part={part}
            partHref={(p) => (p === 'text' ? `?part=text` : '?')}
            badge={
              preview.kind === 'recreated' ? (
                <Tag color="orange">Re-created preview</Tag>
              ) : (
                <Tag color="green">Exactly as sent</Tag>
              )
            }
          />
        </Panel>
      )}
    </>
  );
}
