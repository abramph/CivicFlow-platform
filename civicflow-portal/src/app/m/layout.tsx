import { Suspense } from "react";
import { MemberPortalShell } from "@/components/app/MemberPortalShell";

export default function MemberPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <MemberPortalShell>{children}</MemberPortalShell>
    </Suspense>
  );
}
