import Link from "next/link";

/** Light-only 404 inside the site chrome (Next's default page switches to dark). */
export default function NotFound() {
  return (
    <main>
      <h1>We can&apos;t find that page</h1>
      <p className="tagline">The link may be old or mistyped. You can start again from any recipe.</p>
      <div className="btn-row">
        <Link href="/" className="btn btn-primary">
          Convert a recipe
        </Link>
        <Link href="/demo" className="btn">
          Try a demo recipe
        </Link>
      </div>
    </main>
  );
}
