import { render, screen, waitFor } from '@testing-library/react-native';

import MinutesScreen from '../minutes';

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetMinutes = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getMinutes: (...args: unknown[]) => mockGetMinutes(...args),
}));

describe('Meeting Minutes screen', () => {
  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('renders approved minutes with the meeting title and date', async () => {
    mockGetMinutes.mockResolvedValue([
      { id: 'minutes-1', title: 'October Board Meeting', meetingTitle: 'October Board Meeting', meetingDate: '2026-10-01T12:00:00.000Z', approvedAt: '2026-10-05T12:00:00.000Z' },
    ]);

    await render(<MinutesScreen />);

    await waitFor(() => expect(screen.getByText('October Board Meeting')).toBeTruthy());
    expect(screen.getByLabelText(/^October Board Meeting, October Board Meeting, 10\/1\/2026/)).toBeTruthy();
  });

  it('shows the empty state once loaded with no approved minutes', async () => {
    mockGetMinutes.mockResolvedValue([]);

    await render(<MinutesScreen />);

    await waitFor(() => expect(screen.getByText('No approved minutes have been posted yet.')).toBeTruthy());
  });

  it('shows a retryable error banner when the load fails', async () => {
    mockGetMinutes.mockRejectedValueOnce(new Error('Network request failed'));

    await render(<MinutesScreen />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load meeting minutes. Check your connection and try again.')).toBeTruthy()
    );
  });
});
