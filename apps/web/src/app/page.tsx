import { CheckSearch } from '@/components/CheckSearch';

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>Check a car before you buy</h1>
        <p>Enter a UK registration, a Dutch plate or a VIN.</p>
      </header>
      <CheckSearch />
    </main>
  );
}
