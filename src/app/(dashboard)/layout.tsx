import { Suspense } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />

      <main className="flex flex-1 w-full bg-[#F2F7FF]">
        <div className="grid w-full flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
          <Suspense fallback={<aside className="w-full self-stretch h-full border-r bg-background" />}>
            <Sidebar />
          </Suspense>
          <div className="min-w-0">
            <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-6">Cargando...</div>}>
              <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
            </Suspense>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
