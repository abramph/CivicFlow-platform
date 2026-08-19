import * as fs from 'fs';
import * as path from 'path';

import { calculateProcessingCostCoverageCents } from '@/lib/coverage-math';

describe('coverage-math (MOBILE-COVER)', () => {
  it('MUST stay byte-identical to the portal formula — one formula, mechanically enforced', () => {
    const extract = (raw: string) => {
      const source = raw.replace(/\r\n/g, '\n'); // git may check the two projects out with different EOLs
      const start = source.indexOf('export function calculateProcessingCostCoverageCents');
      expect(start).toBeGreaterThanOrEqual(0);
      const end = source.indexOf('\n}', start);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end + 2);
    };
    const mobileSource = fs.readFileSync(path.join(__dirname, '..', 'coverage-math.ts'), 'utf8');
    const portalSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'civicflow-portal', 'src', 'lib', 'giving', 'coverage-math.ts'),
      'utf8'
    );
    expect(extract(mobileSource)).toBe(extract(portalSource));
  });

  it('returns zero when nothing is configured or the base is non-positive', () => {
    expect(calculateProcessingCostCoverageCents(0, 290, 30)).toBe(0);
    expect(calculateProcessingCostCoverageCents(-500, 290, 30)).toBe(0);
    expect(calculateProcessingCostCoverageCents(500, 0, 0)).toBe(0);
  });

  it('grosses up so the org nets exactly the base (configured rate, no hardcoded processor rate)', () => {
    // $5.00 at 290bps + 30¢: gross = ceil((500+30)/0.971) = 546 → coverage 46.
    expect(calculateProcessingCostCoverageCents(500, 290, 30)).toBe(46);
    // $25.00 at 290bps + 30¢: gross = ceil((2500+30)/0.971) = 2606 → coverage 106.
    const coverage = calculateProcessingCostCoverageCents(2500, 290, 30);
    const gross = 2500 + coverage;
    // The processor's cut of the gross leaves at least the base for the org.
    expect(gross - (gross * 0.029 + 30)).toBeGreaterThanOrEqual(2500);
    expect(Number.isInteger(coverage)).toBe(true);
  });
});
