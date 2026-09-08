import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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
const mockPreviewRecipients = jest.fn();
const mockGetTargetingOptions = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminCampaign: (...args: unknown[]) => mockCreateAdminCampaign(...args),
  previewAdminCampaignRecipients: (...args: unknown[]) => mockPreviewRecipients(...args),
  getAdminCampaignTargetingOptions: (...args: unknown[]) => mockGetTargetingOptions(...args),
}));

// Confirmation dialogs: pressing the LAST button is the confirm action.
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

async function fillRequiredFields() {
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Fall Newsletter');
  await fireEvent.changeText(screen.getByLabelText('Subject'), 'Hello');
  await fireEvent.changeText(screen.getByLabelText('Message body'), 'Body text');
}

describe('Announcement composer (Build 27)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a', selectedOrganization: { capability: { adminCapabilities: ['manageCommunications'] } } });
    mockGetTargetingOptions.mockResolvedValue({ isPta: false, currentSchoolYear: null });
    mockPreviewRecipients.mockResolvedValue({ count: 42 });
  });

  it('rejects submission without required fields — nothing is previewed or created', async () => {
    await render(<AdminCampaignCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() => expect(screen.getByText('Title is required.')).toBeTruthy());
    expect(mockCreateAdminCampaign).not.toHaveBeenCalled();
    expect(mockPreviewRecipients).not.toHaveBeenCalled();
  });

  it('saves as draft without sending, carrying the selected audience filter', async () => {
    mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

    await render(<AdminCampaignCreateScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByLabelText('Save as draft'));

    await waitFor(() =>
      expect(mockCreateAdminCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', title: 'Fall Newsletter', sendNow: false, recipientFilter: { selector: 'active_with_email' } })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-campaigns/camp-new');
    // Drafts never require the confirmation dialog.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Send Now previews the REAL recipient count and requires an explicit confirmation before creating', async () => {
    mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

    await render(<AdminCampaignCreateScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() => expect(mockCreateAdminCampaign).toHaveBeenCalledWith(expect.objectContaining({ sendNow: true })));
    // Preview ran through the same resolver-backed endpoint first…
    expect(mockPreviewRecipients).toHaveBeenCalledWith('org-a', { selector: 'active_with_email' }, 'EMAIL');
    // …and the confirmation named the count.
    expect(alertSpy).toHaveBeenCalledWith(
      'Send this announcement?',
      expect.stringContaining('42 recipients'),
      expect.anything()
    );
  });

  it('offers PTA family targeting for PTA organizations and sends the server-validated rule shape', async () => {
    mockGetTargetingOptions.mockResolvedValue({ isPta: true, currentSchoolYear: '2026-2027' });
    mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

    await render(<AdminCampaignCreateScreen />);
    await waitFor(() => expect(screen.getByLabelText('All families')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Unpaid households'));
    await fillRequiredFields();
    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() =>
      expect(mockCreateAdminCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ recipientFilter: { selector: 'pta_target', ptaRule: { type: 'unpaid', schoolYear: '2026-2027' } } })
      )
    );
  });

  it('preserves entered data and surfaces a server error — including the duplicate-submission conflict', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockCreateAdminCampaign.mockRejectedValueOnce(
      new ApiError('An identical announcement was just created. Check the campaign list before sending it again.', 409)
    );

    await render(<AdminCampaignCreateScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() =>
      expect(screen.getByText('An identical announcement was just created. Check the campaign list before sending it again.')).toBeTruthy()
    );
    expect(screen.getByLabelText('Title').props.value).toBe('Fall Newsletter');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('never sends when the audience preview fails — no blind fan-out', async () => {
    mockPreviewRecipients.mockRejectedValueOnce(new Error('offline'));

    await render(<AdminCampaignCreateScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByLabelText('Send now'));

    await waitFor(() => expect(screen.getByText('Unable to preview the audience. Check your connection and try again.')).toBeTruthy());
    expect(mockCreateAdminCampaign).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
