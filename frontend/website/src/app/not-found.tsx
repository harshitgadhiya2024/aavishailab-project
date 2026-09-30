import { Button } from "@/components/button";
import { Float } from "@/components/motion/float";

export default function NotFound() {
  return (
    <section className="relative grid min-h-[80dvh] place-items-center overflow-hidden px-4 pt-24">
      <div className="dot-field absolute inset-0 -z-10" aria-hidden />
      <div className="text-center">
        <Float amplitude={12} duration={5}>
          <p className="text-[9rem] font-semibold leading-none tracking-[-0.06em] text-fg md:text-[13rem]">404</p>
        </Float>
        <p className="mt-4 text-lg text-muted">This page was blocked by policy. Or it never existed.</p>
        <div className="mt-8 flex justify-center">
          <Button href="/">Back to home</Button>
        </div>
      </div>
    </section>
  );
}
