import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AnnouncementsScreen from '../announcements';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAnnouncementsForIdentities = jest.fn();
const mockSetAnnouncementArchivedForSources = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentities: (...args: unknown[]) => mockGetAnnouncementsForIdentities(...args),
  setAnnouncementArchivedForSources: (...args: unknown[]) => mockSetAnnouncementArchivedForSources(...args),
}));

describe('Announcements list accessibility', () => {
  beforeEach(() => {
    mockGetAnnouncementsForIdentities.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a', selectedOrganization: { memberId: 'member-1', pta: null } });
  });

  it('exposes each announcement as a single accessible button labeled with its read state, subject, and date', async () => {
    mockGetAnnouncementsForIdentities.mockResolvedValue([
      {
        id: 'ann-1',
        subject: 'Welcome to Pine Grove PTA!',
        title: 'Welcome to Pine Grove PTA!',
        body: 'We are excited to have you.',
        isRead: false,
        sentAt: '2026-09-01T12:00:00.000Z',
      },
    ]);

    await render(<AnnouncementsScreen />);

    await waitFor(() => expect(screen.getByText('Welcome to Pine Grove PTA!')).toBeTruthy());
    const row = screen.getByLabelText(/^Unread, Welcome to Pine Grove PTA!, 9\/1\/2026/);
    expect(row.props.accessibilityRole).toBe('button');
  });

  it('does not prefix a read announcement with "Unread"', async () => {
    mockGetAnnouncementsForIdentities.mockResolvedValue([
      {
        id: 'ann-2',
        subject: 'September minutes approved',
        title: 'September minutes approved',
        body: 'See attached.',
        isRead: true,
        sentAt: '2026-09-05T00:00:00.000Z',
      },
    ]);

    await render(<AnnouncementsScreen />);

    await waitFor(() => expect(screen.getByText('September minutes approved')).toBeTruthy());
    expect(screen.queryByLabelText(/^Unread/)).toBeNull();
    expect(screen.getByLabelText(/^September minutes approved/)).toBeTruthy();
  });

  it('shows a retryable error banner instead of a silently empty list when the load fails', async () => {
    mockGetAnnouncementsForIdentities.mockRejectedValueOnce(new Error('Network request failed'));

    await render(<AnnouncementsScreen />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load announcements. Check your connection and try again.')).toBeTruthy()
    );

    mockGetAnnouncementsForIdentities.mockResolvedValueOnce([
      { id: 'ann-1', subject: 'Welcome!', title: 'Welcome!', body: 'Hi there.', isRead: false, sentAt: '2026-09-01T12:00:00.000Z' },
    ]);
    fireEvent.press(screen.getByLabelText('Retry loading'));

    await waitFor(() => expect(screen.getByText('Welcome!')).toBeTruthy());
    expect(
      screen.queryByText('Unable to load announcements. Check your connection and try again.')
    ).toBeNull();
  });
});

