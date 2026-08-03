import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import OrgSwitcherScreen from '../org-switcher';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockSelectOrganization = jest.fn();
const mockLogout = jest.fn();
const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

function organizations() {
  return [
    { organizationId: 'org-a', organizationName: 'Riverdale Community Association', firstName: 'Jamie', lastName: 'Lee', isDelinquent: false },
    { organizationId: 'org-pta', organizationName: 'Pine Grove School PTA', firstName: 'Casey', lastName: 'Kim', isDelinquent: true },
  ];
}

describe('Organization switching', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockSelectOrganization.mockReset().mockResolvedValue(undefined);
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      organizations: organizations(),
      selectedOrganizationId: 'org-a',
      selectOrganization: mockSelectOrganization,
      logout: mockLogout,
    });
  });

  it('marks the currently selected organization as selected and the other as not', async () => {
    await render(<OrgSwitcherScreen />);

    await waitFor(() => expect(screen.getByText('Riverdale Community Association')).toBeTruthy());
    expect(screen.getByLabelText('Riverdale Community Association').props.accessibilityState?.selected).toBe(true);
    expect(screen.getByLabelText('Pine Grove School PTA, dues past due').props.accessibilityState?.selected).toBe(false);
  });

  it('switches organization and navigates to the dashboard when a different org is tapped', async () => {
    await render(<OrgSwitcherScreen />);
    await waitFor(() => expect(screen.getByText('Pine Grove School PTA')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Pine Grove School PTA, dues past due'));

    expect(mockSelectOrganization).toHaveBeenCalledWith('org-pta');
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('logs out when the log out control is pressed', async () => {
    await render(<OrgSwitcherScreen />);
    await waitFor(() => expect(screen.getByLabelText('Log out')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Log out'));

    expect(mockLogout).toHaveBeenCalled();
  });

  it('shows the vertical label next to an organization that has capability data, and nothing extra for one that does not', async () => {
    mockUseAuth.mockReturnValue({
      organizations: [
        {
          organizationId: 'org-hoa',
          organizationName: 'Oak Ridge HOA',
          firstName: 'Robin',
          lastName: 'Park',
          isDelinquent: false,
          capability: {
            primaryVertical: 'HOA',
            terminology: { productLabel: 'HOA', member: 'Resident', dashboardTitle: 'HOA Dashboard' },
            quickActions: [],
            supportedModules: ['dashboard'],
            landingPage: 'dashboard',
            capabilities: { properties: true, propertyResidents: true },
          },
        },
        ...organizations(),
      ],
      selectedOrganizationId: 'org-hoa',
      selectOrganization: mockSelectOrganization,
      logout: mockLogout,
    });

    await render(<OrgSwitcherScreen />);

    await waitFor(() => expect(screen.getByText('HOA')).toBeTruthy());
  });
});
