import { FormEvent, useEffect, useState } from 'react';
import { IoArrowForward, IoLogoGoogle } from 'react-icons/io5';
import { Button, Input, Select } from '@chakra-ui/react';
import axios from 'axios';
import { RecentSheet } from 'ontime-types';
import { parseGoogleSheetInput } from 'ontime-utils';

import { getRecentSheets, openPublicSheet } from '../../../../common/api/sheets';
import { maybeAxiosError } from '../../../../common/api/utils';
import * as Panel from '../../panel-utils/PanelUtils';

import { useSheetStore } from './useSheetStore';

interface GSheetPublicProps {
  onCancel: () => void;
  onSignIn: () => void;
}

/**
 * Opens a Google Sheet by its link, for sheets shared as "anyone with the link can view"
 */
export default function GSheetPublic(props: GSheetPublicProps) {
  const { onCancel, onSignIn } = props;

  const [link, setLink] = useState('');
  const [recentSheets, setRecentSheets] = useState<RecentSheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setPublicSheet = useSheetStore((state) => state.setPublicSheet);

  useEffect(() => {
    getRecentSheets()
      .then(setRecentSheets)
      .catch(() => {
        /** recents are a convenience, we can do without */
      });
  }, []);

  const openSheet = async (value: string) => {
    if (!parseGoogleSheetInput(value)) {
      setError('Paste a Google Sheets link or a sheet ID');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const sheet = await openPublicSheet(value);
      setPublicSheet(sheet);
    } catch (error) {
      setError(getServerMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    openSheet(link);
  };

  const handleRecent = (sheetId: string) => {
    if (!sheetId) return;
    setLink(sheetId);
    openSheet(sheetId);
  };

  return (
    <Panel.Section as='form' onSubmit={handleSubmit}>
      <Panel.Title>
        Import from Google Sheet
        <Button variant='ontime-subtle' size='sm' onClick={onCancel} isDisabled={loading}>
          Go Back
        </Button>
      </Panel.Title>
      <Panel.ListGroup>
        <Panel.Description>Paste the link to a sheet shared as “Anyone with the link can view”</Panel.Description>
        <Panel.InlineElements>
          <Input
            size='sm'
            variant='ontime-filled'
            autoComplete='off'
            placeholder='https://docs.google.com/spreadsheets/d/...'
            value={link}
            onChange={(event) => setLink(event.target.value)}
            isDisabled={loading}
            data-testid='gsheet-link'
          />
          <Button
            type='submit'
            variant='ontime-filled'
            size='sm'
            rightIcon={<IoArrowForward />}
            isLoading={loading}
            isDisabled={!link.trim()}
          >
            Open
          </Button>
        </Panel.InlineElements>
        <Panel.Error>{error}</Panel.Error>
      </Panel.ListGroup>
      {recentSheets.length > 0 && (
        <Panel.ListGroup>
          <Panel.Description>Or pick a recent sheet</Panel.Description>
          <Select
            variant='ontime'
            size='sm'
            placeholder='Recent sheets'
            value=''
            onChange={(event) => handleRecent(event.target.value)}
            isDisabled={loading}
            data-testid='gsheet-recent'
          >
            {recentSheets.map((sheet) => (
              <option key={sheet.sheetId} value={sheet.sheetId}>
                {sheet.title}
              </option>
            ))}
          </Select>
        </Panel.ListGroup>
      )}
      <Panel.ListGroup>
        <Panel.Description>Private sheet, or want to export back to the sheet?</Panel.Description>
        <Panel.InlineElements>
          <Button variant='ontime-subtle' size='sm' leftIcon={<IoLogoGoogle />} onClick={onSignIn} isDisabled={loading}>
            Sign in with Google
          </Button>
        </Panel.InlineElements>
      </Panel.ListGroup>
    </Panel.Section>
  );
}

/** the server explains what went wrong in words meant for the user, so we show them as they are */
function getServerMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return maybeAxiosError(error);
}