describe('Announcement personal lifecycle (Build 27)', () => {
  beforeEach(() => {
    mockGetAnnouncementsForIdentities.mockReset();
    mockSetAnnouncementArchivedForSources.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a', selectedOrganization: { memberId: 'member-1', pta: null } });
  });

  it('archives the caller’s own copy through every source row, then reloads', async () => {
    mockGetAnnouncementsForIdentities.mockResolvedValue([
      { id: 'ann-1', subject: 'Book fair', title: 'Book fair', body: 'Next week.', isRead: true, sentAt: '2026-09-01T12:00:00.000Z', sources: ['member'] },
    ]);

    await render(<AnnouncementsScreen />);
    await waitFor(() => expect(screen.getByText('Book fair')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Archive Book fair'));

    await waitFor(() =>
      expect(mockSetAnnouncementArchivedForSources).toHaveBeenCalledWith('org-a', 'ann-1', ['member'], true)
    );
  });

  it('the Archived view fetches archived items and offers Restore instead', async () => {
    mockGetAnnouncementsForIdentities.mockResolvedValue([
      { id: 'ann-2', subject: 'Old news', title: 'Old news', body: 'Done.', isRead: true, sentAt: '2026-08-01T12:00:00.000Z', sources: ['member'], isArchived: true },
    ]);

    await render(<AnnouncementsScreen />);
    await fireEvent.press(screen.getByLabelText('Show archived announcements'));

    await waitFor(() =>
      expect(mockGetAnnouncementsForIdentities).toHaveBeenCalledWith(
        'org-a',
        { hasMemberIdentity: true, hasParentIdentity: false },
        { archived: true }
      )
    );
    await waitFor(() => expect(screen.getByLabelText('Restore Old news')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Restore Old news'));
    await waitFor(() =>
      expect(mockSetAnnouncementArchivedForSources).toHaveBeenCalledWith('org-a', 'ann-2', ['member'], false)
    );
  });
});

describe('Announcement management discoverability (device-acceptance F-02)', () => {
  const { router } = jest.requireMock('expo-router');

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAnnouncementsForIdentities.mockReset();
    mockSetAnnouncementArchivedForSources.mockReset();
  });

  it('an identity-less administrator with manageCommunications keeps the truthful recipient message AND gets a path to management', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { pta: null, capability: { adminCapabilities: ['adminDashboard', 'manageCommunications'] } },
    });

    await render(<AnnouncementsScreen />);

    // The honest empty state is unchanged -- management access must never
    // pretend the admin has a recipient inbox.
    await waitFor(() =>
      expect(
        screen.getByText(
          'Announcements are sent to members and families. Your login has no member or family record in this organization, so there is nothing to show here.'
        )
      ).toBeTruthy()
    );
    expect(mockGetAnnouncementsForIdentities).not.toHaveBeenCalled();

    // Both entry points exist: the header action and the empty-state action.
    const manageActions = screen.getAllByLabelText('Manage announcements');
    expect(manageActions.length).toBe(2);

    await fireEvent.press(manageActions[manageActions.length - 1]);
    expect(router.push).toHaveBeenCalledWith('/admin-campaigns');
  });

  it('management entry does not depend on recipient identity, and inbox behavior is unchanged for a dual-role admin', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { memberId: 'member-1', pta: null, capability: { adminCapabilities: ['adminDashboard', 'manageCommunications'] } },
    });
    mockGetAnnouncementsForIdentities.mockResolvedValue([
      { id: 'ann-1', subject: 'Book fair', title: 'Book fair', body: 'Next week.', isRead: true, sentAt: '2026-09-01T12:00:00.000Z', sources: ['member'] },
    ]);

    await render(<AnnouncementsScreen />);

    await waitFor(() => expect(screen.getByText('Book fair')).toBeTruthy());
    // Header action present alongside the normal inbox.
    expect(screen.getByLabelText('Manage announcements')).toBeTruthy();
    expect(screen.getByLabelText('Show archived announcements')).toBeTruthy();
  });

  it('a parent/member without manageCommunications sees no management entry anywhere -- behavior unchanged', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { memberId: 'member-1', pta: null, capability: { adminCapabilities: [] } },
    });
    mockGetAnnouncementsForIdentities.mockResolvedValue([]);

    await render(<AnnouncementsScreen />);

    await waitFor(() => expect(screen.getByText('No announcements yet.')).toBeTruthy());
    expect(screen.queryByLabelText('Manage announcements')).toBeNull();
  });

  it('an admin whose capabilities do not include manageCommunications gets no management entry', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { pta: null, capability: { adminCapabilities: ['adminDashboard', 'manageEvents'] } },
    });

    await render(<AnnouncementsScreen />);

    await waitFor(() => expect(screen.getByText(/no member or family record/)).toBeTruthy());
    expect(screen.queryByLabelText('Manage announcements')).toBeNull();
  });
});
