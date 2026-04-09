import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />

      <main className="flex flex-1 w-full bg-[#F2F7FF]">
        <div className="grid w-full flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
          <Sidebar />
          <div className="min-w-0">
            <div className="mx-auto max-w-6xl px-4 py-6">
              {children}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
