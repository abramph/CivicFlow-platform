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

describe('LoadErrorBanner — Build 26 accessibility remediation', () => {
  it('announces itself as an alert so a failed load is not silent', async () => {
    // RNTL's role queries do not cover 'alert', so assert on the node itself:
    // the point is that the banner really carries both announcement signals.
    await render(<LoadErrorBanner message="Something went wrong." onRetry={() => {}} />);
    const banner = screen.getByTestId('load-error-banner');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
  });

  it('names what the retry reloads when a target is given', async () => {
    await render(<LoadErrorBanner message="Nope." onRetry={() => {}} retryTarget="student progression" />);
    expect(screen.getByLabelText('Retry loading student progression')).toBeTruthy();
  });

  it('keeps the generic label when no target is given, so existing callers are unchanged', async () => {
    await render(<LoadErrorBanner message="Nope." onRetry={() => {}} />);
    expect(screen.getByLabelText('Retry loading')).toBeTruthy();
  });

  it('gives the retry control a large enough touch target', async () => {
    await render(<LoadErrorBanner message="Nope." onRetry={() => {}} />);
    const retry = screen.getByLabelText('Retry loading');
    const style = Array.isArray(retry.props.style) ? Object.assign({}, ...retry.props.style.flat()) : retry.props.style;
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });
});
