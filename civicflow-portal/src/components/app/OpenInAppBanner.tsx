import Link from "next/link";

/**
 * Shown on member web-fallback pages (/m/*) to a visitor who isn't logged in
 * as a member — offers the app or lets them continue in the browser.
 */
export function OpenInAppBanner({ deepLink, title }: { deepLink: string; title: string }) {
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600">
        Get the Unestra app to check your dues, report payments, and receive announcements on the go.
      </p>
      <a
        href={`unestra://${deepLink}`}
        className="block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        Open in Unestra App
      </a>
      <p className="text-xs text-slate-500">Don&apos;t have the app yet? It&apos;s coming soon to the App Store and Google Play.</p>
      <div className="border-t border-slate-200 pt-4">
        <p className="text-sm text-slate-600">Already have an account?</p>
        <Link href="/login" className="text-sm font-medium text-emerald-600 hover:underline">
          Continue in your browser
        </Link>
      </div>
    </div>
  );
}
