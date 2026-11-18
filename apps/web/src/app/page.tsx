import { CheckSearch } from '@/components/CheckSearch';

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>Car Check</h1>
        <p>Enter a UK registration, a Dutch plate or a VIN.</p>
      </header>
      <CheckSearch />
    </main>
  );
}
