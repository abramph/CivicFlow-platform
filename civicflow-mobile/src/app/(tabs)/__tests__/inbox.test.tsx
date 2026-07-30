import { render, screen, waitFor } from '@testing-library/react-native';

import InboxScreen from '../inbox';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetConversations = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getConversations: (...args: unknown[]) => mockGetConversations(...args),
}));

describe('Inbox unread state', () => {
  beforeEach(() => {
    mockGetConversations.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it("marks an unread conversation as bold and accessibly announces it as unread, distinct from a read one", async () => {
    mockGetConversations.mockResolvedValue([
      {
        id: 'conv-1',
        subject: null,
        hasUnread: true,
        lastMessageAt: '2026-09-10T12:00:00.000Z',
        otherParticipants: [{ displayName: 'Alex Morgan' }],
      },
      {
        id: 'conv-2',
        subject: 'Field trip logistics',
        hasUnread: false,
        lastMessageAt: '2026-09-01T12:00:00.000Z',
        otherParticipants: [{ displayName: 'Jamie Lee' }],
      },
    ]);

    await render(<InboxScreen />);

    await waitFor(() => expect(screen.getByText('Alex Morgan')).toBeTruthy());
    expect(screen.getByLabelText(/^Unread, Alex Morgan/)).toBeTruthy();
    expect(screen.getByLabelText(/^Field trip logistics/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Unread, Field trip logistics/)).toBeNull();
  });

  it('shows the empty state once loaded with no conversations', async () => {
    mockGetConversations.mockResolvedValue([]);

    await render(<InboxScreen />);

    await waitFor(() => expect(screen.getByText('No conversations yet.')).toBeTruthy());
  });
});
