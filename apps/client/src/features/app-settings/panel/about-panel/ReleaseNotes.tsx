import { ReactNode } from 'react';

import style from './AboutPanel.module.scss';

/**
 * Shows release notes written in markdown: headings, bullet lists, paragraphs, bold and code.
 * Built as elements rather than injected HTML, since the notes come from outside the app.
 */
export default function ReleaseNotes({ notes }: { notes: string }) {
  if (!notes) {
    return <div className={style.releaseNotes}>This release has no notes.</div>;
  }

  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((item, index) => (
            <li key={index}>{formatInline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{formatInline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
  };

  for (const rawLine of notes.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      blocks.push(<h4 key={blocks.length}>{formatInline(heading[1])}</h4>);
    } else if (bullet) {
      if (paragraph.length) flush();
      list.push(bullet[1]);
    } else if (list.length && /^\s+/.test(rawLine)) {
      // a wrapped bullet continues the item above
      list[list.length - 1] += ` ${line}`;
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();

  return <div className={style.releaseNotes}>{blocks}</div>;
}

/** **bold** and `code` */
function formatInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
