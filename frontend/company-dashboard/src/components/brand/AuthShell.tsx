import Link from "next/link";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { AuthBrandPanel } from "./AuthBrandPanel";
import { BrandLogo } from "./BrandLogo";

/*
 * The frame every sign-in screen shares, in the website's light style: the
 * brand band on the left, a plain white side on the right with a link at the
 * top, the form in the middle and a mono footer. Colours are the website's
 * own and fixed, so the screens stay light whatever the console theme.
 * The fonts (DM Mono, Satoshi) are loaded app-wide in app/layout.tsx.
 */

export function AuthShell({
  topRight,
  headline,
  lead,
  children,
}: {
  /** The prompt at the top right, e.g. "New to Aavishield? Register". */
  topRight?: React.ReactNode;
  headline?: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-[#fafafa] text-[#0b0b0d] [color-scheme:light] [--control-bg:#ffffff] [--control-fg:#0b0b0d] [--control-placeholder:#8a8a93] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <AuthBrandPanel headline={headline} lead={lead} />

      <main className="relative flex min-h-screen flex-col bg-white">
        <div className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-10 sm:pt-8 [@media(max-height:800px)]:sm:pt-5">
          <Link href="/login" className="lg:hidden">
            <BrandLogo className="text-[22px]" ink="text-[#0b0b0d]" />
          </Link>
          {topRight && <p className="ml-auto text-right text-sm text-[#5d5d66]">{topRight}</p>}
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-8 sm:px-10 [@media(max-height:800px)]:py-4">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>

        <div className="flex items-center justify-between gap-4 px-6 pb-6 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#71717a] sm:px-10 sm:pb-7 [@media(max-height:800px)]:sm:pb-5">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
            Encrypted · SSO ready
          </span>
          <Link href="/privacy" className="transition-colors hover:text-[#0b0b0d]">Privacy</Link>
        </div>
      </main>
    </div>
  );
}

/** Mono eyebrow, Satoshi title and a short lead, as on the website's sections. */
export function AuthHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <>
      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#c2410c]">
        <span className="size-1.5 bg-brand-500" />
        {eyebrow}
      </p>
      <h2 className="mt-4 [@media(max-height:800px)]:mt-2 [font-family:Satoshi,var(--font-inter),sans-serif] text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-[#0b0b0d]">
        {title}
      </h2>
      {children && <p className="mt-2 text-[15px] text-[#5d5d66]">{children}</p>}
    </>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="mt-6 rounded-[4px] border border-[#b42318]/40 bg-[#fdecea] px-4 py-3 text-sm text-[#b42318]">
      {children}
    </div>
  );
}

/** The website's input: square, hairline border, orange focus ring. */
export const authInput = (error?: boolean) =>
  "h-12 w-full rounded-[4px] border bg-white px-4 [@media(max-height:800px)]:h-11 text-[15px] text-[#0b0b0d] placeholder:text-[#8a8a93] outline-none transition-[border-color,box-shadow] focus:ring-4 " +
  (error ? "border-[#b42318] focus:border-[#b42318] focus:ring-[#b42318]/15" : "border-[rgb(11_11_13/0.18)] focus:border-[#ff7000] focus:ring-[#ff7000]/20");

/** One-time codes: the same input, centred in mono. */
export const authCodeInput = (error?: boolean) => `${authInput(error)} text-center font-mono text-lg tracking-[0.4em]`;

/** Password field with the show/hide toggle; the page owns `show` so paired fields reveal together. */
export function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
  error,
  placeholder,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  error?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${authInput(error)} pr-11`}
        placeholder={placeholder}
        required
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#71717a] transition-colors hover:text-[#0b0b0d]"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export const AUTH_LABEL = "mb-2 block text-sm font-medium text-[#0b0b0d]";
export const AUTH_LINK = "text-[#c2410c] hover:text-[#9a3412]";
export const AUTH_HINT = "mt-2 text-[13px] text-[#71717a]";
export const AUTH_CHECK = "mt-0.5 h-4 w-4 rounded-[3px] border-[rgb(11_11_13/0.18)] accent-brand-500";

/** The website's primary button: orange, mono uppercase, arrow nudges on hover. */
export const AUTH_BUTTON =
  "group flex h-12 w-full [@media(max-height:800px)]:h-11 items-center justify-center gap-2.5 rounded-[6px] bg-[#ff7000] font-mono text-[13px] font-medium uppercase tracking-[0.06em] text-white transition-[background-color,transform,opacity] duration-200 hover:bg-[#e56400] active:scale-[0.98] disabled:opacity-50";
export const AUTH_ARROW = "h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-disabled:translate-x-0";



/** Round icon above a confirmation message (email sent, password reset). */
export function AuthDoneIcon({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid size-12 place-items-center rounded-[6px] border border-[#ff7000]/20 bg-[#fff1e5] text-[#ff7000]">{children}</div>;
}


