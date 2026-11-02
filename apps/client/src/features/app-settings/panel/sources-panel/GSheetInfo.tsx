import Info from '../../../../common/components/info/Info';
import ExternalLink from '../../../../common/components/link/external-link/ExternalLink';

const googleSheetDocsUrl = 'https://docs.getontime.no/features/import-spreadsheet-gsheet/';

export default function GSheetInfo() {
  return (
    <Info>
      Ontime can import your rundown from a Google Sheet.
      <br />
      <br />
      Share the sheet as “Anyone with the link can view” and paste its link, no sign in needed.
      <br />
      To import a private sheet, or to export your rundown back to the sheet, sign in with Google using tokens from your
      Google account. <br />
      <ExternalLink href={googleSheetDocsUrl}>See the docs</ExternalLink>
    </Info>
  );
}
