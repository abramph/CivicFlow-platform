import { render, screen, waitFor } from '@testing-library/react-native';

import VolunteersScreen from '../volunteers';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetPtaVolunteerOpportunities = jest.fn();
const mockGetPtaVolunteerCommitments = jest.fn();
const mockGetPtaVolunteerHours = jest.fn();
const mockGetPtaVolunteerToday = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaVolunteerOpportunities: (...args: unknown[]) => mockGetPtaVolunteerOpportunities(...args),
  getPtaVolunteerCommitments: (...args: unknown[]) => mockGetPtaVolunteerCommitments(...args),
  getPtaVolunteerHours: (...args: unknown[]) => mockGetPtaVolunteerHours(...args),
  getPtaVolunteerToday: (...args: unknown[]) => mockGetPtaVolunteerToday(...args),
}));

describe('Volunteers screen — PTA capability gating', () => {
  beforeEach(() => {
    mockGetPtaVolunteerOpportunities.mockReset().mockResolvedValue([]);
    mockGetPtaVolunteerCommitments.mockReset().mockResolvedValue([]);
    mockGetPtaVolunteerHours.mockReset().mockResolvedValue(null);
    mockGetPtaVolunteerToday.mockReset().mockResolvedValue(null);
  });

  it('shows the volunteer hub for a household adult with a PTA identity', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganization: { pta: { householdAdultId: 'adult-1', isOfficer: false } },
      selectedOrganizationId: 'org-pta',
    });

    await render(<VolunteersScreen />);

    await waitFor(() => expect(screen.getByText('Volunteers')).toBeTruthy());
    expect(screen.queryByText("Volunteer features aren't available for this organization.")).toBeNull();
  });

  it('hides the volunteer hub entirely once the organization has no PTA capability at all — Labs removal must fail closed here too', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganization: { pta: null },
      selectedOrganizationId: 'org-conventional',
    });

    await render(<VolunteersScreen />);

    await waitFor(() =>
      expect(screen.getByText("Volunteer features aren't available for this organization.")).toBeTruthy()
    );
    expect(mockGetPtaVolunteerOpportunities).not.toHaveBeenCalled();
  });
});
