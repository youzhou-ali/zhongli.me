import { Streamdown } from "streamdown";

export default function MarkdownContent({ content }: { content: string }) {
  return <Streamdown>{content}</Streamdown>;
}
