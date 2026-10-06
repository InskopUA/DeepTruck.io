// Guides describe shipped controls. Examples use fictional carriers and phone numbers.
const link = (slug, label) => `<a href="/help/${slug}">${label}</a>`;
const p = text => `<p>${text}</p>`;
const steps = items => `<ol class="steps">${items.map(([title, text]) => `<li><h3>${title}</h3><p>${text}</p></li>`).join('')}</ol>`;
const note = (title, text) => `<aside class="callout"><strong>${title}</strong><p>${text}</p></aside>`;
const image = (name, alt, caption, phone = false) => {
  const size = phone ? [390,844] : {'carrier-checklist':[1366,768],'create-tracking':[650,1150],documents:[570,1000]}[name] || [1440,1000];
  return `<figure class="guide-figure${phone ? ' phone-figure' : ''}"><button type="button" class="image-zoom" data-zoom aria-label="Enlarge: ${alt}"><img src="/help/media/${name}.jpg" alt="${alt}" loading="lazy" width="${size[0]}" height="${size[1]}"><span>View full size ↗</span></button><figcaption>${caption} Screens show example data.</figcaption></figure>`;
};
const table = (headers, rows) => `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<${i ? 'td' : 'th scope="row"'}>${cell}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const section = (id, title, html) => ({ id, title, html });
const groups = [
  {id:'start', title:'Getting started', icon:'compass'},
  {id:'verification', title:'Carrier verification', icon:'shield'},
  {id:'tracking', title:'Load tracking', icon:'pin'},
  {id:'driver', title:'DeepTruck Driver', icon:'phone'},
  {id:'support', title:'Workspace & support', icon:'help'}
];
const articles = [
  {slug:'getting-started', group:'start', title:'Your first load, step by step', description:'From checking a carrier to following a delivery. See how the workspace and Driver app work together.', time:4, audience:'Dispatchers', sections:[
    section('workflow','The whole flow', `<div class="workflow"><div><b>01</b><strong>Verify the carrier</strong><span>Confirm contacts and collect documents.</span></div><div><b>02</b><strong>Invite the driver</strong><span>Create a load using the driver’s own number.</span></div><div><b>03</b><strong>Start tracking</strong><span>The driver accepts and enables location.</span></div><div><b>04</b><strong>Close the delivery</strong><span>Complete the load to end location access.</span></div></div>`),
    section('before','Before you start', p('You need a DeepTruck workspace account, the carrier’s USDOT number, and access to the driver’s own phone number. The carrier needs its listed email and phone, a driver license, a signed W-9, and a certificate of insurance (COI). The driver needs DeepTruck Driver installed.')),
    section('walkthrough','Try a sample delivery', steps([
      ['Find the carrier','Open <strong>Verifications → New verification</strong>, enter the USDOT number and select <strong>Search</strong>. Review the contact information, then select <strong>Verify carrier</strong>.'],
      ['Wait for all five checks','The carrier opens the email link, verifies the SMS code and uploads three documents. Open the carrier in your list to review the files. '+link('review-documents','See what “Complete” means')+'.'],
      ['Create the load','Select <strong>Create tracking</strong> from the completed carrier, or <strong>Tracking → New tracking</strong>. Add a load reference, driver, pickup, delivery and expiry. Select <strong>Send invitation</strong>.'],
      ['Let the driver start','The driver opens the app, signs in using the number that received the invitation and selects <strong>Accept &amp; start tracking</strong>. On iPhone, follow the guide to allow location <strong>Always</strong>.'],
      ['Follow and finish','In <strong>Tracking</strong>, select the load to see the latest location and update time. When delivery is finished, the driver selects <strong>Complete delivery</strong> or you complete the load in the workspace.']
    ])),
    section('next','Choose your next guide', p(link('verify-carrier','Verify a carrier')+' · '+link('create-tracking','Send a driver invitation')+' · '+link('accept-load','Start a load in Driver')))
  ]},
  {slug:'account', group:'start', title:'Create an account & sign in', description:'Open your dispatch workspace. Drivers use a separate phone sign-in in the app.', time:2, audience:'Dispatchers', sections:[
    section('create','Create your workspace account', steps([
      ['Open Sign Up','Go to <a href="/signup">Sign Up</a>. Enter your first name, last name, company, email and password.'],
      ['Create your account','Select <strong>Create account</strong>. If the page asks you to confirm your email, open the confirmation email, then return to <a href="/login">Sign In</a>.'],
      ['Open your workspace','Sign in with your email and password. The workspace opens on <strong>Verifications</strong>. Use the sidebar to open <strong>Tracking</strong>, <strong>Plans</strong>, <strong>Settings</strong> or <strong>Help &amp; resources</strong>. On a small screen, secondary navigation is under <strong>•••</strong>.']
    ])),
    section('driver','Signing in as a driver?', note('Use the Driver app','Drivers sign in with their phone number and an SMS code. Your workspace email and password do not sign you in to Driver. '+link('driver-sign-in','Open the driver sign-in guide')+'.')),
    section('help','If you cannot sign in', p('Check the email spelling and password, including the keyboard layout. If you were asked to confirm your email, finish that first. If the sign-in page cannot load, refresh it and check your connection. For account recovery, <a href="mailto:verify@deeptruck.io?subject=Account%20help">contact support</a>; do not send your password or SMS codes.'))
  ]},
  {slug:'verify-carrier', group:'verification', title:'Send a carrier verification', description:'Look up a USDOT number, review the listed contacts and send the five-check request.', time:3, audience:'Dispatchers', sections:[
    section('lookup','Find the carrier', steps([
      ['Start a new verification','Open <strong>Verifications</strong> and select <strong>New verification</strong>.'],
      ['Search by USDOT','Enter the carrier’s USDOT number and select <strong>Search</strong>. Match the business name and identifiers to the carrier you are working with.'],
      ['Review the contact information','The lookup shows the FMCSA-listed email and phone. Expand <strong>FMCSA profile · authority, fleet &amp; insurance</strong> for the additional profile details. Both email and phone must be present to send a request.']
    ])),
    section('send','Send the request', p('Select <strong>Verify carrier</strong>. The carrier receives an email link and an SMS code for the carrier phone. The checklist covers email, phone, driver license, W-9 and COI. Return to the list to follow progress.' ) + image('verifications','Verifications list showing complete and in-progress carrier checks','Open a carrier name to view its contact checks and documents.')),
    section('existing','If a request already exists', p('A new search reuses an existing request for that USDOT number. Select <strong>Open existing verification</strong> to continue it. In the carrier details, use <strong>Copy carrier link</strong> if you need to share the existing verification page with the carrier.')),
    section('missing','Missing or incorrect contacts', note('Confirm the listed contacts first','The workspace sends to the contacts returned by the lookup; this form does not let you replace them. If they are missing or belong to someone else, resolve the carrier’s listed contact information before sending. A successful contact check is only one part of your review.'))
  ]},
  {slug:'complete-verification', group:'verification', title:'Complete a carrier verification', description:'A guide for carriers: confirm your phone and upload the three requested documents.', time:3, audience:'Carriers', sections:[
    section('open','Open your verification link', p('Open the link in the DeepTruck verification email. Check the company name, USDOT and contact details. You can complete this page without creating a workspace account. Opening the link confirms access to the email automatically.') + image('carrier-checklist','Carrier verification page with phone code and three document upload controls','All five checks are shown together. Progress saves after each successful step.')),
    section('phone','Confirm your phone', steps([
      ['Find the SMS code','Use the verification code sent to the carrier phone shown on the page. This is separate from a driver’s app sign-in code.'],
      ['Verify the code','Enter the six digits in <strong>Phone confirmation</strong> and select <strong>Verify phone</strong>. Wait for the verified state before continuing. If the code is rejected, check the latest carrier verification message and contact your dispatcher if you need help.']
    ])),
    section('upload','Upload your documents', steps([
      ['Driver license','Select <strong>Upload license</strong> and choose a clear PDF, JPG or PNG of the requested license.'],
      ['W-9','Select <strong>Upload W-9</strong> and choose the signed document.'],
      ['Certificate of insurance','Select <strong>Upload COI</strong> and choose the insurance certificate. After upload, the filename appears next to that step.']
    ])+p('Wait for each upload to finish. To correct a document, select <strong>Replace file</strong> and choose the replacement. If an upload fails, try again; the previous successfully uploaded file remains.')),
    section('done','How you know you are finished', note('Look for 5 of 5 complete','The page shows <strong>Verification complete</strong> when both contacts and all three uploads are finished. The dispatcher can then review your documents. This does not automatically book a load or begin driver tracking.'))
  ]},
  {slug:'review-documents', group:'verification', title:'Review progress & documents', description:'Find incomplete checks, open submitted files and move a completed carrier into tracking.', time:3, audience:'Dispatchers', sections:[
    section('find','Find the request', p('Use <strong>All</strong>, <strong>In progress</strong> or <strong>Complete</strong> in Verifications. Search by carrier name, USDOT or contact. Sort by latest activity, newest requests or carrier name. The progress column lists the checks still waiting.')),
    section('review','Open the carrier details', steps([
      ['Open the carrier','Select the carrier name or its document icon. The detail panel shows the two contact checks and the three document cards.'],
      ['Read each file','Open the uploaded driver license, W-9 and insurance / COI. Compare names and identifiers with the carrier you intend to use; review document contents and dates as part of your own process.'],
      ['Refresh when needed','Use the refresh icon in the detail panel or the list to fetch updated checks. <strong>Copy carrier link</strong> shares the existing checklist with the carrier.']
    ]) + image('documents','Carrier details showing Driver license, W-9 and Insurance / COI cards','Contact confirmation and uploaded files are visible in the same panel.')),
    section('complete','What Complete means', note('Received is different from reviewed','<strong>Complete · 5/5</strong> means the email and phone were confirmed and all three files were uploaded. DeepTruck does not certify the authenticity, validity or coverage of those documents. Your team decides whether to proceed.')),
    section('tracking','Create tracking next', p('Once all five checks are complete, select <strong>Create tracking</strong> in the carrier details. The completed carrier is selected for you. '+link('create-tracking','Continue with the invitation guide')+'.'))
  ]},
  {slug:'create-tracking', group:'tracking', title:'Create a load & invite the driver', description:'Send an SMS invitation after carrier verification. Use the driver’s own phone number.', time:3, audience:'Dispatchers', sections:[
    section('before','Before sending an invitation', p('The carrier must have all five verification checks complete. Select <strong>Create tracking</strong> in its details, or open <strong>Tracking → New tracking</strong> and choose a completed carrier.')),
    section('fields','Fill in the load', table(['Field','What to enter'],[
      ['Carrier','Choose the completed carrier verification.'],['Driver name','The person who will drive this load.'],['Driver phone','The driver’s own number, including the country code, for example +1 202 555 0148.'],['Load name / reference','A reference your team and the driver will recognize, such as Load #1042 · Miami.'],['Pickup / delivery','Expand <strong>Add route, vehicles &amp; pickup time</strong> to add addresses or clear location descriptions.'],['Tracking expires','Choose when location access must end. The expiry must be after planned pickup, more than five minutes from now and within 30 days.'],['Optional details','In that same optional section, add vehicles (one per line) and planned pickup.']
    ]) + image('create-tracking','New tracking form with driver number, load reference, addresses and expiry','The driver number is entered separately from the carrier office number.')),
    section('send','Send and check the result', steps([
      ['Send invitation','Select <strong>Send invitation</strong>. The load appears under <strong>Awaiting</strong> and the driver receives an SMS invitation.'],
      ['Wait for driver consent','Signing in alone does not start sharing. The driver must select <strong>Accept &amp; start tracking</strong> and allow location access. '+link('accept-load','Share the driver guide')+'.'],
      ['If SMS delivery fails','A load can be saved even if its invitation fails. Select that existing load and use <strong>Resend invitation</strong>. Check the driver number before retrying. Do not create a duplicate load just to resend.']
    ])),
    section('example','Example: office number vs driver number', note('Use the number on the driver’s phone','If the carrier office receives your verification code but another person drives the truck, send the load invitation to that driver’s number. Driver app loads match the verified phone used to sign in.'))
  ]},
  {slug:'monitor-tracking', group:'tracking', title:'Read the map & tracking statuses', description:'Understand the latest GPS point, update time, accuracy and the Needs attention filter.', time:3, audience:'Dispatchers', sections:[
    section('map','Open a load', p('Open <strong>Tracking</strong> and select a load on the left. The detail panel shows driver, carrier, pickup, delivery and expiry. Once a position is received, the map shows the latest recorded phone location and the available trail. On mobile, select a load to open its details; use the back control to return to the list.') + image('tracking','Tracking workspace showing a sharing load and its recorded location','Read the recorded time and accuracy alongside the map. The example map is illustrative.')),
    section('filters','Choose a filter', table(['Filter','What it shows'],[
      ['Open','Loads that have not closed.'],['Sharing','Loads with sharing activated. Check the GPS time as well.'],['Awaiting','Invitations waiting for the driver to accept.'],['Needs attention','Failed invitations, paused sharing, old pending invitations or active loads with missing / delayed GPS.'],['Closed','Completed, cancelled, declined and expired loads.']
    ])),
    section('freshness','Read location freshness', p('The workspace checks for updates every 15 seconds while Tracking is visible. That refresh interval is separate from when the phone records GPS. <strong>Location delayed</strong> appears when the latest recorded point is at least five minutes old. <strong>Sharing location</strong> indicates the load’s sharing state; it does not by itself mean a new point has arrived.') + note('Example: Sharing location + 6 min ago','The load is active, but its last received GPS point is six minutes old. Check the driver’s connection, app status and location permissions before relying on that point. '+link('troubleshooting','Follow the troubleshooting checks')+'.')),
    section('accuracy','Read accuracy and time', p('Accuracy is an approximate radius around the position reported by the phone. A smaller number means a more precise estimate. The map is a recorded position, not a guaranteed live location or delivery ETA. Use <strong>Last recorded</strong> to check when it was captured.'))
  ]},
  {slug:'manage-tracking', group:'tracking', title:'Resend, complete or cancel a load', description:'Manage an invitation and end location access when the shipment is finished.', time:2, audience:'Dispatchers', sections:[
    section('resend','Resend an invitation', steps([
      ['Find the existing load','In <strong>Tracking</strong>, search by load, driver or carrier and select the load.'],
      ['Use Resend invitation','For a pending invitation, select <strong>Resend invitation</strong> and check the confirmation or error. Ask the driver to sign in using the number shown in the load.']
    ])),
    section('complete','Complete a delivered load', p('Select the open load and choose <strong>Complete load</strong> when that action is available. Confirm the prompt. The load becomes <strong>Completed</strong> and location access for that load closes. The driver can also finish it with <strong>Complete delivery</strong> in the app.')),
    section('cancel','Cancel or correct a load', p('Use <strong>Cancel load</strong> and confirm when the shipment will not proceed or the invitation was created with the wrong driver number. Location access for that load closes. To correct details that cannot be edited in the workspace, create a replacement load with the correct information and let the driver accept it.')),
    section('expiry','What happens at expiry', note('Access ends with the load','A load also closes when its expiry time passes or the driver declines it. Closed records are available under <strong>Closed</strong> in the workspace and <strong>History</strong> in Driver. Closing one load does not close other active loads for the same driver.'))
  ]},
  {slug:'driver-sign-in', group:'driver', title:'Sign in to DeepTruck Driver', description:'Use the invited phone number, enter your SMS code and find the load in the app.', time:2, audience:'Drivers', sections:[
    section('open','Open the app from your invitation', p('Open the link in your load invitation SMS, then select <strong>Open DeepTruck Driver</strong>. If you do not have the app, use the installation option provided on that page. If it says pilot testing, ask your dispatcher or support for access; a public store download may not yet be available.')),
    section('signin','Sign in with your phone', steps([
      ['Use the invited number','Enter the number that received the invitation, with its country code. For a US number, use +1 followed by the ten digits.'],
      ['Get your code','Select <strong>Send code</strong>. Enter the six-digit sign-in code from the latest SMS and select <strong>Continue</strong>.'],
      ['Find your load','Open <strong>Loads</strong>. Invitations for your verified phone number appear here. Pull down to refresh if needed.']
    ]) + image('driver-login','Driver sign-in screen with phone field and Send code button','No workspace password is needed.',true)),
    section('retry','Wrong number or missing code?', p('Use <strong>Change number</strong> to correct your phone number. If you need another code, wait until <strong>Resend code</strong> is available. Use the latest code promptly; older codes may no longer work. Never share your code with someone else.') + note('No load after sign-in?','Check your verified phone number in <strong>Profile</strong> against the driver number in the dispatcher’s load. '+link('troubleshooting','See the missing-load checklist')+'.'))
  ]},
  {slug:'accept-load', group:'driver', title:'Accept a load & start tracking', description:'One main action takes you from an invitation to sharing location for your delivery.', time:3, audience:'Drivers', sections:[
    section('review','Check the invitation', p('Open <strong>Loads</strong> and find the new invitation. Check the load reference, pickup and delivery. Use <strong>••• → View details</strong> for the carrier, vehicles, planned pickup and when location access ends.') + image('driver-invitation','Driver load invitation with pickup, delivery and Accept & start tracking button','The main blue button accepts this load and starts its tracking flow.',true)),
    section('start','Accept and start', steps([
      ['Select Accept & start tracking','This is the main action on a new invitation. It combines accepting the load with starting location sharing.'],
      ['Follow the location guide','If permissions are missing, the app shows the setup steps. On iPhone, allow location while using the app, then choose <strong>Always</strong> for background access. '+link('location-permissions','See the location setup guide')+'.'],
      ['Check the load state','After permissions are ready, return to Driver to finish starting the selected load. Check that the card shows tracking and the action changes to <strong>Pause tracking</strong>. A GPS update appears after the phone obtains and sends a position.']
    ])),
    section('later','Need to start later?', p('Select <strong>••• → Accept, start later</strong>. The invitation is accepted without starting sharing. When ready, use the load’s <strong>Start tracking</strong> action. To decline an invitation, choose <strong>••• → Decline invitation</strong> and confirm.')),
    section('consent','You control sharing', note('Location is tied to your load','The card identifies who receives your location and when access ends. Signing in or granting a phone permission alone does not start tracking. You can pause sharing from the load card.'))
  ]},
  {slug:'location-permissions', group:'driver', title:'Set up location: Always on iPhone', description:'Make location updates work with the screen locked. Check background access and precision.', time:3, audience:'Drivers', sections:[
    section('why','Why Always is needed', p('A delivery continues when your phone is locked or Driver is in the background. <strong>While Using the App</strong> alone does not give the app the background access required for this flow. <strong>Always</strong> lets Driver request location in the background; sharing still only starts for loads you choose to track.')),
    section('iphone','On iPhone', steps([
      ['Start with the in-app guide','Select <strong>Accept &amp; start tracking</strong>, then <strong>Enable location</strong>. Allow <strong>While Using the App</strong> in the first system prompt, then choose <strong>Always</strong> if prompted.'],
      ['If the app asks you to open Settings','Select <strong>Open settings</strong>. Open <strong>DeepTruck Driver → Location</strong> and choose <strong>Always</strong>. You can also find the app under iPhone <strong>Settings → Privacy &amp; Security → Location Services</strong>.'],
      ['Check Location Services and precision','Make sure <strong>Location Services</strong> is on. Turn on <strong>Precise Location</strong> for a more accurate position.'],
      ['Return to Driver','Return to the app to finish setup. Open <strong>Profile</strong>: Location services should show <strong>On</strong> and Background access should show <strong>Always</strong>. Check the selected load is tracking.']
    ]) + image('driver-settings','Driver location guide showing Choose Always in Settings and Open settings button','The guide tells you exactly what to select in the phone settings.',true)),
    section('android','On Android', p('Follow the in-app location guide. In the app’s location permissions, select <strong>Allow all the time</strong> for background access. Enable phone location services and precise location where offered. Setting labels vary by device. Return to Driver and check <strong>Profile → Background access</strong>.')),
    section('limits','If GPS still stops updating', note('Permissions are only one check','Keep an internet connection available and check the app’s tracking state. Phone settings and operating-system restrictions can affect background updates. If the app has been force-closed, reopen it and check the active load. '+link('troubleshooting','Troubleshoot delayed GPS')+'.')+p('For iPhone’s system controls, see <a href="https://support.apple.com/en-us/102515" target="_blank" rel="noopener noreferrer">Apple’s location permission guide ↗</a>.'))
  ]},
  {slug:'driver-controls', group:'driver', title:'Pause sharing & complete delivery', description:'Manage an active delivery, check your location settings and find closed loads.', time:2, audience:'Drivers', sections:[
    section('pause','Pause or resume a load', p('In <strong>Loads</strong>, select <strong>Pause tracking</strong> on an active load. The dispatcher sees sharing paused. When ready, select <strong>Resume tracking</strong>. If location access needs attention, follow the permission guide first.') + image('driver-active','Active Driver load with Pause tracking and Complete delivery actions','Pause sharing temporarily, or finish the delivery to close the load.',true)),
    section('complete','Finish your delivery', steps([
      ['Select Complete delivery','Use this action when the delivery is finished. Read and confirm the prompt.'],
      ['Check History','The load is closed and location access for it ends. Open <strong>History</strong> in the bottom navigation to see closed loads. A completed delivery cannot be resumed as the same active load.']
    ])),
    section('profile','Use Profile', p('<strong>Profile</strong> shows your verified phone number, location services, background access and accuracy. Select <strong>Configure location</strong> or <strong>Open location settings</strong> to fix permissions. If you have active loads, <strong>Pause all tracking</strong> stops sharing for them. <strong>Sign out</strong> also stops this app’s location sharing. Other loads are not completed by pausing or signing out.'))
  ]},
  {slug:'workspace-settings', group:'support', title:'Company settings & plans', description:'Update the company displayed in your workspace and find the right verification volume.', time:2, audience:'Dispatchers', sections:[
    section('company','Update your company name', steps([
      ['Open Settings','Select <strong>Settings</strong> in the sidebar. On a small screen, open <strong>••• → Settings</strong>.'],
      ['Save the company name','Edit the company field and select <strong>Save changes</strong>. This name is displayed in your workspace and driver invitations. Your account name and email are shown in the account section.']
    ])),
    section('plans','Choose a plan', p('Open <strong>Plans</strong> to compare the current monthly verification volumes. Use the <strong>Contact us</strong> link for the plan you want to arrange activation or a change. The workspace does not currently offer a self-service payment form.')),
    section('theme','Choose light or dark', p('On the public website, use the theme switch in the footer. Help Center and the website sign-in pages follow that saved preference in the same browser. The workspace and Driver app use their own light interface.'))
  ]},
  {slug:'extension', group:'support', title:'Use Verify on Central Dispatch', description:'Start a carrier check from the DeepTruck Chrome extension and continue in the workspace.', time:2, audience:'Dispatchers', sections:[
    section('access','Get access to the extension', p('Use the DeepTruck Verify Chrome extension supplied by your team. If you do not have an installation link or package, <a href="mailto:verify@deeptruck.io?subject=Chrome%20extension%20access">ask support for extension access</a>. Do not install similarly named extensions from an unverified source.')),
    section('use','Verify a carrier on Central Dispatch', steps([
      ['Sign in to Verify','Open the DeepTruck extension from Chrome’s toolbar and sign in with the same DeepTruck email and password you use for the workspace.'],
      ['Open a carrier profile','Open a carrier page on <strong>app.centraldispatch.com</strong>. The extension reads the USDOT number and shows the carrier’s lookup details in its panel.'],
      ['Start the check','Review the listed contacts and select <strong>Verify carrier</strong>. Requests appear in the same account’s <strong>Verifications</strong> list. Continue with '+link('review-documents','progress and document review')+'.']
    ])),
    section('panel','If the panel does not appear', p('Check that the extension is enabled in Chrome and that you are on a Central Dispatch carrier profile. Refresh the carrier page after installing or updating the extension. If the page has no readable USDOT number, use <strong>New verification</strong> in the workspace to look up the carrier directly.'))
  ]},
  {slug:'troubleshooting', group:'support', title:'Missing load, SMS or delayed GPS?', description:'Quick checks for the most common invitation, sign-in and location problems.', time:4, audience:'Everyone', sections:[
    section('no-load','I signed in, but my load is missing', steps([
      ['Compare the phone numbers','Driver: open <strong>Profile</strong> and check the verified number. Dispatcher: open the load in <strong>Tracking</strong> and compare the driver phone. Include the country code. The carrier office number may be different.'],
      ['Refresh the right screen','Driver: open <strong>Loads</strong> and pull down to refresh. Check <strong>History</strong> if the load has already closed. Dispatcher: use refresh in Tracking to see its current state.'],
      ['Check the invitation state','A cancelled, declined or expired load is closed. If the driver phone was wrong, cancel the incorrect load and send a new invitation with the right number. If the numbers and state are correct but the load stays missing, contact support with the load reference.']
    ])),
    section('sms','My SMS code or invitation did not arrive', p('Check the number and country code, cellular reception and blocked / filtered messages. A driver can request a new sign-in code once <strong>Resend code</strong> is available. A dispatcher can use <strong>Resend invitation</strong> on the existing pending load. These are two different messages. If the app shows a provider or delivery error, contact support with the error text; never send a code.')),
    section('delayed','Location is delayed or missing', steps([
      ['Check the load is tracking','Driver: look at the load card. If it is paused or ready to start, use its start / resume action. Dispatcher: check the sharing state and last recorded time.'],
      ['Check Profile','Location services must be <strong>On</strong>. On iPhone, background access must be <strong>Always</strong>. Use '+link('location-permissions','the permission guide')+' if the app shows Required.'],
      ['Check connection and reopen Driver','Make sure the phone can reach the internet. Reopen Driver if it was closed. Leave the active load screen open briefly, then refresh the workspace. Pending updates retry when connectivity returns.'],
      ['Read the recorded time','The workspace refreshes every 15 seconds, but phone updates depend on GPS availability and phone conditions. A delayed point should not be treated as the driver’s current position. If it remains delayed, contact support.']
    ])),
    section('verification','Carrier verification is incomplete', p('Open the carrier details and read the missing-check list. Ask the carrier to reopen its verification link, finish the phone code or upload the missing document. A filename should appear after a successful upload. The dispatcher can copy the existing carrier link instead of creating another request.')),
    section('support','What to send to support', note('Help us find the problem','Email <a href="mailto:verify@deeptruck.io?subject=DeepTruck%20support">verify@deeptruck.io</a> with the load reference or carrier USDOT, what you were trying to do, the exact error, and whether it happened in the workspace or Driver. Include a screenshot if useful. Do not include passwords, SMS codes or unnecessary identity documents.'))
  ]},
  {slug:'privacy', group:'support', title:'Who can see a driver’s location?', description:'How load consent, phone permissions and expiry work together.', time:2, audience:'Everyone', sections:[
    section('start','When sharing starts', p('Signing in with an SMS code identifies the driver’s phone account. Allowing location in phone Settings gives the app permission to request positions. Sharing for a load starts only when the driver chooses its tracking action. <strong>Accept, start later</strong> accepts without starting sharing.')),
    section('access','Who gets access', p('The inviting workspace can view location for its load while the driver is sharing. The Driver load card names the recipient and shows when access ends. A carrier verification by itself does not give access to a driver’s location.')),
    section('end','When sharing ends', p('The driver can pause a load or pause all tracking. Completing, cancelling, declining or expiring a load closes location access for that load. Historical load information and previously recorded locations may remain available in the workspace; ending access does not promise deletion of past records.')),
    section('policy','Read the full policy', p('See our <a href="/privacy">Privacy Policy</a> for data handling and contact options. For a question about your data, email <a href="mailto:verify@deeptruck.io?subject=Privacy%20question">verify@deeptruck.io</a>.'))
  ]}
];
module.exports = {groups, articles};
