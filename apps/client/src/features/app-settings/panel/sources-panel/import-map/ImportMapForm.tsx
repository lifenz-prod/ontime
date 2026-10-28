import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { IoAdd, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Select, Tooltip } from '@chakra-ui/react';
import { ImportMap, isAlphanumericWithSpace, parseGoogleSheetInput } from 'ontime-utils';

import { getWorksheetNames } from '../../../../../common/api/sheets';
import { maybeAxiosError } from '../../../../../common/api/utils';
import * as Panel from '../../../panel-utils/PanelUtils';
import useGoogleSheet from '../useGoogleSheet';
import { useSheetStore } from '../useSheetStore';

import {
  convertToImportMap,
  getPersistedOptions,
  NamedImportMap,
  persistImportMap,
  pickWorksheet,
} from './importMapUtils';

import style from '../SourcesPanel.module.scss';

interface ImportMapFormProps {
  hasErrors: boolean;
  isSpreadsheet: boolean;
  /** a sheet opened by its link is read only, and has no authentication to revoke */
  isPublicSheet?: boolean;
  onChangeSheet?: () => void;
  onCancel: () => void;
  onSubmitExport: (importMap: ImportMap) => Promise<void>;
  onSubmitImport: (importMap: ImportMap) => Promise<void>;
}

