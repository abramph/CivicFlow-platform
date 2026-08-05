"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

type Exchange = {
  question: string;
  answer: string;
  citations: { title: string; href: string }[];
  questionCategory: string;
  feedback: "helpful" | "not_helpful" | null;
};

const MAX_QUESTION_LENGTH = 500;

export function SupportAssistantWidget() {
  const { status } = useSession();
  const pathname = usePathname();
  const [available, setAvailable] = useState(false);
  const [mode, setMode] = useState<"public" | "authenticated">("public");
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/support-assistant/availability")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled || !body?.ok) return;
        setAvailable(Boolean(body.data?.available));
        setMode(body.data?.mode === "authenticated" ? "authenticated" : "public");
      })
      .catch(() => {
        /* Availability check failing just means the widget stays hidden -- never breaks the page. */
      });
    return () => {
      cancelled = true;
    };
    // Re-check when auth status changes (e.g. login/logout in another tab).
  }, [status]);

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.querySelector("textarea")?.focus();
    }
  }, [open]);

  if (!available) return null;

  async function submitQuestion() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/support-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, currentPath: pathname }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error || "Something went wrong. Please try again.");
        return;
      }
      setExchanges((current) => [
        ...current,
        {
          question: trimmed,
          answer: body.data.answer,
          citations: body.data.citations ?? [],
          questionCategory: body.data.questionCategory ?? "unmatched",
          feedback: null,
        },
      ]);
      setQuestion("");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function sendFeedback(index: number, helpful: boolean) {
    const exchange = exchanges[index];
    setExchanges((current) => current.map((e, i) => (i === index ? { ...e, feedback: helpful ? "helpful" : "not_helpful" } : e)));
    await fetch("/api/support-assistant/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPath: pathname, questionCategory: exchange.questionCategory, helpful }),
    }).catch(() => null);
  }

  async function escalate() {
    await fetch("/api/support-assistant/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPath: pathname, questionCategory: exchanges.at(-1)?.questionCategory ?? "unmatched", escalated: true }),
    }).catch(() => null);
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Unestra Assistant"
          className="flex h-[32rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl sm:w-96"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex items-center justify-between border-b border-slate-200 bg-emerald-700 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Unestra Assistant</p>
              <p className="text-xs text-emerald-100">AI-powered — always double-check anything important</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-lg p-1 text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              &#10005;
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {exchanges.length === 0 ? (
              <div className="space-y-2 text-sm text-slate-700">
                <p>
                  Hi, I&apos;m the Unestra Assistant. I can answer general questions about Unestra features, organization types,
                  setup, reports, payments, and support{mode === "authenticated" ? " for your organization" : ""}.
                </p>
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                  Please don&apos;t enter passwords, payment-card details, or private member information.
                </p>
              </div>
            ) : null}
            {exchanges.map((exchange, index) => (
              <div key={index} className="space-y-2">
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">{exchange.question}</p>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                  <p className="whitespace-pre-wrap">{exchange.answer}</p>
                  {exchange.citations.length > 0 ? (
                    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
                      {exchange.citations.map((citation) => (
                        <li key={citation.href}>
                          <a href={citation.href} className="text-emerald-700 hover:underline">
                            {citation.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs">
                    {exchange.feedback ? (
                      <span className="text-slate-500">Thanks for the feedback.</span>
                    ) : (
                      <>
                        <button type="button" onClick={() => sendFeedback(index, true)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                          Helpful
                        </button>
                        <button type="button" onClick={() => sendFeedback(index, false)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                          Not helpful
                        </button>
                      </>
                    )}
                    <button type="button" onClick={escalate} className="ml-auto text-emerald-700 hover:underline">
                      Contact Support
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          </div>

          <div className="border-t border-slate-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitQuestion();
                  }
                }}
                rows={2}
                placeholder="Ask a question about Unestra…"
                aria-label="Your question"
                className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              />
              <button
                type="button"
                onClick={submitQuestion}
                disabled={pending || !question.trim()}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "…" : "Ask"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          aria-label="Open Unestra Assistant"
        >
          <span aria-hidden="true">💬</span> Ask Unestra
        </button>
      )}
    </div>
  );
}
