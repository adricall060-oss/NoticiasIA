"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function RegistroPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    dni: "",
    nombre: "",
    apellidos: "",
    codigo_cliente: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

 async function onSubmit() {
  setErr(null);
  setLoading(true);

  try {
    await api.signup({
      email: form.email,
      password: form.password,
      dni: form.dni,
      nombre: form.nombre,
      apellidos: form.apellidos,
      codigo_cliente: form.codigo_cliente,
    });

    router.replace("/?registered=1");
  } catch (e: any) {
    setErr(e?.message ?? "Error");
  } finally {
    setLoading(false);
  }
}

  return (
    <div className="mx-auto max-w-xl">
      <Card className="p-6 bg-gradient-to-l from-[#F2F2F2] to-white shadow-xl border-slate-400/30">
        <div className="text-xl text-blue-700 font-satoshi font-black">Crear cuenta</div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <div className="text-sm font-medium">Email</div>
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-sm font-medium">Contraseña</div>
            <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">DNI</div>
            <Input value={form.dni} onChange={(e) => set("dni", e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Código empresa</div>
            <Input value={form.codigo_cliente} onChange={(e) => set("codigo_cliente", e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Nombre</div>
            <Input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Apellidos</div>
            <Input value={form.apellidos} onChange={(e) => set("apellidos", e.target.value)} />
          </div>
        </div>

        {err ? <div className="mt-3 text-sm text-destructive">{err}</div> : null}

        <div className="mt-4">
          <Button className="w-full cursor-pointer bg-blue-700 text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            disabled={loading} onClick={onSubmit}>
            Crear cuenta
          </Button>

          <div className="mt-4 text-center space-y-2">
            <div className="text-sm text-blue-700">
              ¿Ya tienes una cuenta?{" "}
              <Link href="/login" className="text-blue-600 font-medium hover:text-blue-800 hover:underline">
                Inicia sesión
              </Link>
            </div>

            <div>
              <Link href="/" className="text-sm text-blue-600 font-medium hover:text-blue-800 hover:underline">
                Volver al inicio
              </Link>
            </div>
          </div>

        </div>
      </Card>
    </div>
  );
}
