import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { API_BASE_URL, apiFetch, ApiError, fetchOrThrow, registerSessionExpiredHandler, setAccessToken } from '@/lib/api-client';
import type { RsvpCapability } from '@/lib/mobile-api';
import { registerDeviceToken, unregisterDeviceToken } from '@/lib/push-registration';
import { secureStorage } from '@/lib/secure-storage';

export interface MobileUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface MobileOrganizationPtaAccess {
  householdAdultId: string | null;
  householdName: string | null;
  isOfficer: boolean;
  canCheckIn: boolean;
  canApproveHours: boolean;
}

/**
 * Mirrors the `capability` object /api/mobile/organizations has sent on
 * every row since PR #43 (src/app/api/mobile/organizations/route.ts's
 * OrgCapability) — this client-side type previously discarded all of it
 * except `pta`, so an HOA/Union org looked identical to a plain Community
 * one in the org switcher despite the server already computing per-vertical
 * terminology/capabilities specifically for mobile to use. Optional because
 * a defensively-mocked or older cached response may omit it; every consumer
 * must handle that case rather than assume it's always present.
 */
export interface MobileOrganizationCapability {
  primaryVertical: string;
  terminology: {
    productLabel: string;
    member: string;
    dashboardTitle: string;
  };
  quickActions: { href: string; label: string }[];
  supportedModules: string[];
  landingPage: string;
  capabilities: {
    properties: boolean;
    propertyResidents: boolean;
  };
  /** Mobile Admin program (PR A) — only the flags the caller actually holds
   * for this org, server-resolved (see civicflow-portal's
   * resolveMobileAdminCapabilities()). Empty for every ordinary member/PTA
   * parent. Never derive Admin-tab visibility from role/permission strings
   * on this client — this array is the sole authority, and it's already
   * been filtered server-side down to only what the caller holds. */
  adminCapabilities: string[];
  /** Core Event RSVP contract — the sole authority for RSVP mode and whether
   * this caller can RSVP in this org. Optional for the same
   * older-cached-response reason as the parent object; when absent, event
   * routing falls back to the legacy memberId switch (see
   * getEventsForOrganization in mobile-api.ts). */
  rsvp?: RsvpCapability;
}

export interface MobileOrganization {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  /** Null for a pure PTA parent — the household's shared OrgMember is a billing identity, never a per-adult one. */
  memberId: string | null;
  /** Build 27 additive dual-role field: the caller's role-agnostic linked
   * OrgMember id, populated even on household-adult rows (whose legacy
   * `memberId` stays withheld for old builds' two-way identity switch).
   * Never the household's shared billing OrgMember. Optional so the app
   * tolerates a portal that predates Build 27. Read identities through
   * deriveOrgCapabilities() (lib/org-capabilities.ts), not raw fields. */
  constituentMemberId?: string | null;
  firstName: string | null;
  lastName: string | null;
  membershipStatus: string | null;
  isDelinquent: boolean;
  /** Null when this org has no PTA relevance for the caller at all (a regular member-only org). */
  pta: MobileOrganizationPtaAccess | null;
  capability?: MobileOrganizationCapability;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false };

interface AuthContextValue {
  status: AuthStatus;
  user: MobileUser | null;
  organizations: MobileOrganization[];
  selectedOrganizationId: string | null;
  selectedOrganization: MobileOrganization | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeMfaChallenge: (mfaToken: string, code: string) => Promise<void>;
  sendMfaSms: (mfaToken: string) => Promise<{ sent: boolean; skipped: boolean; maskedPhone?: string }>;
  acceptInvite: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectOrganization: (organizationId: string) => Promise<void>;
  refreshOrganizations: () => Promise<MobileOrganization[]>;
}

/**
 * Raw (non-apiFetch) POST for the two-step MFA login flow — apiFetch always
 * unwraps `payload.data`, but the login endpoint's MFA branch returns
 * `{ok, mfaRequired, mfaToken}` with no `data` field at all, so the caller
 * needs the full parsed payload to tell the two shapes apart.
 */
