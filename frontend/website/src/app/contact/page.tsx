import type { Metadata } from "next";
import { CalendarCheck, ChatCircleText, Laptop } from "@phosphor-icons/react/dist/ssr";
import { ContactForm } from "@/components/contact-form";
import { Reveal, WordRise } from "@/components/motion/reveal";

export const metadata: Metadata = {
  title: "Book a demo",
  description: "See DelSecure on your own devices. Book a 30-minute demo with our team.",
};

const expect = [
  { I: ChatCircleText, title: "A short conversation", body: "We learn what you need to protect and which devices you run." },
  { I: Laptop, title: "A live walkthrough", body: "We show the agent and console enforcing a policy like yours." },
  { I: CalendarCheck, title: "A pilot, if it fits", body: "Enroll a few devices and see real events from your own team." },
];

export default function ContactPage() {
  return (
    <section className="relative overflow-hidden">
      <div className="dot-field absolute inset-0 -z-10" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-14 px-4 pb-10 pt-32 md:px-6 md:pt-40 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <h1 className="text-[2.6rem] font-semibold leading-[1.03] tracking-[-0.035em] text-fg md:text-6xl">
            <WordRise text="See it on your own devices." />
          </h1>
          <Reveal delay={0.3}>
            <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted">Thirty minutes with our team. No slides, just the product.</p>
          </Reveal>
          <ul className="mt-12 grid gap-8">
            {expect.map(({ I, title, body }, i) => (
              <Reveal key={title} delay={0.4 + i * 0.1}>
                <li className="flex gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-fg">
                    <I size={20} weight="light" />
                  </span>
                  <span>
                    <span className="block font-semibold text-fg">{title}</span>
                    <span className="mt-1 block leading-relaxed text-muted">{body}</span>
                  </span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={0.2} y={36}>
          <ContactForm />
        </Reveal>
      </div>
    </section>
  );
}
