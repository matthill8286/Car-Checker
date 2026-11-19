import { Garage } from '@/components/Garage';

export const metadata = { title: 'Garage · Car Check' };

export default function GaragePage() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>Garage</h1>
        <p>Cars you are considering. Tick two to compare them.</p>
      </header>
      <Garage />
    </main>
  );
}
