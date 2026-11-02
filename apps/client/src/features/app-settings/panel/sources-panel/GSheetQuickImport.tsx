import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IoArrowForward, IoLogoGoogle, IoRefresh } from 'react-icons/io5';
import { Button, Input, Select } from '@chakra-ui/react';
import axios from 'axios';
import { LoadedSheet, PublicSheetInfo, RecentSheet } from 'ontime-types';
import { ImportMap, parseGoogleSheetInput } from 'ontime-utils';

import {
  getLoadedSheet,
  getRecentSheets,
  getWorksheetNames,
  openPublicSheet,
  previewPublicRundown,
  previewRundown,
} from '../../../../common/api/sheets';
import { maybeAxiosError } from '../../../../common/api/utils';
import * as Panel from '../../panel-utils/PanelUtils';

import { pickWorksheet } from './import-map/importMapUtils';
import useGoogleSheet from './useGoogleSheet';

import style from './SourcesPanel.module.scss';

const maxRecentButtons = 5;

interface GSheetQuickImportProps {
  /** there is no column mapping yet, so the sheet needs to go through the import options first */
  onNeedsMapping: (sheet: PublicSheetInfo) => void;
  /** opens the import options for the loaded sheet */
  onEditMapping: (loaded: LoadedSheet) => void;
  onSignIn: () => void;
}

type Loaded = { sheet: LoadedSheet; importMap: ImportMap };

/**
 * Imports straight from a Google Sheet, reusing the column mapping of the last import,
 * so changing sheet or tab is a single tap
 */
