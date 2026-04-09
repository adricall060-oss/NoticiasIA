import { Globe2, Instagram, Linkedin, Twitter } from "lucide-react";

export function Footer() {
  return (
    <footer className="w-full border-t border-[#5f5f5f] bg-[#707070]">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 text-xs text-white sm:px-6 sm:text-sm">
        <span className="font-satoshi">Dominion Digital</span>
        <div className="flex items-center gap-3">
          <a
            href="https://www.dominiondigital.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/15"
            aria-label="Web de Dominion Digital"
          >
            <Globe2 className="h-4 w-4" />
          </a>
          <a
            href="https://www.instagram.com/dominion_global/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/15"
            aria-label="Instagram de Dominion Digital"
          >
            <Instagram className="h-4 w-4" />
          </a>
          <a
            href="https://www.linkedin.com/company/dominion-digital-banking-insurance/posts/?feedView=all"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/15"
            aria-label="LinkedIn de Dominion Digital"
          >
            <Linkedin className="h-4 w-4" />
          </a>
          <a
            href="https://twitter.com/Dominion_DOM"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/15"
            aria-label="Twitter de Dominion Digital"
          >
            <Twitter className="h-4 w-4" />
          </a>
          <span className="font-satoshi">&copy; {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
