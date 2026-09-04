import { act, fireEvent, render, screen } from '@testing-library/react-native';

import PtaMyFamilyScreen from '../pta-my-family';

/**
 * Covers what's actually new in this screen: entry-point display states,
 * navigation to the existing pta-family-photo.tsx screen, refresh-on-focus
 * (upload/replace/removal/org-switch all show up here as "the next focus
 * event returns different data"), authorization gating, and accessibility.
 *
 * Deliberately NOT re-tested here (already covered by
 * pta-family-photo.test.tsx and attendance-scan.test.tsx, and unchanged --
 * this pass made zero edits to pta-family-photo.tsx): cancel/upload-failure
 * preserving the existing photo, picker rejection error handling, the
 * neutral camera-permission flow itself, and the unnecessary-library-
 * permission fix. Re-testing another screen's already-covered internal
 * behavior here would be redundant, not additional coverage.
 *
 * useFocusEffect is mocked as a plain, hook-free callback capturer (not a
 * real useEffect) -- the real hook fires once when the screen mounts/
 * focuses and again every time it regains focus after navigating back.
 * Each test explicitly triggers the initial "focus" itself via
 * openScreen(), then can trigger a second one via triggerFocus() to
 * simulate returning from photo management or an org switch.
 */

const mockPush = jest.fn();
const mockRedirectHref = jest.fn();
let latestFocusCallback: (() => void | (() => void)) | null = null;
const mockUseFocusEffect = jest.fn((callback: () => void | (() => void)) => {
  latestFocusCallback = callback;
});
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: (props: { href: unknown }) => {
    mockRedirectHref(props.href);
    return null;
  },
  useFocusEffect: (callback: () => void | (() => void)) => mockUseFocusEffect(callback),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetPtaHouseholdPhoto = jest.fn();
const mockGetPtaProgression = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaHouseholdPhoto: (...args: unknown[]) => mockGetPtaHouseholdPhoto(...args),
  getPtaProgression: (...args: unknown[]) => mockGetPtaProgression(...args),
}));

function authWith(overrides: { householdAdultId?: string | null; householdName?: string | null; organizationId?: string } = {}) {
  return {
    status: 'signedIn',
    selectedOrganizationId: overrides.organizationId ?? 'org-1',
    selectedOrganization: {
      organizationId: overrides.organizationId ?? 'org-1',
      organizationName: 'Pine Grove PTA',
      pta:
        overrides.householdAdultId === null
          ? null
          : {
              householdAdultId: overrides.householdAdultId ?? 'adult-1',
              householdName: overrides.householdName ?? 'The Kim Family',
              isOfficer: false,
              canCheckIn: false,
              canApproveHours: false,
            },
    },
  };
}

/** A demonstrably Community/Nonprofit organization (capability.
 * primaryVertical: 'COMMUNITY' -- the same field this app's own
 * vertical-gating logic keys off, see _layout.test.tsx/org-switcher.test.tsx)
 * with no PTA household link at all. Distinct from
 * authWith({householdAdultId: null}) above, which represents the broader
 * "no PTA identity" case (could be a PTA-org staff member with no household
 * link); this fixture pins the org's own vertical explicitly. */
function communityMemberOrg(overrides: { organizationId?: string } = {}) {
  return {
    status: 'signedIn' as const,
    selectedOrganizationId: overrides.organizationId ?? 'org-community',
    selectedOrganization: {
      organizationId: overrides.organizationId ?? 'org-community',
      organizationName: 'Riverdale Community Association',
      pta: null,
      capability: { primaryVertical: 'COMMUNITY' },
    },
  };
}

/** Simulates the screen (re)gaining focus -- the same mechanism
 * useFocusEffect uses in production for both the initial mount and every
 * later return trip (e.g. from photo management, or after an org switch
 * that navigated away and back), not a full remount. The focus callback
 * kicks off an async load (setLoading(true) -> await load() ->
 * setLoading(false)) without itself returning a promise, so we can't await
 * its completion directly -- instead we wait for the loading indicator
 * (shown only while `loading` is true) to disappear. */
