import { describe, expect, it } from 'vitest';

import {
  CHECKOUT_REMINDER_DEFAULTS,
  REMINDER_POSTAL_ADDRESS,
  REMINDER_TICKETS_URL,
  checkoutReminderMessage,
  fillFirstName,
} from './email.js';

/** The checkout reminder's words (T363). */
describe('checkoutReminderMessage', () => {
  const page = 'https://www.knowledgegraph.tech/u/TOKEN';

  it('greets by first name, or drops the name cleanly', () => {
    expect(fillFirstName('Hi {first name}, you started', 'Ada Lovelace')).toBe('Hi Ada, you started');
    expect(fillFirstName('Hi {first name}, you started', undefined)).toBe('Hi, you started');
    expect(fillFirstName('Hi {First Name}!', '  ')).toBe('Hi!');
  });

  it('has the default words, the ticket, the button, why, unsubscribe and the postal address', () => {
    const m = checkoutReminderMessage({ name: 'Ada Lovelace', ticketNames: ['Main Conference', 'Main Conference', 'Workshops'], ...CHECKOUT_REMINDER_DEFAULTS }, page);
    expect(m.subject).toBe('Your KGC 2027 ticket is still available');
    for (const part of [m.html, m.text]) {
      expect(part).toContain('Hi Ada, you started registering for the Knowledge Graph Conference 2027');
      expect(part).toContain('You picked: Main Conference, Workshops.');
      expect(part).toContain(REMINDER_TICKETS_URL);
      expect(part).toContain('Finish registering');
      expect(part).toContain('started buying a ticket');
      expect(part).toContain(page);
      expect(part).toContain(REMINDER_POSTAL_ADDRESS);
    }
    expect(REMINDER_POSTAL_ADDRESS).toBe('Jay Conference Bryant Park, 109 West 39th Street, New York, NY 10018');
    expect(m.html + m.text + m.subject).not.toContain('—');
  });

  it('escapes what an organizer types and leaves out the ticket line when unknown', () => {
    const m = checkoutReminderMessage({ subject: 'Hi <b>', body: 'Q&A <script>x</script>' }, page);
    expect(m.html).toContain('Q&amp;A &lt;script&gt;');
    expect(m.html).not.toContain('<script>x');
    expect(m.text).not.toContain('You picked');
  });
});
