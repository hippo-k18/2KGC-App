import { requireViewer } from '@/lib/blog/auth';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const viewer = await requireViewer();
  return (
    <div className="st-page" style={{ maxWidth: 640 }}>
      <div className="st-head">
        <div>
          <h1>Profile</h1>
          <p>Your name is the byline on your posts. The photo and bio appear under each one.</p>
        </div>
      </div>
      <ProfileForm
        email={viewer.email}
        initial={{ name: viewer.member.name, bio: viewer.member.bio ?? '', avatar: viewer.member.avatar ?? null }}
      />
    </div>
  );
}
