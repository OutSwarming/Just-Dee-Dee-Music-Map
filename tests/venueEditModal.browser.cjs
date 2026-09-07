const {chromium,expect}=require('@playwright/test');const fs=require('fs'),assert=require('assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000}});
const output=fs.mkdtempSync(require('path').join(require('os').tmpdir(),'jddm-people-'));
console.log('Screenshots: '+output);
const html=fs.readFileSync('index.html','utf8');const fragment=html.slice(html.indexOf('    <div id="venue-edit-modal"'),html.indexOf('    <div id="booking-email-modal"'));
await page.setContent(fragment);await page.addStyleTag({path:'styles.css'});
await page.evaluate(()=>{window.BARK={services:{spreadsheet:{isConfigured:()=>true,createVenue:async({rawFields})=>{window.saved=rawFields;return{ok:true,rawFields,venue:{'Place ID':'test'}}},saveVenue:async({rawFields})=>{window.saved={...window.saved,...rawFields};return{ok:true,rawFields:window.saved}},getVenue:async()=>({rawFields:window.saved})}}};});
for(const path of ['functions/contactRecords.js','modules/bookingSchema.js','modules/venueEditModal.js'])await page.addScriptTag({path});
await page.evaluate(()=>window.BARK.openNewVenueEditor());
await page.locator('#venue-edit-source-place-name').fill('JDDM Contact Editor Test');
const card=n=>page.locator('[data-person-index]').nth(n);
await card(0).getByRole('textbox',{name:'Contact name',exact:true}).fill('Jamie / booking');
await card(0).getByRole('textbox',{name:'Preferred contact method'}).fill('Text after 4 Eastern');
await card(0).getByRole('textbox',{name:'Email 1',exact:true}).fill('booking@example.com');
await card(0).locator('[data-contact-add="emails"]').click();await card(0).getByRole('textbox',{name:'Email 2',exact:true}).fill('music@example.com');
await card(0).getByRole('textbox',{name:'Phone 1',exact:true}).fill('+1 (330) 555-0100 ext 2');
await card(0).locator('.venue-person-notes summary').click();await card(0).getByRole('textbox',{name:'Contact notes',exact:true}).fill('This note belongs to Jamie.');
await page.locator('[data-person-add]').click();await card(1).getByRole('textbox',{name:'Contact name',exact:true}).fill('Pat / venue owner');await card(1).getByRole('textbox',{name:'Phone 1',exact:true}).fill('330-555-0101');
await card(1).getByRole('textbox',{name:'Contact type',exact:true}).fill('Messenger');await card(1).getByRole('textbox',{name:'Other contact 1',exact:true}).fill('@venue-owner');
await page.locator('#venue-edit-source-next-follow-up').fill('2026-09-20');await page.locator('#venue-edit-save').click();await expect(page.locator('#venue-edit-status')).toContainText('Saved');
let saved=await page.evaluate(()=>window.JDDMContacts.read(window.saved));assert.equal(saved.contacts.length,2);assert.equal(saved.contacts[0].notes,'This note belongs to Jamie.');assert(saved.contacts[0].emails.every(i=>!i.note));assert.equal(saved.contacts[1].others[0].type,'Messenger');assert.equal(await page.evaluate(()=>Object.hasOwn(window.saved,'Contact Details')),false);
await page.evaluate(()=>window.BARK.openVenueEditor({id:'test',name:'JDDM Contact Editor Test'}));
await expect(card(1).getByRole('textbox',{name:'Contact name',exact:true})).toHaveValue('Pat / venue owner');
await card(1).getByRole('textbox',{name:'Phone 1',exact:true}).fill('330-555-0199');await page.locator('#venue-edit-source-next-follow-up').fill('2026-09-22');await page.locator('#venue-edit-save').click();await expect(page.locator('#venue-edit-status')).toContainText('Saved');
await page.evaluate(()=>window.BARK.openVenueEditor({id:'test',name:'JDDM Contact Editor Test'}));await expect(card(1).getByRole('textbox',{name:'Phone 1',exact:true})).toHaveValue('(330) 555-0199');await expect(card(0).getByRole('textbox',{name:'Phone 1',exact:true})).toHaveValue('(330) 555-0100 ext. 2');
await page.screenshot({path:output+'/desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/mobile.png'});
for(const key of ['emails','phones','others']) {const bounds=await card(0).locator(`[data-contact-group="${key}"] [data-contact-row]`).first().evaluate(row=>{const a=row.querySelector('[data-contact-value]').getBoundingClientRect(),b=row.querySelector('[data-contact-add]').getBoundingClientRect();return {ay:a.y,by:b.y,bx:b.right,width:window.innerWidth}});console.log(key,bounds);assert(Math.abs(bounds.ay-bounds.by)<10&&bounds.bx<=bounds.width,'Add must stay inline on mobile');}
await card(1).locator('[data-person-remove]').click();await page.getByRole('dialog',{name:'Remove contact?'}).getByRole('button',{name:'Remove contact',exact:true}).click();await page.locator('#venue-edit-save').click();await expect(page.locator('#venue-edit-status')).toContainText('Saved');assert.equal((await page.evaluate(()=>window.JDDMContacts.read(window.saved))).contacts.length,1);
// Legacy free text becomes an editable Other method rather than an invalid email.
await page.evaluate(()=>{window.saved={'Place Name':'Legacy venue','Contact Name':'Sabrina /blond','Email/Contact':'Jennie owner','Phone Number':'440-555-0100','Contact Type':'stop, email','Notes':'Venue notes'};window.BARK.openVenueEditor({id:'test',name:'Legacy venue'});});
await expect(card(0).getByRole('textbox',{name:'Other contact 1',exact:true})).toHaveValue('Jennie owner');await page.locator('#venue-edit-save').click();await expect(page.locator('#venue-edit-status')).toContainText('Saved');saved=await page.evaluate(()=>window.JDDMContacts.read(window.saved));assert.equal(saved.contacts[0].others[0].value,'Jennie owner');
await browser.close();console.log('PASS: two people, related methods/notes, create/edit/remove, legacy free text, date picker, mobile inline Add. Screenshots: '+output);
})().catch(e=>{console.error(e);process.exitCode=1});
