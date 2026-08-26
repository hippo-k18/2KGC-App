import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Photo Booth. */
export default async function Page() {
  return (
    <GapScreen
      title="Photo Booth"
      lead={<>Not built, and honestly sized rather than promised. The note below is what it would actually take.</>}
      whova={<>A branded in-app camera with stickers and frames, usually run on a tablet at the venue.</>}
      needs={<>The camera, the compositing and a kiosk mode. This is the most app-side feature in Engagement and the least reachable from a web console.</>}
      size="8–10 days, and it wants a development build rather than Expo Go."
      notBuilt={[
        <><strong>A physical photo booth is cheaper.</strong> Worth saying plainly: this is one of the few features where hiring the real thing beats building it.</>,
      ]}
    />
  );
}
