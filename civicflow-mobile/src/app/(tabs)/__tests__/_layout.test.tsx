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

describe('TabsLayout — Union vertical navigation', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  function unionOrg(overrides: Record<string, unknown> = {}) {
    return { pta: null, capability: { primaryVertical: 'UNION', adminCapabilities: [] }, ...overrides };
  }

  it('shows Cases and hides Announcements/Payments for a Union organization', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: unionOrg() }));

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Cases')).toBeTruthy());
    expect(screen.queryByText('Announcements')).toBeNull();
    expect(screen.queryByText('Payments')).toBeNull();
    // Still present: Home, Inbox, Events, Profile.
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Inbox')).toBeTruthy();
    expect(screen.getByText('Events')).toBeTruthy();
    expect(screen.getByText('Profile')).toBeTruthy();
  });

  it('hides Cases and keeps Announcements/Payments for a non-Union organization', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({ selectedOrganization: { pta: null, capability: { primaryVertical: 'COMMUNITY', adminCapabilities: [] } } })
    );

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
    expect(screen.queryByText('Cases')).toBeNull();
    expect(screen.getByText('Announcements')).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
  });

  it('lets an Admin-capable Union officer keep the Admin tab alongside Cases — officer capability is untouched by the vertical nav change', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({ selectedOrganization: unionOrg({ capability: { primaryVertical: 'UNION', adminCapabilities: ['adminDashboard'] } }) })
    );

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Cases')).toBeTruthy());
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('re-renders the tab set with no stale tabs when switching from a Union org to a non-Union org', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: unionOrg() }));
    const { rerender } = await render(<TabsLayout />);
    await waitFor(() => expect(screen.getByText('Cases')).toBeTruthy());

    mockUseAuth.mockReturnValue(
      baseAuth({ selectedOrganization: { pta: null, capability: { primaryVertical: 'COMMUNITY', adminCapabilities: [] } } })
    );
    rerender(<TabsLayout />);

    await waitFor(() => expect(screen.queryByText('Cases')).toBeNull());
    expect(screen.getByText('Announcements')).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
  });
});

describe('TabsLayout — Church vertical navigation (CHURCH-VERT-A)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  function churchOrg(overrides: Record<string, unknown> = {}) {
    return { pta: null, capability: { primaryVertical: 'CHURCH', adminCapabilities: [] }, ...overrides };
  }

  function unionOrg(overrides: Record<string, unknown> = {}) {
    return { pta: null, capability: { primaryVertical: 'UNION', adminCapabilities: [] }, ...overrides };
  }

  it('shows Give and hides Cases/Announcements/Payments for a Church organization', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: churchOrg() }));

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Give')).toBeTruthy());
    expect(screen.queryByText('Cases')).toBeNull();
    expect(screen.queryByText('Announcements')).toBeNull();
    expect(screen.queryByText('Payments')).toBeNull();
    // Still present: Home, Inbox, Events, Profile.
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Inbox')).toBeTruthy();
    expect(screen.getByText('Events')).toBeTruthy();
    expect(screen.getByText('Profile')).toBeTruthy();
  });

  it('hides Give for a non-Church organization', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({ selectedOrganization: { pta: null, capability: { primaryVertical: 'COMMUNITY', adminCapabilities: [] } } })
    );

    await render(<TabsLayout />);

    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
    expect(screen.queryByText('Give')).toBeNull();
  });

  it('re-renders the tab set with no stale tabs when switching between Union and Church orgs (§18)', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: unionOrg() }));
    const { rerender } = await render(<TabsLayout />);
    await waitFor(() => expect(screen.getByText('Cases')).toBeTruthy());
    expect(screen.queryByText('Give')).toBeNull();

    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: churchOrg() }));
    rerender(<TabsLayout />);

    await waitFor(() => expect(screen.queryByText('Cases')).toBeNull());
    expect(screen.getByText('Give')).toBeTruthy();

    mockUseAuth.mockReturnValue(baseAuth({ selectedOrganization: unionOrg() }));
    rerender(<TabsLayout />);

    await waitFor(() => expect(screen.queryByText('Give')).toBeNull());
    expect(screen.getByText('Cases')).toBeTruthy();
  });
});
