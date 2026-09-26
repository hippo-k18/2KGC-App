'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BlogRole } from '@/lib/blog/access';
import { inviteAction, removeMemberAction, resendInviteAction, setRoleAction } from '../actions';

export interface PersonRow {
  email: string;
  name: string;
  role: BlogRole;
  status: 'invited' | 'active' | 'removed';
  /** Named in BLOG_EDITORS, so its role cannot be changed here. */
  fixed: boolean;
  you: boolean;
  posts: number;
  lastSignInAt: number | null;
}

const since = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function PeopleManager({ rows }: { rows: PersonRow[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'writer' as BlogRole });

  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg(null), error ? 6000 : 3500);
  };

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return flash(res.error ?? 'That did not work.', true);
    flash(done);
    router.refresh();
  }

  return (
    <div className="pp-grid">
      <div className="st-panel">
        {rows.map((r) => (
          <div key={r.email} className="pp-row">
            <div style={{ minWidth: 0 }}>
              <div className="pp-name">
                {r.name}
                {r.you && <span className="st-muted" style={{ fontWeight: 400 }}> (you)</span>}
              </div>
              <div className="pp-email">
                {r.email}
                {' · '}
                {r.status === 'invited'
                  ? 'Invited, not signed in yet'
                  : r.lastSignInAt
                    ? `Last in ${since.format(r.lastSignInAt)}`
                    : 'Active'}
                {r.posts > 0 && ` · ${r.posts} ${r.posts === 1 ? 'post' : 'posts'}`}
              </div>
            </div>
            <div>{r.role === 'editor' ? 'Editor' : 'Writer'}</div>
            <div className="pp-actions">
              {r.status === 'invited' && !r.fixed && (
                <button
                  className="st-btn st-btn-quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    run(`resend-${r.email}`, async () => {
                      const res = await resendInviteAction(r.email);
                      return res.ok && !res.sent ? { ok: false, error: `The email to ${r.email} did not go out.` } : res;
                    }, `Invitation sent again to ${r.email}`)
                  }
                >
                  Resend invitation
                </button>
              )}
              {!r.fixed && !r.you && (
                <>
                  <button
                    className="st-btn st-btn-quiet"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`role-${r.email}`, () => setRoleAction(r.email, r.role === 'editor' ? 'writer' : 'editor'),
                        `${r.name} is now ${r.role === 'editor' ? 'a writer' : 'an editor'}`)
                    }
                  >
                    Make {r.role === 'editor' ? 'writer' : 'editor'}
                  </button>
                  <button
                    className="st-btn st-btn-quiet st-btn-danger"
                    disabled={busy !== null}
                    onClick={() => run(`rm-${r.email}`, () => removeMemberAction(r.email), `${r.name} can no longer sign in`)}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        className="st-panel pp-invite"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy('invite');
          const res = await inviteAction(form);
          setBusy(null);
          if (!res.ok) return flash(res.error, true);
          flash(res.sent ? `Invitation sent to ${res.email}` : `${res.email} was added, but the email did not go out. Send them the sign-in link yourself.`, !res.sent);
          setForm({ name: '', email: '', role: 'writer' });
          router.refresh();
        }}
      >
        <h2>Invite someone</h2>
        <label className="st-field">
          <span>Name</span>
          <input className="st-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="st-field">
          <span>Email</span>
          <input className="st-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <div className="pp-roles" role="radiogroup" aria-label="Role">
          <label>
            <input type="radio" name="role" checked={form.role === 'writer'} onChange={() => setForm({ ...form, role: 'writer' })} />
            Writer
            <small>Writes their own posts. Every post goes to review.</small>
          </label>
          <label>
            <input type="radio" name="role" checked={form.role === 'editor'} onChange={() => setForm({ ...form, role: 'editor' })} />
            Editor
            <small>Edits and publishes any post, and invites people.</small>
          </label>
        </div>
        <button className="st-btn st-btn-primary" disabled={busy !== null}>
          {busy === 'invite' ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      {msg && <div className={`st-toast${msg.error ? ' is-error' : ''}`} role="status">{msg.text}</div>}
    </div>
  );
}
