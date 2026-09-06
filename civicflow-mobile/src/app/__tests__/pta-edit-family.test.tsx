import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import PtaEditFamilyScreen from '../pta-edit-family';

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetMyPtaHousehold = jest.fn();
const mockGetMyPtaChangeRequests = jest.fn();
const mockGetMyPtaClassrooms = jest.fn();
const mockUpdateMyPtaAdult = jest.fn();
const mockUpdateMyPtaHouseholdInterests = jest.fn();
const mockSubmitPtaChangeRequest = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getMyPtaHousehold: (...args: unknown[]) => mockGetMyPtaHousehold(...args),
  getMyPtaChangeRequests: (...args: unknown[]) => mockGetMyPtaChangeRequests(...args),
  getMyPtaClassrooms: (...args: unknown[]) => mockGetMyPtaClassrooms(...args),
  updateMyPtaAdult: (...args: unknown[]) => mockUpdateMyPtaAdult(...args),
  updateMyPtaHouseholdInterests: (...args: unknown[]) => mockUpdateMyPtaHouseholdInterests(...args),
  submitPtaChangeRequest: (...args: unknown[]) => mockSubmitPtaChangeRequest(...args),
}));

jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function household() {
  return {
    householdId: 'hh-1',
    displayName: 'Kim Family',
    schoolYear: '2026-2027',
    currentSchoolYear: '2026-2027',
    volunteerInterests: ['Book fair'],
    adults: [
      { id: 'adult-self', name: 'Casey Kim', email: 'casey@example.org', phone: null, relationshipLabel: 'Mom', hasLogin: true, isSelf: true },
      { id: 'adult-2', name: 'Jordan Kim', email: null, phone: null, relationshipLabel: 'Dad', hasLogin: false, isSelf: false },
    ],
    students: [
      { id: 'stu-1', displayName: 'Riley Kim', status: 'ACTIVE', hasPhoto: false, placementLabel: '3rd Grade · Room 12' },
    ],
  };
}

function parentAuth() {
  return {
    status: 'signedIn',
    selectedOrganizationId: 'org-pta',
    selectedOrganization: {
      organizationId: 'org-pta',
      pta: { householdAdultId: 'adult-self', householdName: 'Kim Family', isOfficer: false, canCheckIn: false, canApproveHours: false },
    },
  };
}

describe('Edit Family — Build 27 parent-managed information', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(parentAuth());
    mockGetMyPtaHousehold.mockResolvedValue(household());
    mockGetMyPtaChangeRequests.mockResolvedValue([]);
    mockGetMyPtaClassrooms.mockResolvedValue({
      currentSchoolYear: '2026-2027',
      classrooms: [{ id: 'room-12', name: 'Room 12', gradeName: '3rd Grade' }, { id: 'room-14', name: 'Room 14', gradeName: '4th Grade' }],
    });
    mockUpdateMyPtaAdult.mockResolvedValue({});
    mockSubmitPtaChangeRequest.mockResolvedValue({ id: 'req-1', type: 'RENAME_STUDENT', status: 'SUBMITTED', createdAt: '2026-09-06T00:00:00.000Z' });
  });

  it("prefills the caller's OWN contact row and saves it directly — no review queue for personal contact data", async () => {
    await render(<PtaEditFamilyScreen />);
    await waitFor(() => expect(screen.getByLabelText('Your name').props.value).toBe('Casey Kim'));

    await fireEvent.changeText(screen.getByLabelText('Your phone'), '555-0100');
    await fireEvent.press(screen.getByLabelText('Save contact info'));

    await waitFor(() =>
      expect(mockUpdateMyPtaAdult).toHaveBeenCalledWith('org-pta', expect.objectContaining({ name: 'Casey Kim', phone: '555-0100' }))
    );
    expect(mockSubmitPtaChangeRequest).not.toHaveBeenCalled();
  });

  it('routes a student name correction through a change REQUEST — never a direct write', async () => {
    await render(<PtaEditFamilyScreen />);
    await waitFor(() => expect(screen.getByText('Riley Kim')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Request a name correction for Riley Kim'));
    await fireEvent.changeText(screen.getByLabelText('Corrected name for Riley Kim'), 'Riley J. Kim');
    await fireEvent.press(screen.getByLabelText('Submit student name correction for review'));

    await waitFor(() =>
      expect(mockSubmitPtaChangeRequest).toHaveBeenCalledWith('org-pta', 'RENAME_STUDENT', { studentId: 'stu-1', displayName: 'Riley J. Kim' })
    );
    expect(mockUpdateMyPtaAdult).not.toHaveBeenCalled();
  });

  it('submits a placement change with the chosen classroom id', async () => {
    await render(<PtaEditFamilyScreen />);
    await waitFor(() => expect(screen.getByText('Riley Kim')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Request a class change for Riley Kim'));
    await waitFor(() => expect(screen.getByLabelText('Request placement in 4th Grade, Room 14')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Request placement in 4th Grade, Room 14'));

    await waitFor(() =>
      expect(mockSubmitPtaChangeRequest).toHaveBeenCalledWith('org-pta', 'STUDENT_PLACEMENT', { studentId: 'stu-1', classroomId: 'room-14' })
    );
  });

  it('shows pending requests with their review status', async () => {
    mockGetMyPtaChangeRequests.mockResolvedValueOnce([
      { id: 'req-9', type: 'ADD_STUDENT', payload: {}, status: 'SUBMITTED', decisionNotes: null, createdAt: '2026-09-01T00:00:00.000Z', reviewedAt: null, appliedAt: null },
      { id: 'req-8', type: 'HOUSEHOLD_DISPLAY_NAME', payload: {}, status: 'REJECTED', decisionNotes: 'Please contact the office.', createdAt: '2026-08-20T00:00:00.000Z', reviewedAt: '2026-08-21T00:00:00.000Z', appliedAt: null },
    ]);

    await render(<PtaEditFamilyScreen />);
    await waitFor(() => expect(screen.getByText('Pending review')).toBeTruthy());
    expect(screen.getByText('Not approved')).toBeTruthy();
    expect(screen.getByText('Please contact the office.')).toBeTruthy();
  });

  it('redirects a login with no household link instead of rendering the form', async () => {
    mockUseAuth.mockReturnValue({
      status: 'signedIn',
      selectedOrganizationId: 'org-pta',
      selectedOrganization: { organizationId: 'org-pta', pta: null },
    });

    await render(<PtaEditFamilyScreen />);
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(mockGetMyPtaHousehold).not.toHaveBeenCalled();
  });
});
