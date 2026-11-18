import { getURLSearchParamsFromObj } from '../../../common/components/view-params-editor/ViewParamsEditor';
import { getScheduleOptionsFromParams } from '../../common/schedule/schedule.options';
import { getBackstageOptions } from '../backstage.options';

describe('backstage schedule cycling', () => {
  it('does not cycle when the URL has no stopCycle param', () => {
    expect(getScheduleOptionsFromParams(new URLSearchParams(), true).stopCycle).toBe(true);
  });

  it('cycles when the URL turns stopCycle off', () => {
    expect(getScheduleOptionsFromParams(new URLSearchParams('stopCycle=false'), true).stopCycle).toBe(false);
  });

  it('other views keep cycling by default', () => {
    expect(getScheduleOptionsFromParams(new URLSearchParams()).stopCycle).toBe(false);
  });
});

describe('saving backstage view settings', () => {
  const options = getBackstageOptions('hh:mm:ss a', {});

  it('leaves defaults out of the URL', () => {
    const params = getURLSearchParamsFromObj({ stopCycle: 'true', 'secondary-src': 'note' }, options);
    expect(params.get('stopCycle')).toBeNull();
    expect(params.get('secondary-src')).toBeNull();
  });

  it('writes stopCycle=false when the switch is turned off', () => {
    // an unchecked switch is missing from the form data
    const params = getURLSearchParamsFromObj({ 'secondary-src': 'note' }, options);
    expect(params.get('stopCycle')).toBe('false');
  });

  it('keeps a non-default secondary source', () => {
    const params = getURLSearchParamsFromObj({ stopCycle: 'true', 'secondary-src': 'none' }, options);
    expect(params.get('secondary-src')).toBe('none');
  });
});
