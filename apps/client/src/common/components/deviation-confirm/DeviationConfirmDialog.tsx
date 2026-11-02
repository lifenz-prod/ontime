import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
} from '@chakra-ui/react';

import { useDeviationConfirm } from '../../stores/deviationConfirm';

/**
 * Asks before a cue in a generated service section (eg 11am) is edited by hand,
 * since it then stops following the master service
 */
export default function DeviationConfirmDialog() {
  const resolve = useDeviationConfirm((state) => state.resolve);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return (
    <AlertDialog
      variant='ontime'
      isOpen={resolve !== null}
      leastDestructiveRef={cancelRef}
      onClose={() => resolve?.(false)}
    >
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize='lg' fontWeight='bold'>
            Edit this service only?
          </AlertDialogHeader>
          <AlertDialogBody>
            This cue is copied from the first service. If you change it here, it will keep your changes and stop
            following edits made to the first service.
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button ref={cancelRef} onClick={() => resolve?.(false)} variant='ontime-ghosted-white'>
              Cancel
            </Button>
            <Button variant='ontime-filled' onClick={() => resolve?.(true)} ml={4}>
              Change this service
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
}
