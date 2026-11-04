import type { ModelLicense } from "../llm/webllm.ts";
import { SITE } from "../site.ts";

/** Small print: AI disclaimer, model licence notices, credits and support links. */
export function Footer({ license }: { license?: ModelLicense }) {
  const links = [
    SITE.buyMeACoffee && { href: SITE.buyMeACoffee, text: "☕ Buy me a coffee" },
    SITE.koFi && { href: SITE.koFi, text: "Ko-fi" },
    SITE.newsletter && { href: SITE.newsletter, text: "Newsletter" },
    SITE.source && { href: SITE.source, text: "Source on GitHub" },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <footer className="foot">
      <p>
        AI-generated on your device. It may be wrong, weird or offensive, so don't take it seriously.
        {license?.builtWithLlama && (
          <>
            {" "}
            <b>Built with Llama</b> (
            <a href={license.url} target="_blank" rel="noreferrer">licence</a>,{" "}
            <a href={license.policyUrl} target="_blank" rel="noreferrer">acceptable use</a>).
          </>
        )}
        {license && !license.builtWithLlama && license.policyUrl && (
          <>
            {" "}Model: <a href={license.url} target="_blank" rel="noreferrer">{license.name}</a>,{" "}
            <a href={license.policyUrl} target="_blank" rel="noreferrer">use policy</a>.
          </>
        )}
      </p>
      <p>
        {SITE.author && (
          <>
            Made by{" "}
            {SITE.authorUrl ? <a href={SITE.authorUrl} target="_blank" rel="noreferrer">{SITE.author}</a> : SITE.author}
            {links.length > 0 && " · Enjoying Convo? "}
          </>
        )}
        {links.map((l, i) => (
          <span key={l.href}>
            {i > 0 && " · "}
            <a href={l.href} target="_blank" rel="noreferrer">{l.text}</a>
          </span>
        ))}
      </p>
    </footer>
  );
}
