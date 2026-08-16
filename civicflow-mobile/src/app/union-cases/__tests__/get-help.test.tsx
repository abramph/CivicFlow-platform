import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/lib/api-client';
import GetUnionHelpScreen from '../get-help';

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateUnionCase = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createUnionCase: (...args: unknown[]) => mockCreateUnionCase(...args),
  UNION_CASE_TYPES: [
    { value: 'GENERAL_ISSUE', label: 'Something else going on' },
    { value: 'DISCIPLINE', label: 'Discipline or write-up' },
    { value: 'SAFETY', label: 'Safety concern' },
    { value: 'CONTRACT_VIOLATION', label: 'Contract violation' },
    { value: 'SCHEDULING', label: 'Scheduling or hours' },
    { value: 'HARASSMENT', label: 'Harassment or mistreatment' },
    { value: 'GRIEVANCE', label: 'I want to file a grievance' },
    { value: 'OTHER', label: 'Other' },
  ],
}));

function createdCase(overrides: Partial<{ id: string; caseNumber: number; createdAt: string }> = {}) {
  return {
    id: overrides.id ?? 'case-new',
    caseNumber: overrides.caseNumber ?? 9,
    caseType: 'GENERAL_ISSUE',
    title: 'Overtime not paid',
    description: 'Worked extra hours, never got paid.',
    status: 'NEW',
    isFormalGrievance: false,
    representationRequested: false,
    incidentDate: null,
    openedAt: '2026-08-16T00:00:00.000Z',
    resolvedAt: null,
    resolutionSummary: null,
    closedAt: null,
    assignedToOrgMemberId: null,
    representativeName: null,
    createdAt: overrides.createdAt ?? '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    comments: [],
    upcomingDates: [],
  };
}

describe('Get Union Help intake', () => {
  beforeEach(() => {
    mockRouterReplace.mockReset();
    mockCreateUnionCase.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-union' });
  });

  it('leads with approachable, non-legalistic language rather than "File a Grievance"', async () => {
    await render(<GetUnionHelpScreen />);

    expect(screen.getByText('How can your union help?')).toBeTruthy();
    expect(screen.queryByText(/^File a Grievance$/)).toBeNull();
  });

  it('blocks submission with a clear message when subject or description is empty', async () => {
    await render(<GetUnionHelpScreen />);

    await fireEvent.press(screen.getByLabelText('Send to your union'));

    await waitFor(() => expect(screen.getByText("Add a short subject and tell us what happened.")).toBeTruthy());
    expect(mockCreateUnionCase).not.toHaveBeenCalled();
  });

  it('submits an intake scoped to the org, shows a confirmation with reference/date/status, and navigates to the case on View Case (never auto-filing a grievance)', async () => {
    mockCreateUnionCase.mockResolvedValue(createdCase({ id: 'case-new', caseNumber: 9, createdAt: '2026-08-16T00:00:00.000Z' }));

    await render(<GetUnionHelpScreen />);

    await fireEvent.changeText(screen.getByLabelText('Brief subject'), 'Overtime not paid');
    await fireEvent.changeText(screen.getByLabelText('Tell us what happened'), 'Worked extra hours, never got paid.');
    await fireEvent.press(screen.getByLabelText('Send to your union'));

    await waitFor(() => expect(screen.getByText('Your request has been sent to your union.')).toBeTruthy());
    expect(mockCreateUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-union',
        caseType: 'GENERAL_ISSUE',
        title: 'Overtime not paid',
        description: 'Worked extra hours, never got paid.',
      })
    );
    expect(screen.getByText('UC-9')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('View case'));
    expect(mockRouterReplace).toHaveBeenCalledWith('/union-cases/case-new');
  });

  it('surfaces a server error message instead of a silent failure', async () => {
    mockCreateUnionCase.mockRejectedValue(new ApiError('Union Case Center is not enabled for this organization.', 403));

    await render(<GetUnionHelpScreen />);

    await fireEvent.changeText(screen.getByLabelText('Brief subject'), 'Overtime not paid');
    await fireEvent.changeText(screen.getByLabelText('Tell us what happened'), 'Worked extra hours, never got paid.');
    await fireEvent.press(screen.getByLabelText('Send to your union'));

    await waitFor(() => expect(screen.getByText('Union Case Center is not enabled for this organization.')).toBeTruthy());
  });
});
