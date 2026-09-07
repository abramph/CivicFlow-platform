import { render, screen } from '@testing-library/react-native';

import { StudentAvatar } from '../student-avatar';

// The hook half of the module is exercised through the roster screens'
// tests (pta-my-family.test.tsx / pta-edit-family.test.tsx); this file pins
// only the presentational contract: photo vs initials, and the labels a
// screen reader announces. mobile-api is mocked because the module imports
// it for the hook, not because StudentAvatar uses it.
jest.mock('@/lib/mobile-api', () => ({
  getPtaStudentPhoto: jest.fn(),
}));

describe('StudentAvatar', () => {
  it('renders the photo with a descriptive label when a uri is provided', async () => {
    await render(<StudentAvatar name="Mina Kim" uri="data:image/jpeg;base64,mina" />);
    const image = screen.getByLabelText('Photo of Mina Kim');
    expect(image.props.source.uri).toBe('data:image/jpeg;base64,mina');
    expect(image.props.accessibilityRole).toBe('image');
  });

  it('renders first+last initials when there is no photo', async () => {
    await render(<StudentAvatar name="Mina Jae Kim" uri={null} />);
    expect(screen.getByLabelText('No photo set for Mina Jae Kim')).toBeTruthy();
    expect(screen.getByText('MK')).toBeTruthy();
  });

  it('renders a single initial for a single-word name', async () => {
    await render(<StudentAvatar name="Mina" uri={null} />);
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('renders an empty labeled circle, not a crash, for a blank name', async () => {
    await render(<StudentAvatar name="   " uri={null} />);
    expect(screen.getByLabelText('No photo set for   ')).toBeTruthy();
  });
});
