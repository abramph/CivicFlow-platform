import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AnnouncementsScreen from '../announcements';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAnnouncementsForIdentity = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentity: (...args: unknown[]) => mockGetAnnouncementsForIdentity(...args),
}));

describe('Announcements list accessibility', () => {
  beforeEach(() => {
    mockGetAnnouncementsForIdentity.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a', selectedOrganization: { memberId: 'member-1', pta: null } });
  });

  it('exposes each announcement as a single accessible button labeled with its read state, subject, and date', async () => {
    mockGetAnnouncementsForIdentity.mockResolvedValue([
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
    mockGetAnnouncementsForIdentity.mockResolvedValue([
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
    mockGetAnnouncementsForIdentity.mockRejectedValueOnce(new Error('Network request failed'));

    await render(<AnnouncementsScreen />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load announcements. Check your connection and try again.')).toBeTruthy()
    );

    mockGetAnnouncementsForIdentity.mockResolvedValueOnce([
      { id: 'ann-1', subject: 'Welcome!', title: 'Welcome!', body: 'Hi there.', isRead: false, sentAt: '2026-09-01T12:00:00.000Z' },
    ]);
    fireEvent.press(screen.getByLabelText('Retry loading'));

    await waitFor(() => expect(screen.getByText('Welcome!')).toBeTruthy());
    expect(
      screen.queryByText('Unable to load announcements. Check your connection and try again.')
    ).toBeNull();
  });
});
