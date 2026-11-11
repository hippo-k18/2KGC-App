'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { updateProfileAction } from '../actions';
import { uploadImage } from '../image-upload';

export function ProfileForm({ email, initial }: { email: string; initial: { name: string; bio: string; avatar: string | null } }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg(null), 3500);
  };

  return (
    <form
      className="st-panel"
      style={{ padding: 24 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await updateProfileAction(v);
        setBusy(false);
        if (!res.ok) return flash(res.error, true);
        flash('Profile saved');
        router.refresh();
      }}
    >
      <div className="pf-avatar">
        {v.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.avatar} alt="" />
        ) : (
          <span className="pf-blank" aria-hidden="true" />
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="st-btn" onClick={() => file.current?.click()}>
            {v.avatar ? 'Change photo' : 'Add a photo'}
          </button>
          {v.avatar && (
            <button type="button" className="st-btn st-btn-quiet" onClick={() => setV({ ...v, avatar: null })}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const up = await uploadImage(f);
              setV((cur) => ({ ...cur, avatar: up.src }));
            } catch (err) {
              flash(err instanceof Error ? err.message : 'The upload failed.', true);
            }
          }}
        />
      </div>
      <label className="st-field">
        <span>Name</span>
        <input className="st-input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </label>
      <label className="st-field">
        <span>Email</span>
        <input className="st-input" value={email} disabled />
      </label>
      <label className="st-field">
        <span>Bio</span>
        <textarea className="st-textarea" rows={4} maxLength={800} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} />
      </label>
      <button className="st-btn st-btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save profile'}
      </button>
      {msg && <div className={`st-toast${msg.error ? ' is-error' : ''}`} role="status">{msg.text}</div>}
    </form>
  );
}
