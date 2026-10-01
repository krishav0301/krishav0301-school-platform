import { Fragment } from "react";

import { parseText, type Inline } from "./text-format";
import styles from "./content.module.css";

function InlineParts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "bold") return <strong key={index}>{part.text}</strong>;
        if (part.type === "italic") return <em key={index}>{part.text}</em>;
        if (part.type === "underline") return <u key={index}>{part.text}</u>;
        if (part.type === "link")
          return (
            <a key={index} href={part.href} rel="nofollow noopener" className={styles.textLink}>
              {part.text}
            </a>
          );
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

/**
 * Website text with its few marks (D-098), drawn only as React elements: every word is a text node, and a
 * link is made only from an address `text-format.ts` allows. The public board and the Admin's preview both use it.
 */
export function FormattedText({ body }: { body: string }) {
  return (
    <>
      {parseText(body).map((block, index) => {
        if (block.type === "heading")
          return (
            <h4 key={index} className={styles.textHeading}>
              <InlineParts parts={block.content} />
            </h4>
          );
        if (block.type === "paragraph")
          return (
            <p key={index} className={styles.paragraph}>
              {block.lines.map((line, n) => (
                <Fragment key={n}>
                  {n > 0 ? <br /> : null}
                  <InlineParts parts={line} />
                </Fragment>
              ))}
            </p>
          );
        const List = block.type === "bullets" ? "ul" : "ol";
        return (
          <List key={index} className={styles.textList}>
            {block.items.map((item, n) => (
              <li key={n}>
                <InlineParts parts={item} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}
