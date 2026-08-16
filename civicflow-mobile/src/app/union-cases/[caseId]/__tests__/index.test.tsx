import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/lib/api-client';
import UnionCaseDetailScreen from '../index';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ caseId: 'case-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetUnionCase = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getUnionCase: (...args: unknown[]) => mockGetUnionCase(...args),
}));

function unionCase(overrides: Partial<{ resolutionSummary: string | null; representativeName: string | null; comments: { id: string; body: string; createdAt: string }[]; upcomingDates: { id: string; deadlineType: string; description: string | null; dueAt: string }[] }> = {}) {
  return {
    id: 'case-1',
    caseNumber: 42,
    caseType: 'Grievance',
    title: 'Unpaid overtime',
    description: 'Filed after three unpaid shifts in July.',
    status: 'ACTIVE',
    isFormalGrievance: false,
    representationRequested: true,
    incidentDate: null,
    openedAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: null,
    resolutionSummary: overrides.resolutionSummary ?? null,
    closedAt: null,
    assignedToOrgMemberId: null,
    representativeName: overrides.representativeName ?? null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    comments: overrides.comments ?? [],
    upcomingDates: overrides.upcomingDates ?? [],
  };
}

describe('Union case detail', () => {
  beforeEach(() => {
    mockGetUnionCase.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-union' });
  });

  it('shows the case title, description, and representation request', async () => {
    mockGetUnionCase.mockResolvedValue(unionCase());

    await render(<UnionCaseDetailScreen />);

    await waitFor(() => expect(screen.getByText('UC-42 · Unpaid overtime')).toBeTruthy());
    expect(screen.getByText('Filed after three unpaid shifts in July.')).toBeTruthy();
    expect(screen.getByText('You asked for a representative on this case.')).toBeTruthy();
    expect(mockGetUnionCase).toHaveBeenCalledWith('org-union', 'case-1');
  });

  it('shows member-visible updates when present', async () => {
    mockGetUnionCase.mockResolvedValue(
      unionCase({ comments: [{ id: 'c1', body: 'A steward has been assigned.', createdAt: '2026-08-02T00:00:00.000Z' }] })
    );

    await render(<UnionCaseDetailScreen />);

    await waitFor(() => expect(screen.getByText('A steward has been assigned.')).toBeTruthy());
  });

  it('shows the assigned Union Representative when present', async () => {
    mockGetUnionCase.mockResolvedValue(unionCase({ representativeName: 'Jordan Reyes' }));

    await render(<UnionCaseDetailScreen />);

    await waitFor(() => expect(screen.getByText('Union Representative: Jordan Reyes')).toBeTruthy());
  });

  it('shows a not-found message for a case the caller cannot access', async () => {
    mockGetUnionCase.mockRejectedValue(new ApiError('Not found', 404));

    await render(<UnionCaseDetailScreen />);

    await waitFor(() => expect(screen.getByText('This case could not be found.')).toBeTruthy());
  });
});
