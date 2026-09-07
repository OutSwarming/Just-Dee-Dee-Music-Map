const {chromium,expect}=require('@playwright/test');const fs=require('fs');
(async()=>{
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000}});
const output=require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'jddm-editor-'));
const html=fs.readFileSync('index.html','utf8');const fragment=html.slice(html.indexOf('    <div id="venue-edit-modal"'),html.indexOf('    <div id="booking-email-modal"'));
await page.setContent(fragment);await page.addStyleTag({path:'styles.css'});
await page.evaluate(()=>{window.BARK={services:{spreadsheet:{isConfigured:()=>true,createVenue:async({rawFields})=>{window.saved=rawFields;return{ok:true,rawFields,venue:{'Place ID':'test'}}},saveVenue:async({rawFields})=>{window.saved=rawFields;return{ok:true,rawFields}},getVenue:async()=>({rawFields:window.saved})}}};});
await page.addScriptTag({path:'modules/bookingSchema.js'});await page.addScriptTag({path:'modules/venueEditModal.js'});
await page.evaluate(()=>window.BARK.openNewVenueEditor());
await page.locator('#venue-edit-source-place-name').fill('JDDM Contact Editor Test');
await page.getByRole('textbox',{name:'Email 1',exact:true}).fill('booking@example.com');
await page.locator('[data-contact-add="emails"]').click();await page.getByRole('textbox',{name:'Email 2',exact:true}).fill('music@example.com');
await page.locator('[aria-label="Notes for email 2"]').click();await page.locator('#venue-contact-emails-1-note').fill('Jamie, music director; "after 5"\nSend gig materials here.');await page.locator('[data-contact-group="emails"] [data-note-done]').nth(1).click();
await page.getByRole('textbox',{name:'Phone 1',exact:true}).fill('+1 (330) 555-0100 ext 2');await page.locator('[data-contact-add="phones"]').click();await page.getByRole('textbox',{name:'Phone 2',exact:true}).fill('330-555-0101');
await page.locator('[aria-label="Notes for phone 2"]').click();await page.locator('#venue-contact-phones-1-note').fill('Mobile — call after 4pm Eastern');await page.locator('[data-contact-group="phones"] [data-note-done]').nth(1).click();
await page.locator('#venue-edit-source-next-follow-up').fill('2026-09-20');await page.locator('#venue-edit-save').click();await expect(page.locator('#venue-edit-status')).toContainText('Saved');
const saved=await page.evaluate(()=>window.saved);if(JSON.parse(saved['Contact Details']).emails[1].note!=='Jamie, music director; "after 5"\nSend gig materials here.')throw Error('Create notes lost');
await page.evaluate(()=>window.BARK.openVenueEditor({id:'test',name:'JDDM Contact Editor Test'}));
await expect(page.getByRole('textbox',{name:'Email 2',exact:true})).toHaveValue('music@example.com');await expect(page.locator('#venue-edit-source-next-follow-up')).toHaveValue('2026-09-20');
await page.locator('[aria-label="Notes for email 2"]').click();await expect(page.locator('#venue-contact-emails-1-note')).toHaveValue('Jamie, music director; "after 5"\nSend gig materials here.');
await page.screenshot({path:output+'/desktop.png'});
await page.locator('#venue-contact-emails-1-note').fill('Updated second contact note');await page.locator('[data-contact-group="emails"] [data-note-done]').nth(1).click();
await page.locator('#venue-edit-source-next-follow-up').fill('2026-09-22');await page.locator('#venue-edit-save').click();await expect(page.locator('#venue-edit-status')).toContainText('Saved');
await page.evaluate(()=>window.BARK.openVenueEditor({id:'test',name:'JDDM Contact Editor Test'}));await expect(page.locator('#venue-contact-emails-1-note')).toHaveValue('Updated second contact note');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/mobile.png'});
for(const key of ['emails','phones']) {const bounds=await page.locator(`[data-contact-group="${key}"] [data-contact-row]`).first().evaluate(row=>{const a=row.querySelector('input').getBoundingClientRect(),b=row.querySelector('[data-contact-add]').getBoundingClientRect();return {ay:a.y,by:b.y,bx:b.right,width:window.innerWidth}});if(Math.abs(bounds.ay-bounds.by)>10||bounds.bx>bounds.width)throw Error('Add button not inline on mobile');}
await browser.close();console.log('PASS: Add/Edit, 2 emails and 2 phones, per-contact notes, dates, reload, desktop/mobile inline Add');
})().catch(e=>{console.error(e);process.exitCode=1});
