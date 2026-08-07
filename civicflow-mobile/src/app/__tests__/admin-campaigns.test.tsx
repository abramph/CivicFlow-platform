import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminCampaignsScreen from '../admin-campaigns';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminCampaigns = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminCampaigns: (...args: unknown[]) => mockGetAdminCampaigns(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

describe('Admin campaigns list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminCampaigns.mockReset();
  });

  it('shows a denial state and never fetches without manageCommunications', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));

    await render(<AdminCampaignsScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have communications administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminCampaigns).not.toHaveBeenCalled();
  });

  it('loads and renders campaigns for an authorized officer', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageCommunications']));
    mockGetAdminCampaigns.mockResolvedValueOnce([
      { id: 'camp-1', title: 'Fall Newsletter', communicationType: 'ANNOUNCEMENT', channel: 'EMAIL', status: 'DRAFT', scheduledFor: null, sentAt: null, createdAt: '2026-08-01T00:00:00.000Z', _count: { recipients: 40 } },
    ]);

    await render(<AdminCampaignsScreen />);

    await waitFor(() => expect(screen.getByText('Fall Newsletter')).toBeTruthy());
    expect(mockGetAdminCampaigns).toHaveBeenCalledWith('org-a');
  });

  it('navigates to the create screen when New is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageCommunications']));
    mockGetAdminCampaigns.mockResolvedValueOnce([]);

    await render(<AdminCampaignsScreen />);
    await waitFor(() => expect(mockGetAdminCampaigns).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('New campaign'));

    expect(mockPush).toHaveBeenCalledWith('/admin-campaigns/new');
  });
});
