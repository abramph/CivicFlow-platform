import Link from "next/link";

export const metadata = { title: "Terms of Service — Unestra" };

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Terms of Service</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated July 8, 2026</p>
        </div>

        <p className="text-sm leading-6 text-slate-700">
          These Terms of Service (&quot;Terms&quot;) govern your use of Unestra, including our website,
          member portal, and mobile app. By creating an account or using Unestra, you agree to these Terms.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Using Unestra</h2>
          <p className="text-sm leading-6 text-slate-700">
            You must provide accurate information when creating an account and are responsible for
            maintaining the confidentiality of your login credentials and for all activity under your account.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">SMS / Text Messaging Program</h2>
          <p className="text-sm leading-6 text-slate-700">
            By checking the SMS consent checkbox, you agree to receive text messages from Unestra and
            organizations you belong to for account verification, password resets, payment confirmations,
            membership renewals, event reminders, volunteer notifications, and organization announcements.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-sm leading-6 text-slate-700">
            <li>Message frequency varies based on your activity and organization communications.</li>
            <li>Message and data rates may apply.</li>
            <li>Reply <strong>STOP</strong> at any time to immediately opt out of all SMS messages.</li>
            <li>Reply <strong>HELP</strong> at any time for assistance, or contact support@getunestra.com.</li>
            <li>Consent to receive SMS messages is not a condition of purchasing any goods or services.</li>
            <li>You can withdraw consent at any time from Notification Settings in the member portal.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Payments</h2>
          <p className="text-sm leading-6 text-slate-700">
            Payments made through Unestra are processed by our third-party payment processor. You are
            responsible for reviewing amounts before submitting a payment.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Termination</h2>
          <p className="text-sm leading-6 text-slate-700">
            We may suspend or terminate access to Unestra for violations of these Terms or for conduct that
            we determine is harmful to other users, organizations, or Unestra itself.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Contact Us</h2>
          <p className="text-sm leading-6 text-slate-700">
            Questions about these Terms can be sent to support@getunestra.com.
          </p>
        </section>

        <p className="border-t border-slate-200 pt-4 text-xs text-slate-400">
          This is a general-purpose terms template and has not been reviewed by legal counsel. It should be
          reviewed and finalized by a qualified attorney before relying on it in production.
        </p>

        <Link href="/" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Unestra
        </Link>
      </div>
    </div>
  );
}
