import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminEventCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminEvent = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminEvent: (...args: unknown[]) => mockCreateAdminEvent(...args),
}));

describe('Admin event create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminEvent.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('rejects submission without a title', async () => {
    await render(<AdminEventCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Create event'));

    await waitFor(() => expect(screen.getByText('Title is required.')).toBeTruthy());
    expect(mockCreateAdminEvent).not.toHaveBeenCalled();
  });

  it('creates the event and navigates to its detail screen', async () => {
    mockCreateAdminEvent.mockResolvedValueOnce({ id: 'evt-new' });

    await render(<AdminEventCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('Title'), 'Fall Festival');
    await fireEvent.press(screen.getByLabelText('Create event'));

    await waitFor(() =>
      expect(mockCreateAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a', title: 'Fall Festival', status: 'upcoming' }))
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-events/evt-new');
  });

  it('preserves entered data and surfaces a server error on failure', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockCreateAdminEvent.mockRejectedValueOnce(new ApiError('Event end time must be on or after the start time.', 400));

    await render(<AdminEventCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('Title'), 'Fall Festival');
    await fireEvent.press(screen.getByLabelText('Create event'));

    await waitFor(() => expect(screen.getByText('Event end time must be on or after the start time.')).toBeTruthy());
    expect(screen.getByLabelText('Title').props.value).toBe('Fall Festival');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
