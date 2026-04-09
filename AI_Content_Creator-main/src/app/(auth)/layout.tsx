import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />

      <main className="flex-1 w-full bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-6">
          {children}
        </div>
      </main>

      <Footer />
    </div>
  );
}