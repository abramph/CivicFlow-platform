import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { GivingContent } from '../giving-content';

const mockOpenBrowserAsync = jest.fn();
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetGiving = jest.fn();
const mockStartGivingCheckout = jest.fn();
const mockStartRecurringGivingCheckout = jest.fn();
const mockManageRecurringGiving = jest.fn();
const mockCreateGivingPledge = jest.fn();
const mockGetGivingStatementUrl = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getGiving: (...args: unknown[]) => mockGetGiving(...args),
  startGivingCheckout: (...args: unknown[]) => mockStartGivingCheckout(...args),
  startRecurringGivingCheckout: (...args: unknown[]) => mockStartRecurringGivingCheckout(...args),
  manageRecurringGiving: (...args: unknown[]) => mockManageRecurringGiving(...args),
  createGivingPledge: (...args: unknown[]) => mockCreateGivingPledge(...args),
  getGivingStatementUrl: (...args: unknown[]) => mockGetGivingStatementUrl(...args),
}));

function enabledSummary(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    terminology: 'Giving',
    yearTotal: 100,
    funds: [
      { id: 'fund-general', name: 'General Fund', description: null, suggestedAmounts: [25, 50], minimumAmount: null, maximumAmount: null, allowRecurring: true, allowPledges: false },
      { id: 'fund-building', name: 'Building Fund', description: null, suggestedAmounts: [100, 250], minimumAmount: null, maximumAmount: null, allowRecurring: true, allowPledges: true },
    ],
    history: [],
    schedules: [],
    pledges: [
      { id: 'pledge-1', fundId: 'fund-building', fundName: 'Building Fund', campaignName: null, pledged: 1000, contributed: 100, remainingTowardPledge: 900, progressPercent: 10, status: 'ACTIVE' },
    ],
    statements: [],
    ...overrides,
  };
}

/**
 * CORE-GIVE-E give-toward-pledge, wired up to the mobile Give tab. The
 * backend already validated/supported pledgeId (see checkout.ts) -- this is
 * the first client to actually send it. Caught in native smoke testing:
 * there was previously no way for a member to attribute a gift to an
 * existing pledge at all.
 */
describe('GivingContent — give toward an existing pledge', () => {
  beforeEach(() => {
    mockOpenBrowserAsync.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-church' });
    mockGetGiving.mockReset().mockResolvedValue(enabledSummary());
    mockStartGivingCheckout.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.com/session' });
    mockStartRecurringGivingCheckout.mockReset();
    mockManageRecurringGiving.mockReset();
    mockCreateGivingPledge.mockReset();
    mockGetGivingStatementUrl.mockReset();
  });

  it('shows a "Give toward this pledge" action only for pledges with a remaining balance', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.getByLabelText('Give toward your Building Fund pledge')).toBeTruthy();
  });

  it('hides the action for a fulfilled pledge', async () => {
    mockGetGiving.mockResolvedValue(
      enabledSummary({
        pledges: [{ id: 'pledge-1', fundId: 'fund-building', fundName: 'Building Fund', campaignName: null, pledged: 1000, contributed: 1000, remainingTowardPledge: 0, progressPercent: 100, status: 'FULFILLED' }],
      })
    );

    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.queryByLabelText('Give toward your Building Fund pledge')).toBeNull();
  });

  it('selecting "Give toward this pledge" switches the fund, pre-fills the remaining amount, shows the pledge banner, and hides the recurring toggle', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Give toward your Building Fund pledge'));

    expect(screen.getByText('Giving toward your Building Fund pledge')).toBeTruthy();
    expect(screen.getByDisplayValue('900')).toBeTruthy();
    expect(screen.queryByText(/Make this recurring/)).toBeNull();
    expect(screen.queryByText('Pledge this amount instead')).toBeNull();
  });

  it('submits the checkout with the pledgeId attached', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Give toward your Building Fund pledge'));
    await fireEvent.press(screen.getByLabelText('Continue to secure payment'));

    await waitFor(() => expect(mockStartGivingCheckout).toHaveBeenCalledWith('org-church', 'fund-building', 900, 'pledge-1', false));
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://checkout.stripe.com/session');
  });

  it('"Clear" exits pledge mode and restores the recurring/pledge options', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Give toward your Building Fund pledge'));
    await fireEvent.press(screen.getByLabelText('Stop giving toward pledge'));

    expect(screen.queryByText('Giving toward your Building Fund pledge')).toBeNull();
    expect(screen.getByText(/Make this recurring/)).toBeTruthy();
  });

  it('manually switching funds exits pledge mode', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Give toward your Building Fund pledge'));
    expect(screen.getByText('Giving toward your Building Fund pledge')).toBeTruthy();

    await fireEvent.press(screen.getByText('General Fund'));

    expect(screen.queryByText('Giving toward your Building Fund pledge')).toBeNull();
  });
});

/**
 * MOBILE-COVER — voluntary processing-cost coverage in the native Give flow.
 * The app shows an ESTIMATE from the shared pure formula and sends ONLY the
 * boolean; the server quote alone determines the charge (§4). At the test
 * rate (290bps + 30¢): $25 → ceil((2500+30)/0.971) − 2500 = 106¢ coverage.
 */
