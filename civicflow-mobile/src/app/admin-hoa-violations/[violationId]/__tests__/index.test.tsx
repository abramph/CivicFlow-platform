import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminHoaViolationDetailScreen from '../index';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ violationId: 'violation-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaViolation = jest.fn();
const mockIssueAdminHoaViolation = jest.fn();
const mockTransitionAdminHoaViolation = jest.fn();
const mockAddAdminHoaViolationComment = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaViolation: (...a: unknown[]) => mockGetAdminHoaViolation(...a),
  issueAdminHoaViolation: (...a: unknown[]) => mockIssueAdminHoaViolation(...a),
  transitionAdminHoaViolation: (...a: unknown[]) => mockTransitionAdminHoaViolation(...a),
  addAdminHoaViolationComment: (...a: unknown[]) => mockAddAdminHoaViolationComment(...a),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample HOA', capability: { adminCapabilities } },
  };
}

function violation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'violation-1',
    violationType: 'Fence height',
    status: 'DRAFT',
    cureByDate: null,
    issuedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    description: 'Fence exceeds 6 feet',
    resolvedAt: null,
    resolutionNotes: null,
    notices: [],
    comments: [],
    statusHistory: [],
    property: { id: 'property-1', addressLine1: '123 Main St', unitLabel: null, displayName: null },
    ...overrides,
  };
}

beforeEach(() => {
  mockGetAdminHoaViolation.mockReset();
  mockIssueAdminHoaViolation.mockReset();
  mockTransitionAdminHoaViolation.mockReset();
  mockAddAdminHoaViolationComment.mockReset();
  alertSpy.mockClear();
});

describe('Admin HOA violation detail screen', () => {
  it('shows a denial state and never fetches without manageHoaViolations', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminHoaViolationDetailScreen />);

    await waitFor(() => expect(screen.getByText("You don't have violation administration access for this organization.")).toBeTruthy());
    expect(mockGetAdminHoaViolation).not.toHaveBeenCalled();
  });

  it('shows an Issue action for a DRAFT violation', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation());

    await render(<AdminHoaViolationDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Issue violation')).toBeTruthy());
  });

  it('issues the violation with a notice body', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation());
    mockIssueAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ISSUED' }));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ISSUED' }));

    await render(<AdminHoaViolationDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Issue violation')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Issue violation'));
    await fireEvent.changeText(screen.getByLabelText('Notice text'), 'You are in violation of the fence height rule.');
    await fireEvent.press(screen.getByLabelText('Confirm issue'));

    await waitFor(() => expect(mockIssueAdminHoaViolation).toHaveBeenCalledWith('violation-1', 'org-a', 'You are in violation of the fence height rule.'));
  });

  it('offers only the valid next statuses for an ISSUED violation', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ISSUED' }));

    await render(<AdminHoaViolationDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Acknowledged')).toBeTruthy());
    expect(screen.getByLabelText('In Review')).toBeTruthy();
    expect(screen.getByLabelText('Cured')).toBeTruthy();
    expect(screen.getByLabelText('Dismissed')).toBeTruthy();
    expect(screen.queryByLabelText('Resolved')).toBeNull();
  });

  it('transitions to the selected status after confirmation', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ISSUED' }));
    mockTransitionAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ACKNOWLEDGED' }));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ACKNOWLEDGED' }));

    await render(<AdminHoaViolationDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Acknowledged')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Acknowledged'));
    await fireEvent.press(screen.getByLabelText('Confirm move to Acknowledged'));

    await waitFor(() =>
      expect(mockTransitionAdminHoaViolation).toHaveBeenCalledWith('violation-1', 'org-a', 'ACKNOWLEDGED', expect.objectContaining({}))
    );
  });

  it('shows no status-change options for a terminal violation', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'RESOLVED' }));

    await render(<AdminHoaViolationDetailScreen />);

    await waitFor(() => expect(screen.getByText('Fence height')).toBeTruthy());
    expect(screen.queryByText('Change Status')).toBeNull();
  });

  it('posts a private-by-default comment', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ISSUED' }));
    mockAddAdminHoaViolationComment.mockResolvedValueOnce({ id: 'comment-1', body: 'Spoke with resident', isPrivate: true });
    mockGetAdminHoaViolation.mockResolvedValueOnce(violation({ status: 'ISSUED' }));

    await render(<AdminHoaViolationDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add a comment')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Spoke with resident');
    await fireEvent.press(screen.getByLabelText('Post comment'));

    await waitFor(() => expect(mockAddAdminHoaViolationComment).toHaveBeenCalledWith('violation-1', 'org-a', 'Spoke with resident', true));
  });
});
