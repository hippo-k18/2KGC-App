import { notFound } from 'next/navigation';
import { RichEditorDemo } from './demo';

/**
 * A workbench for the rich text editor (T317): every variant on one page.
 * Development only and in no menu; production builds answer 404.
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <RichEditorDemo />;
}