export default function ImportMapForm(props: ImportMapFormProps) {
  const { hasErrors, isSpreadsheet, isPublicSheet, onChangeSheet, onCancel, onSubmitExport, onSubmitImport } = props;
  const worksheetNames = useSheetStore((state) => state.worksheetNames);
  const linkedWorksheet = useSheetStore((state) => state.linkedWorksheet);
  const sheetTitle = useSheetStore((state) => state.sheetTitle);
  const persistedOptions = getPersistedOptions();
  const namedImportMap = {
    ...persistedOptions,
    Worksheet: pickWorksheet(worksheetNames, linkedWorksheet, persistedOptions.Worksheet),
  };
  const { revoke } = useGoogleSheet();
  const {
    control,
    handleSubmit,
    register,
    formState: { errors, isValid },
  } = useForm<NamedImportMap>({
    mode: 'onChange',
    defaultValues: namedImportMap,
    values: namedImportMap,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'custom',
  });

  const stepData = useSheetStore((state) => state.stepData);
  const patchStepData = useSheetStore((state) => state.patchStepData);
  const setWorksheets = useSheetStore((state) => state.setWorksheets);
  const sheetId = useSheetStore((state) => state.sheetId);
  const setSheetId = useSheetStore((state) => state.setSheetId);

  const [loading, setLoading] = useState<'' | 'sheet' | 'export' | 'import'>('');

  const handleLoadWorksheets = async () => {
    if (!sheetId) {
      patchStepData({ worksheet: { available: false, error: 'Please enter a sheet ID' } });
      return;
    }

    setLoading('sheet');
    patchStepData({ worksheet: { available: false, error: '' } });

    try {
      const names = await getWorksheetNames(sheetId);
      setWorksheets(names);
    } catch (error) {
      patchStepData({ worksheet: { available: false, error: maybeAxiosError(error) } });
    } finally {
      setLoading('');
    }
  };

  const handleExport = async (values: NamedImportMap) => {
    setLoading('export');
    const importMap = convertToImportMap(values);

    await onSubmitExport(importMap);
    setLoading('');
  };

  const handleRevoke = async () => {
    await revoke();
    onCancel();
  };

  const handleImport = async (values: NamedImportMap) => {
    setLoading('import');
    const importMap = convertToImportMap(values);
    persistImportMap(values);
    await onSubmitImport(importMap);
    setLoading('');
  };

  const deleteCustomImport = (index: number) => {
    remove(index);
  };

  const addCustomImport = () => {
    append({});
  };

  const isLoading = Boolean(loading);
  const canSubmitSpreadsheet = isSpreadsheet && !isLoading;
  const canSubmitGSheet = !isLoading && !!sheetId && !!worksheetNames?.length && !stepData.worksheet.error;
  const canSubmit = !hasErrors && isValid && (canSubmitSpreadsheet || canSubmitGSheet);

  return (
    <Panel.Section as='form' id='import-map'>
      <Panel.Title>
        Import options
        <Panel.InlineElements>
          {!isSpreadsheet && !isPublicSheet && (
            <Tooltip label='Revoke the google authentication'>
              <Button variant='ontime-subtle' size='sm' onClick={handleRevoke} isDisabled={isLoading}>
                Revoke
              </Button>
            </Tooltip>
          )}
          <Button variant='ontime-subtle' size='sm' onClick={onCancel} isDisabled={isLoading}>
            Cancel
          </Button>
          {!isSpreadsheet && !isPublicSheet && (
            <Button
              variant='ontime-filled'
              size='sm'
              onClick={handleSubmit(handleExport)}
              isDisabled={!canSubmitGSheet}
              isLoading={loading === 'export'}
            >
              Export
            </Button>
          )}
          <Button
            variant='ontime-filled'
            size='sm'
            onClick={handleSubmit(handleImport)}
            isDisabled={!canSubmit}
            isLoading={loading === 'import'}
          >
            Import
          </Button>
        </Panel.InlineElements>
      </Panel.Title>
      {isPublicSheet && (
        <Panel.ListGroup>
          <Panel.Description>Importing from Google Sheet</Panel.Description>
          <Panel.InlineElements>
            <Panel.Field title={sheetTitle || sheetId || ''} description={sheetId ?? ''} />
            <Button size='sm' variant='ontime-subtle' onClick={onChangeSheet} isDisabled={isLoading}>
              Change sheet
            </Button>
          </Panel.InlineElements>
        </Panel.ListGroup>
      )}
      {!isSpreadsheet && !isPublicSheet && (
        <Panel.ListGroup>
          <Panel.Description>Choose which Google Sheet to use</Panel.Description>
          <Panel.InlineElements>
            <Input
              size='sm'
              variant='ontime-filled'
              autoComplete='off'
              placeholder='Sheet link or ID'
              value={sheetId ?? ''}
              onChange={(event) => setSheetId(parseGoogleSheetInput(event.target.value)?.sheetId ?? event.target.value)}
              isDisabled={isLoading}
            />
            <Button
              size='sm'
              variant='ontime-subtle'
              onClick={handleLoadWorksheets}
              isLoading={loading === 'sheet'}
              isDisabled={isLoading || !sheetId}
            >
              Load worksheets
            </Button>
          </Panel.InlineElements>
        </Panel.ListGroup>
      )}
      <Panel.Table>
        <thead>
          <tr>
            <th>Ontime field</th>
            <th>Column name in spreadsheet</th>
            <th className={style.singleActionCell} />
          </tr>
        </thead>
        <tbody>
          {Object.entries(namedImportMap).map(([label, importName]) => {
            if (label === 'custom') {
              return null;
            }
            if (label === 'Worksheet') {
              return (
                <tr key={importName as string}>
                  <td>{label}</td>
                  <td>
                    <Select
                      variant='ontime'
                      id={importName as string}
                      size='sm'
                      {...register(label as keyof NamedImportMap)}
                    >
                      {worksheetNames?.map((name) => {
                        return (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        );
                      })}
                    </Select>
                  </td>
                  <td className={style.singleActionCell} />
                </tr>
              );
            }
            return (
              <tr key={importName as string}>
                <td>{label}</td>
                <td>
                  <Input
                    id={importName as string}
                    size='sm'
                    variant='ontime-filled'
                    autoComplete='off'
                    maxLength={25}
                    defaultValue={importName as string}
                    placeholder='Use default column name'
                    {...register(label as keyof NamedImportMap)}
                  />
                </td>
                <td className={style.singleActionCell} />
              </tr>
            );
          })}
          {fields.map((field, index) => {
            const ontimeName = field.ontimeName;
            const importName = field.importName;
            const maybeOntimeError = errors.custom?.[index]?.ontimeName?.message;
            const key = `custom.${index}.ontimeName`;
            return (
              <tr key={key}>
                <td>
                  <Input
                    size='sm'
                    variant='ontime-filled'
                    autoComplete='off'
                    maxLength={25}
                    defaultValue={ontimeName}
                    placeholder='Name of the field as shown in Ontime'
                    {...register(`custom.${index}.ontimeName`, {
                      validate: (value) => {
                        if (!isAlphanumericWithSpace(value))
                          return 'Only alphanumeric characters and space are allowed';
                        return true;
                      },
                    })}
                  />
                  {maybeOntimeError && <Panel.Error>{maybeOntimeError}</Panel.Error>}
                </td>
                <td>
                  <Input
                    size='sm'
                    variant='ontime-filled'
                    autoComplete='off'
                    maxLength={25}
                    defaultValue={importName}
                    placeholder='Name of the column in the spreadsheet'
                    {...register(`custom.${index}.importName`)}
                  />
                </td>
                <td className={style.singleActionCell}>
                  <IconButton
                    size='sm'
                    variant='ontime-ghosted'
                    color='#FA5656' // $red-500
                    icon={<IoTrash />}
                    aria-label='Delete entry'
                    onClick={() => deleteCustomImport(index)}
                  />
                </td>
              </tr>
            );
          })}
          <tr>
            <td />
            <Panel.InlineElements as='td' align='end'>
              <Button size='sm' variant='ontime-subtle' rightIcon={<IoAdd />} onClick={addCustomImport}>
                Add custom field
              </Button>
            </Panel.InlineElements>
            <td />
          </tr>
        </tbody>
      </Panel.Table>
      <Panel.Error>{stepData.worksheet.error}</Panel.Error>
    </Panel.Section>
  );
}
