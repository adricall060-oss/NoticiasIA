import "./globals.css";
import localFont from "next/font/local";

export const metadata = {
  title: "AI Content Creator",
  description: "Generación y revisión de contenido con n8n + MySQL",
};

const satoshi = localFont({
  src: [{ path: "./fonts/Satoshi-Regular.otf", weight: "400", style: "normal" }],
  variable: "--font-satoshi",
  display: "swap",
});

const satoshi_b = localFont({
  src: [{ path: "./fonts/Satoshi-Black.otf", weight: "700", style: "normal" }],
  variable: "--font-satoshi-black",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${satoshi.variable} ${satoshi_b.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}