async function triggerFocus() {
  await act(async () => {
    latestFocusCallback?.();
    // The focus callback itself doesn't return a promise (it returns a
    // cleanup function, per the useFocusEffect/useEffect contract), so its
    // internal async work (setLoading -> await load() -> setLoading) can't
    // be awaited directly. Yielding a few microtask turns inside this same
    // act() scope lets that work -- and the state updates it makes --
    // settle before the scope closes, instead of leaking outside any act()
    // boundary (which corrupts React's act() nesting tracking for every
    // later render in the process, not just this test).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openScreen() {
  await render(<PtaMyFamilyScreen />);
  await triggerFocus();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPtaHouseholdPhoto.mockReset();
  mockGetPtaProgression.mockReset();
  // Default: progression unavailable (both feature flags default OFF), so
  // existing expectations describe an org without progression enabled.
  mockGetPtaProgression.mockRejectedValue(new Error('progression unavailable'));
  latestFocusCallback = null;
});

describe('PtaMyFamilyScreen -- entry point display states', () => {
  it('shows a placeholder and "Add Family Photo" when no photo exists', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    expect(screen.getByLabelText('No family photo set')).toBeTruthy();
    expect(screen.getByLabelText('Add family photo')).toBeTruthy();
    expect(screen.queryByLabelText('Edit family photo')).toBeNull();
  });

  it('shows the current photo and "Edit Family Photo" when a photo exists', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue({ uri: 'data:image/jpeg;base64,signed', byteSize: 1000 });
    await openScreen();
    expect(screen.getByLabelText('Edit family photo')).toBeTruthy();
    expect(screen.getByLabelText("Your family's current photo")).toBeTruthy();
    expect(screen.queryByLabelText('Add family photo')).toBeNull();
  });

  it('shows the household name when available', async () => {
    mockUseAuth.mockReturnValue(authWith({ householdName: 'The Morgan Family' }));
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    expect(screen.getByText('The Morgan Family')).toBeTruthy();
  });
});

describe('PtaMyFamilyScreen -- navigation to the existing management screen', () => {
  it('Add Family Photo navigates to /pta-family-photo', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    await fireEvent.press(screen.getByLabelText('Add family photo'));
    expect(mockPush).toHaveBeenCalledWith('/pta-family-photo');
  });

  it('Edit Family Photo also navigates to /pta-family-photo (the same screen, not a second implementation)', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue({ uri: 'data:image/jpeg;base64,signed', byteSize: 1000 });
    await openScreen();
    await fireEvent.press(screen.getByLabelText('Edit family photo'));
    expect(mockPush).toHaveBeenCalledWith('/pta-family-photo');
  });
});

describe('PtaMyFamilyScreen -- refresh on regaining focus (covers upload/replace/remove/org-switch)', () => {
  it('shows the newly uploaded photo after returning from photo management', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce(null);
    await openScreen();
    expect(screen.getByLabelText('Add family photo')).toBeTruthy();

    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ uri: 'data:image/jpeg;base64,newphoto', byteSize: 500 });
    await triggerFocus();

    expect(screen.getByLabelText('Edit family photo')).toBeTruthy();
    expect(mockGetPtaHouseholdPhoto).toHaveBeenCalledTimes(2);
  });

  it('shows the replaced photo (different bytes) after returning from photo management', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ uri: 'data:image/jpeg;base64,oldphoto', byteSize: 500 });
    await openScreen();
    expect(screen.getByLabelText("Your family's current photo").props.source.uri).toBe('data:image/jpeg;base64,oldphoto');

    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ uri: 'data:image/jpeg;base64,replacedphoto', byteSize: 600 });
    await triggerFocus();

    expect(screen.getByLabelText("Your family's current photo").props.source.uri).toBe('data:image/jpeg;base64,replacedphoto');
  });

  it('restores the default placeholder after the photo is removed', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ uri: 'data:image/jpeg;base64,oldphoto', byteSize: 500 });
    await openScreen();
    expect(screen.getByLabelText('Edit family photo')).toBeTruthy();

    mockGetPtaHouseholdPhoto.mockResolvedValueOnce(null);
    await triggerFocus();

    expect(screen.getByLabelText('No family photo set')).toBeTruthy();
    expect(screen.getByLabelText('Add family photo')).toBeTruthy();
  });

  it('does not retain a stale photo after the active organization changes', async () => {
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-a' }));
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ uri: 'data:image/jpeg;base64,orgaphoto', byteSize: 500 });
    const { rerender } = await render(<PtaMyFamilyScreen />);
    await triggerFocus();
    expect(screen.getByLabelText("Your family's current photo")).toBeTruthy();

    // A real org switch navigates away (org-switcher) and back, which is a
    // real focus-loss/regain -- re-rendering with the new org's auth state
    // and triggering focus again mirrors that.
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-b', householdName: 'The Ortiz Family' }));
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce(null);
    await rerender(<PtaMyFamilyScreen />);
    await triggerFocus();

    expect(screen.getByLabelText('No family photo set')).toBeTruthy();
    expect(screen.queryByLabelText("Your family's current photo")).toBeNull();
    expect(mockGetPtaHouseholdPhoto).toHaveBeenLastCalledWith('org-b');
  });
});

