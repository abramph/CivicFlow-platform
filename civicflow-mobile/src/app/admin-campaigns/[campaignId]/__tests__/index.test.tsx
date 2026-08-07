import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminCampaignDetailScreen from '../index';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ campaignId: 'camp-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminCampaign = jest.fn();
const mockSendAdminCampaign = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminCampaign: (...args: unknown[]) => mockGetAdminCampaign(...args),
  sendAdminCampaign: (...args: unknown[]) => mockSendAdminCampaign(...args),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function campaign(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'camp-1',
    title: 'Fall Newsletter',
    communicationType: 'ANNOUNCEMENT',
    channel: 'EMAIL',
    subject: 'Hello',
    body: 'Body text',
    status: 'DRAFT',
    scheduledFor: null,
    sentAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    _count: { recipients: 40 },
    ...overrides,
  };
}

describe('Admin campaign detail screen', () => {
  beforeEach(() => {
    mockGetAdminCampaign.mockReset();
    mockSendAdminCampaign.mockReset();
    alertSpy.mockClear();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('re-fetches by campaignId + organization', async () => {
    mockGetAdminCampaign.mockResolvedValueOnce(campaign());

    await render(<AdminCampaignDetailScreen />);

    await waitFor(() => expect(mockGetAdminCampaign).toHaveBeenCalledWith('org-a', 'camp-1'));
    expect(screen.getByText('Fall Newsletter')).toBeTruthy();
  });

  it('shows Send Campaign for a DRAFT campaign', async () => {
    mockGetAdminCampaign.mockResolvedValueOnce(campaign({ status: 'DRAFT' }));

    await render(<AdminCampaignDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Send campaign')).toBeTruthy());
  });

  it('hides Send Campaign for a SENT campaign', async () => {
    mockGetAdminCampaign.mockResolvedValueOnce(campaign({ status: 'SENT' }));

    await render(<AdminCampaignDetailScreen />);

    await waitFor(() => expect(screen.getByText('Fall Newsletter')).toBeTruthy());
    expect(screen.queryByLabelText('Send campaign')).toBeNull();
  });

  it('sends the campaign via the confirmation flow', async () => {
    mockGetAdminCampaign.mockResolvedValueOnce(campaign({ status: 'DRAFT' }));
    mockGetAdminCampaign.mockResolvedValueOnce(campaign({ status: 'SENT' }));
    mockSendAdminCampaign.mockResolvedValueOnce({ sent: 40, skipped: 0, failed: 0 });

    await render(<AdminCampaignDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Send campaign')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Send campaign'));

    await waitFor(() => expect(mockSendAdminCampaign).toHaveBeenCalledWith('org-a', 'camp-1'));
  });

  it('shows a not-found state for a deleted/foreign-org campaign', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockGetAdminCampaign.mockRejectedValueOnce(new ApiError('Campaign not found', 404));

    await render(<AdminCampaignDetailScreen />);

    await waitFor(() => expect(screen.getByText('This campaign could not be found.')).toBeTruthy());
  });
});
