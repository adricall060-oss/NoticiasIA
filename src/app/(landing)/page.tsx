import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RegisteredSuccessCard } from "@/components/registro-success";

export default function Page() {
  return (

      <div className="mx-auto max-w-3xl px-4 py-10">

        <RegisteredSuccessCard />
        
        <Card className="bg-gradient-to-l from-[#F2F2F2] to-white p-10 text-center shadow-xl border-slate-400/30">
          <img
            src="/assets/fotos/dominion.webp"
            alt="AI Content Creator"
            className="mx-auto h-1/2 w-1/2 object-cover"
          />

          <div className="text-base font-satoshi tracking-tight">AI Content Creator</div>

          <div className="mt-6 flex justify-center gap-3">
            <Button
              asChild
              className="bg-blue-700 text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <Link href="/login">Iniciar sesión</Link>
            </Button>

            <Button
              asChild
              className="bg-blue-700 text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <Link href="/registro">Crear cuenta</Link>
            </Button>
          </div>
        </Card>

        
      </div>
 
  );
}