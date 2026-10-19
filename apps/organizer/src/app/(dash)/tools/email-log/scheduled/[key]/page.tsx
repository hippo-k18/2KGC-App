import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TIME_ZONE } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { EMAIL_LOG_PATH, formatWhen, formatWhenLong } from '@/lib/email-log-core';
import { scheduledPreview } from '@/lib/email-schedule';
import { Banner, DetailList, PageHeader, Panel, Table, Tag } from '../../../../ui';
import { EmailFrame } from '../../email-frame';

export const dynamic = 'force-dynamic';

/**
 * What a scheduled or waiting email will look like (T274). Built from the
 * same template the send uses and the data as it stands now. Read-only: the
 * button that sends it is on its own screen, linked from here.
 */
export default async function ScheduledPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const { key } = await params;
  const sp = await searchParams;
  const part = sp.part === 'text' ? 'text' : 'html';
  const now = Date.now();
  const preview = await scheduledPreview(decodeURIComponent(key), now);
  if (!preview) notFound();
  const { item } = preview;

  return (
    <>
      <PageHeader
        title="Email Log"
        links={[
          <Link key="b" href={`${EMAIL_LOG_PATH}?tab=scheduled`}>
            Back to Scheduled
          </Link>,
        ]}
      />
      <Panel>
        <DetailList
          items={[
            { label: 'Email', value: item.email },
            { label: 'To', value: item.to },
            {
              label: 'When',
              value: item.whenMs !== undefined ? `${formatWhen(item.whenMs, TIME_ZONE)} (New York). ${item.when}` : item.when,
            },
            ...(item.where ? [{ label: 'Sent from', value: <Link href={item.where.href}>{item.where.label}</Link> }] : []),
            ...(item.about ? [{ label: 'About', value: <Link href={item.about.href}>{item.about.label}</Link> }] : []),
          ]}
        />
        {item.blocked ? <Banner kind="warning">{item.blocked}</Banner> : null}
        {item.note ? <Banner kind="info">{item.note}</Banner> : null}
      </Panel>

      <Panel>
        {preview.notes.length ? <Banner kind="info">{preview.notes.join(' ')}</Banner> : null}
        <EmailFrame
          from={preview.from}
          to={preview.to}
          replyTo={preview.replyTo}
          subject={preview.subject}
          when={item.whenMs !== undefined ? formatWhenLong(item.whenMs, TIME_ZONE) : formatWhenLong(now, TIME_ZONE)}
          html={preview.html}
          text={preview.text}
          part={part}
          partHref={(p) => (p === 'text' ? '?part=text' : '?')}
          badge={<Tag color="blue">Preview: not sent yet</Tag>}
        />
      </Panel>

      {preview.recipients?.length ? (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Who it would go to ({preview.recipients.length})
          </h2>
          <Table
            cols={[
              { key: 'n', label: 'Name', className: 'cell-md' },
              { key: 'e', label: 'Email', className: 'cell-md' },
              { key: 't', label: 'Submission', className: 'cell-fill' },
            ]}
            rows={preview.recipients.map((r) => [r.name || 'No name', r.email, r.title || 'Untitled'])}
          />
        </Panel>
      ) : null}
    </>
  );
}
