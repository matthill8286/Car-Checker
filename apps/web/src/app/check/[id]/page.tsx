import { CheckReport } from '@/components/CheckReport';

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page">
      <CheckReport id={id} />
    </main>
  );
}
