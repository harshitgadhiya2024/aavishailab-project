import {
  AppleLogo,
  DropboxLogo,
  GithubLogo,
  GoogleDriveLogo,
  GoogleLogo,
  LinuxLogo,
  MicrosoftOutlookLogo,
  MicrosoftTeamsLogo,
  OpenAiLogo,
  SlackLogo,
  WindowsLogo,
} from "@phosphor-icons/react/dist/ssr";

const items = [
  { I: AppleLogo, name: "macOS" },
  { I: WindowsLogo, name: "Windows" },
  { I: LinuxLogo, name: "Linux" },
  { I: GoogleLogo, name: "Gmail" },
  { I: MicrosoftOutlookLogo, name: "Outlook" },
  { I: MicrosoftTeamsLogo, name: "Microsoft Teams" },
  { I: OpenAiLogo, name: "ChatGPT" },
  { I: SlackLogo, name: "Slack" },
  { I: GoogleDriveLogo, name: "Google Drive" },
  { I: DropboxLogo, name: "Dropbox" },
  { I: GithubLogo, name: "GitHub" },
];

/** The site's one marquee: the platforms and apps policy is enforced across. */
export function Marquee() {
  const row = [...items, ...items];
  return (
    <div className="group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <ul className="flex w-max animate-marquee items-center gap-14 py-2 group-hover:[animation-play-state:paused]">
        {row.map(({ I, name }, i) => (
          <li key={i} className="text-fg/55 transition-colors duration-300 hover:text-fg">
            <I size={34} weight="fill" aria-label={i < items.length ? name : undefined} aria-hidden={i >= items.length} />
          </li>
        ))}
      </ul>
    </div>
  );
}
