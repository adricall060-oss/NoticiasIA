import { getSession } from "@/lib/auth";
import { HeaderTitleLink } from "@/components/header-title-link";

export async function Header() {
  const session = await getSession();
  const authenticated = Boolean(session);

  return (
    <header className="w-full border-b bg-background bg-gradient-to-b from-[#0047BA] to-[#0062FF]">
  <div className="flex h-14 items-center justify-center">
        <HeaderTitleLink authenticated={authenticated} />
      </div>
    </header>
  );
}
