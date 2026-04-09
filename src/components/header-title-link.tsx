"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type HeaderTitleLinkProps = {
  authenticated: boolean;
};

export function HeaderTitleLink({ authenticated }: HeaderTitleLinkProps) {
  const router = useRouter();
  const fallbackHref = authenticated ? "/home?reset=1" : "/";

  return (
    <Link
      href={fallbackHref}
      onClick={(event) => {
        if (!authenticated) return;
        event.preventDefault();
        router.push(`/home?reset=${Date.now()}`);
      }}
      className="font-satoshi-black tracking-tight text-center text-white text-lg"
    >
      AI CONTENT CREATOR
    </Link>
  );
}
