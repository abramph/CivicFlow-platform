import Link from "next/link";

export const metadata = { title: "Privacy Policy — Unestra" };

/**
 * DRAFT — submission-blocker sprint (2026-08), task "Privacy Policy
 * Technical Review". Every addition below describes ACTUAL current
 * behavior only (verified against code: src/lib/mail.ts, sms.ts,
 * whatsapp/*, push.ts, storage.ts, account-deletion.ts, giving/*,
 * support-assistant/providers/openai-provider.ts). No legal conclusions,
 * retention-period legal claims, or compliance-framework language (GDPR/
 * CCPA/etc.) have been added or asserted — those require Abram + a
 * qualified attorney. The "not reviewed by legal counsel" line at the
 * bottom is left in place because it is still factually true; do not
 * remove it until an actual legal review has happened.
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated August 16, 2026</p>
        </div>

        <p className="text-sm leading-6 text-slate-700">
          This Privacy Policy describes how Unestra (&quot;Unestra,&quot; &quot;we,&quot; &quot;us&quot;)
          collects, uses, and protects information about you when you use the Unestra platform, including
          our website, member portal, and mobile app, and when you communicate with us or an organization
          you belong to by SMS text message, WhatsApp, or push notification.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Information We Collect</h2>
          <p className="text-sm leading-6 text-slate-700">
            We collect information you provide directly, such as your name, email address, mailing address,
            and mobile phone number, as well as information about your interactions with Unestra and the
            organizations you belong to, including membership and role information, payment and contribution
            history, event and meeting RSVPs, messages and announcements sent through the platform, files you
            upload (such as receipts, documents, or attachments to a case or request), and, if you use it, the
            questions you submit to our in-app support assistant.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            If your organization uses the Union Case Center, information about a case you file — including
            its description, status, any dates or deadlines, and any updates your organization&apos;s staff
            marks as visible to you — is stored as part of that case. Internal notes your organization&apos;s
            staff mark as not visible to you are stored but are never shown to you or included in anything we
            send you.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            We also automatically collect limited technical and diagnostic information when you use Unestra —
            such as error reports, request logs, and an internal audit trail of account and administrative
            actions — which we use to operate, secure, and troubleshoot the platform.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Payments</h2>
          <p className="text-sm leading-6 text-slate-700">
            Payments and contributions are processed by Stripe, our payment processor. We do not store your
            full payment card number; Stripe handles card data directly and provides us limited payment
            metadata (such as amount, date, status, and a reference id) so we can maintain accurate financial
            records for your organization. Organizations that accept online giving through Unestra use Stripe
            Connect, meaning payments to that organization flow through a Stripe account associated with it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">SMS, WhatsApp &amp; Push Notifications</h2>
          <p className="text-sm leading-6 text-slate-700">
            If you opt in to receive SMS text messages or WhatsApp messages, we use your mobile phone number
            to send account verification codes, password reset codes, payment confirmations, membership
            renewal notices, event and volunteer reminders, and organization announcements. SMS and WhatsApp
            messages are delivered through Twilio, our messaging provider. We record the date, time, IP
            address, and method (website registration, profile settings, or QR code) of your consent, and we
            keep that record for as long as required for compliance and auditing purposes.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            <strong>No mobile information will be shared with third parties or affiliates for marketing or
            promotional purposes.</strong> Information sharing with subcontractors for support services, such
            as our messaging provider, is permitted only as necessary to operate the service. Message and
            data rates may apply. You may reply STOP at any time to opt out of SMS, or HELP for assistance.
            You may also withdraw consent at any time from Notification Settings in the member portal.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            If you use the Unestra mobile app and allow notifications, we store a device push token so we can
            deliver push notifications (such as new announcements, messages, or case updates) to your device
            through Apple&apos;s and Google&apos;s standard push notification services. You can disable push
            notifications at any time in your device settings or in the app&apos;s notification settings.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">How We Use Information</h2>
          <p className="text-sm leading-6 text-slate-700">
            We use the information we collect to operate and improve Unestra, process payments, send the
            communications you&apos;ve opted in to, comply with legal obligations, and prevent fraud and abuse.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            If your organization enables the in-app support assistant, the text of your question (and
            relevant excerpts of your organization&apos;s help content) is sent to OpenAI, our AI service
            provider, to generate a response. We do not intentionally include your name, email, or other
            account identifiers in that request.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            Uploaded files (such as receipts, documents, or case attachments) are stored using DigitalOcean
            Spaces, our cloud storage provider, and access is restricted to authorized users within the
            relevant organization.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            <strong>We do not sell your personal information, and we do not use it for third-party
            advertising.</strong>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Account Deletion</h2>
          <p className="text-sm leading-6 text-slate-700">
            You can permanently delete your Unestra account from Settings in the member portal or app, or
            from a public request page if you no longer have app access. Deleting your account removes your
            login credentials, profile details, and personal settings, and signs you out everywhere. It does
            not delete any organization you belong to, or that organization&apos;s records.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            Some information tied to your account is retained after deletion rather than removed, because it
            is also part of your organization&apos;s own records — for example, payment and contribution
            history, financial statements, case records, and entries in our security/administrative audit
            trail. Where that information is retained, we remove or minimize the personal details attached to
            it where we&apos;re able to (for example, the login associated with those records is deactivated
            and your profile information is cleared). If you are the sole owner of an organization, we ask
            you to transfer ownership before your account can be deleted, so the organization and its records
            are not left without anyone able to manage them.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Your Choices</h2>
          <p className="text-sm leading-6 text-slate-700">
            You can review, update, or withdraw SMS/WhatsApp consent at any time from Notification Settings.
            You can request a copy of your personal information, or delete your account as described above,
            by contacting your organization or Unestra support.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Contact Us</h2>
          <p className="text-sm leading-6 text-slate-700">
            Questions about this policy can be sent to support@getunestra.com.
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
