import { useFieldArray, useForm } from 'react-hook-form';
import { IoAdd, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input } from '@chakra-ui/react';
import { ServiceProfiles } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
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
  profiles: Array<{ id: string; name: string; startTimeStr: string }>;
};

export default function ServiceProfilesPanel() {
  const { data } = useServiceProfiles();
  const { mutateAsync } = useServiceProfilesMutation();

  const defaultValues: ProfileForm = {
    profiles: data.map((p) => ({ id: p.id, name: p.name, startTimeStr: msToTimeString(p.startTime) })),
  };

  const {
    control,
    handleSubmit,
    register,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({ defaultValues, values: defaultValues, resetOptions: { keepDirtyValues: true } });

  const { fields, append, remove } = useFieldArray({ control, name: 'profiles' });

  const onSubmit = async (formData: ProfileForm) => {
    try {
      const profiles: ServiceProfiles = formData.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        startTime: timeStringToMs(p.startTimeStr),
      }));
      await mutateAsync(profiles);
      reset(formData);
    } catch (error) {
      const message = maybeAxiosError(error);
      setError('root', { message });
    }
  };

  const addProfile = () => {
    append({ id: crypto.randomUUID(), name: 'New Service', startTimeStr: '09:00' });
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
          Configure service start times for the iPad Editor. Each service profile creates a tab that
          shifts the entire rundown to start at the specified time.
        </Panel.Description>

        <Panel.ListGroup>
          {fields.map((field, index) => (
            <Panel.ListItem key={field.id}>
              <Input
                placeholder='Service name'
                size='sm'
                width='10rem'
                variant='ontime-filled'
                {...register(`profiles.${index}.name`, { required: true })}
              />
              <Input
                type='time'
                size='sm'
                width='8rem'
                variant='ontime-filled'
                {...register(`profiles.${index}.startTimeStr`, { required: true })}
              />
              <IconButton
                aria-label='Delete service profile'
                icon={<IoTrash />}
                size='sm'
                variant='ontime-ghosted'
                colorScheme='red'
                onClick={() => remove(index)}
              />
            </Panel.ListItem>
          ))}
        </Panel.ListGroup>

        <Button
          leftIcon={<IoAdd />}
          variant='ontime-subtle'
          size='sm'
          onClick={addProfile}
          marginTop={2}
        >
          Add service
        </Button>
      </Panel.Section>
    </Panel.Card>
  );
}
