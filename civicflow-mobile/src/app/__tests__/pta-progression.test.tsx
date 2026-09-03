import { act, render, screen } from '@testing-library/react-native';

import PtaProgressionScreen from '../pta-progression';

/**
 * Read-only family progression screen. Covers display states, the
 * publication rule as the family experiences it, authorization gating,
 * cross-vertical isolation, feature-flag behavior, organization switching,
 * and accessibility.
 *
 * useFocusEffect is mocked as a plain, hook-free callback capturer; each
 * test triggers the initial "focus" itself via openScreen(), and can
 * trigger another via triggerFocus() to simulate returning to the screen
 * or switching organization. Same pattern as pta-my-family.test.tsx.
 */

const mockRedirectHref = jest.fn();
let latestFocusCallback: (() => void | (() => void)) | null = null;
const mockUseFocusEffect = jest.fn((callback: () => void | (() => void)) => {
  latestFocusCallback = callback;
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
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

const mockGetPtaProgression = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaProgression: (...args: unknown[]) => mockGetPtaProgression(...args),
}));

jest.mock('@/lib/api-client', () => ({
  // Plain class, no TypeScript parameter properties: Jest's mock factory
  // treats a `readonly status: number` constructor parameter as an
  // out-of-scope variable reference and refuses to hoist it.
  ApiError: class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
// The screen narrows with `instanceof ApiError` against the mocked class,
// so errors thrown in tests must be built from that same mocked class.
const { ApiError } = jest.requireMock('@/lib/api-client') as {
  ApiError: new (message: string, status: number) => Error & { status: number };
};

function ptaAuth(overrides: { householdAdultId?: string | null; organizationId?: string } = {}) {
  return {
    status: 'signedIn' as const,
    selectedOrganizationId: overrides.organizationId ?? 'org-pta',
    selectedOrganization: {
      organizationId: overrides.organizationId ?? 'org-pta',
      organizationName: 'Pine Grove School PTA',
      pta:
        overrides.householdAdultId === null
          ? null
          : { householdAdultId: overrides.householdAdultId ?? 'adult-1', householdName: 'The Kim Family' },
    },
  };
}

/** A demonstrably Community/Nonprofit organization — capability.
 * primaryVertical is the field this app's own vertical gating keys off. */
function communityAuth() {
  return {
    status: 'signedIn' as const,
    selectedOrganizationId: 'org-community',
    selectedOrganization: {
      organizationId: 'org-community',
      organizationName: 'Riverdale Community Association',
      pta: null,
      capability: { primaryVertical: 'COMMUNITY' },
    },
  };
}

function churchAuth() {
  return {
    status: 'signedIn' as const,
    selectedOrganizationId: 'org-church',
    selectedOrganization: {
      organizationId: 'org-church',
      organizationName: 'Grace Chapel',
      pta: null,
      capability: { primaryVertical: 'CHURCH' },
    },
  };
}

function unionAuth() {
  return {
    status: 'signedIn' as const,
    selectedOrganizationId: 'org-union',
    selectedOrganization: {
      organizationId: 'org-union',
      organizationName: 'Lakeside Union',
      pta: null,
      capability: { primaryVertical: 'UNION' },
    },
  };
}

function summary(students: unknown[], years: { current?: string | null; next?: string | null } = {}) {
  return {
    currentSchoolYear: years.current ?? '2026-2027',
    nextSchoolYear: years.next === undefined ? '2027-2028' : years.next,
    students,
  };
}

function student(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 's-1',
    displayName: 'Ada Kim',
    currentGrade: '5th Grade',
    currentClassroom: 'Room 12',
    nextGrade: null,
    nextClassroom: null,
    status: 'NOT_YET_AVAILABLE',
    ...overrides,
  };
}

async function triggerFocus() {
  await act(async () => {
    latestFocusCallback?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openScreen() {
  await render(<PtaProgressionScreen />);
  await triggerFocus();
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks clears calls but NOT implementations, so a
  // mockImplementation/mockReturnValue set by one test would otherwise leak
  // into the next. Reset this one explicitly (a blanket resetAllMocks would
  // also wipe the module-level useFocusEffect capturer).
  mockGetPtaProgression.mockReset();
  latestFocusCallback = null;
});

describe('PtaProgressionScreen — display states', () => {
  it('shows a confirmed next-year placement as "current → next" with a Confirmed badge', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(
      summary([student({ nextGrade: '6th Grade', nextClassroom: 'Room 20', status: 'CONFIRMED' })])
    );
    await openScreen();
    expect(screen.getByText('5th Grade → 6th Grade')).toBeTruthy();
    expect(screen.getByText('Next class: Room 20')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('shows the exact unavailable message when there is no publishable next-year placement', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student({ currentGrade: '2nd Grade' })]));
    await openScreen();
    expect(screen.getByText('2nd Grade')).toBeTruthy();
    expect(screen.getByText('Next-year placement is not yet available.')).toBeTruthy();
    expect(screen.getByText('Not yet available')).toBeTruthy();
  });

  it('always shows the family continuity statement', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student()]));
    await openScreen();
    expect(screen.getByText('Your family account and history stay connected each school year.')).toBeTruthy();
  });

  it('renders multiple children progressing differently, in the order the server returned', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(
      summary([
        student({ studentId: 's-a', displayName: 'Ada Kim', nextGrade: '6th Grade', status: 'CONFIRMED' }),
        student({ studentId: 's-b', displayName: 'Ben Kim', currentGrade: '2nd Grade' }),
      ])
    );
    await openScreen();
    expect(screen.getByText('Ada Kim')).toBeTruthy();
    expect(screen.getByText('Ben Kim')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('Not yet available')).toBeTruthy();
  });

  it('handles a student with no current placement on file', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student({ currentGrade: null, currentClassroom: null })]));
    await openScreen();
    expect(screen.getByText('No current placement on file.')).toBeTruthy();
  });

  it('shows an empty state for a family with no students', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([]));
    await openScreen();
    expect(screen.getByText('No students are on file for your family yet.')).toBeTruthy();
  });

  it('falls back to the current school year heading when no next year exists', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student({ status: 'COMPLETED' })], { next: null }));
    await openScreen();
    expect(screen.getByText('2026-2027 school year')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('tolerates a missing academic year entirely', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student()], { current: null, next: null }));
    await openScreen();
    expect(screen.getByText('Student Progression')).toBeTruthy();
  });
});

