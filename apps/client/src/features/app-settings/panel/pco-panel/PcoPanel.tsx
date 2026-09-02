import { useCallback } from 'react';
import type { PcoRules } from 'ontime-types';

import useScrollIntoView from '../../../../common/hooks/useScrollIntoView';
import { usePcoRules, usePcoRulesMutation } from '../../../../common/hooks-query/usePco';
import type { PanelBaseProps } from '../../panel-list/PanelList';
import * as Panel from '../../panel-utils/PanelUtils';

import PcoConnection from './PcoConnection';
import PcoDefaults from './PcoDefaults';
import PcoImportLink from './PcoImportLink';

/**
 * Planning Center settings.
 *
 * Every control writes immediately, patched over the rules as last read from the
 * server. There is deliberately no dirty form here: both sections edit one
 * pco-rules.json, so a form on either could only save by writing the whole object
 * back, silently reverting whatever the other section had changed.
 */
export default function PcoPanel({ location }: PanelBaseProps) {
  const { data: rules, isFetching } = usePcoRules();
  const { mutateAsync, isPending } = usePcoRulesMutation();

  const importRef = useScrollIntoView<HTMLDivElement>('import', location);
  const defaultsRef = useScrollIntoView<HTMLDivElement>('defaults', location);

  const patchRules = useCallback(
    async (patch: Partial<PcoRules>) => {
      if (!rules) {
        return;
      }
      await mutateAsync({ ...rules, ...patch });
    },
    [rules, mutateAsync],
  );

  return (
    <>
      <Panel.Header>Planning Center</Panel.Header>
      <Panel.Loader isLoading={isFetching && !rules} />

      {rules && (
        <>
          <div ref={importRef}>
            <PcoConnection rules={rules} patchRules={patchRules} isSaving={isPending} />
            <PcoImportLink />
          </div>
          <div ref={defaultsRef}>
            <PcoDefaults rules={rules} patchRules={patchRules} isSaving={isPending} />
          </div>
        </>
      )}
    </>
  );
}
