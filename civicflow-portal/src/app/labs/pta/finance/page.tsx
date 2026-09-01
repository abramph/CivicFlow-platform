import { redirect } from "next/navigation";

/**
 * feature/pta-treasurer-expenditure-experience (E1) — /labs/pta/finance
 * used to be the whole Treasurer page; it's now the shell in layout.tsx
 * plus four nested sections. This redirect keeps the existing nav item
 * href (vertical-navigation.ts) and any external bookmark/link to this
 * exact URL working unchanged, landing on the default section.
 */
export default function PtaFinanceIndexPage() {
  redirect("/labs/pta/finance/overview");
}
