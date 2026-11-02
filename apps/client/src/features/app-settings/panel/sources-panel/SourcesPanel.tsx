import { ChangeEvent, useRef, useState } from 'react';
import { IoDownloadOutline } from 'react-icons/io5';
import { Button, Input } from '@chakra-ui/react';
import { LoadedSheet, PublicSheetInfo } from 'ontime-types';
import { getErrorMessage, ImportMap } from 'ontime-utils';

import {
  getWorksheetNames as getWorksheetNamesExcel,
  importRundownPreview as importRundownPreviewExcel,
  upload as uploadExcel,
} from '../../../../common/api/excel';
import { getWorksheetNames, openPublicSheet, previewPublicRundown } from '../../../../common/api/sheets';
import { maybeAxiosError } from '../../../../common/api/utils';
import { validateExcelImport } from '../../../../common/utils/uploadUtils';
import * as Panel from '../../panel-utils/PanelUtils';

import ImportMapForm from './import-map/ImportMapForm';
import GSheetPublic from './GSheetPublic';
import GSheetQuickImport from './GSheetQuickImport';
import GSheetSetup from './GSheetSetup';
import ImportReview from './ImportReview';
import useGoogleSheet from './useGoogleSheet';
import { useSheetStore } from './useSheetStore';

import style from './SourcesPanel.module.scss';

interface SourcesPanelProps {
  location?: string;
  onClose?: () => void;
}

