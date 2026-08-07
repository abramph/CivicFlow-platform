import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminEventEditScreen from '../edit';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => ({ eventId: 'evt-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminEvent = jest.fn();
const mockUpdateAdminEvent = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminEvent: (...args: unknown[]) => mockGetAdminEvent(...args),
  updateAdminEvent: (...args: unknown[]) => mockUpdateAdminEvent(...args),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    organizationId: 'org-a',
    title: 'Fall Festival',
    description: null,
    location: null,
    startAt: null,
    endAt: null,
    status: 'upcoming',
    notes: null,
    ...overrides,
  };
}

describe('Admin event edit screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockBack.mockReset();
    mockGetAdminEvent.mockReset();
    mockUpdateAdminEvent.mockReset();
    alertSpy.mockClear();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('prepopulates the form from a fresh server fetch', async () => {
    mockGetAdminEvent.mockResolvedValueOnce(event());

    await render(<AdminEventEditScreen />);

    await waitFor(() => expect(screen.getByLabelText('Title').props.value).toBe('Fall Festival'));
  });

  it('goes back immediately when cancelling with no changes', async () => {
    mockGetAdminEvent.mockResolvedValueOnce(event());

    await render(<AdminEventEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Cancel'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('warns before discarding unsaved changes', async () => {
    mockGetAdminEvent.mockResolvedValueOnce(event());

    await render(<AdminEventEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Location'), 'Main Hall');
    await fireEvent.press(screen.getByLabelText('Cancel'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });

  it('saves changes and navigates to the detail screen', async () => {
    mockGetAdminEvent.mockResolvedValueOnce(event());
    mockUpdateAdminEvent.mockResolvedValueOnce(event({ location: 'Main Hall' }));

    await render(<AdminEventEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Location'), 'Main Hall');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() =>
      expect(mockUpdateAdminEvent).toHaveBeenCalledWith('evt-1', expect.objectContaining({ organizationId: 'org-a', location: 'Main Hall' }))
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-events/evt-1');
  });
});
