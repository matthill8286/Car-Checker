import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Car Check',
  description: 'Pre-purchase vehicle checks from DVLA, DVSA, RDW and NHTSA in one record.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        {children}
        <footer className="attribution">
          Contains public sector information licensed under the{' '}
          <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">
            Open Government Licence v3.0
          </a>
          . Dutch vehicle data from RDW open data. VIN decoding by NHTSA vPIC.
        </footer>
      </body>
    </html>
  );
}
