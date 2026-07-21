export function InternalPilotBanner() {
  return (
    <div className="rounded-xl border border-sky-300 bg-sky-50 px-5 py-4">
      <p className="text-sm font-bold uppercase tracking-wide text-sky-900">Internal APH Technologies Pilot</p>
      <p className="mt-1 text-sm text-sky-800">
        Meeting Intelligence is available only to APH Technologies during this pilot. Do not upload recordings
        containing protected health information, psychotherapy content, patient identifiers, highly sensitive
        personnel matters, confidential legal advice, payment card information, or passwords/security credentials.
        AI-generated minutes are always a draft — a person must review and approve them before they become official.
      </p>
      <p className="mt-2 text-sm text-sky-800">
        Only upload a recording if every participant was notified of recording or has consented, as required. Audio
        and transcript content are sent to third-party AI providers (transcription and, if configured, AI-generated
        minutes) for processing. Recordings are retained temporarily and deleted automatically after the pilot&apos;s
        retention window.
      </p>
    </div>
  );
}