async function rawPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetchOrThrow(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new ApiError(payload?.error ?? 'Request failed', response.status, payload?.error);
  }
  return payload as T;
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
  // Always-current mirror of `organizations`, updated synchronously alongside
  // setOrganizations so selectOrganization() can validate against the latest
  // (e.g. just-refreshed) access list without waiting for a re-render.
  const organizationsRef = useRef<MobileOrganization[]>([]);

  function commitOrganizations(orgs: MobileOrganization[]) {
    organizationsRef.current = orgs;
    setOrganizations(orgs);
  }

  async function resetToSignedOut() {
    setAccessToken(null);
    await secureStorage.clearRefreshToken();
    await secureStorage.clearSelectedOrganizationId();
    await secureStorage.clearUser();
    setUser(null);
    commitOrganizations([]);
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
        const cachedUser = await secureStorage.getUser<MobileUser>();
        if (cachedUser) setUser(cachedUser);
        const { organizations: orgs, selectedOrganizationId: selected } = await loadOrganizationsAndRestoreSelection();
        commitOrganizations(orgs);
        setSelectedOrganizationId(selected);
        setStatus('signedIn');
        void registerDeviceToken(selected ?? undefined);
      } catch {
        await resetToSignedOut();
      }
    })();

    return () => registerSessionExpiredHandler(null);
    // Mount-once bootstrap; the helpers it calls are stable for the provider's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyTokensAndUser(tokens: TokenPair, signedInUser: MobileUser) {
    setAccessToken(tokens.accessToken);
    await secureStorage.setRefreshToken(tokens.refreshToken);
    await secureStorage.setUser(signedInUser);
    setUser(signedInUser);
    const { organizations: orgs, selectedOrganizationId: selected } = await loadOrganizationsAndRestoreSelection();
    commitOrganizations(orgs);
    setSelectedOrganizationId(selected);
    setStatus('signedIn');
    void registerDeviceToken(selected ?? undefined);
  }

  async function login(email: string, password: string): Promise<LoginResult> {
    const payload = await rawPost<
      | { ok: true; mfaRequired: true; mfaToken: string }
      | { ok: true; data: TokenPair & { user: MobileUser } }
    >('/api/mobile/auth/login', { email, password });

    if ('mfaRequired' in payload && payload.mfaRequired) {
      return { mfaRequired: true, mfaToken: payload.mfaToken };
    }

    const { data } = payload as { ok: true; data: TokenPair & { user: MobileUser } };
    await applyTokensAndUser(data, data.user);
    return { mfaRequired: false };
  }

  async function completeMfaChallenge(mfaToken: string, code: string) {
    const { data } = await rawPost<{ ok: true; data: TokenPair & { user: MobileUser } }>(
      '/api/mobile/auth/mfa/challenge',
      { mfaToken, code }
    );
    await applyTokensAndUser(data, data.user);
  }

  function sendMfaSms(mfaToken: string) {
    return rawPost<{ sent: boolean; skipped: boolean; maskedPhone?: string }>(
      '/api/mobile/auth/mfa/send-sms',
      { mfaToken }
    );
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
    // Validate against the always-current ref (not the render-closure array), so
    // a switch initiated right after a refreshOrganizations() sees the fresh
    // access list rather than a stale one.
    if (!organizationsRef.current.some((org) => org.organizationId === organizationId)) return;
    await secureStorage.setSelectedOrganizationId(organizationId);
    setSelectedOrganizationId(organizationId);
    void registerDeviceToken(organizationId);
  }

  /** Re-fetches the caller's live organization access from the server and
   *  returns it. Callers that must act on current access (e.g. validating a
   *  notification tap) use the returned list rather than the possibly-stale
   *  context array. Throws on failure so callers can fail closed. */
  async function refreshOrganizations(): Promise<MobileOrganization[]> {
    const { organizations: orgs, selectedOrganizationId: selected } = await loadOrganizationsAndRestoreSelection();
    commitOrganizations(orgs);
    setSelectedOrganizationId((current) => current ?? selected);
    return orgs;
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
    completeMfaChallenge,
    sendMfaSms,
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
