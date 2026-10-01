import { LegalDoc, legalMetadata } from "@/components/legal-doc";

export const metadata = legalMetadata("cookie-policy");

export default function Page() {
  return <LegalDoc slug="cookie-policy" />;
}
