// Legal pages for the Aavishield website. Written to match how the product
// actually works (see the platform README). Review with counsel before
// relying on them; commercial terms marked in the refund policy in particular.

export const LEGAL_EMAIL = "info@aavishield.com";
export const LEGAL_UPDATED = "1 October 2026";

export type LegalSection = { id: string; title: string; body: string[]; list?: string[] };
export type LegalPage = {
  slug: string;
  short: string;
  title: string;
  description: string;
  intro: string;
  summary: { title: string; body: string }[];
  sections: LegalSection[];
};

export const legalPages: LegalPage[] = [
  {
    slug: "privacy-policy",
    short: "Privacy",
    title: "Privacy Policy",
    description: "How Aavishield, made by Aavish AI Lab, collects, uses, stores and protects personal data on its website and endpoint security platform.",
    intro:
      "This policy explains what personal data Aavishield collects, why, how long we keep it and the choices you have. It covers our website, the company admin console, the employee portal and the Aavishield agent installed on devices.",
    summary: [
      { title: "Your company decides", body: "For data collected from employee devices, your employer is in charge. We process it on their instructions." },
      { title: "We never sell data", body: "Personal data is never sold or used for advertising." },
      { title: "Scoped to your organisation", body: "Each organisation's data is isolated and visible only to its own authorised admins." },
      { title: "You have rights", body: "Ask for access, correction or deletion at any time." },
    ],
    sections: [
      {
        id: "who-we-are",
        title: "Who we are",
        body: [
          `Aavishield is an endpoint security product built and operated by Aavish AI Lab ("we", "us"). You can reach us about privacy at ${LEGAL_EMAIL}.`,
          "When a company (\"customer\") uses Aavishield to protect its devices, that company decides what is monitored and why. Under India's Digital Personal Data Protection Act, 2023 the customer is the Data Fiduciary and we act as its Data Processor; under the GDPR the customer is the controller and we are a processor. For our own website, sales and billing data we act as the Data Fiduciary or controller.",
        ],
      },
      {
        id: "data-we-collect",
        title: "Data we collect",
        body: ["What we collect depends on how you interact with Aavishield."],
        list: [
          "Website visitors and prospects: name, work email, company, role, team size and anything you write in the demo request form.",
          "Customer administrators: name, work email, password (stored only as a hash), role, sign-in history, two-factor settings and actions taken in the console (audit log).",
          "Employees of customers: name, work email, department, team, devices enrolled and portal account details.",
          "Device data from the agent: hostname, operating system and version, agent version, IP address, installed applications and security posture (disk encryption, firewall, updates, screen lock, antivirus).",
          "Security events from the agent: websites blocked or flagged by policy, blocked application launches, blocked downloads with file name and risk score, and data loss prevention findings (the destination, file name, detector types and a short masked preview of what matched).",
          "Activity monitoring, only on devices the customer enables it for: periodic screenshots, activity level, open applications and work session times.",
          "Billing data: billing contact, company tax details and payment status. Card and bank details are handled by our payment processor, not stored by us.",
        ],
      },
      {
        id: "how-we-use",
        title: "How we use data",
        body: ["We use personal data only to:"],
        list: [
          "Provide the service: enforce the customer's security policies on its devices and show the results to its administrators.",
          "Secure the service: authenticate users, detect abuse, keep audit logs and investigate incidents.",
          "Support customers: answer tickets and emails and troubleshoot problems the customer reports.",
          "Bill customers and meet legal, tax and accounting obligations.",
          "Respond to demo requests and send service emails such as sign-in codes and security alerts.",
          "Improve the product using aggregated, de-identified usage information.",
        ],
      },
      {
        id: "monitor-only",
        title: "Data loss prevention and monitoring",
        body: [
          "Data loss prevention in Aavishield is monitor-only: it records findings and never blocks the employee's upload. To classify content, files may be inspected in memory by our scanning service, including OCR of images and, where enabled, analysis by an AI model. We store the finding and a short masked preview, not a copy of the file.",
          "Screenshot monitoring is off by default and is enabled per device by the customer. Customers are responsible for telling their employees what is monitored and for having a lawful basis to do so.",
        ],
      },
      {
        id: "sharing",
        title: "Who we share data with",
        body: [
          "We do not sell personal data and we do not share it for advertising. A customer's data is visible only to that customer's authorised users, never to other organisations on the platform.",
          "We use service providers who process data on our behalf under contract, for: cloud hosting and storage, network delivery and protection, transactional email, payment processing, and AI model providers used to classify content for data loss prevention. We may disclose data if the law requires it, or to protect the rights and safety of our users and the public.",
        ],
      },
      {
        id: "security",
        title: "How we protect data",
        body: ["Security is our product, so we hold ourselves to it."],
        list: [
          "Policy bundles sent to devices are signed with Ed25519 and verified on the device.",
          "Each organisation's data is scoped to that organisation.",
          "Per-organisation certificate authority keys are stored encrypted at rest.",
          "Screenshots and files are served only through short-lived signed links.",
          "Internal scanning services accept only authenticated requests.",
          "Sign-in uses a second factor: an emailed one-time code or an authenticator app.",
        ],
      },
      {
        id: "retention",
        title: "How long we keep data",
        body: [
          "Security events and monitoring data are kept for the retention period the customer configures, or our default, and then deleted. Account data is kept while the customer's subscription is active and for a limited period afterwards for legal, tax and audit purposes. Demo request data is kept for up to 24 months unless you ask us to delete it sooner.",
        ],
      },
      {
        id: "your-rights",
        title: "Your rights",
        body: [
          "Depending on where you live, you can ask to access, correct, update or erase your personal data, withdraw consent, nominate someone to exercise your rights, and raise a grievance. If your data came to us through your employer's use of Aavishield, please contact your employer first; we will help them respond.",
          `To exercise your rights or raise a grievance, email ${LEGAL_EMAIL}. We aim to respond within 30 days. You may also complain to the Data Protection Board of India or your local data protection authority.`,
        ],
      },
      {
        id: "transfers",
        title: "International transfers",
        body: [
          "Our service providers may process data in countries other than yours. Where we transfer data, we do so as permitted by applicable law and with contractual safeguards in place.",
        ],
      },
      {
        id: "children",
        title: "Children",
        body: ["Aavishield is a business product. It is not directed at children and we do not knowingly collect children's personal data."],
      },
      {
        id: "changes",
        title: "Changes to this policy",
        body: ["We may update this policy as the product changes. We will post the new version here with a new date, and tell customers about material changes by email or in the console."],
      },
    ],
  },
  {
    slug: "terms-and-conditions",
    short: "Terms",
    title: "Terms and Conditions",
    description: "The terms that govern access to and use of the Aavishield website, console, employee portal and endpoint agent.",
    intro:
      "These terms are an agreement between Aavish AI Lab and the organisation that signs up for Aavishield. By creating an account, installing the agent or using the service you agree to them on behalf of your organisation.",
    summary: [
      { title: "You control your policy", body: "You decide what is monitored and must use Aavishield lawfully and transparently." },
      { title: "Per-device subscription", body: "Fees are per enrolled device, billed in advance for the term on your order." },
      { title: "Your data stays yours", body: "You own your data. We process it only to provide the service." },
      { title: "Fair limits", body: "Liability is limited as described below, as is usual for business software." },
    ],
    sections: [
      { id: "service", title: "The service", body: ["Aavishield provides an endpoint agent for macOS, Windows and Linux, a company admin console, an employee portal and related services such as web filtering, data loss prevention, application control, VPN control, malware scanning, device posture checks and optional activity monitoring. Features vary by plan."] },
      {
        id: "accounts",
        title: "Accounts and access",
        body: ["You must give accurate information when you sign up and keep it up to date. You are responsible for your administrators' accounts, for keeping credentials safe, and for all activity under your organisation. Tell us promptly at " + LEGAL_EMAIL + " if you suspect unauthorised access."],
      },
      {
        id: "your-responsibilities",
        title: "Your responsibilities",
        body: ["Because Aavishield can monitor devices and activity, you agree to:"],
        list: [
          "Install the agent only on devices your organisation owns or has the right to manage.",
          "Inform employees and contractors about what is monitored, and obtain any consent or notice the law requires.",
          "Have a lawful basis for the monitoring you enable, and keep it proportionate.",
          "Follow our Acceptable Use Policy.",
          "Not use Aavishield to monitor anyone outside your organisation or for any unlawful purpose.",
        ],
      },
      {
        id: "fees",
        title: "Fees, billing and taxes",
        body: [
          "Fees are set out in your order or plan and are charged per enrolled device, in advance, for the subscription term. Payments are processed by our payment partner. Prices exclude taxes such as GST, which are added where applicable. If an invoice is unpaid after a reminder, we may suspend the service until it is paid. Refunds and cancellations are covered by our Refund and Cancellation Policy.",
        ],
      },
      {
        id: "data",
        title: "Your data",
        body: [
          "You keep all rights to the data you and your devices send to Aavishield (\"customer data\"). You give us permission to process customer data only to provide, secure and support the service, as described in our Privacy Policy. We act as your processor for personal data in customer data.",
          "After your subscription ends, you can export your reports during the notice period. We then delete customer data within a reasonable time, except where the law requires us to keep it.",
        ],
      },
      {
        id: "acceptable-use",
        title: "Restrictions",
        body: ["You must not:"],
        list: [
          "Reverse engineer, decompile or try to extract the source code of the agent or service, except where the law allows.",
          "Resell, sublicense or provide the service to third parties without our written agreement.",
          "Interfere with or disrupt the service, or try to access other organisations' data.",
          "Use the service to build a competing product.",
        ],
      },
      {
        id: "availability",
        title: "Availability and support",
        body: ["We work to keep Aavishield available and secure, and provide support by email and through in-console tickets. Planned maintenance is scheduled to minimise disruption. Specific service levels apply only if agreed in your order."],
      },
      {
        id: "ip",
        title: "Intellectual property",
        body: ["We own Aavishield, including the agent, console, documentation and all improvements. These terms give you a limited, non-exclusive, non-transferable right to use the service during your subscription. Feedback you give us may be used to improve the product without obligation."],
      },
      {
        id: "warranties",
        title: "Warranties and disclaimers",
        body: ["We will provide the service with reasonable skill and care. No security product can stop every threat, and Aavishield does not guarantee that your devices or data will never be compromised. Except as stated in these terms, the service is provided \"as is\" to the extent the law allows."],
      },
      {
        id: "liability",
        title: "Limitation of liability",
        body: ["To the extent the law allows, neither party is liable for indirect, incidental or consequential losses, or loss of profits, revenue or data. Each party's total liability under these terms is limited to the fees paid or payable by you in the 12 months before the event giving rise to the claim. These limits do not apply to your payment obligations or to liability that cannot be limited by law."],
      },
      {
        id: "term",
        title: "Term and termination",
        body: ["These terms last for your subscription term and renew as set out in your order. Either party may terminate if the other materially breaches these terms and does not fix the breach within 30 days of notice. On termination, your access ends and the agent stops enforcing policy."],
      },
      {
        id: "law",
        title: "Governing law",
        body: ["These terms are governed by the laws of India. The courts of India have jurisdiction over any dispute, unless your order says otherwise. We will always try to resolve disputes informally first."],
      },
      { id: "changes", title: "Changes", body: ["We may update these terms. Material changes will be notified at least 30 days in advance by email or in the console. Continuing to use the service after that means you accept the new terms."] },
    ],
  },
  {
    slug: "cookie-policy",
    short: "Cookies",
    title: "Cookie Policy",
    description: "Which cookies and similar storage the Aavishield website, console and employee portal use, and how to control them.",
    intro: "We keep cookies to the minimum the service needs. This policy lists what we use and why.",
    summary: [
      { title: "No advertising cookies", body: "We do not use cookies to track you for advertising." },
      { title: "Essentials only", body: "Sign-in and security cookies keep the console working." },
      { title: "One preference", body: "The website remembers your light or dark theme in your browser." },
      { title: "You are in control", body: "Your browser lets you clear or block cookies at any time." },
    ],
    sections: [
      { id: "what", title: "What cookies are", body: ["Cookies are small files a website stores in your browser. Similar technologies such as local storage work the same way. We refer to all of them as cookies here."] },
      { id: "website", title: "On our website", body: ["The public website does not set advertising or third-party tracking cookies. It stores your theme choice (light or dark) in your browser's local storage so the site looks the way you left it."] },
      {
        id: "console",
        title: "In the console and employee portal",
        body: ["When you sign in to the company admin console or the employee portal we use strictly necessary cookies to:"],
        list: ["Keep you signed in and refresh your session securely", "Protect forms against cross-site request forgery", "Remember your theme and layout preferences, such as a collapsed sidebar"],
      },
      { id: "third-party", title: "Third parties", body: ["Our network provider may set a strictly necessary cookie to protect the site against bots and abuse. We do not allow third parties to place advertising cookies through our services."] },
      { id: "control", title: "Managing cookies", body: ["You can clear or block cookies in your browser settings. If you block strictly necessary cookies, you will not be able to sign in to the console or portal."] },
      { id: "changes", title: "Changes", body: [`If we add new kinds of cookies we will update this policy and, where the law requires, ask for your consent first. Questions: ${LEGAL_EMAIL}.`] },
    ],
  },
  {
    slug: "acceptable-use-policy",
    short: "Acceptable use",
    title: "Acceptable Use Policy",
    description: "How customers may and may not use Aavishield's monitoring and security features, including fair and lawful employee monitoring.",
    intro: "Aavishield gives organisations real visibility into their devices. With that comes responsibility. This policy sets the rules for using it fairly and lawfully.",
    summary: [
      { title: "Company devices", body: "Install the agent only on devices you own or have the right to manage." },
      { title: "Be transparent", body: "Tell people what is monitored before you monitor it." },
      { title: "Be proportionate", body: "Monitor only what you need for security and compliance." },
      { title: "No abuse", body: "Never use Aavishield to harass, stalk or discriminate." },
    ],
    sections: [
      { id: "purpose", title: "Purpose", body: ["Aavishield exists to protect organisations' devices and data. Use it for security, compliance and legitimate management of company devices."] },
      {
        id: "transparency",
        title: "Transparency with employees",
        body: ["Before enabling monitoring you must:"],
        list: ["Tell employees and contractors that Aavishield is installed and what it does", "Explain whether activity monitoring and screenshots are enabled on their device", "Make your internal IT or monitoring policy available to them", "Obtain consent where your local law requires it"],
      },
      {
        id: "proportionate",
        title: "Proportionate monitoring",
        body: ["Enable screenshot monitoring only where it is necessary and proportionate, for example on devices handling regulated data or during a specific investigation. Use the blur, interval and retention settings to collect no more than you need."],
      },
      {
        id: "prohibited",
        title: "Prohibited uses",
        body: ["You must not use Aavishield to:"],
        list: [
          "Monitor personal devices without the owner's informed agreement",
          "Monitor people outside your organisation",
          "Harass, stalk, intimidate or discriminate against anyone",
          "Capture or review content you have no lawful reason to access, such as private medical or legal communications",
          "Break any law, including privacy, employment and telecommunications law",
          "Probe, attack or overload Aavishield or other customers' data",
        ],
      },
      { id: "access", title: "Access within your organisation", body: ["Give console access only to people who need it, use roles to limit what each person can do, and review access regularly. Activity monitoring data should be visible only to the smallest group that needs it."] },
      { id: "enforcement", title: "Enforcement", body: [`If we believe Aavishield is being misused, we may ask you to stop, suspend affected features or end the service. Report suspected misuse to ${LEGAL_EMAIL}.`] },
    ],
  },
  {
    slug: "refund-and-cancellation",
    short: "Refunds",
    title: "Refund and Cancellation Policy",
    description: "How cancellations, renewals, device changes and refunds work for Aavishield subscriptions.",
    intro: "This policy explains how you can cancel a Aavishield subscription and when refunds apply. It forms part of our Terms and Conditions.",
    summary: [
      { title: "Cancel any time", body: "Cancellation stops renewal. Service continues to the end of the paid term." },
      { title: "Billing errors refunded", body: "If we charge you incorrectly, we refund the difference." },
      { title: "Add devices any time", body: "Extra devices are billed pro-rata for the rest of the term." },
      { title: "Original payment method", body: "Approved refunds go back to the way you paid." },
    ],
    sections: [
      { id: "trial", title: "Trials and pilots", body: ["Where we offer a trial or pilot, you can stop at any time before it ends without being charged."] },
      { id: "cancel", title: "Cancelling a subscription", body: [`You can cancel by writing to ${LEGAL_EMAIL} or through your account contact. Cancellation stops the next renewal. Your service continues until the end of the term you have already paid for.`] },
      { id: "refunds", title: "Refunds", body: ["Subscription fees are paid in advance and are generally non-refundable for the current term, except:"], list: ["If you were charged more than once or charged an incorrect amount", "If we materially fail to provide the service and cannot fix it within a reasonable time", "Where the law requires a refund", "Where your order form says otherwise"] },
      { id: "devices", title: "Adding and removing devices", body: ["Devices added during a term are charged pro-rata for the remaining period. Removing devices reduces the count at your next renewal; it does not create a refund for the current term."] },
      { id: "process", title: "How refunds are paid", body: ["Approved refunds are made to the original payment method through our payment partner, usually within 7 to 10 working days of approval. Your bank may take longer to show the credit."] },
      { id: "after", title: "After cancellation", body: ["When the paid term ends, enrolled agents stop enforcing policy and your console access ends. You can export reports before the end date. Data is then deleted as set out in our Privacy Policy."] },
      { id: "contact", title: "Contact", body: [`Questions about billing or refunds: ${LEGAL_EMAIL}.`] },
    ],
  },
];

export const getLegal = (slug: string) => legalPages.find((l) => l.slug === slug);
