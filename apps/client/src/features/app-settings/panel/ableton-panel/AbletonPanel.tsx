import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { IoAdd, IoLocate, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Switch, Tooltip } from '@chakra-ui/react';
import type { AbletonSettings } from 'ontime-types';

import { readAbletonClipPosition } from '../../../../common/api/ableton';
import { maybeAxiosError } from '../../../../common/api/utils';
import Info from '../../../../common/components/info/Info';
import useAbletonSettings, { useAbletonSettingsMutation } from '../../../../common/hooks-query/useAbletonSettings';
import { useRuntimeStore } from '../../../../common/stores/runtime';
import { preventEscape } from '../../../../common/utils/keyEvent';
import { tooltipDelayMid } from '../../../../ontimeConfig';
import * as Panel from '../../panel-utils/PanelUtils';

import { formatClipTime, parseClipTime } from './abletonPanel.utils';

import style from './AbletonPanel.module.scss';

export default function AbletonPanel() {
  const { data } = useAbletonSettings();
  const { mutateAsync } = useAbletonSettingsMutation();
  const abletonState = useRuntimeStore((state) => state.ableton);
  const countdown = useRuntimeStore((state) => state.countdown);

  const {
    control,
    handleSubmit,
    reset,
    register,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<AbletonSettings>({
    mode: 'onChange',
    defaultValues: data,
    values: data,
    resetOptions: {
      keepDirtyValues: true,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'timers', keyName: 'fieldKey' });

  // per row feedback from "Set to current position", keyed by the timer id
  const [captureNotes, setCaptureNotes] = useState<Record<string, { text: string; isError: boolean }>>({});
  const [capturing, setCapturing] = useState<string | null>(null);

  const onSubmit = async (formData: AbletonSettings) => {
    try {
      await mutateAsync(formData);
    } catch (error) {
      const message = maybeAxiosError(error);
      setError('root', { message });
    }
  };

  const onReset = () => {
    reset(data);
    setCaptureNotes({});
  };

  const addTimer = () => {
    const last = getValues('timers').at(-1);
    append({ id: crypto.randomUUID(), name: '', track: last?.track ?? 1, clip: (last?.clip ?? 0) + 1, target: 0 });
  };

  const captureCurrentPosition = async (index: number) => {
    const timer = getValues(`timers.${index}`);
    setCapturing(timer.id);
    try {
      const reading = await readAbletonClipPosition(timer.track, timer.clip);
      setValue(`timers.${index}.target`, reading.position, { shouldDirty: true, shouldValidate: true });
      if (!timer.name && reading.clipName) {
        setValue(`timers.${index}.name`, reading.clipName, { shouldDirty: true });
      }
      const where = [reading.trackName, reading.clipName].filter(Boolean).join(' › ');
      const text = reading.isPlaying
        ? `Set from ${where || 'the playing clip'}`
        : `${where || 'That clip'} is not playing: this is where its playhead was left`;
      setCaptureNotes((notes) => ({ ...notes, [timer.id]: { text, isError: false } }));
    } catch (error) {
      setCaptureNotes((notes) => ({ ...notes, [timer.id]: { text: maybeAxiosError(error), isError: true } }));
    } finally {
      setCapturing(null);
    }
  };

  const canSubmit = !isSubmitting && isDirty && isValid;
  const isOnCountdown = countdown.source === 'ableton';

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Ableton Integration
        <Panel.InlineElements>
          <Button variant='ontime-ghosted' size='sm' onClick={onReset} isDisabled={!canSubmit}>
            Revert to saved
          </Button>
          <Button
            variant='ontime-filled'
            size='sm'
            type='submit'
            form='ableton-settings-form'
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
        Ontime follows Session View clips in Ableton Live through AbletonOSC. On the Ableton Mac, install AbletonOSC in
        Live&apos;s Remote Scripts folder, then pick AbletonOSC as a Control Surface in Settings → Link, Tempo &amp;
        MIDI.
        <br />
        <br />
        Each timer below points at one clip and a time in it. While that clip plays and the time is still ahead, the
        playback countdown counts down to it, taking over from QLab or Mitti. It hands back once the clip passes that
        point or stops. Scrubbing the clip moves the countdown with it.
      </Info>

      <Panel.Section
        as='form'
        id='ableton-settings-form'
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={(event) => preventEscape(event, onReset)}
      >
        <Panel.Loader isLoading={false} />

        <Panel.Title>Connection</Panel.Title>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field
              title='Enable Ableton integration'
              description='Follow the clips Ableton Live is playing'
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
              title='Status'
              description={
                abletonState.connected
                  ? isOnCountdown
                    ? `On the countdown: ${abletonState.cueName || 'Ableton timer'}`
                    : 'Connected, no timer running'
                  : 'No reply from AbletonOSC'
              }
            />
            <span style={{ color: abletonState.connected ? '#4caf50' : '#999' }}>
              {abletonState.connected ? 'Connected' : 'Disconnected'}
            </span>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Ableton host IP'
              description='IP address of the Mac running Ableton Live'
              error={errors.host?.message}
            />
            <Input
              id='host'
              placeholder='127.0.0.1'
              width='10rem'
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              autoComplete='off'
              {...register('host', {
                required: { value: true, message: 'Required field' },
              })}
            />
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='AbletonOSC port'
              description="AbletonOSC's input port. Default: 11000"
              error={errors.port?.message}
            />
            <Input
              id='port'
              placeholder='11000'
              width='5rem'
              maxLength={5}
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              type='number'
              autoComplete='off'
              {...register('port', {
                required: { value: true, message: 'Required field' },
                valueAsNumber: true,
                max: { value: 65535, message: 'Port must be within range 1 - 65535' },
                min: { value: 1, message: 'Port must be within range 1 - 65535' },
              })}
            />
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Reply port'
              description='Port Ontime listens on for answers. AbletonOSC always replies to 11001'
              error={errors.listenPort?.message}
            />
            <Input
              id='listenPort'
              placeholder='11001'
              width='5rem'
              maxLength={5}
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              type='number'
              autoComplete='off'
              {...register('listenPort', {
                required: { value: true, message: 'Required field' },
                valueAsNumber: true,
                max: { value: 65535, message: 'Port must be within range 1 - 65535' },
                min: { value: 1, message: 'Port must be within range 1 - 65535' },
              })}
            />
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Reply timeout'
              description='Milliseconds without a reply before Ableton counts as disconnected. Default: 5000'
              error={errors.timeout?.message}
            />
            <Input
              id='timeout'
              placeholder='5000'
              width='5rem'
              size='sm'
              textAlign='right'
              variant='ontime-filled'
              type='number'
              autoComplete='off'
              {...register('timeout', {
                required: { value: true, message: 'Required field' },
                valueAsNumber: true,
                min: { value: 1000, message: 'Minimum 1000ms' },
              })}
            />
          </Panel.ListItem>
        </Panel.ListGroup>

        <Panel.Title>Timers</Panel.Title>
        <Panel.Description>
          Track and clip are counted from 1: track 1 is the leftmost track, clip 1 its top slot. The time is how far
          into the clip the countdown reaches zero, as minutes:seconds on the clip&apos;s own ruler. To set it, play the
          clip to that point in Live and press the target button. Save before using it if you have just turned the
          integration on.
        </Panel.Description>
        <Panel.Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Track</th>
              <th>Clip</th>
              <th>Zero at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={5} className={style.empty}>
                  No timers yet
                </td>
              </tr>
            )}
            {fields.map((field, index) => {
              const rowErrors = errors.timers?.[index];
              const note = captureNotes[field.id];
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
                    {note && <div className={note.isError ? style.noteError : style.note}>{note.text}</div>}
                  </td>
                  <td className={style.numberCell}>
                    <Input
                      size='sm'
                      variant='ontime-filled'
                      type='number'
                      textAlign='right'
                      autoComplete='off'
                      isInvalid={Boolean(rowErrors?.track)}
                      {...register(`timers.${index}.track`, {
                        valueAsNumber: true,
                        validate: (value) => (Number.isInteger(value) && value >= 1) || 'Track from 1',
                      })}
                    />
                  </td>
                  <td className={style.numberCell}>
                    <Input
                      size='sm'
                      variant='ontime-filled'
                      type='number'
                      textAlign='right'
                      autoComplete='off'
                      isInvalid={Boolean(rowErrors?.clip)}
                      {...register(`timers.${index}.clip`, {
                        valueAsNumber: true,
                        validate: (value) => (Number.isInteger(value) && value >= 1) || 'Clip from 1',
                      })}
                    />
                  </td>
                  <td className={style.timeCell}>
                    <Controller
                      control={control}
                      name={`timers.${index}.target`}
                      rules={{ validate: (value) => value > 0 || 'Set a time' }}
                      render={({ field: { value, onChange } }) => (
                        <ClipTimeInput value={value} onChange={onChange} isInvalid={Boolean(rowErrors?.target)} />
                      )}
                    />
                  </td>
                  <td className={style.actionsCell}>
                    <Tooltip label='Set to current position' openDelay={tooltipDelayMid}>
                      <IconButton
                        aria-label='Set to current position'
                        icon={<IoLocate />}
                        size='sm'
                        variant='ontime-subtle'
                        isLoading={capturing === field.id}
                        onClick={() => captureCurrentPosition(index)}
                      />
                    </Tooltip>
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
              id='warningThreshold'
              placeholder='30000'
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
              id='dangerThreshold'
              placeholder='10000'
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
 * A minutes:seconds field over a value in milliseconds.
 * It keeps what is being typed until the field is left, then settles on the parsed time.
 */
function ClipTimeInput({
  value,
  onChange,
  isInvalid,
}: {
  value: number;
  onChange: (value: number) => void;
  isInvalid: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseClipTime(draft);
    if (parsed !== null) onChange(parsed);
    setDraft(null);
  };

  return (
    <Input
      size='sm'
      variant='ontime-filled'
      textAlign='right'
      placeholder='m:ss'
      autoComplete='off'
      isInvalid={isInvalid}
      value={draft ?? (value > 0 ? formatClipTime(value) : '')}
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
