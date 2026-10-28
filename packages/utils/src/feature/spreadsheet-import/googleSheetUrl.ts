export type GoogleSheetReference = {
  sheetId: string;
  /** the worksheet (tab) id, when the link points at a specific tab */
  gid: string | null;
};

const sheetIdPattern = /^[a-zA-Z0-9_-]{20,100}$/;
const urlIdPattern = /\/spreadsheets(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/;
const gidPattern = /[#&?]gid=(\d+)/;

/**
 * Extracts the sheet ID (and tab gid, if any) from a Google Sheets link or a bare sheet ID
 * eg. https://docs.google.com/spreadsheets/d/<id>/edit#gid=<gid>
 * Links to a sheet published to the web (/d/e/...) are not supported, they do not carry the sheet ID
 */
export function parseGoogleSheetInput(input: string): GoogleSheetReference | null {
  const value = input.trim();
  if (!value) {
    return null;
  }

  const urlMatch = value.match(urlIdPattern);
  if (urlMatch) {
    const sheetId = urlMatch[1];
    if (!sheetIdPattern.test(sheetId)) {
      return null;
    }
    const gidMatch = value.match(gidPattern);
    return { sheetId, gid: gidMatch ? gidMatch[1] : null };
  }

  if (sheetIdPattern.test(value)) {
    return { sheetId: value, gid: null };
  }

  return null;
}
