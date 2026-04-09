import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />

      <main className="flex-1 w-full bg-[#F2F7FF]">
        {children}
      </main>

      <Footer />
    </div>
  );
}