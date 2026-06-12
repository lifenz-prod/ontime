import { useFieldArray, useForm } from 'react-hook-form';
import { IoAdd, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Select } from '@chakra-ui/react';
import { isOntimeBlock, ServiceProfiles } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
import useRundown from '../../../../common/hooks-query/useRundown';
import useServiceProfiles, { useServiceProfilesMutation } from '../../../../common/hooks-query/useServiceProfiles';
import * as Panel from '../../panel-utils/PanelUtils';

function msToTimeString(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeStringToMs(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return ((hours || 0) * 60 + (minutes || 0)) * 60000;
}

type ProfileForm = {
  boundaryBlockId: string;
  services: Array<{ id: string; name: string; offsetStr: string }>;
};

export default function ServiceProfilesPanel() {
  const { data } = useServiceProfiles();
  const { data: rundownData } = useRundown();
  const { mutateAsync } = useServiceProfilesMutation();

  // boundary candidates are the blocks authored in the rundown, not generated ones
  const blockOptions = rundownData.order
    .map((id) => rundownData.rundown[id])
    .filter((entry) => entry && isOntimeBlock(entry) && !entry.generatedFor);

  const defaultValues: ProfileForm = {
    boundaryBlockId: data.boundaryBlockId ?? '',
    services: data.services.map((service) => ({
      id: service.id,
      name: service.name,
      offsetStr: msToTimeString(service.offset),
    })),
  };

  const {
    control,
    handleSubmit,
    register,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({ defaultValues, values: defaultValues, resetOptions: { keepDirtyValues: true } });

  const { fields, append, remove } = useFieldArray({ control, name: 'services' });

  const onSubmit = async (formData: ProfileForm) => {
    try {
      const profiles: ServiceProfiles = {
        boundaryBlockId: formData.boundaryBlockId || null,
        services: formData.services.map((service) => ({
          id: service.id,
          name: service.name,
          offset: timeStringToMs(service.offsetStr),
        })),
      };
      await mutateAsync(profiles);
      reset(formData);
    } catch (error) {
      const message = maybeAxiosError(error);
      setError('root', { message });
    }
  };

  const addService = () => {
    // a new service defaults to the common two-hour offset from the master
    append({ id: crypto.randomUUID(), name: 'New Service', offsetStr: fields.length === 0 ? '00:00' : '02:00' });
  };

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Service Profiles
        <Panel.InlineElements>
          <Button variant='ontime-ghosted' size='sm' onClick={() => reset()} isDisabled={!isDirty || isSubmitting}>
            Revert
          </Button>
          <Button
            variant='ontime-filled'
            size='sm'
            type='submit'
            form='service-profiles-form'
            isDisabled={!isDirty || isSubmitting}
            isLoading={isSubmitting}
          >
            Save
          </Button>
        </Panel.InlineElements>
      </Panel.SubHeader>
      {errors?.root && <Panel.Error>{errors.root.message}</Panel.Error>}

      <Panel.Divider />

      <Panel.Section as='form' id='service-profiles-form' onSubmit={handleSubmit(onSubmit)}>
        <Panel.Description>
          Configure dual-service mode. The boundary block marks where the master service section begins: entries
          before it are rehearsal and run once. The first service is the authored master; each additional service is
          generated after it as a copy of the master, time-shifted by its offset. The iPad and mobile editors show one
          tab per service (plus PRE for the rehearsal).
        </Panel.Description>

        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field title='Service boundary block' description='Block where the master service section begins' />
            <Select size='sm' width='14rem' variant='ontime' {...register('boundaryBlockId')}>
              <option value=''>No boundary (single section)</option>
              {blockOptions.map((block) => (
                <option key={block.id} value={block.id}>
                  {isOntimeBlock(block) ? block.title || 'Untitled block' : block.id}
                </option>
              ))}
            </Select>
          </Panel.ListItem>
        </Panel.ListGroup>

        <Panel.ListGroup>
          {fields.map((field, index) => (
            <Panel.ListItem key={field.id}>
              <Input
                placeholder='Service name'
                size='sm'
                width='10rem'
                variant='ontime-filled'
                {...register(`services.${index}.name`, { required: true })}
              />
              <Input
                type='time'
                size='sm'
                width='8rem'
                variant='ontime-filled'
                title={index === 0 ? 'Offset of the master service (usually 00:00)' : 'Offset from the master service'}
                {...register(`services.${index}.offsetStr`, { required: true })}
              />
              <IconButton
                aria-label='Delete service'
                icon={<IoTrash />}
                size='sm'
                variant='ontime-ghosted'
                colorScheme='red'
                onClick={() => remove(index)}
              />
            </Panel.ListItem>
          ))}
        </Panel.ListGroup>

        <Button leftIcon={<IoAdd />} variant='ontime-subtle' size='sm' onClick={addService} marginTop={2}>
          Add service
        </Button>
      </Panel.Section>
    </Panel.Card>
  );
}
