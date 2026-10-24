'use client';

import { useState } from 'react';
import { newPostAction, signOutAction } from './actions';

/** Buttons whose action answers with a place to go. See the note in `actions.ts`. */
export function NewPostButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="st-btn st-btn-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        window.location.assign((await newPostAction()).go);
      }}
    >
      New post
    </button>
  );
}

export function SignOutButton() {
  return (
    <button type="button" onClick={async () => window.location.assign((await signOutAction()).go)}>
      Sign out
    </button>
  );
}
