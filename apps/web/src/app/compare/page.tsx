import { Compare } from '@/components/Compare';

export const metadata = { title: 'Compare · Car Check' };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  return (
    <main className="page page-wide">
      <header className="masthead">
        <h1>Compare</h1>
      </header>
      {a && b ? <Compare a={a} b={b} /> : <p className="muted">Pick two cars in your garage.</p>}
    </main>
  );
}