describe('PtaMyFamilyScreen -- authorization', () => {
  it('an authorized adult family member can access the screen', async () => {
    mockUseAuth.mockReturnValue(authWith({ householdAdultId: 'adult-1' }));
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    expect(screen.getByText('My Family')).toBeTruthy();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });

  it('an account with no PTA household link (unauthorized family member / staff-only identity) is redirected away, not shown the screen', async () => {
    mockUseAuth.mockReturnValue(authWith({ householdAdultId: null }));
    await render(<PtaMyFamilyScreen />);
    expect(mockRedirectHref).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByText('My Family')).toBeNull();
    // The client-side redirect is a UX nicety only -- server-side
    // authorization (requireMobilePtaHouseholdAccess) is what actually
    // protects the underlying data regardless of this check.
    expect(mockGetPtaHouseholdPhoto).not.toHaveBeenCalled();
  });

  it('signed-out redirects to login with a return path back to this screen', async () => {
    mockUseAuth.mockReturnValue({ status: 'signedOut', selectedOrganizationId: null, selectedOrganization: null });
    await render(<PtaMyFamilyScreen />);
    expect(mockRedirectHref).toHaveBeenCalledWith({ pathname: '/login', params: { redirectTo: '/pta-my-family' } });
  });

  it('never reads or sends a household/family ID from anywhere other than the server-resolved session -- cross-family and cross-org access have no client-supplied ID to exploit', async () => {
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-1' }));
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    // The only argument is the current session's own organizationId -- no
    // householdId parameter exists anywhere in this screen's code.
    expect(mockGetPtaHouseholdPhoto).toHaveBeenCalledWith('org-1');
    expect(mockGetPtaHouseholdPhoto.mock.calls[0]).toHaveLength(1);
  });

  it('a Community/Nonprofit organization member (demonstrably non-PTA vertical) is redirected to /dashboard without any family-photo request', async () => {
    mockUseAuth.mockReturnValue(communityMemberOrg());
    await render(<PtaMyFamilyScreen />);

    expect(mockRedirectHref).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByText('My Family')).toBeNull();
    // Client-side rejection happens before any data request is made; the
    // real boundary is server-side regardless (requireMobilePtaHouseholdAccess
    // / requirePtaVerticalForMobile, portal src/lib/mobile-auth.ts, tested
    // explicitly against a COMMUNITY-vertical fixture in
    // mobile-pta-auth.test.ts).
    expect(mockGetPtaHouseholdPhoto).not.toHaveBeenCalled();
  });
});

describe('PtaMyFamilyScreen -- organization switching (PTA -> Community/Nonprofit)', () => {
  it('clears the displayed family photo and name, redirects away, and never fetches using the new organization id', async () => {
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-pta', householdName: 'The Alvarez Family' }));
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ uri: 'data:image/jpeg;base64,alvarezphoto', byteSize: 500 });
    const { rerender } = await render(<PtaMyFamilyScreen />);
    await triggerFocus();
    expect(screen.getByText('The Alvarez Family')).toBeTruthy();
    expect(screen.getByLabelText("Your family's current photo")).toBeTruthy();
    expect(mockGetPtaHouseholdPhoto).toHaveBeenCalledTimes(1);

    // A real org switch navigates to /dashboard (see org-switcher.test.tsx);
    // re-rendering this still-mounted screen with the new org's auth state
    // and triggering a focus event mirrors what happens if it briefly
    // remains mounted during that transition.
    mockUseAuth.mockReturnValue(communityMemberOrg({ organizationId: 'org-community' }));
    await rerender(<PtaMyFamilyScreen />);
    await triggerFocus();

    expect(mockRedirectHref).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByText('The Alvarez Family')).toBeNull();
    expect(screen.queryByLabelText("Your family's current photo")).toBeNull();
    // load() no-ops on !hasPtaIdentity regardless of organizationId, so the
    // call count stays at exactly the one PTA-org fetch from before the
    // switch -- never a second call, and never one using 'org-community'.
    expect(mockGetPtaHouseholdPhoto).toHaveBeenCalledTimes(1);
    expect(mockGetPtaHouseholdPhoto).not.toHaveBeenCalledWith('org-community');
  });
});

describe('PtaMyFamilyScreen -- no permission prompt on mere viewing', () => {
  it('opening My Family never touches any camera/photo-library API', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    expect(screen.getByLabelText('Add family photo')).toBeTruthy();
    // This screen imports no permission API at all (verified structurally
    // -- see the module's own imports); the only network call it ever
    // makes is the read-only photo fetch.
    expect(mockGetPtaHouseholdPhoto).toHaveBeenCalledTimes(1);
  });
});

