import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getConversation, sendConversationMessage, type ConversationDetail } from '@/lib/mobile-api';

const POLL_INTERVAL_MS = 15_000;

export default function ConversationThreadScreen() {
  const { status, selectedOrganizationId, user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const data = await getConversation(selectedOrganizationId, id);
    setConversation(data);
  }, [selectedOrganizationId, id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: `/conversation/${id ?? ''}` } }} />;
  }

  async function handleSend() {
    if (!selectedOrganizationId || !id || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendConversationMessage(selectedOrganizationId, id, draft.trim());
      setDraft('');
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send that message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={styles.container}>
        <ThemedText type="title">{conversation?.subject || 'Conversation'}</ThemedText>

        {loading && !conversation ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <FlatList
            ref={listRef}
            data={conversation?.messages ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const isMine = item.senderUserId === user?.id;
              return (
                <ThemedView
                  type="backgroundElement"
                  style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}
                >
                  {!isMine ? (
                    <ThemedText type="small" themeColor="textSecondary">{item.senderDisplayName}</ThemedText>
                  ) : null}
                  <ThemedText type="default">{item.body}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </ThemedText>
                </ThemedView>
              );
            }}
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                No messages yet — say hello.
              </ThemedText>
            }
          />
        )}

        {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

        <ThemedView style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            multiline
          />
          <Pressable style={[styles.sendButton, sending && styles.sendButtonDisabled]} onPress={handleSend} disabled={sending || !draft.trim()}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText style={styles.sendButtonText}>Send</ThemedText>}
          </Pressable>
        </ThemedView>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loading: {
    marginTop: Spacing.five,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  bubble: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 2,
    maxWidth: '85%',
  },
  bubbleMine: {
    alignSelf: 'flex-end',
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
  error: {
    color: '#B42318',
  },
  composer: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
