import { ArrowRight } from "lucide-react";
import heroImage from "@/assets/hero.jpg";

const Index = () => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-charcoal text-ivory">
      {/* Background image */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src={heroImage}
          alt=""
          className="h-full w-full object-cover opacity-55 animate-fade-in"
        />
        <div className="absolute inset-0 bg-luxe opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal via-charcoal/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-charcoal via-transparent to-charcoal/40" />
      </div>

      {/* Grain overlay */}
      <div className="grain absolute inset-0 pointer-events-none" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Nav */}
        <header className="container flex items-center justify-between py-8 animate-fade-in">
          <a
            href="/"
            className="font-display text-2xl tracking-[0.35em] text-ivory"
            aria-label="dreyv home"
          >
            DREYV
          </a>
          <a
            href="#signin"
            className="text-xs uppercase tracking-[0.25em] text-ivory/70 transition-colors duration-500 hover:text-champagne"
          >
            Sign in
          </a>
        </header>

        {/* Hero */}
        <main className="container flex flex-1 items-center">
          <div className="max-w-3xl py-16 md:py-24">
            <p className="animate-fade-up delay-100 mb-8 inline-flex items-center gap-3 text-[11px] uppercase tracking-[0.4em] text-champagne">
              <span className="h-px w-10 bg-champagne/60" />
              For the modern rideshare driver
            </p>

            <h1 className="animate-fade-up delay-200 font-display text-5xl leading-[1.05] text-balance text-ivory sm:text-6xl md:text-7xl lg:text-8xl">
              Drive smarter.
              <br />
              <span className="italic text-champagne">Earn more.</span>
            </h1>

            <p className="animate-fade-up delay-300 mt-8 max-w-xl text-base leading-relaxed text-ivory/70 md:text-lg">
              dreyv is the premium companion app crafted for professional
              rideshare drivers — turning every mile into measured, refined
              opportunity.
            </p>

            <div className="animate-fade-up delay-400 mt-12 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <a
                href="#early-access"
                className="group inline-flex items-center gap-3 bg-gold px-8 py-4 text-sm uppercase tracking-[0.25em] text-charcoal shadow-gold transition-all duration-500 hover:translate-y-[-2px] hover:shadow-luxe"
              >
                Get early access
                <ArrowRight className="h-4 w-4 transition-transform duration-500 group-hover:translate-x-1" />
              </a>
              <a
                href="#learn-more"
                className="group relative text-sm uppercase tracking-[0.25em] text-ivory/80 transition-colors duration-500 hover:text-champagne"
              >
                Learn more
                <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-champagne transition-transform duration-500 group-hover:scale-x-100" />
              </a>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="container animate-fade-in delay-500 flex flex-col items-start justify-between gap-3 border-t border-ivory/10 py-8 text-xs uppercase tracking-[0.25em] text-ivory/50 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} dreyv</span>
          <span className="text-champagne/70">Designed for the road ahead</span>
        </footer>
      </div>
    </div>
  );
};

export default Index;
