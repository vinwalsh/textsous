import ConverterForm from "./ConverterForm";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; src?: string }>;
}) {
  const params = await searchParams;
  return (
    <main>
      {/* The site header carries the visible title and intro. */}
      <h1 className="visually-hidden">TextSous Open: turn a recipe into a Cook Along</h1>
      <ConverterForm initialUrl={params.url ?? ""} initialSrc={params.src ?? ""} />
    </main>
  );
}
