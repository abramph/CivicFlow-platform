import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CasesScreen from '../cases';

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

function unionCase(overrides: Partial<{
  id: string;
  caseNumber: number;
  title: string;
  status: string;
  representativeName: string | null;
  comments: { id: string; body: string; createdAt: string }[];
  upcomingDates: { id: string; deadlineType: string; description: string | null; dueAt: string }[];
}> = {}) {
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
    representativeName: overrides.representativeName ?? null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    comments: overrides.comments ?? [],
    upcomingDates: overrides.upcomingDates ?? [],
  };
}

describe('Union Cases tab', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockGetUnionCases.mockReset();
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-union',
      selectedOrganization: { organizationName: 'Unestra Demo Union' },
    });
  });

  it('always shows the Get Help entry point above the case list', async () => {
    mockGetUnionCases.mockResolvedValue([]);

    await render(<CasesScreen />);

    await waitFor(() => expect(screen.getByLabelText('Get Union Help')).toBeTruthy());
  });

  it('shows a purpose-explaining empty state with its own Get Help button when there are no cases', async () => {
    mockGetUnionCases.mockResolvedValue([]);

    await render(<CasesScreen />);

    await waitFor(() => expect(screen.getByText('No current cases')).toBeTruthy());
    expect(screen.getByLabelText('Get Help')).toBeTruthy();
  });

  it('navigates to the Get Help intake screen', async () => {
    mockGetUnionCases.mockResolvedValue([]);

    await render(<CasesScreen />);
    await waitFor(() => expect(screen.getByLabelText('Get Union Help')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Get Union Help'));

    expect(mockRouterPush).toHaveBeenCalledWith('/union-cases/get-help');
  });

  it('groups cases into Open, Awaiting Response, and Resolved sections', async () => {
    mockGetUnionCases.mockResolvedValue([
      unionCase({ id: 'case-1', caseNumber: 1, title: 'Active one', status: 'ACTIVE' }),
      unionCase({ id: 'case-2', caseNumber: 2, title: 'Waiting one', status: 'PENDING' }),
      unionCase({ id: 'case-3', caseNumber: 3, title: 'Closed one', status: 'CLOSED' }),
    ]);

    await render(<CasesScreen />);

    await waitFor(() => expect(screen.getByText('Open')).toBeTruthy());
    expect(screen.getByText('Awaiting Response')).toBeTruthy();
    expect(screen.getByText('Resolved')).toBeTruthy();
    expect(screen.getByText('UC-1 · Active one')).toBeTruthy();
    expect(screen.getByText('UC-2 · Waiting one')).toBeTruthy();
    expect(screen.getByText('UC-3 · Closed one')).toBeTruthy();
  });

  it('shows the assigned representative and most recent update on a case card', async () => {
    mockGetUnionCases.mockResolvedValue([
      unionCase({
        representativeName: 'Jordan Reyes',
        comments: [{ id: 'c1', body: 'A steward has been assigned.', createdAt: '2026-08-02T00:00:00.000Z' }],
      }),
    ]);

    await render(<CasesScreen />);

    await waitFor(() => expect(screen.getByText('Union Representative: Jordan Reyes')).toBeTruthy());
    expect(screen.getByText('A steward has been assigned.')).toBeTruthy();
  });

  it('navigates to case detail on tap', async () => {
    mockGetUnionCases.mockResolvedValue([unionCase({ id: 'case-7', caseNumber: 7, title: 'Schedule dispute' })]);

    await render(<CasesScreen />);
    await waitFor(() => expect(screen.getByText('UC-7 · Schedule dispute')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/UC-7, Schedule dispute/));

    expect(mockRouterPush).toHaveBeenCalledWith('/union-cases/case-7');
  });
});
