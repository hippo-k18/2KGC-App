import Link from 'next/link';

export default function NotFound() {
  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">404</p>
        <h1>Nothing here</h1>
        <p className="lede">
          That page does not exist. If you followed an order confirmation link, it may simply have
          expired — those are deliberately short-lived, because they show a claim code.
        </p>
        <p>
          <Link href="/" className="btn btn-outline">
            Back to the home page
          </Link>
        </p>
      </div>
    </section>
  );
}