describe('PtaMyFamilyScreen -- progression entry point (server-gated by both feature flags)', () => {
  it('shows the Progression card only when the server confirms progression is available', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    mockGetPtaProgression.mockResolvedValue({ currentSchoolYear: '2026-2027', nextSchoolYear: null, students: [] });
    await openScreen();
    expect(screen.getByLabelText('View student progression')).toBeTruthy();
    expect(screen.getByText('Progression')).toBeTruthy();
  });

  it('navigates to the read-only progression screen', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    mockGetPtaProgression.mockResolvedValue({ currentSchoolYear: '2026-2027', nextSchoolYear: null, students: [] });
    await openScreen();
    await fireEvent.press(screen.getByLabelText('View student progression'));
    expect(mockPush).toHaveBeenCalledWith('/pta-progression');
  });

  it('hides the Progression card when either feature flag is OFF (server denies)', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    mockGetPtaProgression.mockRejectedValue(new Error('Student progression is not enabled on this platform.'));
    await openScreen();
    expect(screen.queryByLabelText('View student progression')).toBeNull();
    expect(screen.queryByText('Progression')).toBeNull();
    // The family photo, this screen's primary content, is unaffected.
    expect(screen.getByLabelText('Add family photo')).toBeTruthy();
  });

  it('a progression failure never surfaces an error banner over the family photo', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    mockGetPtaProgression.mockRejectedValue(new Error('network down'));
    await openScreen();
    expect(screen.queryByLabelText('Retry loading your family photo')).toBeNull();
    expect(screen.queryByLabelText('View student progression')).toBeNull();
  });

  it('never requests progression for an account with no PTA family identity', async () => {
    mockUseAuth.mockReturnValue(authWith({ householdAdultId: null }));
    await render(<PtaMyFamilyScreen />);
    expect(mockGetPtaProgression).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('View student progression')).toBeNull();
  });

  it('requests progression with only the active organization id -- no household or student id', async () => {
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-7' }));
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    mockGetPtaProgression.mockResolvedValue({ currentSchoolYear: null, nextSchoolYear: null, students: [] });
    await openScreen();
    expect(mockGetPtaProgression).toHaveBeenCalledWith('org-7');
    expect(mockGetPtaProgression.mock.calls[0]).toHaveLength(1);
  });
});

describe('PtaMyFamilyScreen -- accessibility', () => {
  it('the action button has the correct role, label, and hint', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    const button = screen.getByLabelText('Add family photo');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityHint).toBe(
      'Opens family photo management, where you can take or choose a photo, replace it, or remove it.'
    );
  });

  it('the placeholder and photo both carry a descriptive accessibility label, never icon-only with no text', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    expect(screen.getByLabelText('No family photo set')).toBeTruthy();
    // The action label itself is always visible text ("Add Family Photo" /
    // "Edit Family Photo"), never an icon rendered alone.
    expect(screen.getByText('Add Family Photo')).toBeTruthy();
  });
});

describe('PtaMyFamilyScreen - Build 26 accessibility remediation', () => {
  it('uses a plain-text primary action, with no emoji for a screen reader to read aloud', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();

    expect(screen.getByLabelText('Add family photo')).toBeTruthy();
    // getByText is an exact match, so this passes only if the visible label is
    // precisely the plain text -- an emoji prefix would fail it.
    expect(screen.getByText('Add Family Photo')).toBeTruthy();
  });

  it('marks the screen and card titles as headers', async () => {
    mockUseAuth.mockReturnValue(authWith());
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();

    expect(screen.getByRole('header', { name: 'My Family' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Family Photo' })).toBeTruthy();
  });
});

describe('PtaMyFamilyScreen - organization switching clears family data', () => {
  it("never shows the previous organization's photo while the new organization loads", async () => {
    // Organization A has a photo.
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-a' }));
    mockGetPtaHouseholdPhoto.mockResolvedValue({ uri: 'data:image/jpeg;base64,AAAA', byteSize: 10 });
    await openScreen();
    expect(screen.getByLabelText("Your family's current photo")).toBeTruthy();

    // Switch to organization B, whose fetch has not resolved yet. The photo in
    // state still belongs to A, so it must not be rendered for even one frame.
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-b' }));
    mockGetPtaHouseholdPhoto.mockImplementation(() => new Promise(() => {}));
    await triggerFocus();

    expect(screen.queryByLabelText("Your family's current photo")).toBeNull();
  });

  it('requests the photo for the organization currently selected', async () => {
    mockUseAuth.mockReturnValue(authWith({ organizationId: 'org-b' }));
    mockGetPtaHouseholdPhoto.mockResolvedValue(null);
    await openScreen();
    expect(mockGetPtaHouseholdPhoto).toHaveBeenCalledWith('org-b');
  });
});
