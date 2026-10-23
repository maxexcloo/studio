import { memo, useDeferredValue } from "react";
import { Anchor, Typography } from "@mantine/core";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import classes from "./AssistantMarkdown.module.css";

const components: Components = {
  a: ({ href, title, children }) => {
    const external = /^(?:https?:)?\/\//i.test(href || "");
    return (
      <Anchor
        href={href}
        title={title}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {children}
      </Anchor>
    );
  },
  img: ({ src, alt }) => (
    <Anchor href={src} target="_blank" rel="noopener noreferrer">
      {alt || "View Image"}
    </Anchor>
  ),
};

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <Typography className={classes.content}>
      <ReactMarkdown skipHtml components={components}>
        {content}
      </ReactMarkdown>
    </Typography>
  );
});

export function AssistantMarkdown({ content }: { content: string }) {
  const deferredContent = useDeferredValue(content);
  return <MarkdownContent content={deferredContent} />;
}
