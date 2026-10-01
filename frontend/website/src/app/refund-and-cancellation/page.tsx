import { LegalDoc, legalMetadata } from "@/components/legal-doc";

export const metadata = legalMetadata("refund-and-cancellation");

export default function Page() {
  return <LegalDoc slug="refund-and-cancellation" />;
}
