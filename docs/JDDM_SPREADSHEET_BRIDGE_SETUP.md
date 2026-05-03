# Just Dee Dee Spreadsheet Bridge Setup

This app is hosted on GitHub Pages, so it cannot write to Google Sheets by itself. The bridge is a tiny Google Apps Script web app that runs inside the spreadsheet and updates rows for the map.

## 1. Install the Bridge

1. Open the JustDeeDee Music spreadsheet.
2. Click `Extensions` > `Apps Script`.
3. Delete any starter code in `Code.gs`.
4. Paste the contents of:

   `google-apps-script/jddm-spreadsheet-bridge/Code.gs`

5. Click `Save`.

## 2. Deploy the Web App

1. Click `Deploy` > `New deployment`.
2. Click the gear icon and choose `Web app`.
3. Set:
   - Description: `Just Dee Dee Music Map bridge`
   - Execute as: `Me`
   - Who has access: `Anyone with the link`
4. Click `Deploy`.
5. Authorize the requested Google Sheets permissions.
6. Copy the Web app URL. It should end with `/exec`.

## 3. Connect the Map

Paste the URL into `config/firebaseConfig.example.js`:

```js
window.JDDM_SPREADSHEET_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
window.JDDM_VENUE_CSV_URL = `${window.JDDM_SPREADSHEET_API_URL}?action=csv`;
```

`JDDM_VENUE_CSV_URL` makes spreadsheet edits flow back into the map data feed. The app also refreshes immediately after a save when the bridge returns updated CSV.

## Optional Edit Token

For a one-person prototype, the bridge can run without a token. If you want a light guard:

1. Set `EDIT_TOKEN` in `Code.gs`.
2. Set the same token in `config/firebaseConfig.example.js`:

```js
window.JDDM_SPREADSHEET_EDIT_TOKEN = "your-token";
```

Do not treat this as real security if the site is public. It is browser-visible.

## Expected Sheet Columns

The bridge works with the current source sheet headers:

- `Place`
- `Rank`
- `Contacted`
- `Want`
- `#Times`
- `Contact Type`
- `Card`
- `Played`
- `Music`
- `Days/Months`
- `Contact Name`
- `Email/Contact`
- `Phone Number`
- `Website`
- `Status`
- `Yearly Booking`
- `Notes`
- `Latitude`
- `Longitude`

The map also supports normalized columns if they are added later:

- `venue name`
- `address`
- `city`
- `state`
- `zip`
- `venue type`
- `website/social link`
- `booking/contact info`
- `upcoming event date`
- `upcoming event time`
- `private event`

## Test

After connecting the URL:

1. Open the map.
2. Click a pin.
3. Click `Update Spreadsheet`.
4. Edit a harmless field, such as `Status`.
5. Click `Save to Spreadsheet`.
6. Confirm the Google Sheet row updates.
7. Confirm the map refreshes from the sheet.