export default function GSheetQuickImport(props: GSheetQuickImportProps) {
  const { onNeedsMapping, onEditMapping, onSignIn } = props;

  const [link, setLink] = useState('');
  const [recentSheets, setRecentSheets] = useState<RecentSheet[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadedWorksheets, setLoadedWorksheets] = useState<string[]>([]);
  /** what is being worked on: the link form, a recent sheet ID, or the loaded sheet tab */
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { importRundown } = useGoogleSheet();

  const refresh = useCallback(async () => {
    const [recents, current] = await Promise.all([
      getRecentSheets().catch(() => [] as RecentSheet[]),
      getLoadedSheet().catch(() => null),
    ]);
    setRecentSheets(recents);
    setLoaded(current);
    return current;
  }, []);

  /** the tabs of the loaded sheet, so it can switch tab without opening the sheet again */
  const loadWorksheets = useCallback(async (current: Loaded | null) => {
    if (!current) {
      setLoadedWorksheets([]);
      return;
    }
    try {
      const names =
        current.sheet.access === 'public'
          ? (await openPublicSheet(current.sheet.sheetId)).worksheets
          : await getWorksheetNames(current.sheet.sheetId);
      setLoadedWorksheets(names);
    } catch {
      // without the list we can still show the tab we have
      setLoadedWorksheets([current.sheet.worksheet]);
    }
  }, []);

  useEffect(() => {
    refresh().then(loadWorksheets);
  }, [refresh, loadWorksheets]);

  const runImport = async (task: string, read: () => Promise<{ worksheets?: string[]; worksheet: string } | null>) => {
    setBusy(task);
    setError('');
    setSuccess('');
    try {
      const result = await read();
      if (!result) return;
      await refresh();
      // switching tab keeps the list we already have
      if (result.worksheets) {
        setLoadedWorksheets(result.worksheets);
      }
      setSuccess(`Imported “${result.worksheet}”`);
    } catch (error) {
      setError(getServerMessage(error));
    } finally {
      setBusy('');
    }
  };

  /** opens a public sheet and imports it with the last mapping, or hands over to the import options */
  const importPublicSheet = (value: string, task: string) =>
    runImport(task, async () => {
      if (!parseGoogleSheetInput(value)) {
        throw new Error('Paste a Google Sheets link or a sheet ID');
      }
      const sheet = await openPublicSheet(value);
      if (!loaded) {
        onNeedsMapping(sheet);
        return null;
      }
      const worksheet = pickWorksheet(sheet.worksheets, sheet.worksheet, loaded.importMap.worksheet);
      const data = await previewPublicRundown(sheet.sheetId, { ...loaded.importMap, worksheet });
      await importRundown(data.rundown, data.customFields, data.serviceProfiles);
      return { worksheets: sheet.worksheets, worksheet };
    });

  /** imports another tab of the loaded sheet, with the same mapping */
  const handleTabChange = (worksheet: string) => {
    if (!loaded || !worksheet) return;
    const { sheet, importMap } = loaded;
    setLoaded({ sheet, importMap: { ...importMap, worksheet } });
    runImport('tab', async () => {
      const options = { ...importMap, worksheet };
      const data =
        sheet.access === 'public'
          ? await previewPublicRundown(sheet.sheetId, options)
          : await previewRundown(sheet.sheetId, options);
      await importRundown(data.rundown, data.customFields, data.serviceProfiles);
      return { worksheet };
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    importPublicSheet(link, 'link');
  };

  const isBusy = Boolean(busy);
  const recentButtons = recentSheets.slice(0, maxRecentButtons);

  return (
    <>
      <Panel.Section as='form' onSubmit={handleSubmit}>
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
              isDisabled={isBusy}
              data-testid='gsheet-link'
            />
            <Button
              type='submit'
              variant='ontime-filled'
              size='sm'
              rightIcon={<IoArrowForward />}
              isLoading={busy === 'link'}
              isDisabled={!link.trim() || isBusy}
            >
              Import
            </Button>
          </Panel.InlineElements>
        </Panel.ListGroup>

        {recentButtons.length > 0 && (
          <Panel.ListGroup>
            <Panel.Description>Recent sheets</Panel.Description>
            <div className={style.recentSheets} data-testid='gsheet-recent'>
              {recentButtons.map((sheet) => (
                <Button
                  key={sheet.sheetId}
                  size='md'
                  variant={loaded?.sheet.sheetId === sheet.sheetId ? 'ontime-filled' : 'ontime-subtle'}
                  onClick={() => importPublicSheet(sheet.sheetId, sheet.sheetId)}
                  isLoading={busy === sheet.sheetId}
                  isDisabled={isBusy}
                  title={sheet.title}
                >
                  <span className={style.recentTitle}>{sheet.title}</span>
                </Button>
              ))}
            </div>
          </Panel.ListGroup>
        )}

        <Panel.Error>{error}</Panel.Error>
      </Panel.Section>

      <div className={style.loadedSheet}>
        <div className={style.loadedHeading}>Currently loaded sheet</div>
        {loaded ? (
          <>
            <div className={style.loadedTitle}>{loaded.sheet.title}</div>
            <Panel.InlineElements>
              <Select
                variant='ontime'
                size='md'
                value={loaded.importMap.worksheet}
                onChange={(event) => handleTabChange(event.target.value)}
                isDisabled={isBusy}
                aria-label='Worksheet'
                data-testid='gsheet-loaded-tab'
              >
                {(loadedWorksheets.length ? loadedWorksheets : [loaded.importMap.worksheet]).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Button
                size='md'
                variant='ontime-subtle'
                leftIcon={<IoRefresh />}
                onClick={() => handleTabChange(loaded.importMap.worksheet)}
                isLoading={busy === 'tab'}
                isDisabled={isBusy}
              >
                Reload
              </Button>
            </Panel.InlineElements>
            {success && <div className={style.loadedSuccess}>{success}</div>}
            <Panel.InlineElements>
              <Button
                size='sm'
                variant='ontime-ghosted'
                onClick={() => onEditMapping(loaded.sheet)}
                isDisabled={isBusy}
              >
                Edit column mapping
              </Button>
            </Panel.InlineElements>
          </>
        ) : (
          <Panel.Description>
            Nothing imported from a Google Sheet yet. The first import asks how the columns map to Ontime, later imports
            reuse it.
          </Panel.Description>
        )}
      </div>

      <Panel.ListGroup>
        <Panel.Description>Private sheet, or want to export back to the sheet?</Panel.Description>
        <Panel.InlineElements>
          <Button variant='ontime-subtle' size='sm' leftIcon={<IoLogoGoogle />} onClick={onSignIn} isDisabled={isBusy}>
            Sign in with Google
          </Button>
        </Panel.InlineElements>
      </Panel.ListGroup>
    </>
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
  if (error instanceof Error) return error.message;
  return maybeAxiosError(error);
}
