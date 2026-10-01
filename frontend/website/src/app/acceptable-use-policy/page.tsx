import { LegalDoc, legalMetadata } from "@/components/legal-doc";

export const metadata = legalMetadata("acceptable-use-policy");

export default function Page() {
  return <LegalDoc slug="acceptable-use-policy" />;
}
