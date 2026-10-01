import { LegalDoc, legalMetadata } from "@/components/legal-doc";

export const metadata = legalMetadata("privacy-policy");

export default function Page() {
  return <LegalDoc slug="privacy-policy" />;
}
