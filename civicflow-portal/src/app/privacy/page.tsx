import Link from "next/link";

export const metadata = { title: "Privacy Policy — Unestra" };

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated July 8, 2026</p>
        </div>

        <p className="text-sm leading-6 text-slate-700">
          This Privacy Policy describes how Unestra (&quot;Unestra,&quot; &quot;we,&quot; &quot;us&quot;)
          collects, uses, and protects information about you when you use the Unestra platform, including
          our website, member portal, and mobile app, and when you communicate with us or an organization
          you belong to by SMS text message.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Information We Collect</h2>
          <p className="text-sm leading-6 text-slate-700">
            We collect information you provide directly, such as your name, email address, mailing address,
            and mobile phone number, as well as information about your interactions with Unestra and the
            organizations you belong to, including payment, event, and communication history.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">SMS / Text Messaging</h2>
          <p className="text-sm leading-6 text-slate-700">
            If you opt in to receive SMS text messages, we use your mobile phone number to send account
            verification codes, password reset codes, payment confirmations, membership renewal notices,
            event and volunteer reminders, and organization announcements. We record the date, time, IP
            address, and method (website registration, profile settings, or QR code) of your consent, and we
            keep that record for as long as required for compliance and auditing purposes.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            <strong>No mobile information will be shared with third parties or affiliates for marketing or
            promotional purposes.</strong> Information sharing with subcontractors for support services, such
            as our SMS delivery provider, is permitted only as necessary to operate the service. Message and
            data rates may apply. You may reply STOP at any time to opt out, or HELP for assistance. You may
            also withdraw consent at any time from Notification Settings in the member portal.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">How We Use Information</h2>
          <p className="text-sm leading-6 text-slate-700">
            We use the information we collect to operate and improve Unestra, process payments, send the
            communications you&apos;ve opted in to, comply with legal obligations, and prevent fraud and abuse.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Your Choices</h2>
          <p className="text-sm leading-6 text-slate-700">
            You can review, update, or withdraw SMS consent at any time from Notification Settings. You can
            also request a copy of, or the deletion of, your personal information by contacting your
            organization or Unestra support.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Contact Us</h2>
          <p className="text-sm leading-6 text-slate-700">
            Questions about this policy can be sent to support@civicflowapp.com.
          </p>
        </section>

        <p className="border-t border-slate-200 pt-4 text-xs text-slate-400">
          This is a general-purpose policy template and has not been reviewed by legal counsel. It should be
          reviewed and finalized by a qualified attorney before relying on it in production.
        </p>

        <Link href="/" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Unestra
        </Link>
      </div>
    </div>
  );
}
