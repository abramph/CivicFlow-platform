import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { requireAdminCapability } from '@/components/require-admin-capability';

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

function InnerScreen() {
  return <Text>secret admin form</Text>;
}
const Guarded = requireAdminCapability('manageEvents', 'event administration', InnerScreen);

describe('requireAdminCapability — deep-link guard for admin write screens', () => {
  it('renders the screen when the caller holds the capability', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: { capability: { adminCapabilities: ['manageEvents'] } } });
    await render(<Guarded />);
    expect(screen.getByText('secret admin form')).toBeTruthy();
  });

  it('renders the unauthorized notice — never the form — without the capability', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: { capability: { adminCapabilities: ['manageMembers'] } } });
    await render(<Guarded />);
    expect(screen.queryByText('secret admin form')).toBeNull();
    expect(screen.getByText("You don't have event administration access for this organization.")).toBeTruthy();
  });

  it('denies when there is no organization or capability object at all', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: null });
    await render(<Guarded />);
    expect(screen.queryByText('secret admin form')).toBeNull();
  });
});
