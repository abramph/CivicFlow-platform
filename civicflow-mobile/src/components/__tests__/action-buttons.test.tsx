import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrimaryActionButton, SecondaryLinkButton } from '../action-buttons';

describe('PrimaryActionButton', () => {
  it('renders its label and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<PrimaryActionButton label="Continue" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Continue'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('falls back accessibilityLabel to the label when none is given', async () => {
    await render(<PrimaryActionButton label="Take Photo" onPress={() => {}} />);
    expect(screen.getByLabelText('Take Photo')).toBeTruthy();
  });

  it('uses an explicit accessibilityLabel over the visible label when given', async () => {
    await render(<PrimaryActionButton label="Take Photo" accessibilityLabel="Take photo" onPress={() => {}} />);
    expect(screen.getByLabelText('Take photo')).toBeTruthy();
    expect(screen.getByText('Take Photo')).toBeTruthy();
  });

  it('shows the loading label and blocks onPress while loading', async () => {
    const onPress = jest.fn();
    await render(<PrimaryActionButton label="Upload" loadingLabel="Uploading…" loading onPress={onPress} />);
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByText('Upload')).toBeNull();
    fireEvent.press(screen.getByLabelText('Upload'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire onPress when explicitly disabled', async () => {
    const onPress = jest.fn();
    await render(<PrimaryActionButton label="Continue" disabled onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Continue'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('SecondaryLinkButton', () => {
  it('renders its label and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<SecondaryLinkButton label="Not Now" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Not Now'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('supports an explicit accessibilityLabel distinct from the visible label', async () => {
    await render(<SecondaryLinkButton label="Not Now" accessibilityLabel="Not now" onPress={() => {}} />);
    expect(screen.getByLabelText('Not now')).toBeTruthy();
  });
});
