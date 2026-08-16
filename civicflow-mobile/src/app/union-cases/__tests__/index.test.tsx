import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import UnionCasesScreen from '../index';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetUnionCases = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getUnionCases: (...args: unknown[]) => mockGetUnionCases(...args),
}));

function unionCase(overrides: Partial<{ id: string; caseNumber: number; title: string; status: string; createdAt: string }> = {}) {
  return {
    id: overrides.id ?? 'case-1',
    caseNumber: overrides.caseNumber ?? 42,
    caseType: 'Grievance',
    title: overrides.title ?? 'Unpaid overtime',
    description: 'Details here.',
    status: overrides.status ?? 'ACTIVE',
    isFormalGrievance: false,
    representationRequested: false,
    incidentDate: null,
    openedAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: null,
    resolutionSummary: null,
    closedAt: null,
    assignedToOrgMemberId: null,
    createdAt: overrides.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    comments: [],
    upcomingDates: [],
  };
}

describe('Union My Cases list', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockGetUnionCases.mockReset();
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-union',
      selectedOrganization: { organizationName: 'Unestra Demo Union' },
    });
  });

  it('lists the caller\'s own cases, never a fabricated web fallback', async () => {
    mockGetUnionCases.mockResolvedValue([unionCase({ id: 'case-1', caseNumber: 42, title: 'Unpaid overtime' })]);

    await render(<UnionCasesScreen />);

    await waitFor(() => expect(screen.getByText('UC-42 · Unpaid overtime')).toBeTruthy());
    expect(mockGetUnionCases).toHaveBeenCalledWith('org-union');
  });

  it('shows an empty state when the caller has no cases', async () => {
    mockGetUnionCases.mockResolvedValue([]);

    await render(<UnionCasesScreen />);

    await waitFor(() => expect(screen.getByText('No cases yet.')).toBeTruthy());
  });

  it('navigates to the case detail screen on tap', async () => {
    mockGetUnionCases.mockResolvedValue([unionCase({ id: 'case-7', caseNumber: 7, title: 'Schedule dispute' })]);

    await render(<UnionCasesScreen />);
    await waitFor(() => expect(screen.getByText('UC-7 · Schedule dispute')).toBeTruthy());

    fireEvent.press(screen.getByLabelText(/UC-7, Schedule dispute/));

    expect(mockRouterPush).toHaveBeenCalledWith('/union-cases/case-7');
  });
});
