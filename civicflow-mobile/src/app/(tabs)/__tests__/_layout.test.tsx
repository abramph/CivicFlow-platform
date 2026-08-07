import { render, screen, waitFor } from '@testing-library/react-native';

import TabsLayout from '../_layout';

jest.mock('expo-router', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  function Tabs({ children }: { children: React.ReactNode }) {
    return React.createElement(View, null, children);
  }
  Tabs.Screen = function TabsScreen({ options }: { name: string; options?: { title?: string; href?: string | null } }) {
    if (options?.href === null) return null;
    return React.createElement(Text, null, options?.title ?? '');
  };
  return {
    Tabs,
    Redirect: ({ href }: { href: string }) => React.createElement(Text, null, `redirect:${href}`),
  };
});

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/lib/unread-count', () => ({
  useUnreadConversationCount: () => 0,
}));

function baseAuth(overrides: Record<string, unknown> = {}) {
  return {
    status: 'signedIn',
    selectedOrganizationId: 'org-a',
    selectedOrganization: null,
    ...overrides,
  };
}

describe('TabsLayout — Admin tab visibility', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('shows the Admin tab when the selected organization has adminCapabilities', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({
        selectedOrganization: { pta: null, capability: { adminCapabilities: ['adminDashboard', 'manageMembers'] } },
      })
    );

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Admin')).toBeTruthy());
  });

  it('hides the Admin tab entirely when adminCapabilities is empty — not merely disabled', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({
        selectedOrganization: { pta: null, capability: { adminCapabilities: [] } },
      })
    );

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('hides the Admin tab when the organization has no capability data at all (defensive default)', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: { pta: null } }));

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
    expect(screen.queryByText('Admin')).toBeNull();
  });
});
