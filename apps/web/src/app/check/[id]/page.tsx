import Link from 'next/link';
import { CheckReport } from '@/components/CheckReport';

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page">
      <header className="masthead masthead-compact">
        <h1>
          <Link href="/">Car Check</Link>
        </h1>
      </header>
      <CheckReport id={id} />
    </main>
  );
}
