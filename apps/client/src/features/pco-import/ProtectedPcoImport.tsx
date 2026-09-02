import ProtectRoute from '../../common/components/protect-route/ProtectRoute';

import PcoImport from './PcoImport';

export default function ProtectedPcoImport() {
  return (
    <ProtectRoute permission='editor'>
      <PcoImport />
    </ProtectRoute>
  );
}
