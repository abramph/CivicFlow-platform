import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminMemberCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminMember = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminMember: (...args: unknown[]) => mockCreateAdminMember(...args),
}));

describe('Admin member create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminMember.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('rejects submission without first/last name', async () => {
    await render(<AdminMemberCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Create member'));

    await waitFor(() => expect(screen.getByText('First name is required.')).toBeTruthy());
    expect(mockCreateAdminMember).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before submitting', async () => {
    await render(<AdminMemberCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('First name'), 'Ada');
    await fireEvent.changeText(screen.getByLabelText('Last name'), 'Lovelace');
    await fireEvent.changeText(screen.getByLabelText('Email, optional'), 'not-an-email');
    await fireEvent.press(screen.getByLabelText('Create member'));

    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeTruthy());
    expect(mockCreateAdminMember).not.toHaveBeenCalled();
  });

  it('creates the member and navigates to its detail screen', async () => {
    mockCreateAdminMember.mockResolvedValueOnce({ id: 'm-new' });

    await render(<AdminMemberCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('First name'), 'Ada');
    await fireEvent.changeText(screen.getByLabelText('Last name'), 'Lovelace');
    await fireEvent.press(screen.getByLabelText('Create member'));

    await waitFor(() =>
      expect(mockCreateAdminMember).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', firstName: 'Ada', lastName: 'Lovelace' })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-members/m-new');
  });

  it('preserves entered data and surfaces a server error on failure', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockCreateAdminMember.mockRejectedValueOnce(new ApiError('A membership category was not found', 404));

    await render(<AdminMemberCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('First name'), 'Ada');
    await fireEvent.changeText(screen.getByLabelText('Last name'), 'Lovelace');
    await fireEvent.press(screen.getByLabelText('Create member'));

    await waitFor(() => expect(screen.getByText('A membership category was not found')).toBeTruthy());
    expect(screen.getByLabelText('First name').props.value).toBe('Ada');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
