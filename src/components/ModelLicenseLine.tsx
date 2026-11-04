import { browserModelById } from "../llm/webllm.ts";

/** "Built with Llama" / licence links for an in-browser model. */
export function ModelLicenseLine({ id, compact }: { id: string; compact?: boolean }) {
  const lic = browserModelById(id)?.license;
  if (!lic) return null;
  return (
    <span className={`lic ${compact ? "compact" : ""}`}>
      {lic.builtWithLlama && <><b className="llama">Built with Llama</b>{" · "}</>}
      {!compact && <>Downloading a model means accepting its licence: </>}
      <a href={lic.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{lic.name}</a>
      {lic.policyUrl && (
        <>
          {" · "}
          <a href={lic.policyUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>use policy</a>
        </>
      )}
    </span>
  );
}
