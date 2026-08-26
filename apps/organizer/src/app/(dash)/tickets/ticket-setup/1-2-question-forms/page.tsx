import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.2 Question Forms.
 *
 * Whova lets an organizer add arbitrary questions to the registration form —
 * dietary requirements, t-shirt size, job function, consent boxes — and then
 * filter and export attendees by the answers.
 *
 * ── Why this one is genuinely constrained rather than merely unbuilt ────────
 *
 * Purchases go through **hosted** Stripe Checkout: the buyer leaves our origin
 * entirely, which is precisely what keeps this project in PCI SAQ A. We
 * therefore do not own the page the questions would appear on. Stripe's own
 * `custom_fields` exist but cap at **three** and support only text, numeric and
 * dropdown — enough for a t-shirt size, not for a consent flow.
 *
 * The alternative is asking before checkout, on our own form, which we do own.
 * That is the realistic design and it is a different screen from this one.
 */
export default async function QuestionFormsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="1.2 Question Forms"
        tags={<Tag color="grey">Not collected</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="e" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Only four things are asked at purchase, and three of them are Stripe&rsquo;s.</strong>{' '}
        There is no question builder, and nothing anywhere stores an answer to a custom question.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What is actually collected today</h2>
        <Table
          cols={[
            { key: 'f', label: 'Field', className: 'cell-md' },
            { key: 'w', label: 'Where', className: 'cell-sm' },
            { key: 'n', label: 'Why it is there', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Name',
              'Our form',
              "Passed to Stripe as metadata, because the webhook has no other way to learn the attendee's name.",
            ],
            ['Email', 'Our form', 'Keys the registration. Folded to lower case; it is the identity in this system.'],
            ['Ticket tier', 'Our form', 'An id, not a price — the price is looked up server-side so a form field cannot set it.'],
            [
              'Billing address',
              'Stripe Checkout',
              'Required, and not vanity: automatic tax needs it, and a company needs it on the invoice.',
            ],
          ]}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Group registration asks for more — company, PO number, net terms, one name and email per
          seat — because that form is ours end to end. See{' '}
          <Link href="/tickets/ticket-setup/create-group-tickets">Create Group Tickets</Link>.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it would take</h2>
        <p className="body-2">
          A question schema on the ticket type, a renderer on the public form, answers stored on the
          registration, and columns in the exports. The schema is the part that decides how big this
          is: a closed set of field types (short text, choice, checkbox, consent) is a few days; an
          open builder with conditional logic is the same project Whova has been iterating on for
          years.
        </p>
        <p className="body-2">
          One design note worth recording before anyone starts: <strong>answers are attendee data,
          not order data.</strong> A dietary requirement belongs to the person, survives a
          transferred ticket, and must not be readable by anyone querying orders. Putting it on the
          order document because that is where the form posted is the mistake to avoid.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No question builder and no answers.</strong> Nothing in the data model holds a
            custom field, so nothing to list, filter or export.
          </li>
          <li>
            <strong>Consent and release forms are a separate screen</strong> and equally unbuilt —
            they are a legal record with a retention question, not a dropdown.
          </li>
          <li>
            <strong>Stripe&rsquo;s three custom fields are not used.</strong> They are the cheapest
            possible version of this and were left off deliberately, because three fields that only
            appear on the card path would make the data set inconsistent between card and invoice
            buyers.
          </li>
        </ul>
      </Panel>
    </>
  );
}