export default function SourcesPanel({ onClose }: SourcesPanelProps) {
  const [importFlow, setImportFlow] = useState<'none' | 'excel' | 'gsheet' | 'finished'>('none');
  const [error, setError] = useState('');
  const [hasFile, setHasFile] = useState<'none' | 'loading' | 'done'>('none');
  const [isOpeningGSheet, setIsOpeningGSheet] = useState(false);

  const { exportRundown, importRundownPreview, importRundown, verifyAuth } = useGoogleSheet();

  const setWorksheets = useSheetStore((state) => state.setWorksheets);
  const authenticationStatus = useSheetStore((state) => state.authenticationStatus);
  const setAuthenticationStatus = useSheetStore((state) => state.setAuthenticationStatus);
  const rundown = useSheetStore((state) => state.rundown);
  const setRundown = useSheetStore((state) => state.setRundown);
  const customFields = useSheetStore((state) => state.customFields);
  const setCustomFields = useSheetStore((state) => state.setCustomFields);
  const serviceProfiles = useSheetStore((state) => state.serviceProfiles);
  const setServiceProfiles = useSheetStore((state) => state.setServiceProfiles);
  const setSheetId = useSheetStore((state) => state.setSheetId);
  const sheetId = useSheetStore((state) => state.sheetId);
  const worksheetNames = useSheetStore((state) => state.worksheetNames);
  const sheetAccess = useSheetStore((state) => state.sheetAccess);
  const setSheetAccess = useSheetStore((state) => state.setSheetAccess);
  const setPublicSheet = useSheetStore((state) => state.setPublicSheet);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileToUpload = event.target.files?.[0];

    if (!fileToUpload) {
      setWorksheets(null);
      setHasFile('none');
      return;
    }
    try {
      setHasFile('loading');
      validateExcelImport(fileToUpload);
      await uploadExcel(fileToUpload);
      const names = await getWorksheetNamesExcel();
      setWorksheets(names);
      setImportFlow('excel');
      setHasFile('done');
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setError(`Error uploading file: ${errorMessage}`);
      setWorksheets(null);
      setHasFile('none');
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const resetFlow = () => {
    // we purposely omit clearing the authentication status
    setImportFlow('none');
    setRundown(null);
    setHasFile('none');
    setWorksheets(null);
    setCustomFields(null);
    setServiceProfiles(null);
    setError('');
    setSheetId(null);
    setSheetAccess('public');
  };

  /** the simple flow: reading a sheet shared by link, no authentication */
  const openGSheetFlow = () => {
    setError('');
    setSheetAccess('public');
    setSheetId(null);
    setWorksheets(null);
    setImportFlow('gsheet');
  };

  /** signing in with google, for private sheets and to export back to the sheet */
  const openOAuthFlow = async () => {
    setError('');
    setSheetAccess('oauth');
    setWorksheets(null);
    setIsOpeningGSheet(true);
    try {
      const result = await verifyAuth();
      if (result) {
        setAuthenticationStatus(result.authenticated);
        setSheetId(result.sheetId);
        if (result.authenticated === 'authenticated' && result.sheetId) {
          try {
            const names = await getWorksheetNames(result.sheetId);
            setWorksheets(names);
          } catch (error) {
            const message = maybeAxiosError(error);
            setError(`Error getting worksheets: ${message}`);
          }
        }
      }
      setImportFlow('gsheet');
    } finally {
      setIsOpeningGSheet(false);
    }
  };

  /** a sheet with no column mapping yet goes through the import options */
  const openMappingForSheet = (sheet: PublicSheetInfo) => {
    setError('');
    setSheetAccess('public');
    setPublicSheet(sheet);
    setImportFlow('gsheet');
  };

  /** opens the import options for the loaded sheet, on the tab it is on */
  const editLoadedMapping = async (loaded: LoadedSheet) => {
    if (loaded.access !== 'public') {
      await openOAuthFlow();
      return;
    }
    setError('');
    setIsOpeningGSheet(true);
    try {
      const sheet = await openPublicSheet(loaded.sheetId);
      openMappingForSheet({ ...sheet, worksheet: loaded.worksheet });
    } catch (error) {
      setError(maybeAxiosError(error));
    } finally {
      setIsOpeningGSheet(false);
    }
  };

  const cancelGSheetFlow = () => {
    resetFlow();
  };

  const handleSubmitImport = async (importMap: ImportMap) => {
    try {
      let previewData = null;
      if (importFlow === 'excel') {
        previewData = await importRundownPreviewExcel(importMap);
      } else if (importFlow === 'gsheet') {
        if (!sheetId) return;
        if (sheetAccess === 'public') {
          previewData = await previewPublicRundown(sheetId, importMap);
        } else {
          previewData = (await importRundownPreview(sheetId, importMap)) ?? null;
        }
      }

      if (!previewData) return;

      await importRundown(previewData.rundown, previewData.customFields, previewData.serviceProfiles);
      handleFinished();
    } catch (error) {
      setError(maybeAxiosError(error));
    }
  };

  const cancelImportMap = async () => {
    resetFlow();
    if (authenticationStatus === 'authenticated') {
      const result = await verifyAuth();
      if (result) {
        setAuthenticationStatus(result.authenticated);
      }
    }
  };

  const handleFinished = () => {
    setImportFlow('finished');
    setRundown(null);
    setHasFile('none');
    setWorksheets(null);
    setCustomFields(null);
    setServiceProfiles(null);
    setError('');
  };

  const handleSubmitExport = async (importMap: ImportMap) => {
    if (!sheetId) return;
    await exportRundown(sheetId, importMap);
  };

  const isExcelFlow = importFlow === 'excel';
  const isGSheetFlow = importFlow === 'gsheet';
  const isAuthenticated = authenticationStatus === 'authenticated';
  const isPublicSheet = sheetAccess === 'public';
  const hasPublicSheet = isPublicSheet && Boolean(worksheetNames);
  const showInput = importFlow === 'none' && !isOpeningGSheet;
  const showCompleted = importFlow === 'finished';
  const showPublicSetup = isGSheetFlow && isPublicSheet && !hasPublicSheet;
  const showAuth = isGSheetFlow && !isPublicSheet && !isAuthenticated;
  const showImportMap =
    (isGSheetFlow && (isPublicSheet ? hasPublicSheet : isAuthenticated)) || (isExcelFlow && hasFile === 'done');
  const showReview = rundown !== null && customFields !== null;

  return (
    <>
      <Panel.Header>Import</Panel.Header>
      {showInput && (
        <>
          <Panel.Section>
            <Panel.Card>
              <Panel.SubHeader>Import from Google Sheet</Panel.SubHeader>
              {error && <Panel.Error>{error}</Panel.Error>}
              <GSheetQuickImport
                onNeedsMapping={openMappingForSheet}
                onEditMapping={editLoadedMapping}
                onSignIn={openOAuthFlow}
              />
            </Panel.Card>
          </Panel.Section>
          <Panel.Section>
            <Panel.Card>
              <Panel.SubHeader>Import from spreadsheet</Panel.SubHeader>
              <Input
                ref={fileInputRef}
                style={{ display: 'none' }}
                type='file'
                onChange={handleFile}
                accept='.xlsx'
                data-testid='file-input'
              />
              <Panel.InlineElements>
                <Button
                  variant='ontime-filled'
                  size='sm'
                  leftIcon={<IoDownloadOutline />}
                  onClick={handleUpload}
                  isLoading={hasFile === 'loading'}
                >
                  Import from spreadsheet
                </Button>
                <Panel.Description>Accepts .xlsx files</Panel.Description>
              </Panel.InlineElements>
            </Panel.Card>
          </Panel.Section>
        </>
      )}
      {!showInput && (
        <Panel.Section>
          <Panel.Card>
            {error && <Panel.Error>{error}</Panel.Error>}
            <Panel.Loader isLoading={isOpeningGSheet} />
            {showCompleted && (
              <div className={style.finishSection}>
                {error ? (
                  <span key='finish__error' className={style.error}>
                    Import failed
                  </span>
                ) : (
                  <span key='finish__success' className={style.success}>
                    Import successful
                  </span>
                )}
                <Button variant='ontime-filled' size='sm' onClick={onClose ?? resetFlow}>
                  Return
                </Button>
              </div>
            )}
            {showPublicSetup && <GSheetPublic onCancel={cancelGSheetFlow} onSignIn={openOAuthFlow} />}
            {showAuth && <GSheetSetup onCancel={cancelGSheetFlow} />}
            {showImportMap && !showReview && (
              <ImportMapForm
                hasErrors={Boolean(error)}
                isSpreadsheet={isExcelFlow}
                isPublicSheet={isGSheetFlow && isPublicSheet}
                onChangeSheet={openGSheetFlow}
                onCancel={cancelImportMap}
                onSubmitExport={handleSubmitExport}
                onSubmitImport={handleSubmitImport}
              />
            )}
            {showReview && (
              <ImportReview
                rundown={rundown}
                customFields={customFields}
                serviceProfiles={serviceProfiles}
                onFinished={handleFinished}
                onCancel={cancelImportMap}
              />
            )}
          </Panel.Card>
        </Panel.Section>
      )}
    </>
  );
}
