"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Home, Newspaper, Settings, HelpCircle, BarChart3, LogOut, Tv } from "lucide-react";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api
      .me()
      .then((r) => setMe(r.data))
      .catch(() => setMe(null));
  }, []);

  async function onLogout() {
    await api.logout().catch(() => {});
    location.href = "/login";
  }

  const email = me?.email ?? "-";
  const displayName = useMemo(() => {
    return (
      me?.displayName ||
      [me?.nombre, me?.apellidos].filter((value): value is string => Boolean(value)).join(" ").trim() ||
      (email !== "-" ? email.split("@")[0] : "Usuario")
    );
  }, [email, me?.apellidos, me?.displayName, me?.nombre]);

  const initial = (displayName?.[0] ?? "U").toUpperCase();
  const currentHomeSection = searchParams.get("section");
  const showAdminLabel =
    String(me?.tipo_usuario ?? "").toUpperCase() === "GLOBAL_ADMIN" && me?.alcance === "TENANT_COMPLETO";
  const orgLabel = showAdminLabel ? "Rol" : "Departamento";
  const orgValue = showAdminLabel
    ? "ADMIN"
    : me?.departamentos?.length
      ? me.departamentos.map((d) => d.nombre).join(" · ")
      : me?.departamento_nombre ?? "-";

  const items = [
    { href: "/home", label: "Inicio", icon: Home },
    { href: "/noticias", label: "Noticias", icon: Newspaper },
    { href: "/canales", label: "Canales", icon: Tv },
    { href: "/kpi", label: "KPI", icon: BarChart3 },
    { href: "/ajustes", label: "Ajustes", icon: Settings },
    { href: "/home?section=ayuda", label: "Ayuda", icon: HelpCircle, section: "ayuda" },
  ];

  return (
    <aside className={cn("w-full self-stretch h-full border-r bg-background")}>
      <div className="p-6">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-semibold">
            {initial}
          </div>

          <div className="mt-3 font-semibold leading-tight">{displayName}</div>
          <div className="mt-1 text-xs text-muted-foreground break-all">{email}</div>

          <div className="mt-4 w-full space-y-2 text-xs">
            <div className="text-muted-foreground">
              <span className="block">
                DNI: <span className="text-foreground">{me?.dni ?? "-"}</span>
              </span>
            </div>
            <div className="text-muted-foreground">
              <span className="block">
                Empresa: <span className="text-foreground">{me?.empresa_nombre ?? "-"}</span>
              </span>
            </div>
            <div className="text-muted-foreground">
              <span className="block">
                {orgLabel}: <span className="text-foreground">{orgValue}</span>
              </span>
            </div>
          </div>
        </div>

        <Separator className="my-6" />

        <nav className="space-y-1">
          {items.map(({ href, label, icon: Icon, section }) => {
            const active = section
              ? pathname === "/home" && currentHomeSection === section
              : href === "/home"
                ? pathname === "/home" && currentHomeSection !== "ayuda"
                : pathname === href || (href !== "/" && pathname.startsWith(href + "/"));

            return (
              <Link
                key={href}
                href={href}
                onClick={(event) => {
                  if (href === "/home") {
                    event.preventDefault();
                    router.push(`/home?reset=${Date.now()}`);
                  }
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  "hover:bg-blue-50 hover:text-blue-700",
                  active && "bg-blue-50 text-blue-700"
                )}
              >
                <Icon className={cn("h-4 w-4", active && "text-blue-700")} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <Separator className="my-6" />

        <button
          type="button"
          onClick={onLogout}
          className="w-full flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-left hover:bg-blue-50 hover:text-blue-700"
        >
          <LogOut className="h-4 w-4" />
          <span>Cerrar sesion</span>
        </button>
      </div>
    </aside>
  );
}
