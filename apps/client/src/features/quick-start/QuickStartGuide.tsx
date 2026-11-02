import { IoApps, IoDownloadOutline } from 'react-icons/io5';
import { IconButton, useDisclosure } from '@chakra-ui/react';

import NavigationMenu from '../../common/components/navigation-menu/NavigationMenu';
import { useWindowTitle } from '../../common/hooks/useWindowTitle';

import editorImage from './assets/editor.png';
import ipadEditorImage from './assets/ipad-editor.png';
import guidePdf from './assets/ontime-quick-start.pdf?url';
import staffGuide from './content/staff.md?raw';
import volunteersGuide from './content/volunteers.md?raw';
import GuideMarkdown from './GuideMarkdown';

import style from './QuickStartGuide.module.scss';

const images = { 'ipad-editor': ipadEditorImage, editor: editorImage };

function scrollToGuide(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The volunteers' and production staff's quick start guides, bundled with the app so they work offline.
 * To update them, edit the markdown in ./content and regenerate the PDF (see ./README.md)
 */
export default function QuickStartGuide() {
  useWindowTitle('Quick Start');
  const { isOpen, onOpen, onClose } = useDisclosure();

  return (
    <div className={style.page}>
      <NavigationMenu isOpen={isOpen} onClose={onClose} />
      <nav className={style.toc}>
        <IconButton
          aria-label='Toggle navigation'
          variant='ontime-subtle-white'
          size='lg'
          icon={<IoApps />}
          onClick={onOpen}
        />
        {/* scroll rather than link to #id, which would change the route */}
        <button type='button' className={style.jump} onClick={() => scrollToGuide('volunteers')}>
          Volunteers
        </button>
        <button type='button' className={style.jump} onClick={() => scrollToGuide('staff')}>
          Production staff
        </button>
        <a href={guidePdf} download='Ontime Quick Start.pdf' className={style.download}>
          <IoDownloadOutline />
          Download PDF
        </a>
      </nav>
      <article id='volunteers' className={style.guide}>
        <GuideMarkdown markdown={volunteersGuide} images={images} />
      </article>
      <article id='staff' className={style.guide}>
        <GuideMarkdown markdown={staffGuide} images={images} />
      </article>
    </div>
  );
}
