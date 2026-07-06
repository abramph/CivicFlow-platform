import { countUnreadConversations } from '@/lib/unread-count';
import type { ConversationSummary } from '@/lib/mobile-api';

function conversation(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'conv-1',
    subject: null,
    lastMessageAt: null,
    hasUnread: false,
    otherParticipants: [],
    ...overrides,
  };
}

describe('countUnreadConversations', () => {
  it('returns 0 for an empty list', () => {
    expect(countUnreadConversations([])).toBe(0);
  });

  it('counts only conversations with hasUnread true', () => {
    const conversations = [
      conversation({ id: 'a', hasUnread: true }),
      conversation({ id: 'b', hasUnread: false }),
      conversation({ id: 'c', hasUnread: true }),
    ];
    expect(countUnreadConversations(conversations)).toBe(2);
  });
});
