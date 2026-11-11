import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { IoAdd, IoLocate, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Select, Switch, Tooltip } from '@chakra-ui/react';
import type { TimecodeSettings } from 'ontime-types';
import { formatTimecode, generateId, parseTimecode } from 'ontime-utils';

import { getCurrentTimecode } from '../../../../common/api/timecode';
import { maybeAxiosError } from '../../../../common/api/utils';
import Info from '../../../../common/components/info/Info';
import useTimecodeSettings, { useTimecodeSettingsMutation } from '../../../../common/hooks-query/useTimecodeSettings';
import { useRuntimeStore } from '../../../../common/stores/runtime';
import { preventEscape } from '../../../../common/utils/keyEvent';
import { tooltipDelayMid } from '../../../../ontimeConfig';
import * as Panel from '../../panel-utils/PanelUtils';

import style from './TimecodePanel.module.scss';

export default function TimecodePanel() {
  const { data } = useTimecodeSettings();
  const { mutateAsync } = useTimecodeSettingsMutation();
  const timecode = useRuntimeStore((state) => state.timecode);
  const countdown = useRuntimeStore((state) => state.countdown);

  const fps = timecode.fps ?? 25;

  const {
    control,
    handleSubmit,
    reset,
    register,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<TimecodeSettings>({
    mode: 'onChange',
    defaultValues: data,
    values: data,
    resetOptions: {
      keepDirtyValues: true,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'timers', keyName: 'fieldKey' });
  const [captureError, setCaptureError] = useState('');

  const onSubmit = async (formData: TimecodeSettings) => {
    try {
      await mutateAsync(formData);
    } catch (error) {
      setError('root', { message: maybeAxiosError(error) });
    }
  };

  const onReset = () => {
    reset(data);
    setCaptureError('');
  };

  const addTimer = () => {
    const last = getValues('timers').at(-1);
    const from = last ? last.zero : timecode.current ?? 3600000;
    append({ id: generateId(), name: '', from, zero: from + 5 * 60 * 1000 });
  };

  const captureNow = async (index: number, field: 'from' | 'zero') => {
    try {
      const { current, signal } = await getCurrentTimecode();
      if (!signal || current === null) {
        setCaptureError('No timecode is arriving: play it in Ableton, then try again');
        return;
      }
      setValue(`timers.${index}.${field}`, Math.round(current), { shouldDirty: true, shouldValidate: true });
      setCaptureError('');
    } catch (error) {
      setCaptureError(maybeAxiosError(error));
    }
  };

  const reader = timecode.reader;
  // the inputs the reader can see, plus the saved one in case the reader is not running right now
  const deviceOptions = [...new Set([...(reader?.devices ?? []), ...(data.deviceLabel ? [data.deviceLabel] : [])])];
  // the desktop app on macOS reads any channel and knows how many each input has; a browser reader reads two at most
  const canReadAnyChannel = Boolean(reader?.deviceChannels);
  const channelCount = (label: string) => {
    const index = reader?.devices.indexOf(label) ?? -1;
    return index >= 0 ? reader?.deviceChannels?.[index] : undefined;
  };
  const selectedDevice = watch('deviceLabel');
  const selectedChannels = selectedDevice ? channelCount(selectedDevice) : undefined;
  const maxChannel = selectedChannels ?? 64;

  const canSubmit = !isSubmitting && isDirty && isValid;
  const isOnCountdown = countdown.source === 'timecode';

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Timecode
        <Panel.InlineElements>
          <Button variant='ontime-ghosted' size='sm' onClick={onReset} isDisabled={!canSubmit}>
            Revert to saved
          </Button>
          <Button
            variant='ontime-filled'
            size='sm'
            type='submit'
            form='timecode-settings-form'
            isDisabled={!canSubmit}
            isLoading={isSubmitting}
          >
            Save
          </Button>
        </Panel.InlineElements>
      </Panel.SubHeader>
      {errors?.root && <Panel.Error>{errors.root.message}</Panel.Error>}

      <Panel.Divider />

      <Info>
        Ontime reads linear timecode (LTC) from a sound card input, such as a Dante Virtual Soundcard channel. The
        desktop app reads it in the background on the machine running Ontime. On another machine, open
        <code> /timecode-reader </code> in a browser there instead.
        <br />
        <br />
        Each timer below covers a stretch of timecode and counts down to its zero point. While the timecode is in that
        stretch, the playback countdown counts down to zero, taking over from QLab or Mitti. It hands back once the
        timecode passes zero, leaves the stretch, or stops.
      </Info>

      <Panel.Section
        as='form'
        id='timecode-settings-form'
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={(event) => preventEscape(event, onReset)}
      >
        <Panel.Loader isLoading={false} />

        <Panel.Title>Input</Panel.Title>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field
              title='Read incoming timecode'
              description='Follow timecode and run the timers below against it'
              error={errors.enabled?.message}
            />
            <Controller
              control={control}
              name='enabled'
              render={({ field: { onChange, value, ref } }) => (
                <Switch variant='ontime' size='lg' isChecked={value} onChange={onChange} ref={ref} />
              )}
            />
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Signal'
              description={
                timecode.signal
                  ? `${timecode.fps ?? ''}${timecode.dropFrame ? ' drop frame' : ''} fps${
                      isOnCountdown ? ` · on the countdown: ${timecode.cueName || 'timecode timer'}` : ''
                    }`
                  : 'No timecode arriving'
              }
            />
            <span className={timecode.signal ? style.live : style.idle} data-testid='timecode-current'>
              {timecode.current === null ? '--:--:--' : formatTimecode(timecode.current)}
            </span>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Reader'
              description={
                !timecode.enabled
                  ? 'Starts when timecode is turned on, and stops when it is off'
                  : reader?.connected
                    ? reader.error ||
                      `Recording ${reader.deviceLabel || 'the default input'}, channel ${reader.channel}`
                    : 'No reader running. The desktop app starts one; elsewhere, open /timecode-reader'
              }
              error={timecode.enabled && reader?.connected && reader.error ? reader.error : undefined}
            />
            <div className={style.meter} title='Level on the timecode channel'>
              <div
                className={style.meterFill}
                style={{ width: `${Math.round((reader?.connected ? reader.level : 0) * 100)}%` }}
              />
            </div>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Sound card'
              description={
                timecode.enabled ? 'The input the timecode arrives on' : 'Turn timecode on and save to list the inputs'
              }
            />
            <Select size='sm' width='16rem' variant='ontime' {...register('deviceLabel')}>
              <option value=''>Default input</option>
              {deviceOptions.map((label) => {
                const count = channelCount(label);
                return (
                  <option key={label} value={label}>
                    {count ? `${label} (${count} ch)` : label}
                  </option>
                );
              })}
            </Select>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Channel'
              description={
                selectedChannels
                  ? `The channel of ${selectedDevice} carrying the timecode, 1 to ${selectedChannels}`
                  : canReadAnyChannel
                    ? 'Input channel carrying the timecode'
                    : 'Input channel carrying the timecode. A browser can only read channels 1 and 2'
              }
              error={errors.channel?.message}
            />
            {selectedChannels ? (
              <Select
                size='sm'
                width='8rem'
                variant='ontime'
                data-testid='timecode-channel'
                {...register('channel', {
                  valueAsNumber: true,
                  validate: (value) =>
                    (Number.isInteger(value) && value >= 1 && value <= maxChannel) || `Channel 1 to ${maxChannel}`,
                })}
              >
                {Array.from({ length: selectedChannels }, (_, i) => i + 1).map((channel) => (
                  <option key={channel} value={channel}>
                    Channel {channel}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                width='5rem'
                size='sm'
                textAlign='right'
                variant='ontime-filled'
                type='number'
                autoComplete='off'
                data-testid='timecode-channel'
                {...register('channel', {
                  valueAsNumber: true,
                  validate: (value) =>
                    (Number.isInteger(value) && value >= 1 && value <= maxChannel) || `Channel 1 to ${maxChannel}`,
                })}
              />
            )}
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Signal timeout'
              description='Milliseconds without timecode before a timer lets go. Default: 500'
              error={errors.timeout?.message}
            />
            <Input
              width='5rem'
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              type='number'
              autoComplete='off'
              {...register('timeout', {
                valueAsNumber: true,
                min: { value: 100, message: 'Minimum 100ms' },
                max: { value: 10000, message: 'Maximum 10000ms' },
              })}
            />
          </Panel.ListItem>
        </Panel.ListGroup>

        <Panel.Title>Timers</Panel.Title>
        <Panel.Description>
          Times are hh:mm:ss:ff. To set one, play the timecode to that point and press its target button.
        </Panel.Description>
        {captureError && <Panel.Error>{captureError}</Panel.Error>}
        <Panel.Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>From</th>
              <th>Zero at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={4} className={style.empty}>
                  No timers yet
                </td>
              </tr>
            )}
            {fields.map((field, index) => {
              const rowErrors = errors.timers?.[index];
              return (
                <tr key={field.fieldKey}>
                  <td>
                    <Input
                      size='sm'
                      variant='ontime-filled'
                      placeholder='Shown on the countdown'
                      autoComplete='off'
                      {...register(`timers.${index}.name`)}
                    />
                    {rowErrors?.zero?.message && <div className={style.noteError}>{rowErrors.zero.message}</div>}
                  </td>
                  {(['from', 'zero'] as const).map((which) => (
                    <td key={which} className={style.timeCell}>
                      <div className={style.timeWithButton}>
                        <Controller
                          control={control}
                          name={`timers.${index}.${which}`}
                          rules={
                            which === 'zero'
                              ? {
                                  validate: (value) =>
                                    value > getValues(`timers.${index}.from`) || 'Zero must come after From',
                                }
                              : undefined
                          }
                          render={({ field: { value, onChange } }) => (
                            <TimecodeInput
                              value={value}
                              fps={fps}
                              onChange={onChange}
                              isInvalid={Boolean(rowErrors?.[which])}
                            />
                          )}
                        />
                        <Tooltip label='Set to current timecode' openDelay={tooltipDelayMid}>
                          <IconButton
                            aria-label={`Set ${which === 'from' ? 'from' : 'zero'} to current timecode`}
                            icon={<IoLocate />}
                            size='sm'
                            variant='ontime-subtle'
                            onClick={() => captureNow(index, which)}
                          />
                        </Tooltip>
                      </div>
                    </td>
                  ))}
                  <td className={style.actionsCell}>
                    <IconButton
                      aria-label='Delete timer'
                      icon={<IoTrash />}
                      size='sm'
                      variant='ontime-ghosted'
                      colorScheme='red'
                      onClick={() => remove(index)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Panel.Table>
        <Button
          leftIcon={<IoAdd />}
          variant='ontime-subtle'
          size='sm'
          onClick={addTimer}
          marginTop={2}
          alignSelf='flex-start'
        >
          Add timer
        </Button>

        <Panel.Title>Phase Thresholds</Panel.Title>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field
              title='Warning threshold'
              description='Time remaining (ms) to enter warning phase. Default: 30000'
              error={errors.warningThreshold?.message}
            />
            <Input
              width='5rem'
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              type='number'
              autoComplete='off'
              {...register('warningThreshold', {
                required: { value: true, message: 'Required field' },
                valueAsNumber: true,
                min: { value: 0, message: 'Must be 0 or greater' },
              })}
            />
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Danger threshold'
              description='Time remaining (ms) to enter danger phase. Default: 10000'
              error={errors.dangerThreshold?.message}
            />
            <Input
              width='5rem'
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              type='number'
              autoComplete='off'
              {...register('dangerThreshold', {
                required: { value: true, message: 'Required field' },
                valueAsNumber: true,
                min: { value: 0, message: 'Must be 0 or greater' },
              })}
            />
          </Panel.ListItem>
        </Panel.ListGroup>
      </Panel.Section>
    </Panel.Card>
  );
}

/**
 * An hh:mm:ss:ff field over a value in milliseconds since 00:00:00:00.
 * It keeps what is being typed until the field is left, then settles on the parsed timecode.
 */
function TimecodeInput({
  value,
  fps,
  onChange,
  isInvalid,
}: {
  value: number;
  fps: number;
  onChange: (value: number) => void;
  isInvalid: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseTimecode(draft, fps);
    if (parsed !== null) onChange(parsed);
    setDraft(null);
  };

  return (
    <Input
      size='sm'
      variant='ontime-filled'
      textAlign='right'
      placeholder='hh:mm:ss:ff'
      autoComplete='off'
      isInvalid={isInvalid}
      value={draft ?? formatTimecode(value, fps)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
