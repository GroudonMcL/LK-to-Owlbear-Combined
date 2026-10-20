// A LegendKeeper page as fetched from the API, for the GM: the full page,
// hidden pages, secrets and DM content included. Images come through the
// authenticated proxy; mentions of other pages open them in place.

import type { ContentBlock, ContentRun, PageContent } from "@lkob/shared";
import { EyeOff, ImageOff, Lock, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient, describeError, isAbort } from "../lib/api";
import { useSettings } from "../lib/settings";
import { Banner, Button, Empty, Spinner } from "../ui/components";
import { useAuthedImage } from "../ui/useAuthedImage";

interface Ctx {
  api: ApiClient;
  projectId: string;
  resourceId: string;
  onMention: (resourceId: string, name: string) => void;
}

export function ContentView({
  projectId,
  resourceId,
  hidden,
  onMention,
}: {
  projectId: string;
  resourceId: string;
  hidden: boolean;
  onMention: (resourceId: string, name: string) => void;
}) {
  const settings = useSettings();
  const api = useMemo(
    () => (settings.backendUrl && settings.apiKey ? new ApiClient(settings) : null),
    [settings.backendUrl, settings.apiKey],
  );
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; content: PageContent } | { kind: "error"; message: string }>({
    kind: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    api
      .content(projectId, resourceId, attempt > 0, controller.signal)
      .then((content) => setState({ kind: "ready", content }))
      .catch((err) => !isAbort(err) && setState({ kind: "error", message: describeError(err) }));
    return () => controller.abort();
  }, [api, projectId, resourceId, attempt]);

  if (!api) {
    return (
      <Empty icon={<Lock />} title="Connect LegendKeeper first">
        Open the extension from the toolbar and paste your API key in Settings.
      </Empty>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className="empty">
        <Spinner large />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="stack" style={{ padding: 12 }}>
        <Banner tone="danger" title="Couldn't load the page">
          {state.message}
        </Banner>
        <Button icon={<RefreshCw />} onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  const { content } = state;
  const ctx: Ctx = { api, projectId, resourceId, onMention };
  const docs = content.documents.filter((d) => d.blocks.length > 0 || d.failed);
  return (
    <article className="lk-content scroll">
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {hidden && (
          <span className="badge warn">
            <EyeOff /> Hidden from players
          </span>
        )}
        {content.aliases.length > 0 && <span className="small faint">Also: {content.aliases.join(", ")}</span>}
      </div>
      {content.sidebar.length > 0 && (
        <aside className="lk-sidebar">
          <Blocks blocks={content.sidebar} ctx={ctx} />
        </aside>
      )}
      {docs.map((doc) => (
        <section key={doc.id}>
          {docs.length > 1 && <h2 className="lk-doc-title">{doc.name}</h2>}
          {doc.failed ? <Banner tone="warn">This document couldn't be read.</Banner> : <Blocks blocks={doc.blocks} ctx={ctx} />}
        </section>
      ))}
      {docs.length === 0 && content.sidebar.length === 0 && <p className="faint">This page has no text yet.</p>}
      {content.otherDocuments.length > 0 && (
        <p className="small faint">Also on this page in LegendKeeper: {content.otherDocuments.join(", ")}.</p>
      )}
      {content.warnings.map((w) => (
        <Banner key={w} tone="warn">
          {w}
        </Banner>
      ))}
    </article>
  );
}

function Blocks({ blocks, ctx }: { blocks: ContentBlock[]; ctx: Ctx }) {
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} block={block} ctx={ctx} />
      ))}
    </>
  );
}

function Block({ block, ctx }: { block: ContentBlock; ctx: Ctx }): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return block.runs.length ? (
        <p>
          <Runs runs={block.runs} ctx={ctx} />
        </p>
      ) : null;
    case "heading": {
      // The panel already shows the page title; document headings start a level down.
      const Tag = `h${Math.min(6, block.level + 1)}` as "h2";
      return (
        <Tag>
          <Runs runs={block.runs} ctx={ctx} />
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote>
          <Blocks blocks={block.children} ctx={ctx} />
        </blockquote>
      );
    case "code":
      return <pre className="lk-code">{block.text}</pre>;
    case "rule":
      return <hr />;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <Blocks blocks={item} ctx={ctx} />
        </li>
      ));
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "task":
      return (
        <p className="lk-task">
          <input type="checkbox" checked={block.checked} readOnly aria-label={block.checked ? "Done" : "Not done"} />{" "}
          <Runs runs={block.runs} ctx={ctx} />
        </p>
      );
    case "table":
      return (
        <div className="lk-table-wrap">
          <table className="lk-table">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) =>
                    cell.header ? (
                      <th key={c}>
                        <Runs runs={cell.text} ctx={ctx} />
                      </th>
                    ) : (
                      <td key={c}>
                        <Runs runs={cell.text} ctx={ctx} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "image":
      return <ContentImage imageId={block.imageId} caption={block.caption} ctx={ctx} />;
    case "keyValue":
      return (
        <dl className="lk-kv">
          {block.rows.map((row, i) => (
            <div key={i}>
              <dt>{row.key}</dt>
              <dd>
                <Runs runs={row.runs} ctx={ctx} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "box":
      if (block.tone === "expand") {
        return (
          <details className="lk-box">
            <summary>{block.title || "More"}</summary>
            <Blocks blocks={block.children} ctx={ctx} />
          </details>
        );
      }
      return (
        <div className={`lk-box lk-box-${block.tone}`}>
          {block.title && (
            <div className="lk-box-title">
              {block.tone === "secret" && <Lock size={12} />} {block.title}
            </div>
          )}
          <Blocks blocks={block.children} ctx={ctx} />
        </div>
      );
    case "unsupported":
      return <p className="small faint">[{block.label}]</p>;
  }
}

function Runs({ runs, ctx }: { runs: ContentRun[]; ctx: Ctx }) {
  return (
    <>
      {runs.map((run, i) => {
        if (run.text === "\n") return <br key={i} />;
        let node: ReactNode = run.text;
        if (run.code) node = <code>{node}</code>;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.italic) node = <em>{node}</em>;
        if (run.underline) node = <u>{node}</u>;
        if (run.strike) node = <s>{node}</s>;
        if (run.mention) {
          const id = run.mention;
          return (
            <button key={i} type="button" className="lk-mention" onClick={() => ctx.onMention(id, run.text)}>
              {node}
            </button>
          );
        }
        if (run.link && /^https?:\/\//i.test(run.link)) {
          return (
            <a key={i} href={run.link} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function ContentImage({ imageId, caption, ctx }: { imageId: string; caption?: string; ctx: Ctx }) {
  const image = useAuthedImage(ctx.api, ctx.projectId, ctx.resourceId, imageId);
  return (
    <figure className="lk-figure">
      {image.status === "ready" ? (
        <img src={image.url} alt={caption ?? ""} />
      ) : image.status === "error" ? (
        <div className="lk-figure-missing small faint">
          <ImageOff size={14} /> Image unavailable
        </div>
      ) : (
        <div className="lk-figure-missing">
          <Spinner />
        </div>
      )}
      {caption && <figcaption className="small faint">{caption}</figcaption>}
    </figure>
  );
}
