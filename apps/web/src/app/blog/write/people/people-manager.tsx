'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BlogPerson, BlogRole } from '@/lib/blog/people';
import { invitePersonAction, removePersonAction, resendInvitationAction, setPersonRoleAction } from '../actions';

const STATUS: Record<BlogPerson['status'], string> = { invited: 'Invited', active: 'Active', removed: 'Removed' };
const since = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function PeopleManager({ people, me }: { people: BlogPerson[]; me: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'writer' as BlogRole });

  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg(null), error ? 7000 : 4000);
  };

  async function run(key: string, fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return flash(res.error, true);
    flash(res.message);
    router.refresh();
    return true;
  }

  return (
    <div className="pp-grid">
      <div className="st-panel">
        {people.map((p) => {
          const you = p.email === me;
          const removed = p.status === 'removed';
          return (
            <div key={p.email} className={`pp-row${removed ? ' is-removed' : ''}`}>
              <div style={{ minWidth: 0 }}>
                <div className="pp-name">
                  {p.name || p.email}
                  {you && <span className="st-muted" style={{ fontWeight: 400 }}> (you)</span>}
                </div>
                <div className="pp-email">
                  {p.email}
                  {' · '}
                  {p.posts} {p.posts === 1 ? 'post' : 'posts'}
                  {p.lastSignInAt && !removed ? ` · Last in ${since.format(new Date(p.lastSignInAt))}` : ''}
                </div>
              </div>
              <div className="pp-role">{p.role === 'editor' ? 'Editor' : 'Writer'}</div>
              <div>
                <span className={`pp-status pp-status-${p.status}`}>{STATUS[p.status]}</span>
              </div>
              <div className="pp-actions">
                {p.fixed ? (
                  <span className="st-muted pp-note">Set in the server settings</span>
                ) : removed ? (
                  <button
                    className="st-btn st-btn-quiet"
                    disabled={busy !== null}
                    onClick={() => setForm({ name: p.name, email: p.email, role: p.role })}
                  >
                    Add back
                  </button>
                ) : (
                  <>
                    {p.status === 'invited' && (
                      <button
                        className="st-btn st-btn-quiet"
                        disabled={busy !== null}
                        onClick={() => run(`resend-${p.email}`, () => resendInvitationAction(p.email))}
                      >
                        Resend invitation
                      </button>
                    )}
                    {!you && (
                      <>
                        <button
                          className="st-btn st-btn-quiet"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`role-${p.email}`, () =>
                              setPersonRoleAction(p.email, p.role === 'editor' ? 'writer' : 'editor'),
                            )
                          }
                        >
                          Make {p.role === 'editor' ? 'writer' : 'editor'}
                        </button>
                        <button
                          className="st-btn st-btn-quiet st-btn-danger"
                          disabled={busy !== null}
                          onClick={() => {
                            if (!confirm(`Remove ${p.name || p.email}? They can no longer sign in. Their posts stay.`)) return;
                            run(`rm-${p.email}`, () => removePersonAction(p.email));
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form
        className="st-panel pp-invite"
        onSubmit={async (e) => {
          e.preventDefault();
          const done = await run('invite', () => invitePersonAction(form));
          if (done) setForm({ name: '', email: '', role: 'writer' });
        }}
      >
        <h2>Add a guest writer</h2>
        <label className="st-field">
          <span>Email</span>
          <input
            className="st-input"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="st-field">
          <span>Name</span>
          <input
            className="st-input"
            required
            maxLength={120}
            autoComplete="off"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <small>The byline on their posts.</small>
        </label>
        <div className="pp-roles" role="radiogroup" aria-label="Role">
          <label>
            <input type="radio" name="role" checked={form.role === 'writer'} onChange={() => setForm({ ...form, role: 'writer' })} />
            Writer
            <small>Drafts their own posts, which go to review.</small>
          </label>
          <label>
            <input type="radio" name="role" checked={form.role === 'editor'} onChange={() => setForm({ ...form, role: 'editor' })} />
            Editor
            <small>Edits and publishes any post, and manages this list.</small>
          </label>
        </div>
        <button className="st-btn st-btn-primary" disabled={busy !== null}>
          {busy === 'invite' ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      {msg && (
        <div className={`st-toast${msg.error ? ' is-error' : ''}`} role="status">
          {msg.text}
        </div>
      )}
    </div>
  );
}
