import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interviewa candidate finder",
  description:
    "Rank a public shortlist from a job spec. A proof of concept for Interviewa. No one is contacted.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
            <div className="flex items-center gap-3">
              <span
                className="relative grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"
                aria-hidden
              >
                <span className="absolute h-3 w-4 -translate-x-1 rounded-sm bg-white/90" />
                <span className="absolute h-3 w-4 translate-x-1 translate-y-1 rounded-sm bg-[#d7f3ef]" />
              </span>
              <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                Interviewa
              </p>
            </div>
            <nav aria-label="Sections" className="flex gap-4 text-sm font-medium">
              <Link href="/" className="underline decoration-[#c9ddd9] underline-offset-4">
                Shortlist
              </Link>
              <Link href="/spend" className="underline decoration-[#c9ddd9] underline-offset-4">
                Apify spend
              </Link>
            </nav>
            <div className="max-w-3xl">
              <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Candidate finder</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                Turn a job spec into a ranked shortlist from public LinkedIn profiles, recent posts, and Indeed
                resumes. This is a proof of concept for Interviewa, a two-way AI video screening platform. It does
                not email or message anyone.
              </p>
              <p className="mt-3 text-sm font-medium text-foreground">Only 10 results are returned per search.</p>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="border-t border-border">
          <p className="mx-auto max-w-6xl px-4 py-6 text-sm leading-6 text-muted-foreground sm:px-6">
            Results come from public data only. No one has been contacted.
          </p>
        </footer>
      </body>
    </html>
  );
}
