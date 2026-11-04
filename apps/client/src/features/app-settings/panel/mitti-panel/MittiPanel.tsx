import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { IoAdd, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Switch } from '@chakra-ui/react';
import type { MittiSettings } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
import Info from '../../../../common/components/info/Info';
import useMittiSettings, { useMittiSettingsMutation } from '../../../../common/hooks-query/useMittiSettings';
import { useRuntimeStore } from '../../../../common/stores/runtime';
import { preventEscape } from '../../../../common/utils/keyEvent';
import * as Panel from '../../panel-utils/PanelUtils';
import CountdownSourcePicker from '../countdown-source/CountdownSourcePicker';

export default function MittiPanel() {
  const { data } = useMittiSettings();
  const { mutateAsync } = useMittiSettingsMutation();
  const mittiState = useRuntimeStore((state) => state.mitti);

  const {
    control,
    handleSubmit,
    reset,
    register,
    setError,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<MittiSettings>({
    mode: 'onChange',
    defaultValues: data,
    values: data,
    resetOptions: {
      keepDirtyValues: true,
    },
  });

  const { fields: relayFields, append: appendRelay, remove: removeRelay } = useFieldArray({ control, name: 'relays' });

  const onSubmit = async (formData: MittiSettings) => {
    try {
      await mutateAsync(formData);
    } catch (error) {
      const message = maybeAxiosError(error);
      setError('root', { message });
    }
  };

  const onReset = () => {
    reset(data);
  };

  const canSubmit = !isSubmitting && isDirty && isValid;

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Mitti Integration
        <Panel.InlineElements>
          <Button variant='ontime-ghosted' size='sm' onClick={onReset} isDisabled={!canSubmit}>
            Revert to saved
          </Button>
          <Button
            variant='ontime-filled'
            size='sm'
            type='submit'
            form='mitti-settings-form'
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
        Mitti pushes its countdown rather than answering requests, so it has to be told where to send it.
        <br />
        In Mitti, open Settings → OSC/UDP Controls, tick Enable, then set Feedback To → Custom with this machine&apos;s
        IP address and the listen port below.
        <br />
        <br />
        Mitti sends its feedback to one destination only, so pointing it here takes it away from anything else that was
        receiving it. To keep Bitfocus Companion (or anything else) fed, add a relay below for each one, pointing at its
        Mitti module with a feedback port of its own: Ontime passes every packet straight on, untouched.
      </Info>

      <Panel.Section
        as='form'
        id='mitti-settings-form'
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={(event) => preventEscape(event, onReset)}
      >
        <Panel.Loader isLoading={false} />

        <CountdownSourcePicker />

        <Panel.Title>Connection</Panel.Title>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field
              title='Enable Mitti integration'
              description='Listen for the countdown Mitti sends for its playing cue'
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
              description={mittiState.connected ? 'Receiving feedback from Mitti' : 'No feedback received'}
            />
            <span style={{ color: mittiState.connected ? '#4caf50' : '#999' }}>
              {mittiState.connected ? 'Connected' : 'Disconnected'}
            </span>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Mitti host IP'
              description='IP address of the machine running Mitti'
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
              title='Mitti port'
              description="Mitti's OSC input port. Default: 51000"
              error={errors.port?.message}
            />
            <Input
              id='port'
              placeholder='51000'
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
              title='Listen port'
              description='Port Mitti sends its feedback to. Default: 51001'
              error={errors.listenPort?.message}
            />
            <Input
              id='listenPort'
              placeholder='51001'
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
              title='Feedback timeout'
              description='Milliseconds without feedback before Mitti counts as disconnected. Default: 5000'
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

        <Panel.Title>Relays</Panel.Title>
        <Panel.Description>
          Every packet Mitti sends is passed on to each destination here. A relay to this machine must use a port other
          than the listen port above.
        </Panel.Description>
        <Panel.ListGroup>
          {relayFields.length === 0 && (
            <Panel.ListItem>
              <Panel.Field title='No relays' description='Mitti feedback is not passed on to anything else' />
            </Panel.ListItem>
          )}
          {relayFields.map((field, index) => {
            const relayErrors = errors.relays?.[index];
            return (
              <Panel.ListItem key={field.id}>
                <Panel.Field
                  title={`Relay ${index + 1}`}
                  description='IP address and port of an application that needs Mitti feedback'
                  error={relayErrors?.host?.message ?? relayErrors?.port?.message}
                />
                <Panel.InlineElements>
                  <Input
                    placeholder='IP address'
                    width='10rem'
                    size='sm'
                    textAlign='right'
                    variant='ontime-filled'
                    autoComplete='off'
                    {...register(`relays.${index}.host`, {
                      required: { value: true, message: 'Host is required' },
                      setValueAs: (value) => (typeof value === 'string' ? value.trim() : value),
                    })}
                  />
                  <Input
                    placeholder='Port'
                    width='5rem'
                    maxLength={5}
                    size='sm'
                    textAlign='right'
                    variant='ontime-filled'
                    type='number'
                    autoComplete='off'
                    {...register(`relays.${index}.port`, {
                      valueAsNumber: true,
                      validate: (value) => Number.isInteger(value) || 'Port is required',
                      max: { value: 65535, message: 'Port must be within range 1 - 65535' },
                      min: { value: 1, message: 'Port must be within range 1 - 65535' },
                    })}
                  />
                  <IconButton
                    aria-label={`Remove relay ${index + 1}`}
                    icon={<IoTrash />}
                    size='sm'
                    variant='ontime-ghosted'
                    colorScheme='red'
                    onClick={() => removeRelay(index)}
                  />
                </Panel.InlineElements>
              </Panel.ListItem>
            );
          })}
        </Panel.ListGroup>
        <Button
          leftIcon={<IoAdd />}
          variant='ontime-subtle'
          size='sm'
          onClick={() => appendRelay({ host: '', port: NaN })}
          marginTop={2}
          alignSelf='flex-start'
        >
          Add relay
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