describe('PtaProgressionScreen — read-only guarantee', () => {
  it('renders no administrative action of any kind', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(
      summary([student({ nextGrade: '6th Grade', status: 'CONFIRMED' })])
    );
    await openScreen();
    for (const forbidden of [
      /commit/i,
      /approve/i,
      /correct/i,
      /exclude/i,
      /retain/i,
      /withdraw/i,
      /transfer/i,
      /roll ?back/i,
      /preview/i,
      /needs review/i,
    ]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('makes exactly one read call and no mutation call', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student()]));
    await openScreen();
    expect(mockGetPtaProgression).toHaveBeenCalledTimes(1);
    expect(mockGetPtaProgression).toHaveBeenCalledWith('org-pta');
    // One argument only — no student or household id is ever client-supplied.
    expect(mockGetPtaProgression.mock.calls[0]).toHaveLength(1);
  });
});

describe('PtaProgressionScreen — authorization and cross-vertical isolation', () => {
  it('an authorized PTA family can view the screen', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student()]));
    await openScreen();
    expect(screen.getByText('Student Progression')).toBeTruthy();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });

  it('a staff-only identity with no PTA family is redirected without any progression request', async () => {
    mockUseAuth.mockReturnValue(ptaAuth({ householdAdultId: null }));
    await render(<PtaProgressionScreen />);
    expect(mockRedirectHref).toHaveBeenCalledWith('/dashboard');
    expect(mockGetPtaProgression).not.toHaveBeenCalled();
  });

  it.each([
    ['Community/Nonprofit', communityAuth],
    ['Church', churchAuth],
    ['Union', unionAuth],
  ])('a %s organization cannot reach the screen and triggers no request', async (_label, auth) => {
    mockUseAuth.mockReturnValue(auth());
    await render(<PtaProgressionScreen />);
    expect(mockRedirectHref).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByText('Student Progression')).toBeNull();
    expect(mockGetPtaProgression).not.toHaveBeenCalled();
  });

  it('signed-out redirects to login with a return path', async () => {
    mockUseAuth.mockReturnValue({ status: 'signedOut', selectedOrganizationId: null, selectedOrganization: null });
    await render(<PtaProgressionScreen />);
    expect(mockRedirectHref).toHaveBeenCalledWith({
      pathname: '/login',
      params: { redirectTo: '/pta-progression' },
    });
  });
});

