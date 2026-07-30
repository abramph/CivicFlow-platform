import { render } from '@testing-library/react-native';

import { ThemedText } from '@/components/themed-text';

describe('React Native Testing Library setup', () => {
  it('renders a themed text component and queries it by role', async () => {
    const result = await render(<ThemedText>Hello Unestra</ThemedText>);
    expect(result.getByText('Hello Unestra')).toBeTruthy();
  });
});
