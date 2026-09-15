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
const mockGetSmsCapability = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminCampaign: (...args: unknown[]) => mockCreateAdminCampaign(...args),
  previewAdminCampaignRecipients: (...args: unknown[]) => mockPreviewRecipients(...args),
  getAdminCampaignTargetingOptions: (...args: unknown[]) => mockGetTargetingOptions(...args),
  getAdminSmsCapability: (...args: unknown[]) => mockGetSmsCapability(...args),
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
    // Default: the org is entitled to SMS (individual tests override this).
    mockGetSmsCapability.mockResolvedValue({ available: true, restricted: false, reasonCode: null, message: null, remaining: 100, billingManagementRequired: false });
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

  describe('SMS entitlement gating', () => {
    it('disables the SMS channels and shows the truthful reason when the org is not entitled', async () => {
      mockGetSmsCapability.mockResolvedValue({
        available: false,
        restricted: false,
        reasonCode: 'ADD_ON_REQUIRED',
        message: "SMS isn't part of your plan yet. Add the SMS add-on in Settings → Billing to text members.",
        remaining: null,
        billingManagementRequired: true,
      });

      await render(<AdminCampaignCreateScreen />);

      // The SMS + Email+SMS chips are rendered disabled (labelled "(unavailable)").
      await waitFor(() => expect(screen.getByLabelText('SMS (unavailable)')).toBeTruthy());
      expect(screen.getByLabelText('Email + SMS (unavailable)')).toBeTruthy();
      // And the truthful, non-sensitive reason is shown verbatim.
      expect(screen.getByText(/Add the SMS add-on in Settings → Billing/)).toBeTruthy();
    });

    it('keeps Email as the channel even after tapping the disabled SMS chip — a disallowed channel is never sent', async () => {
      mockGetSmsCapability.mockResolvedValue({
        available: false,
        restricted: false,
        reasonCode: 'SUSPENDED',
        message: 'SMS messaging is suspended for your organization. Please contact support.',
        remaining: null,
        billingManagementRequired: false,
      });
      mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

      await render(<AdminCampaignCreateScreen />);
      await waitFor(() => expect(screen.getByLabelText('SMS (unavailable)')).toBeTruthy());

      await fireEvent.press(screen.getByLabelText('SMS (unavailable)'));
      await fillRequiredFields();
      await fireEvent.press(screen.getByLabelText('Send now'));

      // Preview + create both still run over EMAIL — the tap on the disabled chip did nothing.
      await waitFor(() => expect(mockPreviewRecipients).toHaveBeenCalledWith('org-a', { selector: 'active_with_email' }, 'EMAIL'));
      expect(mockCreateAdminCampaign).toHaveBeenCalledWith(expect.objectContaining({ channel: 'EMAIL' }));
    });

    it('allows selecting SMS and surfaces the remaining allowance when the org is entitled', async () => {
      mockGetSmsCapability.mockResolvedValue({ available: true, restricted: false, reasonCode: null, message: null, remaining: 100, billingManagementRequired: false });
      mockCreateAdminCampaign.mockResolvedValueOnce({ id: 'camp-new' });

      await render(<AdminCampaignCreateScreen />);
      // Entitled: the chip is selectable (no "(unavailable)" suffix) and the allowance is shown.
      await waitFor(() => expect(screen.getByLabelText('SMS')).toBeTruthy());
      expect(screen.getByText(/100 messages left this month/)).toBeTruthy();

      await fireEvent.press(screen.getByLabelText('SMS'));
      await fillRequiredFields();
      await fireEvent.press(screen.getByLabelText('Send now'));

      await waitFor(() => expect(mockPreviewRecipients).toHaveBeenCalledWith('org-a', { selector: 'active_with_email' }, 'SMS'));
      expect(mockCreateAdminCampaign).toHaveBeenCalledWith(expect.objectContaining({ channel: 'SMS' }));
    });

    it('surfaces a truthful RESTRICTED (Safe Launch) state — SMS stays selectable', async () => {
      mockGetSmsCapability.mockResolvedValue({
        available: true,
        restricted: true,
        reasonCode: 'RESTRICTED_TEST_MODE',
        message: 'SMS is in limited launch mode — only verified test numbers will receive messages until verification is complete.',
        remaining: 100,
        billingManagementRequired: false,
      });

      await render(<AdminCampaignCreateScreen />);
      await waitFor(() => expect(screen.getByLabelText('SMS')).toBeTruthy());
      expect(screen.getByText(/only verified test numbers/)).toBeTruthy();
    });

    it('offers an actionable billing route ONLY to an admin who can manage billing', async () => {
      mockUseAuth.mockReturnValue({
        selectedOrganizationId: 'org-a',
        selectedOrganization: { capability: { adminCapabilities: ['manageCommunications', 'manageOrganization'] } },
      });
      mockGetSmsCapability.mockResolvedValue({
        available: false,
        restricted: false,
        reasonCode: 'ADD_ON_REQUIRED',
        message: "SMS isn't part of your plan yet. Add the SMS add-on in Settings → Billing to text members.",
        remaining: null,
        billingManagementRequired: true,
      });

      await render(<AdminCampaignCreateScreen />);
      await waitFor(() => expect(screen.getByLabelText('Manage billing to enable SMS')).toBeTruthy());
    });

    it('tells a non-billing admin that an owner must enable SMS (no billing action)', async () => {
      // Default useAuth has only manageCommunications (no manageOrganization).
      mockGetSmsCapability.mockResolvedValue({
        available: false,
        restricted: false,
        reasonCode: 'BILLING_REQUIRED',
        message: "Your subscription isn't active. Update billing in Settings → Billing to send SMS.",
        remaining: null,
        billingManagementRequired: true,
      });

      await render(<AdminCampaignCreateScreen />);
      await waitFor(() => expect(screen.getByText(/organization owner or billing administrator must enable SMS/)).toBeTruthy());
      expect(screen.queryByLabelText('Manage billing to enable SMS')).toBeNull();
    });

    it('for a billing-EXEMPT org shows contact-support and NO billing link — even for a billing admin', async () => {
      // A manageOrganization admin — yet billing is not the remedy for an exempt org.
      mockUseAuth.mockReturnValue({
        selectedOrganizationId: 'org-a',
        selectedOrganization: { capability: { adminCapabilities: ['manageCommunications', 'manageOrganization'] } },
      });
      mockGetSmsCapability.mockResolvedValue({
        available: false,
        restricted: false,
        reasonCode: 'ADD_ON_REQUIRED_EXEMPT',
        message: "SMS isn't enabled for your organization yet. Contact Unestra support to have it turned on.",
        remaining: null,
        billingManagementRequired: false,
      });

      await render(<AdminCampaignCreateScreen />);
      await waitFor(() => expect(screen.getByText(/Contact Unestra support/)).toBeTruthy());
      // No billing link and no "ask an owner (billing)" hint — billing is irrelevant here.
      expect(screen.queryByLabelText('Manage billing to enable SMS')).toBeNull();
      expect(screen.queryByText(/organization owner or billing administrator must enable SMS/)).toBeNull();
    });
  });
});
