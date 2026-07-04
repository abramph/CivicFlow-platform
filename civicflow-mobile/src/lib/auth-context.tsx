import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { apiFetch, registerSessionExpiredHandler, setAccessToken } from '@/lib/api-client';
import { registerDeviceToken, unregisterDeviceToken } from '@/lib/push-registration';
import { secureStorage } from '@/lib/secure-storage';

export interface MobileUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface MobileOrganization {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  memberId: string;
  firstName: string;
  lastName: string;
  membershipStatus: string;
  isDelinquent: boolean;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  user: MobileUser | null;
  organizations: MobileOrganization[];
  selectedOrganizationId: string | null;
  selectedOrganization: MobileOrganization | null;
  login: (email: string, password: string) => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectOrganization: (organizationId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadOrganizationsAndRestoreSelection(): Promise<{
  organizations: MobileOrganization[];
  selectedOrganizationId: string | null;
}> {
  const organizations = await apiFetch<MobileOrganization[]>('/api/mobile/organizations');
  const persisted = await secureStorage.getSelectedOrganizationId();
  let selectedOrganizationId: string | null = null;

  if (persisted && organizations.some((org) => org.organizationId === persisted)) {
    selectedOrganizationId = persisted;
  } else if (organizations.length === 1) {
    selectedOrganizationId = organizations[0].organizationId;
    await secureStorage.setSelectedOrganizationId(selectedOrganizationId);
  }

  return { organizations, selectedOrganizationId };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<MobileUser | null>(null);
  const [organizations, setOrganizations] = useState<MobileOrganization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);

  async function resetToSignedOut() {
    setAccessToken(null);
    await secureStorage.clearRefreshToken();
    await secureStorage.clearSelectedOrganizationId();
    setUser(null);
    setOrganizations([]);
    setSelectedOrganizationId(null);
    setStatus('signedOut');
  }

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      void resetToSignedOut();
    });

    (async () => {
      try {
        const refreshToken = await secureStorage.getRefreshToken();
        if (!refreshToken) {
          setStatus('signedOut');
          return;
        }
        const { organizations: orgs, selectedOrganizationId: selected } = await loadOrganizationsAndRestoreSelection();
        setOrganizations(orgs);
        setSelectedOrganizationId(selected);
        setStatus('signedIn');
        void registerDeviceToken(selected ?? undefined);
      } catch {
        await resetToSignedOut();
      }
    })();

    return () => registerSessionExpiredHandler(null);
  }, []);

  async function applyTokensAndUser(tokens: TokenPair, signedInUser: MobileUser) {
    setAccessToken(tokens.accessToken);
    await secureStorage.setRefreshToken(tokens.refreshToken);
    setUser(signedInUser);
    const { organizations: orgs, selectedOrganizationId: selected } = await loadOrganizationsAndRestoreSelection();
    setOrganizations(orgs);
    setSelectedOrganizationId(selected);
    setStatus('signedIn');
    void registerDeviceToken(selected ?? undefined);
  }

  async function login(email: string, password: string) {
    const data = await apiFetch<{ accessToken: string; refreshToken: string; expiresIn: number; user: MobileUser }>(
      '/api/mobile/auth/login',
      { method: 'POST', authenticated: false, body: JSON.stringify({ email, password }) }
    );
    await applyTokensAndUser(data, data.user);
  }

  async function acceptInvite(token: string, password: string) {
    const data = await apiFetch<{ accessToken: string; refreshToken: string; expiresIn: number; user: MobileUser }>(
      '/api/mobile/auth/accept-invite',
      { method: 'POST', authenticated: false, body: JSON.stringify({ token, password }) }
    );
    await applyTokensAndUser(data, data.user);
  }

  async function logout() {
    try {
      await unregisterDeviceToken();
      await apiFetch('/api/mobile/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // Best-effort — tokens are discarded client-side regardless.
    }
    await resetToSignedOut();
  }

  async function selectOrganization(organizationId: string) {
    if (!organizations.some((org) => org.organizationId === organizationId)) return;
    await secureStorage.setSelectedOrganizationId(organizationId);
    setSelectedOrganizationId(organizationId);
    void registerDeviceToken(organizationId);
  }

  async function refreshOrganizations() {
    const { organizations: orgs, selectedOrganizationId: selected } = await loadOrganizationsAndRestoreSelection();
    setOrganizations(orgs);
    setSelectedOrganizationId((current) => current ?? selected);
  }

  const selectedOrganization = useMemo(
    () => organizations.find((org) => org.organizationId === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId]
  );

  const value: AuthContextValue = {
    status,
    user,
    organizations,
    selectedOrganizationId,
    selectedOrganization,
    login,
    acceptInvite,
    logout,
    selectOrganization,
    refreshOrganizations,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
