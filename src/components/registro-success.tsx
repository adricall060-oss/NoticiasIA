"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";

export function RegisteredSuccessCard() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const registered = sp.get("registered") === "1";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!registered) return;

    setVisible(true);

    const t = setTimeout(() => {
      setVisible(false);
      router.replace(pathname);
    }, 2500);

    return () => clearTimeout(t);
  }, [registered, router, pathname]);

  if (!registered || !visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-md border-slate-200 bg-white text-slate-900 shadow-xl">
        <div className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
          <div>
            <div className="font-semibold">Cuenta registrada correctamente</div>
            <div className="text-sm text-slate-600">Ya puedes iniciar sesion.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
