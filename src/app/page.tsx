import ConverterForm from "./ConverterForm";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; src?: string }>;
}) {
  const params = await searchParams;
  return (
    <main>
      <h1>TextSous Open</h1>
      <p>
        Convert any recipe into the TextSous Cook Along format. <a href="/demo">Or try a demo recipe.</a>
      </p>
      <ConverterForm initialUrl={params.url ?? ""} initialSrc={params.src ?? ""} />
    </main>
  );
}