describe('GivingContent — processing-cost coverage (MOBILE-COVER)', () => {
  const OFFER = { offered: true, percentBps: 290, fixedCents: 30 };

  beforeEach(() => {
    mockOpenBrowserAsync.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-church' });
    mockGetGiving.mockReset().mockResolvedValue(enabledSummary({ coverage: OFFER }));
    mockStartGivingCheckout.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.com/session' });
    mockStartRecurringGivingCheckout.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.com/session-r' });
    mockManageRecurringGiving.mockReset().mockResolvedValue({});
    mockCreateGivingPledge.mockReset();
    mockGetGivingStatementUrl.mockReset();
  });

  it('defaults OFF: the control renders unchecked with the estimate, and Total stays the base', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('$25'));

    const toggle = screen.getByRole('checkbox');
    expect(toggle.props.accessibilityState.checked).toBe(false);
    expect(screen.getByText(/Help cover estimated processing costs \(\+\$1\.06\)/)).toBeTruthy();
    expect(screen.getByText('Total: $25.00')).toBeTruthy();
  });

  it('enabling updates the Total to base + estimated coverage and explains the full base goes to the org', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('$25'));
    await fireEvent.press(screen.getByRole('checkbox'));

    expect(screen.getByText('Total: $26.06')).toBeTruthy();
    expect(screen.getByText(/The full \$25\.00 goes to the organization/)).toBeTruthy();
  });

  it('checked-out one-time gift sends ONLY the boolean true — base amount unchanged', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('$25'));
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByLabelText('Continue to secure payment'));

    await waitFor(() => expect(mockStartGivingCheckout).toHaveBeenCalledWith('org-church', 'fund-general', 25, null, true));
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://checkout.stripe.com/session');
  });

  it('left OFF, checkout sends false and the amount is exactly what was entered', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('$25'));
    await fireEvent.press(screen.getByLabelText('Continue to secure payment'));

    await waitFor(() => expect(mockStartGivingCheckout).toHaveBeenCalledWith('org-church', 'fund-general', 25, null, false));
  });

  it('org not offering coverage (§5): no control, and checkout still sends false', async () => {
    mockGetGiving.mockResolvedValue(enabledSummary());

    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('$25'));

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/Help cover estimated processing costs/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Continue to secure payment'));
    await waitFor(() => expect(mockStartGivingCheckout).toHaveBeenCalledWith('org-church', 'fund-general', 25, null, false));
  });

  it('recurring setup: the preference rides the existing contract as a boolean, labeled per contribution', async () => {
    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('$25'));
    await fireEvent.press(screen.getByText(/Make this recurring/));
    await fireEvent.press(screen.getByRole('checkbox'));

    expect(screen.getByText('Total per contribution: $26.06')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Continue to secure payment'));
    await waitFor(() =>
      expect(mockStartRecurringGivingCheckout).toHaveBeenCalledWith('org-church', 'fund-general', 25, 'MONTHLY', false, true)
    );
  });

  it('a schedule already covering costs shows the disclosure and "Stop covering costs" sends the boolean false', async () => {
    mockGetGiving.mockResolvedValue(
      enabledSummary({
        coverage: OFFER,
        schedules: [
          { id: 'sched-1', fundName: 'General Fund', amount: 50, frequency: 'MONTHLY', status: 'ACTIVE', nextContributionDate: null, paymentMethodDescriptor: null, coverProcessingCosts: true },
        ],
      })
    );

    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.getByText(/Covering estimated processing costs — the full \$50\.00 goes to the organization/)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Stop covering processing costs'));
    await waitFor(() =>
      expect(mockManageRecurringGiving).toHaveBeenCalledWith('org-church', 'sched-1', 'coverage', undefined, false)
    );
  });

  it('a schedule not covering costs offers "Cover costs" only while the org offers coverage', async () => {
    mockGetGiving.mockResolvedValue(
      enabledSummary({
        coverage: OFFER,
        schedules: [
          { id: 'sched-1', fundName: 'General Fund', amount: 50, frequency: 'MONTHLY', status: 'ACTIVE', nextContributionDate: null, paymentMethodDescriptor: null, coverProcessingCosts: false },
        ],
      })
    );

    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Cover estimated processing costs on future contributions'));
    await waitFor(() =>
      expect(mockManageRecurringGiving).toHaveBeenCalledWith('org-church', 'sched-1', 'coverage', undefined, true)
    );
  });

  it('org mode OFF (§5): an existing covering schedule can still STOP, but "Cover costs" never renders', async () => {
    mockGetGiving.mockResolvedValue(
      enabledSummary({
        schedules: [
          { id: 'sched-1', fundName: 'General Fund', amount: 50, frequency: 'MONTHLY', status: 'ACTIVE', nextContributionDate: null, paymentMethodDescriptor: null, coverProcessingCosts: false },
          { id: 'sched-2', fundName: 'Building Fund', amount: 20, frequency: 'MONTHLY', status: 'ACTIVE', nextContributionDate: null, paymentMethodDescriptor: null, coverProcessingCosts: true },
        ],
      })
    );

    await render(<GivingContent />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.queryByLabelText('Cover estimated processing costs on future contributions')).toBeNull();
    expect(screen.getByLabelText('Stop covering processing costs')).toBeTruthy();
  });
});
