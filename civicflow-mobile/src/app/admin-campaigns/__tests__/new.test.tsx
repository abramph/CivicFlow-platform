import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminCampaignCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminCampaign = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminCampaign: (...args: unknown[]) => mockCreateAdminCampaign(...args),
}));

describe('Admin campaign create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminCampaign.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('rejects submission without required fields', async () => {
    await render(<AdminCampaignCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() => expect(screen.getByText('Title is required.')).toBeTruthy());
    expect(mockCreateAdminCampaign).not.toHaveBeenCalled();
  });

  it('saves as draft without sending', async () => {
    mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

    await render(<AdminCampaignCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Fall Newsletter');
    await fireEvent.changeText(screen.getByLabelText('Subject'), 'Hello');
    await fireEvent.changeText(screen.getByLabelText('Message body'), 'Body text');
    await fireEvent.press(screen.getByLabelText('Save as draft'));

    await waitFor(() =>
      expect(mockCreateAdminCampaign).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a', title: 'Fall Newsletter', sendNow: false }))
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-campaigns/camp-new');
  });

  it('sends immediately when Send Now is tapped', async () => {
    mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

    await render(<AdminCampaignCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Fall Newsletter');
    await fireEvent.changeText(screen.getByLabelText('Subject'), 'Hello');
    await fireEvent.changeText(screen.getByLabelText('Message body'), 'Body text');
    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() =>
      expect(mockCreateAdminCampaign).toHaveBeenCalledWith(expect.objectContaining({ sendNow: true }))
    );
  });

  it('preserves entered data and surfaces a server error on failure', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockCreateAdminCampaign.mockRejectedValueOnce(new ApiError('Your organization does not have the SMS add-on enabled.', 400));

    await render(<AdminCampaignCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Fall Newsletter');
    await fireEvent.changeText(screen.getByLabelText('Subject'), 'Hello');
    await fireEvent.changeText(screen.getByLabelText('Message body'), 'Body text');
    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() => expect(screen.getByText('Your organization does not have the SMS add-on enabled.')).toBeTruthy());
    expect(screen.getByLabelText('Title').props.value).toBe('Fall Newsletter');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
