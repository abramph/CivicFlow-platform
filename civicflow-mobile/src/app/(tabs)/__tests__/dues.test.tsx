import { render, screen, waitFor } from '@testing-library/react-native';

import DuesScreen from '../dues';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetDues = jest.fn();
const mockGetPtaDues = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getDues: (...args: unknown[]) => mockGetDues(...args),
  getPtaDues: (...args: unknown[]) => mockGetPtaDues(...args),
}));

function conventionalOrg() {
  return {
    organizationId: 'org-a',
    organizationName: 'Riverdale Community Association',
    memberId: 'member-1',
    firstName: 'Jamie',
    lastName: 'Lee',
    pta: null,
  };
}

function ptaParentOrg() {
  return {
    organizationId: 'org-pta',
    organizationName: 'Pine Grove School PTA',
    memberId: null,
    firstName: 'Casey',
    lastName: 'Kim',
    pta: { householdAdultId: 'adult-1', householdName: null, isOfficer: false, canCheckIn: false, canApproveHours: false },
  };
}

/**
 * A staff/owner login with no linked OrgMember. Distinct from an owner who IS
 * also a member — that account resolves a real memberId (see the API's
 * role-agnostic OrgMember lookup) and is indistinguishable here from any other
 * member, which is the point: the client keys off identity, never off role.
 */
function staffOnlyOrg() {
  return {
    organizationId: 'org-aph',
    organizationName: 'APH Technologies, LLC',
    memberId: null,
    firstName: null,
    lastName: null,
    pta: null,
  };
}

function ownerMemberOrg() {
  return {
    organizationId: 'org-aph',
    organizationName: 'APH Technologies, LLC',
    memberId: 'member-owner',
    firstName: 'Abram',
    lastName: 'Harris',
    pta: null,
  };
}

describe('Dues screen', () => {
  beforeEach(() => {
    mockGetDues.mockReset();
    mockGetPtaDues.mockReset();
  });

  it('renders the conventional member outstanding balance, accessibly grouped into one label', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: conventionalOrg(), selectedOrganizationId: 'org-a' });
    mockGetDues.mockResolvedValue({ outstandingBalance: 42.5, isDelinquent: false, charges: [] });

    await render(<DuesScreen />);

    await waitFor(() => expect(screen.getByText('$42.50')).toBeTruthy());
    const summaryCard = screen.getByLabelText('Outstanding balance, $42.50');
    expect(summaryCard).toBeTruthy();
  });

  it('surfaces a past-due balance in the accessible label', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: conventionalOrg(), selectedOrganizationId: 'org-a' });
    mockGetDues.mockResolvedValue({
      outstandingBalance: 100,
      isDelinquent: true,
      delinquentSince: '2026-01-15T00:00:00.000Z',
      charges: [],
    });

    await render(<DuesScreen />);

    await waitFor(() => expect(screen.getByText(/past due/i)).toBeTruthy());
    expect(screen.getByLabelText(/Outstanding balance, \$100.*past due since/)).toBeTruthy();
  });

  it('renders the PTA parent dues-charge summary with a status label, not the conventional balance card', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: ptaParentOrg(), selectedOrganizationId: 'org-pta' });
    mockGetPtaDues.mockResolvedValue({
      currentSchoolYear: '2025-2026',
      currentCharge: {
        id: 'charge-1',
        remainingBalanceCents: 2500,
        status: 'UNPAID',
        dueDate: '2026-09-01T00:00:00.000Z',
        amountDueCents: 2500,
        amountPaidCents: 0,
        adjustments: [],
        payments: [],
      },
      hasBillingIdentity: true,
      priorCharges: [],
      onlinePaymentLinkSlug: null,
    });

    await render(<DuesScreen />);

    await waitFor(() => expect(screen.getByText('Unpaid')).toBeTruthy());
    expect(screen.queryByText('Outstanding Balance')).toBeNull();
  });

  it("shows the household's missing-billing-record message when a PTA parent has no billing identity", async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: ptaParentOrg(), selectedOrganizationId: 'org-pta' });
    mockGetPtaDues.mockResolvedValue({
      currentSchoolYear: '2025-2026',
      currentCharge: null,
      hasBillingIdentity: false,
      priorCharges: [],
      onlinePaymentLinkSlug: null,
    });

    await render(<DuesScreen />);

    await waitFor(() => expect(screen.getByText(/doesn't have a dues billing record yet/)).toBeTruthy());
  });

  it('shows a non-member state — not the member UI — for a staff/owner with no member identity', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: staffOnlyOrg(), selectedOrganizationId: 'org-aph' });

    await render(<DuesScreen />);

    expect(screen.getByText(/No personal dues or payment account is associated/)).toBeTruthy();
    // Previously this account fell through to the conventional-member render,
    // which offered three actions that each 403'd server-side.
    expect(screen.queryByLabelText('Make a payment')).toBeNull();
    expect(screen.queryByLabelText('Report a payment')).toBeNull();
    expect(screen.queryByLabelText('View payment history')).toBeNull();
    expect(screen.queryByText('Outstanding Balance')).toBeNull();
    expect(mockGetDues).not.toHaveBeenCalled();
    expect(mockGetPtaDues).not.toHaveBeenCalled();
  });

  it('shows the full member UI for an owner who also has a linked member identity', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: ownerMemberOrg(), selectedOrganizationId: 'org-aph' });
    mockGetDues.mockResolvedValue({ outstandingBalance: 60, isDelinquent: false, charges: [] });

    await render(<DuesScreen />);

    await waitFor(() => expect(screen.getByText('$60.00')).toBeTruthy());
    expect(screen.getByLabelText('Make a payment')).toBeTruthy();
    expect(screen.getByLabelText('Report a payment')).toBeTruthy();
    expect(mockGetDues).toHaveBeenCalledWith('org-aph');
  });
});
