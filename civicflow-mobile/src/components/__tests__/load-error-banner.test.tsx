import { fireEvent, render, screen } from '@testing-library/react-native';

import { LoadErrorBanner } from '../load-error-banner';

describe('LoadErrorBanner', () => {
  it('renders nothing when there is no error message', async () => {
    await render(<LoadErrorBanner message={null} onRetry={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the message and a Retry action, which calls onRetry when pressed', async () => {
    const onRetry = jest.fn();
    await render(<LoadErrorBanner message="Unable to load. Check your connection and try again." onRetry={onRetry} />);

    expect(screen.getByText('Unable to load. Check your connection and try again.')).toBeTruthy();
    const retryButton = screen.getByLabelText('Retry loading');
    expect(retryButton.props.accessibilityRole).toBe('button');

    fireEvent.press(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
