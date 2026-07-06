import { Suspense } from "react";
import { MemberPortalNav } from "@/components/app/MemberPortalNav";

export default function MemberPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <Suspense fallback={null}>
        <MemberPortalNav />
      </Suspense>
      {children}
    </div>
  );
}
