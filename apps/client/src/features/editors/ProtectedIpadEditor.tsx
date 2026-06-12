import ProtectRoute from '../../common/components/protect-route/ProtectRoute';

import IpadEditor from './IpadEditor';

export default function ProtectedIpadEditor() {
  return (
    <ProtectRoute permission='editor'>
      <IpadEditor />
    </ProtectRoute>
  );
}
