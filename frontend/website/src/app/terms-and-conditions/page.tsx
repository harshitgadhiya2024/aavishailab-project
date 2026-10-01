import { LegalDoc, legalMetadata } from "@/components/legal-doc";

export const metadata = legalMetadata("terms-and-conditions");

export default function Page() {
  return <LegalDoc slug="terms-and-conditions" />;
}
