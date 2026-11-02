import { ReactNode } from 'react';

interface GuideMarkdownProps {
  markdown: string;
  /** images are referenced by key, eg. ![alt](editor), so the bundler can hash the files */
  images: Record<string, string>;
}

type ListItem = { text: string; children: ListItem[] };
type List = { ordered: boolean; items: ListItem[] };

/**
 * Renders the guide's markdown: headings, paragraphs, lists (one level of nesting), tables, images,
 * **bold**, *italic* and `code`. Built as elements, so only what the guide uses is supported.
 */
export default function GuideMarkdown(props: GuideMarkdownProps) {
  const { markdown, images } = props;
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: List | null = null;
  let table: string[][] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{formatInline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
    if (list) {
      blocks.push(renderList(list, blocks.length));
      list = null;
    }
    if (table.length) {
      blocks.push(renderTable(table, blocks.length));
      table = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(rawLine);

    if (!line) {
      flush();
    } else if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2];
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      blocks.push(
        <Tag key={blocks.length} id={slugify(text)}>
          {formatInline(text)}
        </Tag>,
      );
    } else if (image) {
      flush();
      const src = images[image[2]];
      if (src) {
        blocks.push(<img key={blocks.length} src={src} alt={image[1]} />);
      }
    } else if (line.startsWith('|')) {
      if (paragraph.length || list) flush();
      const cells = line
        .slice(1, line.endsWith('|') ? -1 : undefined)
        .split('|')
        .map((cell) => cell.trim());
      // the separator row under the header carries no content
      if (!cells.every((cell) => /^:?-+:?$/.test(cell))) {
        table.push(cells);
      }
    } else if (item) {
      if (paragraph.length || table.length) flush();
      const nested = item[1].length > 0;
      const ordered = /\d/.test(item[2]);
      const entry = { text: item[3], children: [] };
      if (nested && list?.items.length) {
        list.items[list.items.length - 1].children.push(entry);
      } else {
        if (!list) list = { ordered, items: [] };
        list.items.push(entry);
      }
    } else {
      if (list || table.length) flush();
      paragraph.push(line);
    }
  }
  flush();

  return <div>{blocks}</div>;
}

function renderList(list: List, key: number): ReactNode {
  const items = list.items.map((item, index) => (
    <li key={index}>
      {formatInline(item.text)}
      {item.children.length > 0 && (
        <ul>
          {item.children.map((child, childIndex) => (
            <li key={childIndex}>{formatInline(child.text)}</li>
          ))}
        </ul>
      )}
    </li>
  ));
  return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

function renderTable(rows: string[][], key: number): ReactNode {
  const [header, ...body] = rows;
  return (
    <table key={key}>
      <thead>
        <tr>
          {header.map((cell, index) => (
            <th key={index}>{formatInline(cell)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, index) => (
              <td key={index}>{formatInline(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** **bold**, *italic* and `code` */
function formatInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
