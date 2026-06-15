import { IoEye, IoEyeOffOutline } from 'react-icons/io5';

import TooltipActionBtn from '../../../common/components/buttons/TooltipActionBtn';
import { setMessage, useExternalMessageInput } from '../../../common/hooks/useSocket';
import { tooltipDelayMid } from '../../../ontimeConfig';

import InputRow from './InputRow';

export default function MessageControl() {
  return <ExternalInput />;
}

export function ExternalInput() {
  const { text, visible } = useExternalMessageInput();

  const toggleExternal = () => {
    if (visible) {
      setMessage.timerSecondary(null);
    } else {
      setMessage.timerSecondary('external');
    }
  };

  return (
    <InputRow
      label='Stage Message'
      placeholder='Message to show on cue screen'
      text={text}
      visible={visible}
      changeHandler={(newValue) => setMessage.externalText(newValue)}
    >
      <TooltipActionBtn
        clickHandler={toggleExternal}
        tooltip={visible ? 'Make invisible' : 'Make visible'}
        aria-label='Toggle stage message visibility'
        openDelay={tooltipDelayMid}
        icon={visible ? <IoEye size='22px' /> : <IoEyeOffOutline size='22px' />}
        variant={visible ? 'ontime-filled' : 'ontime-subtle'}
        size='md'
      />
    </InputRow>
  );
}
