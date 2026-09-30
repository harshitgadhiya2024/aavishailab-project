import type { Metadata } from "next";
import { Eye, Fingerprint, Key, LockKey, Signature, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";

export const metadata: Metadata = {
  title: "Trust and security",
  description: "How DelSecure protects the policy it enforces and the data it sees.",
};

const principles = [
  { I: Signature, title: "Signed policy", body: "Policy bundles are signed with Ed25519 and verified on the device, so an agent only ever enforces policy that came from your console." },
  { I: Eye, title: "Monitor-only DLP", body: "Data loss prevention records findings and never blocks. Security gets visibility without breaking the way people work." },
  { I: UsersThree, title: "Isolation between companies", body: "Every organisation's policy, devices and findings are scoped to that organisation and never mixed." },
  { I: Key, title: "Encrypted keys", body: "Per-organisation certificate authority keys are stored encrypted at rest." },
  { I: LockKey, title: "Signed media links", body: "Screenshots and files are served only through short-lived signed links, visible to admins of that organisation." },
  { I: Fingerprint, title: "Authenticated services", body: "Internal scanning services only accept requests carrying a shared secret, never open to the internet." },
];

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Trust"
        title="A security product has to earn trust first."
        body="DelSecure sees sensitive traffic on your devices. Here is how we protect the policy we enforce and the data we see."
      />

      <section className="mx-auto grid max-w-6xl gap-12 px-4 md:grid-cols-[0.8fr_1.2fr] md:px-6">
        <div className="md:sticky md:top-32 md:self-start">
          <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight text-fg md:text-5xl">Six things we never compromise on.</h2>
          <p className="mt-5 max-w-[40ch] leading-relaxed text-muted">If your security team has questions beyond these, we are happy to walk through the architecture in detail.</p>
        </div>
        <div className="grid gap-4">
          {principles.map(({ I, title, body }, i) => (
            <Reveal key={title} delay={i * 0.04}>
              <div className="group flex gap-5 rounded-[20px] border border-line bg-surface p-6 transition-transform duration-500 ease-out-expo hover:-translate-y-1 md:p-8">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-invert-bg text-invert-fg transition-transform duration-500 ease-out-expo group-hover:rotate-[-6deg]">
                  <I size={22} weight="light" />
                </span>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-fg">{title}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBand title="Walk through the architecture with us." />
    </>
  );
}