describe('PtaProgressionScreen — feature flags and failure handling', () => {
  it('shows the unavailable state, with no retry, when the server denies (either flag OFF)', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockRejectedValue(new ApiError('Student progression is not enabled on this platform.', 403));
    await openScreen();
    expect(screen.getByText('Student progression is not available for this organization.')).toBeTruthy();
    expect(screen.queryByLabelText('Retry loading')).toBeNull();
    // The refusal reason is never echoed to the family.
    expect(screen.queryByText(/platform/i)).toBeNull();
  });

  it('shows a retryable error for a network failure, and recovers on retry', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockRejectedValueOnce(new ApiError('Network request failed.', 0));
    await openScreen();
    expect(screen.getByText('Unable to load student progression. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByLabelText('Retry loading')).toBeTruthy();

    mockGetPtaProgression.mockResolvedValueOnce(summary([student({ nextGrade: '6th Grade', status: 'CONFIRMED' })]));
    await triggerFocus();
    expect(screen.getByText('5th Grade → 6th Grade')).toBeTruthy();
  });

  it('shows a retryable error for a server error (5xx)', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockRejectedValue(new ApiError('Request failed', 500));
    await openScreen();
    expect(screen.getByLabelText('Retry loading')).toBeTruthy();
  });
});

describe('PtaProgressionScreen — organization switching', () => {
  it('clears the previous family\'s students and never refetches with the old organization id', async () => {
    mockUseAuth.mockReturnValue(ptaAuth({ organizationId: 'org-pta-a' }));
    mockGetPtaProgression.mockResolvedValueOnce(
      summary([student({ displayName: 'Ada Kim', nextGrade: '6th Grade', status: 'CONFIRMED' })])
    );
    const { rerender } = await render(<PtaProgressionScreen />);
    await triggerFocus();
    expect(screen.getByText('Ada Kim')).toBeTruthy();

    mockUseAuth.mockReturnValue(ptaAuth({ organizationId: 'org-pta-b' }));
    mockGetPtaProgression.mockResolvedValueOnce(summary([student({ studentId: 's-z', displayName: 'Zoe Ortiz' })]));
    await rerender(<PtaProgressionScreen />);
    await triggerFocus();

    expect(screen.getByText('Zoe Ortiz')).toBeTruthy();
    expect(screen.queryByText('Ada Kim')).toBeNull();
    expect(mockGetPtaProgression).toHaveBeenLastCalledWith('org-pta-b');
  });

  it('switching from a PTA org to a Community org clears prior students and stops fetching', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValueOnce(summary([student({ displayName: 'Ada Kim' })]));
    const { rerender } = await render(<PtaProgressionScreen />);
    await triggerFocus();
    expect(screen.getByText('Ada Kim')).toBeTruthy();

    mockGetPtaProgression.mockClear();
    mockUseAuth.mockReturnValue(communityAuth());
    await rerender(<PtaProgressionScreen />);
    await triggerFocus();

    expect(screen.queryByText('Ada Kim')).toBeNull();
    expect(mockRedirectHref).toHaveBeenCalledWith('/dashboard');
    expect(mockGetPtaProgression).not.toHaveBeenCalled();
  });
});

describe('PtaProgressionScreen — accessibility', () => {
  it('gives each child one coherent spoken sentence rather than disconnected fragments', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(
      summary([student({ nextGrade: '6th Grade', nextClassroom: 'Room 20', status: 'CONFIRMED' })])
    );
    await openScreen();
    expect(
      screen.getByLabelText('Ada Kim, currently 5th Grade, in Room 12, next year 6th Grade in Room 20, Confirmed')
    ).toBeTruthy();
  });

  it('announces the unavailable case in the spoken label too', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student()]));
    await openScreen();
    expect(
      screen.getByLabelText(
        'Ada Kim, currently 5th Grade, in Room 12, Next-year placement is not yet available., Not yet available'
      )
    ).toBeTruthy();
  });

  it('labels the loading state for screen readers', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student()]));
    // `loading` initialises to true, so the indicator is present from the
    // first render -- asserted here WITHOUT triggering focus, deliberately.
    // Holding a fetch promise open to observe the spinner instead would
    // leave it pending across the test boundary and corrupt React 19's
    // process-global act() nesting counter, silently breaking the next
    // test's initial effect (the same failure mode documented in
    // dashboard.test.tsx). The loaded state is covered by every other test.
    await render(<PtaProgressionScreen />);
    expect(screen.getByLabelText('Loading student progression')).toBeTruthy();
  });

  it('renders status text, not an icon-only badge', async () => {
    mockUseAuth.mockReturnValue(ptaAuth());
    mockGetPtaProgression.mockResolvedValue(summary([student({ status: 'CURRENT' })]));
    await openScreen();
    expect(screen.getByText('Current')).toBeTruthy();
  });
});
