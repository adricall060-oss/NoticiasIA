"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setErr(null);
    if (!turnstileSiteKey) {
      setErr("Falta configurar TURNSTILE en frontend");
      return;
    }
    if (!turnstileToken) {
      setErr("Confirma la verificacion anti-bot");
      return;
    }
    setLoading(true);
    try {
      await api.login({ email, password, turnstileToken });
      router.push("/home");
    } catch (e: unknown) {
      setTurnstileToken("");
      setTurnstileNonce((n) => n + 1);
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6 bg-gradient-to-l from-[#F2F2F2] to-white shadow-xl border-slate-400/30">
        <div className="text-xl text-blue-700 font-satoshi font-black">Iniciar sesión</div>

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Email</div>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@..." />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Contraseña</div>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {err ? <div className="text-sm text-destructive">{err}</div> : null}

          <div key={turnstileNonce} className="flex w-full justify-center overflow-hidden pt-1">
            {turnstileSiteKey ? (
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                size="normal"
                onVerify={(token) => {
                  setTurnstileToken(token);
                  setErr(null);
                }}
                onExpire={() => setTurnstileToken("")}
                onError={() => {
                  setTurnstileToken("");
                  setErr("No se pudo completar la verificacion anti-bot");
                }}
              />
            ) : (
              <div className="text-sm text-destructive">Falta configurar TURNSTILE en frontend</div>
            )}
          </div>

          <Button
            className="w-full cursor-pointer bg-blue-700 text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            disabled={loading || !turnstileSiteKey || !turnstileToken}
            onClick={onSubmit}
          >
            Entrar
          </Button>

          <div className="mt-4 text-center space-y-2">
            <div className="text-sm text-blue-700">
              ¿No tienes una cuenta?{" "}
              <Link href="/registro" className="text-blue-600 font-medium hover:text-blue-800 hover:underline">
                Regístrate
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
