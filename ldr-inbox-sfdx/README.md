# LDR Inbox – Salesforce Lightning Web Component

Status (2026-10-20, canvas 1792543523-e7b5: Aqil's notes #119–131 incl. Aziz's design-system change 25, on top of 41be;
Rep Finder left out): **production candidate, written, not deployed, not run in any org by Claude.** Built on Zaid's v33 package (his test class, permission set and file list). The LWC compiles with
`@lwc/compiler` and passes ESLint; the Apex was syntax-parsed only (not compiled, tests not run). `LDR_Prospect_Since` =
Sep 1, 2026.

Refactor pass 2026-10-20 (bug fixes, dead code, small consolidations; no new features): every change is listed in
[`REFACTOR_LOG.md`](REFACTOR_LOG.md), with the pre-refactor source in `_baseline/original-2026-10-20.zip`.

## What's in here

| Path | What it is |
|---|---|
| `classes/LdrInboxController.cls` | Apex: queue, related activity, claim/release (row-locked), save, hand-off, log call |
| `classes/LdrInboxControllerTest.cls` | Zaid's v33 test class (uses the org's `TestDataUtility`) plus tests for the 9fed Apex (not yet run by Claude) |
| `lwc/ldrInbox/` | The inbox UI, ported from the LDRInbox artboard in the Sales Portal Concept canvas |
| `lwc/ldrInbox/prospects.js` | Prospects tab rules and scoring (hide rules, points, tiers), ported from the canvas |
| `lwc/ldrPostQuote/` | Post Quote reply page (every LDR): one 6sense post-quote reply, Project / Opportunity edits, Action taken, FJTR |
| `lwc/ldrSixSense/` | 6Sense tab (admins, v5): 6sense email replies on Leads, Mine / Unassigned boxes, list + page; `sixSenseModel.js` holds the list rules |
| `lwc/ldrTypeIcon/` | Customer type icon (Homeowner / Contractor / Architect / Business Owner) from the brand artboard |
| `lwc/ldrEstimate/` | Estimate tab: rough price range per frame / size (`estimatePrices.js`), frame images from `LDR_EstimateFrames` |
| `lwc/ldrLeadViews/`, `lwc/ldrListViewPanel/` | Lead Views tab (admins): live Lead list views (uiListsApi + datatable) and reports (Apex Reports API) |
| `staticresources/LDR_EstimateFrames.resource` | Frame type images (Aluminum, Aluminum Clad, Wood) for the Estimate tab |
| `lwc/ldrDashboard/` | Boss View dashboard + Speed, My Dashboard, 6Sense Dashboard (`mode` = team / my / six) |
| `lwc/ldrInbox/repRouting.js` | Rep display routing rules and reference data (aliases, split territories, SoCal zips) |
| `flexipages/LDR_Inbox.flexipage-meta.xml` | Full-width Lightning App Page holding the component |
| `permissionsets/LDR_Inbox_User.permissionset-meta.xml` | Zaid's v33 version (no app / tab entries) |
| `staticresources/NanaWallFonts.resource` | Source Sans 3 + Source Serif 4 (SIL OFL 1.1, Latin subset, woff2) and `fonts.css`, loaded by the inbox |
| `labels/CustomLabels.labels-meta.xml` | Custom Labels `LDR_Estimate_Date_Windows` (Custom estimates in the queue) and `LDR_Prospect_Since` (Prospects + Post Quote start date) |
| `pages/LDR_Profiler_Lead.page`, `pages/LDR_Profiler_Contact.page` | Eloqua Profiler pages sized for the inbox (fixes the cut-off) |

## Prerequisites (must be true before deploy)

1. **Fields exist on `Form_Submission__c`** (the code will not compile without them):
   - `Claimed_By__c` – **Lookup(User)**. The code uses `Claimed_By__r.Name`, so a text field will not work.
   - `Claimed_Date__c` – Date or Date/Time (the code handles either).
2. LDR users have read on `Form_Submission__c` (incl. both new fields, with **edit** on them),
   edit on Lead `Status`, `Lead_Funnel_Outcome__c`, `LDR_Project_Name__c`, `LDR_Notes__c`,
   `Project_Coordinator__c`, and create on Task. All DML (and the claim / lock reads) run in USER_MODE, so missing
   edit permissions show up as errors. Most other reads run in system mode (sharing still enforced: the class is
   `with sharing`) and pass through `Security.stripInaccessible`, so an unreadable field is blanked and listed in the
   yellow banner instead of failing the queue. (Corrected 2026-10-20; see `REFACTOR_LOG.md`.)
3. A sandbox (refreshed recently enough to have `Form_Submission__c`) and the Salesforce CLI (`sf`).
4. **Not in this package any more (Zaid's v33 file list):** the LDR Console app, the LDR Inbox tab and the
   `NanaWall_Uploads` CSP Trusted Site. They must already exist in the target org (they do in UATFullSB / production
   if earlier builds were deployed). Without the CSP entry, nanawall.com attachment thumbnails won't load.
5. `TestDataUtility` (used by the test class) must exist in the target org.

## Deploy to a sandbox

```bash
sf org login web --alias ldr-sandbox --instance-url https://test.salesforce.com
sf project deploy start --source-dir force-app --target-org ldr-sandbox --test-level RunSpecifiedTests --tests LdrInboxControllerTest
sf org assign permset --name LDR_Inbox_User --target-org ldr-sandbox --on-behalf-of <ldr.username>
```

Then App Launcher → **LDR Console**. (The permission set makes the app visible; no App Manager edits needed.)
Optional: Setup → App Manager → LDR Console → **Assign to user profiles** so it's in the LDRs' app list without the permission set.

## Behaviour

Version numbers (Aqil, 2026-11-04): after 9 the letter goes up (v6f9 → v6g), after h the number goes up (v6h9 → v7),
then a, a1, … (v7a, v7a1, …).

### v7 (Aqil, 2026-11-09)
- **Admins edit others' claims from All**: Aqil and Aziz (the inbox admins) can change the LDR Fields and use the status
  buttons on a submission another LDR has claimed, from the All tab. The claim stays with that LDR; Hand-off still
  needs the claimer. Apex saveLeadFields lets admins save any claim (was: unclaimed only).
- Mine: a submission with no Lead / Contact and "#Working" is listed under Working (was Other).
- Queue rows: the age / date stays at the top right when the name wraps.
- Tab bar: the search input and button are 32px, so with a 14px minimum font the box no longer pushes the tabs 2px
  down (their green line was below the bar's line).
- Open opportunities: line 1 the stage on the right, line 2 the name on the left; Record Type and Close removed (the
  other four in two columns).
- Detail padding 10 / 5 / 10 / 10; queue padding 5.

### v6g8 (Aqil, 2026-11-09): fewer hint lines
- Not-yet-linked banner: "No Lead or Contact linked to this submission yet. There may be a short delay between a
  submission and Salesforce creating or matching the record." The email-match line keeps only the match itself.
- Removed hint lines: Link to existing; Activity History; Windfall Unknown; Lead History geocoding; Eloqua profiler;
  "You can still claim it…"; FETR layout; attachment links; Related submissions; the Prospects list blurbs.
- "Required when Status is …" (and the Outcome *) only while the Outcome is blank and the status change isn't saved.
- The unclaimed Project Coordinator banner shows only when Lead Funnel Timestamp is within 30 days (was 7).

### v6g7 (Aqil, 2026-11-09): unlinked status buttons, shorter tags, spacing
- **No Lead / Contact yet**: Working, Unreachable and Disqualified work (Nurture / Qualified still need a record). The
  click writes "#Working" / "#Unreachable" / "#Disqualified" to the tag field (Form Submission Comments1__c, estimate
  Comments__c; replaces an earlier one) and claims it if it isn't yours. Unreachable / Disqualified take it off Mine:
  it shows in Finished and All for 14 days from the click, like other finished records. Working keeps it in Mine.
  Release removes the tag. New Apex: LdrInboxController.setUnlinkedStatus. Once a Lead / Contact is linked, its own
  status decides again.
- Tags: "Competitor" (was "Competitor search"); "Open opp" (was "Open opp · <rep>"; the rep is in the hover text);
  form Types "Virtual Consultation" / "Quote Request" show as Consultation / Quote.
- Open opportunities: the "Stays in your queue. A rep already has …" line is gone.
- Undetermined split: "Rep: Kris or Brad (Undetermined Res/Com Split)" (full names in the hover text).
- Spacing: queue 5px left, rows 4px padding; age tag never wraps; Questions or Comments 14px; cards 10 / 10 / 5 / 10;
  detail 7 / 4 / 4 / 10; header top row 30px (Not yet in CRM box 30px tall, no 6px around the buttons beside the
  name); nothing pulled up under the LDR Fields title.

### v6g6 (Aqil, 2026-11-05): popup size follow-ups
- **Draft Email**: at least 850px wide, half the window only when that's wider (was 70%, too wide on a big screen).
- **Project Details**: 645px tall (was 650). The fields' area is 565px and no longer stretches; it grows only when the
  fields need more, so they never run under the buttons. Cancel / Save straight under it with 5px below (was 12px
  above). Construction Classification | Timeline 4px under the address (was 6), the checkboxes 6px under that (was 8).

### v6g5 (Aqil, 2026-11-05): Draft Email and Project Details sizes
- **Draft Email**: at least 850px wide, 70% of the window when that's wider; at least 650px tall, at most 75% (the
  email box takes the height). Padding 6 / 6 / 4 / 10; title line 24px (no 2px above the title or Close, 4px under
  Close, 1px pulled up); copy actions 2px under the email box.
- **Project Details**: at least 550px wide, half the window when that's wider; 650px tall; padding 10 / 5 / 5 / 10;
  Cancel / Save stay at the bottom (the fields' area takes any spare height). Nothing under the title line, Project
  Type or Construction Classification | Timeline; 2px under Industry | Application; no gap under Search project
  address or between the address rows; the checkboxes 8px down, Cancel / Save 12px.
- On a window too small for a minimum width or height, the minimum gives way, so both still fit and keep Close /
  Cancel / Save in view (v6g1).
- Populate Project no longer shows its "Populated Project: …" summary; the filled-in fields stay highlighted and the
  address parts listed under the address.

### v6g4 (Aqil, 2026-11-05): Draft Email spacing
- Editor notes, the inbox's display only (the copied email keeps its own inline styles): popup padding 10 / 8 / 4 / 12;
  title line 28px with "Draft Email" at 18px; Close 2px from the top; no 3px above the grey lines, 2px under Questions
  or Comments; 3px under the email box; email box padding 5 / 4 / 1 / 9; no gap above the message; message box padding
  5 / 3 / 1 / 3, 5px in, 8 rows to start (was 4); detail rows without padding; copy actions 20px apart.
- The "Message · edit it before copying …" label is gone (Undo Edits still shows on the right after an edit).
- Submission Details leaves out a blank value, and its " · ".

### v6g3 (Aqil, 2026-11-05): Draft Email layout
- **Under the title** (Close on the right), in the note's grey small text:
  - **Submission Details:** form submissions: Type · Form · Location (the Lead / Contact's city, state, zip) · Project
    Zip · Project Name · Application; instant estimates: Type · Form · Estimate · Frame type · Opening Width · Opening
    Height. Values as What They Submitted shows them; blank ones are "—".
  - **Questions or Comments:** one line, ending in "…" when it's longer (the full text shows on hover).
- **Middle:** the email box on the left (scrolls when there isn't room) and the template buttons on the right (175px,
  one per line, 6px apart, 6px from the box): Request Information, Estimate Small / Large (instant estimates), Handoff.
- **Subject** can be edited; Copy Details & Open Mail App and Open Mail App with Plain Text use it. Reopening Draft
  Email starts again from the automatic subject.
- **Bottom:** the three copy actions (moved back from beside the title), then the note, now just "The copy starts
  with a few blank lines so you can write your message above the details." (with a template: "The copy starts with
  the message above.").

### v6g2 (Aqil, 2026-11-05): click outside a popup closes it
- **Every popup** (Draft Email, Quick Edit, Project Details, Log a Call, Create Lead, Link to existing / Advanced
  Search, Convert Lead, Attach to Opportunity, the claim / reassign confirm, Fixed submission links, Uncontacted, the
  activity preview): a click on the dark area around it does what its own Close / Cancel / × does. Unsaved edits are
  discarded as Cancel would; a confirm counts as No; Advanced Search closes on its own, leaving the Link window open;
  Convert Lead closes as its × does (checks whether the Lead already converted).
- Only when the press also started on the dark area, so selecting text in a field and letting go outside doesn't close
  it; nothing closes while something is saving.

### v6g1 (Aqil, 2026-11-04): popups fit the window
- **Every popup** is at most the window's height less 190px (and never taller than the overlay), so it stays inside
  the inbox's area, clear of Salesforce's header and utility bar. Draft Email was 88% of the window and on a short
  window ran past the top, hiding its title line and Close. If a popup still can't fit, the overlay scrolls from the
  popup's top instead of cutting it off.
- **Draft Email:** the title line (copy actions, Close), template buttons and the note under the box stay put; the
  white box (To / Bcc / Subject, message, details) scrolls.
- **Quick Edit, Project Details, Log a Call, Create Lead:** same size as before when they fit (widths unchanged, so no
  field wraps or gets narrower); on a short window they scroll, with their title line and Cancel / Save line kept in
  view.

### v6g (Aqil, 2026-11-04): claiming no longer switches to Mine
- **Claim:** the list stays on the tab you claimed from (Unclaimed, Prospects, …) with the claimed record still open
  and the claim message showing; its header shows "Current Tab: Mine · Go to Mine" to switch if wanted. (Canvas #148
  had moved the list to Mine after every claim.)

### v6f9 (Aqil, 2026-11-04): Mine › Other first
- **Mine:** the "Other" section (claimed submissions with no Lead or Contact yet, or a Status other than New / Working)
  is listed first when there is one, then New, then Working (was last).

### v6f8 (Aqil, 2026-11-04): editable FETR / FJTR, coordinator banner wording, no "PT"
- **FETR (Contact rows) and FJTR (Post Quote):** every value can be typed over before copying (FJTR: the subject too).
  Questions/Comments/Concerns, Home/Zip Code Value and Instant Estimator are boxes that grow with their text; the rest
  are one-line fields that read as the text until hovered or clicked. Copy FETR / Copy FJTR / Copy Subject use the
  edited values in both the HTML and the plain text. A linked value keeps its link with the edited text (an edited
  email becomes the mailto); an emptied one has no link, and ↗ opens a linked value. Edits are kept per submission /
  reply while the inbox is open, never saved to Salesforce; "Reset" (shown once something is edited) puts the Salesforce
  values back (FJTR: and their latest reply). Picking another FETR project replaces a typed-over Project Name / Split
  Territory.
- **Unclaimed with a Project Coordinator banner:** "This submission is unclaimed, but the Project Coordinator is
  **[Name]** from a previous submission. Claiming will take it over from them. If it's recent you can assign it to
  them instead (they aren't notified so let them know)."
- **What They Submitted › Submitted:** no " PT" after the time (still shown in Pacific time on any computer).

### v6f7 (Aqil, 2026-11-04): ZIP-range routing back, top bar and header fit at a 14px minimum font
- **Blank territory, owner of several splits:** the ZIP prefix picks the split again (one range per area: TX, KS / MO,
  CT, NY, SoCal), then the State, because the State isn't always filled in. Matrix check against v6f5: only the NorCal
  note (fixed in v6f6) differs.
- **Top bar:** with Chrome's 14px minimum font the right side (Signed in as / View as / version / Updated / ↻) wrapped
  below the logo at 1045-1065px. 8px sides (were 24), 16px between top tabs (were 22), 8px pill sides (were 10): one
  line down to a 1045px inbox for your own view and View as an LDR. Boss View (five top tabs) still wraps below ~1195px.
- **Record header, three rows of buttons:**
  - The name box could shrink (the name wrapped onto two lines), and the button split measured that squeezed width, so
    too many buttons stayed beside the name and wrapped there. The name now keeps its width (ends in "…" only if longer
    than the whole row), and the split is re-measured when the name or the top buttons change size.
  - Buttons beside line 1 are at most half the row (was 200px). One to three buttons are under 200px anyway; four (a
    record claimed by someone else at 1045px) now stay on one row, with line 1 wrapping beside them.
  - Editor values: "Claimed by …" padding 3px / 2px, header buttons 4px sides (also 6Sense / Post Quote), buttons
    beside the name 6px above and below, buttons beside line 1 1px between rows, -5px above, 0 below; line 1 margin
    0 / 1px, line 2 margin 2px / -4px, no top padding on either.
- **LDR Fields:** at least 320px wide in the two-column layout, so "Lead Funnel Timestamp" stays on one line (needs
  318px at 14px; the label is also set not to wrap). What They Submitted is ~20-30px narrower at 1045-1170px; its first
  column (Submitted date) is a little wider so the date keeps to one line, and a longer label in the other columns
  (e.g. "Lunch & Learn Request") can wrap there.
- **"From another submission"** (was "Set from a different submission, not this one") under both Project Coordinator
  and Lead Funnel Timestamp, full width.

### v6f6 (Aqil, 2026-11-04): rep routing tidy-up, header buttons beside line 1
- **Blank territory, owner of several splits:** the State alone picks the split (the ZIP-prefix rules, including v6f5's
  SoCal one, are gone). Production: the inbox had ~1 such record in the past year without a State; it now shows the
  owner with "Confirm if split" instead of a ZIP guess.
- **NorCal note:** Brad Burden's records now show "(NorCal Residential)" / "(NorCal Commercial)" / "(Undetermined NorCal
  Res/Com Split)" after the rep (v6f5 worded the rule so the note never showed).
- **Removed what Salesforce already has right:** the 38-name canonical spelling list (every rep's User name already
  matches; it only re-curled April's apostrophe, and April now always shows as Shawn), and "Drew Scott" from the SoCal
  owners (no such User; his User is Andrew Scott). Preferred Marketing → Jeff Calabrese and Andrew Scott → Drew Scott
  moved into the split-owner alias table with April → Shawn. The SoCal pick works out both reps once.
- Checked against v6f5 over 4,860 combinations of owner / territory / state / ZIP / project type: only the two changes
  above differ.
- **Header:** line 1 has no width cap; buttons moved beside it are at most 200px wide, right-aligned, wrapping inside
  that.
- **Not done (needs a decision):** Territory Master already stores a Residential Owner and Commercial Owner per ZIP for
  the split areas, matching the hard-coded SoCal ZIP lists and split reps. See the v6f6 report for the option of reading
  them from Salesforce instead.

### v6f5 (Aqil, 2026-11-04): rep routing (repRouting.js)
- **KS / MO and TX splits:** residential is Shawn Mahoney (was April Lele’a); commercial unchanged (Nathan Homann /
  Harmen Bollen). Shawn Mahoney is also a split owner there, so the splits keep routing once Territory Master moves
  April's territories to him.
- **April Lele’a shows as Shawn Mahoney** wherever the split rules fall back to the owner (a territory that isn't a split,
  or a blank territory the location can't settle). April was residential only, so commercial one-offs don't matter.
- **NorCal (owner only):** Brad Burden's records go to Kris Trevino for residential and Brad Burden for commercial,
  whatever Territory__c says (checked before the territory step). Kris Trevino added to the canonical names.
- **Blank territory, owner + location:** Southern California ZIPs (900-935) or state CA now pick the SoCal split. Shawn
  Mahoney is an owner of three splits now (SoCal, KS / MO, TX), and without this his blank-territory California records
  would have shown "Shawn Mahoney" instead of the SoCal routing. His blank-territory records outside CA / KS / MO / TX
  now show Shawn Mahoney, flagged "Set the Territory" (were SoCal routing by default).
- George Scaggs (not a split owner) is unaffected, including on OK-TX Area records.
- Rules written and tested with node by another session (Aqil's rep changes); the SoCal location rule and the
  before/after check above were added here.

### v6f4 (Aqil, 2026-11-04): tighter tab bar, search box evenly spaced
- Tab bar sides 8px (were 24), 6px between the tab groups and the search box and between tabs (were 22).
- The search box (150-320px) sits in the middle of the space between the two tab groups, so it's always the same
  distance from Prospects and from Finished. Centred on the page doesn't fit at these widths (the left group reaches
  past the middle).
- Preview: every tab fits at 1045 / 1064 / 1065px for admins and LDRs, both fonts; the search box stays 320px with
  28-44px each side for admins (73-88px for LDRs).

### v6f3 (Aqil, 2026-11-04): All tab cut off on narrower inboxes
- Found by the preview session. Since v4 the tab bar is a grid whose side columns (the tab groups) can't shrink below
  their content, with the Salesforce search box a fixed 320px in the middle. Below ~1140px (admins, with the 6Sense tab)
  the right group ran past the inbox and was clipped: All partly or fully hidden, and on Post Quote also its filter and
  Finished. v5.x hid it with its 0.9 zoom, so the sandbox (v5.6p2) shows All; v6 without the zoom would not have.
- The search box now gives way first, from 320px down to 150px. The Post Quote filter moved from the tab bar to the top
  of the Post Quote list (like the other tabs' filters); in the tab bar it added ~180px that the search box couldn't
  make up.
- Preview: every tab, as an admin and as an LDR, at 1045 / 1064 / 1065px, with Chrome's 14px font (minimum 14) and the
  16px default: nothing past the inbox's edge; All ends at the bar's 24px margin; the search box is 220-251px for
  admins and 320px for LDRs.

### v6f2 (Aqil, 2026-11-04): header buttons right-aligned again
- v6f1 dropped the `.ldr-d-actions-top` rule by mistake (a scripted edit kept only its comment), so the header's top-row
  buttons sat right after the name instead of at the right end. Restored: the group is as wide as its buttons and
  pushed right (`margin-left: auto`).

### v6f1 (Aqil, 2026-11-04): editor-mode spacing pass
- **List filters:** Coordinator on its own line (Unclaimed / All), then Lead or Contact · Type, then Form · Status ·
  Date. List padding 7 / 2 / 7 / 7, cards 5 / 3 / 3 / 4 and 6px apart, group headers 10px apart, age pills 1px top /
  bottom.
- **Top bar 50px, tab bar 40px.** Two fixes so they look right in those heights: the Salesforce search box's 8px bottom
  padding made its row 4px taller than the tab bar (tabs sat below the bar's line), now 4px; and at a 1045px inbox the
  top bar's two halves didn't fit one line, so logo → tabs is 24px (was 34) and the right-side items 6px apart (was 10),
  with no max-height (a longer name wraps instead of spilling over the tabs).
- **Record page:** padding 7, columns and cards 7px apart, cards padding 7, titles / grey notes / comments / links /
  activity rows 6px. Header buttons and the "Claimed by …" label 30px high, 6px apart and from the name; the button group
  is only as wide as its buttons. Alerts padding 5 / 25 / 5 / 7, 5px apart (the "No Lead linked" note asked 7 / 6px, the
  two later notes 5px; 5px is used for all).
- **Texts:** "No activity from you in the N days since claiming. Check Outreach sequence (if not enrolled add today)."
  and "You claimed this but Status is still New. Claiming sets ownership, but Status needs to be updated below."
- **LDR Fields:** title line gap 6, field pairs 6, Project Details / Convert-Hand-off / Attach to Opportunity 30px with
  5px sides, Cancel / Save 25.5px with 14px sides, 4px above the hand-off line. A Contact's Attach to Opportunity +
  Cancel + Save no longer fits one line at 1045-1065px, so Cancel / Save wrap below it (Leads stay on one line).
- **Popups** (Project Details, Quick Edit, Log Call, Draft Email): padding 10. Project Details: every field 4px in
  from both edges (as the address's Search and Country already were), two-field rows with the same 8px middle gap as
  City | State (the Classification | Timeline row's 7px gap would have left it out of line), checkboxes and the "Project
  Site Address" heading lined up with the rest, labels tight to their fields, 4px between fields.
- **Inside Salesforce's components** (field labels, the address's rows): `ldrInbox.css` can't reach in there, so these
  rules are in a new static resource, `LDR_InboxBaseStyles` (text/css), loaded with `loadStyle` like the fonts and scoped
  to `.ldr-shell`. They work while Lightning renders base components with synthetic shadow DOM (as now); Salesforce
  doesn't support styling inside its components, so if it changes their markup or moves to native shadow DOM these
  rules stop matching and the fields go back to Salesforce's spacing. Check them in the sandbox.
- 6Sense and Post Quote got the same values (list, cards, page, panels, header buttons, alerts).

### v6f (Aqil, 2026-11-03)
- Line 1 sits at the bottom of its row, level with the bottom of any buttons moved beside it (was the top).
- The status-button line is 6px above What They Submitted / LDR Fields (was its own 16px bottom margin). Same on 6Sense
  and Post Quote.

### v6e (Aqil, 2026-11-03): header buttons split beside the name and beside line 1
- v6d kept every button in the right half, so the space between a short name and the buttons went unused and four
  buttons dropped to a second row. A box of buttons can't be wide on its first row and narrow on its second, so CSS alone
  can't put just the overflow beside line 1.
- Now the buttons come from one list (`headerButtons`) and the inbox measures how many fit beside the name
  (`measureHeader`, on every render and when the header resizes, via ResizeObserver). Those sit on the top row,
  right-aligned; the rest go to the right end of line 1's row, and line 1 is then at most 70% wide (full width when
  nothing is beside it). Line 2 stays full width with Current Tab · Go to <Tab> on its right.
- Preview, 14px and 16px: at a 1045-1065px inbox only Draft Email moves down for your own Lead or Contact, Call / Log
  Call / Draft Email for one claimed by someone else (its badge is longer); line 1 stays on one line; header 113px (v6d
  128px). With room for all of them, one row and a 101px header.
- Post Quote and 6Sense (3-4 buttons) went back to v6b's row: buttons beside the name, wrapping there; Current Tab
  stays on line 2.

### v6d (Aqil, 2026-11-03): shorter header buttons, header in two halves
- **Labels:** "Open Lead ↗" / "Open Contact ↗" → "Lead ↗" / "Contact ↗"; "Open Form Submission ↗" / "Open Instant
  Estimate ↗" / "Open 3D Configurator Quote ↗" → "Form Submission ↗" / "Instant Estimate ↗" / "3D Configurator ↗";
  "Log a Call" → "Log Call". Post Quote: "Contact ↗", "Opportunity ↗"; 6Sense: "Lead ↗".
- **Layout** (replaces v6b's): a two-column grid. Left half: icon + name, then line 1 (Inquiry Type · claimed / submitted ·
  email · phone), at most 50% wide. Right half: the buttons, right-aligned over both of those rows, so a second row of
  buttons sits beside line 1. Then line 2 (customer type · account · location · Rep) full width, with **Current Tab**
  (moved from line 1) and "· Go to <Tab>" (when the list is on another tab) on its right. Only a third row of buttons
  pushes line 2 down. Same on Post Quote and 6Sense.
- **Measured in the preview (16px):** at a 1045-1065px inbox the buttons take two rows and line 1 wraps to two lines in
  its half (email · phone on the second); header 128px. At 1186px line 1 fits on one line; header 110px. Line 2 stays
  on one line in all of them.

### v6c (Aqil, 2026-11-03): tighter record page
- Record page padding right 3px, left 6px (were 9 / 9); list column sides 4px / 4px (were 1 / 5).
- What They Submitted and LDR Fields columns 6px apart (was 18), and the cards in each column 6px apart (was 14).
- Same values on the 6Sense and Post Quote pages.
- The LDR Fields card is now 293-301px at a 1045-1065px inbox, so a Contact's Attach to Opportunity + Cancel + Save
  also fits on one line (v6 wrapped Cancel / Save below about 1065px). Checked in the preview at 14px and 16px.

### v6b (Aqil, 2026-11-03): header on narrower inboxes
- The record header's buttons floated right and the name and info lines flowed around them, so when the buttons needed
  two rows (a 1065px inbox at 16px) the name split over two lines and lines 1-2 squeezed in beside the buttons.
- Now the header is a wrapping row: icon + name at full width (a name splits only if it's wider than the whole page),
  the buttons in the rest of that line, right-aligned, wrapping into rows there (or onto their own line under the name
  when less than 45% of the width is left), then the info lines at full width underneath. Same on the 6Sense and Post
  Quote pages. Checked in the preview at 1045 / 1060 / 1065 / 1186px, 14px and 16px.

### v6 (Aqil, 2026-11-03): no built-in zoom, two columns at 1045px, compact layout
- **Zoom removed:** no `zoom: 0.9` on the shell (#162). The inbox is at the browser's own zoom again, and the shell height
  and popup max-heights are plain `vh` (no `/ 0.9`).
- **Two columns down to a 1045px inbox:** the breakpoint that puts the record detail in one column is now
  `max-width: 1080px` (was 1100px; it also sets What They Submitted's facts and the tracking grid to 2 columns). Checked
  in the preview at 1045, 1060 and 1065px inboxes, 14px and 16px fonts: two columns, nothing wider than the LDR Fields
  card, Project Coordinator / Lead Funnel Timestamp / Status / Outcome 127-131px wide.
- **Compact layout** (Aqil's editor-mode values on Unclaimed, applied everywhere the same classes are used; the 6Sense
  and Post Quote pages got the same values in their own stylesheets):
  - List column 250px (was 340), padding 10 / 1 / 14 / 5; cards padding 5 / 4 / 4 / 7, 5px apart; age and tag pills 4-5px
    sides; filters and sort button tighter (Date sort button 26px high).
  - Record page padding 10 / 9 / 8 / 9; header buttons 5px sides, 5px apart, at most 80% wide; title row gaps 6 / 5px;
    status buttons 5px sides; cards padding 10px; LDR Fields, facts, tracking and links gaps 4-6px.
  - "No Lead or Contact is linked" banner padding 10 / 25 / 6 / 10 (its × moved 4px right so it can't overlap the
    text); its buttons 5px sides.
- **Hand-off line:** at 1045-1060px Convert/Hand-off + Cancel + Save ran 6px past the LDR Fields card. The hand-off
  button now has 10px sides (was 14), Cancel / Save 8px (was 14), 6px apart. A Lead's line fits on one row at 1045; a
  Contact's (Attach to Opportunity is longer) puts Cancel / Save on a second line, on the right, below about 1065px, as
  does "Unsaved changes" showing.

### v5.7b (Aqil, 2026-11-02): Populate Project address highlight
- The inputs inside the Project Site address box can't be highlighted one by one: it's Salesforce's address
  component, and its inside can't be styled from the inbox (same reason the Zip box couldn't be widened). v5.7
  highlighted the whole box, which also marked Search project address, and typing in any part cleared all of it.
- Now the box isn't highlighted. A line under it, "Filled in by Populate Project: City · State · Zip · Country", lists
  the parts it filled in, in the same yellow, and only the part that's changed drops off. The other Project Details
  fields keep their own highlight, cleared one by one.
- A change event without the address (or field value) is ignored instead of blanking the address in the draft.

### v5.7 (Aqil, 2026-11-02)
- **Contact type:** on Contact rows, the type flag (list, header) and the FETR's Type come from the Contact's Lead Type
  (`LeadType__c`), not the form. The form's Customer Type is the fallback when the Contact has none (about 1 in 10
  production Contacts from the last year). What They Submitted still shows the form's Customer Type. When the two
  differ, "Check before hand-off" says so, as it already did for a Lead's Type.
- **FETR comments:** after Questions/Comments/Concerns, a blank line, then `Project Timeline:`, `Product Type:` and
  `Application:` from the form. A blank field gets no line; Application gets a space after each comma.
- **Populate Project highlight:** the fields it fills in get the Lead page's changed-field yellow, like a browser's
  autofill. A field's highlight goes when its value changes. The address is one box, so changing any part of it clears
  the whole address highlight. Save, Cancel or opening another submission clears them all.
- **Attach to Opportunity (Contacts):** on the Hand-off line, sized to its text, in place of Hand-off (was a full-width
  button below). Click: Lead Funnel Status = Qualified, Outcome = Hand-off to Rep (as Hand-off did), Lead Funnel
  Timestamp = today (Pacific), then the Attach to Opportunity flow opens. The status is set even if the flow is closed
  without finishing. Like Hand-off, it waits for unsaved LDR field changes to be saved or cancelled.
- **"Some fields are hidden…"** shows only for the inbox admins (Aqil, Aziz). Its text now says the LDR profile needs
  read access (the permission set no longer grants fields since v5.6p).
- **× on every alert:** the detail alerts close on every tab (were Mine only), including "This contact was converted
  after their form submission" and the junk banner. The page banners (Boss View, Viewing as, no email after 24 hours,
  one-time move, admin errors, hidden fields, load error) close until the page is reloaded or the message changes. Post
  Quote's and 6Sense's alerts close for that person while the page is open.

### v5.6p2 (Aqil, 2026-11-02): remove the old permissions on deploy
- A deploy leaves permission set entries the file doesn't list, so orgs with an older LDR Inbox User kept its object,
  field, flow and page access after v5.6p.
- The file now lists every entry any earlier version granted, set to false, so deploying removes them:
  - 75 field permissions
  - 5 objects: Form Submission, KBMax Web Quote Junction, Opportunity, Account, KBMax Web Quote
  - the Convert_Lead flow
  - the org's Profiler_Lead / Profiler_Contact pages
- It still grants only LdrInboxController and the LDR_Profiler_Lead / LDR_Profiler_Contact pages.
- After deploying, check Setup → Permission Sets → LDR Inbox User lists only those three.
- One-time: once every org that had an older LDR Inbox User (sandbox, production if it had one) has deployed this, a
  later version can drop the false entries. A sandbox refreshed from a production that still had them needs it too.

### v5.6p1 (Aqil, 2026-11-02): deploy fix for v5.6p
- Aziz's v5.6p sandbox deploy still failed with "Permission Read KBMax_Web_Quote_Junction__c depends on
  permission(s): Read Opportunity", though the file no longer mentioned the junction.
- Cause: deploying a permission set only changes the entries the file lists. The sandbox's LDR Inbox User kept its
  junction Read/Create, and Salesforce still checked it against Opportunity Read.
- Fix: the permission set now lists KBMax_Web_Quote_Junction__c with every permission off, which removes it. The LDR
  profile grants junction access instead (see v5.6p).
- If the same error comes back, remove KBMax Web Quote Junction from LDR Inbox User by hand (Setup → Permission Sets →
  LDR Inbox User → Object Settings), then deploy again.

### v5.6p (Aqil, 2026-11-02): permissions from the LDR profile
- **LDR Inbox User now grants only what this repo deploys**, which no profile can already have:
  - Apex class `LdrInboxController`
  - Visualforce pages `LDR_Profiler_Lead` and `LDR_Profiler_Contact`
- Everything else was removed and now comes from the LDRs' Salesforce profiles:
  - Object access: Form Submission, KBMax Web Quote Junction, Opportunity, Account, KBMax Web Quote.
  - About 70 field permissions.
  - The Convert_Lead flow and the org's own Profiler_Lead / Profiler_Contact pages.
- **What the inbox expects the LDR profile to grant** (else that feature fails when used, not at deploy):
  - Form_Submission__c: Read + Edit, with field access to Claimed_By__c, ClaimedDate__c, Claimed_Date__c,
    Comments1__c and Questions_or_Comments__c (Edit) and the other form fields it shows (Read).
  - Website_Instant_Estimate__c: Read + Edit on its claim fields (never in the permission set).
  - Lead: Edit on Status, Project_Coordinator__c, Lead_Funnel_Time_Stamp__c, Lead_Funnel_Outcome__c, the Project
    Details fields (Project Name, Type, Industry, Application, Project Site street/city/state/zip/country,
    Construction Classification, Timeline, Quote Requested, Reference Opportunity); Read on the Windfall, Matched
    Account, Outreach and UTM fields it shows.
  - Contact: Edit on Lead_Funnel_Status__c, Lead_Funnel_Outcome__c, Lead_Funnel_Time_Stamp__c,
    Project_Coordinator__c.
  - KBMax_Web_Quote_Junction__c: Read + Create (the KBMax checkboxes), which needs Read on Opportunity, Account and
    KBMax_Web_Quote__c in the same profile.
  - Run access to the Convert_Lead and Contact_New_Opportunity flows.
- Unchanged and not permissions: the version label, "Signed in as", and Boss View's two hard-coded admins are in the
  inbox code.

### v5.6d (Aqil, 2026-11-02): deploy fix
- Aziz's sandbox deploy failed: "Permission Read KBMax_Web_Quote_Junction__c depends on permission(s): Read
  Opportunity". A permission set that grants Read on a master-detail child must also grant Read on its masters.
- LDR Inbox User now also has **Read only** on the junction's masters, Opportunity and KBMax_Web_Quote__c, and on
  Account (Salesforce requires Account Read for Opportunity Read). Sharing still decides which records an LDR sees.
  LDRs already read these objects in the inbox through their profiles, so nothing new becomes visible.

### v5.6c (Aqil, 2026-11-02)
- **Draft Email:** the template buttons (Request Information, Handoff, …) are right-aligned on their line.
- **Quick Edit:** Email and Last Name switched places.
  - Leads: First Name | Last Name | Type | Company, then Email | Phone | Matched Account Type | Reporting Matched
    Account.
  - Contacts: First Name | Last Name | Lead Type, then Email | Phone.
- **Project Details:** Project Construction Classification | Project Timeline moved from under Industry / Application to
  under the Project Site address (Zip). Quote Requested | Reference Opportunity stay below them.

### v5.6b (Aqil, 2026-11-02)
- **Quick Edit fields, two lines:**
  - Leads: First Name | Email | Type | Company, then Last Name | Phone | Matched Account Type
    (`Matched_Account_Type__c`) | Reporting Matched Account (`LeanData__Reporting_Matched_Account__c`).
  - Contacts have no Company or Matched Account fields: First Name | Email | Lead Type (`LeadType__c`), then Last
    Name | Phone.
  - Saved through Lightning Data Service, so the LDR's own field access decides what's editable. The LDR Inbox User
    permission set gives Read only on Lead Type__c and Reporting Matched Account.
- **LDR Fields:** Convert/Hand-off on the left and Quick Edit's Cancel / Save on the right of the same line, with
  "Unsaved changes" to their left. An admin editing without claiming gets Cancel / Save only.
- **"Check before hand-off" is an alert now.** It was at the top of the left column, which pushed What They Submitted
  below LDR Fields. It now sits in the alert group above the status-button line, full width at the boxes' margins, so
  What They Submitted and LDR Fields always start level.
  - × closes it on every tab. It comes back when the LDR switches submission or tab.
- **Alerts above the status buttons everywhere:**
  - Inbox: every alert is in the group above the status line; this one was the only alert inside a column.
  - 6Sense: the two alerts sat under the status buttons. The status-button line (with Project Coordinator) now comes
    after them, right above the boxes.
  - Post Quote: alerts were already above the Action taken line. Its save message ("Marked Updated: …") was below it
    and pushed the boxes down; it's in the alert group now.

### v5.6 (Aqil, 2026-11-02)
- **Project Details is a popup.** The section under Status became a **Project Details** button (Populate Project's
  size and colour) on the right of the LDR Fields title line, Leads only. It opens a centred popup like Quick Edit.
  - The popup holds every Project Details field, with Populate Project on its title line. Populate Project's summary
    shows in the popup.
  - Quick Edit's Cancel / Save sit bottom right. Cancel drops only the Project Details edits; status, outcome and
    coordinator edits stay. Save is the LDR Fields Save (everything unsaved) and closes the popup; an error keeps it
    open with the edits.
  - The popup is hidden with CSS, not `lwc:if`, so its form keeps the saved values loaded.
- **New fields in the popup** (Lead fields, saved with Save):
  - Under Project Application Industry / Project Application: Project Construction Classification
    (`Project_Construction_Classification__c`) | Project Timeline (`Project_Timeline__c`).
  - Under the Project Site address: Quote Requested (`Quote_Request__c`) | Reference Opportunity
    (`Reference_Opportunity__c`). Both are checkboxes, drawn as `lightning-input` checkboxes so the box sits left of
    the name.
  - Apex `PRE_CONVERSION_FIELDS` allows the four. `typedValue` saves a checkbox as true/false (blank = unchecked).
  - LDR Inbox User permission set: Edit on the four.
- **Convert/Hand-off moved** from the LDR Fields title line to its own line under Status / Lead Funnel Outcome, for
  Leads and Contacts.
- **LDR Fields Save / Cancel** are Quick Edit's buttons, bottom right, with "Unsaved changes" to their left.
- **Draft Email popup is wider** (900px, was 800px). Popups keep the scrollbar's room reserved
  (`scrollbar-gutter: stable`), so picking a template no longer pushes "Open Mail App with Plain Text Instead" to a
  second line.
- **Not built: a wider Project Site Zip.** The Zip box is drawn inside `lightning-input-address`, whose layout can't be
  styled from outside (see Known risks).

### v5.5g (Aqil, 2026-10-30)
- **KBMax quotes on the new Opportunity:** the Files step of both windows lists the person's KBMax web quotes from the
  last year. That means quotes on the Lead, on the Contact, or on a Lead converted into the Contact (`getKbmaxQuotes`).
  The section shows only when there are some.
  - Each quote has a checkbox on its left. Checking one adds a `KBMax_Web_Quote_Junction__c` (Opportunity__c +
    KBMax_Web_Quote__c, as the Contact page's flow does) right away, through `linkKbmaxQuotes` in user mode.
  - An added quote shows "Added" and stays checked. It's never added twice; removing one is done in Salesforce.
  - Component: `c-ldr-kbmax-link`.
- **Attach to Opportunity has a Files step** after the flow, like Convert's: form files with Download + previews,
  Upload Files, KBMax quotes, Done.
  - The flow returns no Opportunity Id, so the step uses the Contact's newest open Opportunity made in the last 30
    minutes. With none, the window closes as before.
  - The form files moved there from above the flow.
- **The flow's `Selected_KBMax_Rows` input isn't sent any more.** Production junctions show the flow joins every quote
  it's given, so sending all of the Contact's quotes would have linked them all. The checkboxes decide now.
- **LDR Inbox User permission set:** Read + Create on `KBMax_Web_Quote_Junction__c`.

### v5.5f (Aqil, 2026-10-30)
- **Project Coordinator dropdown:** a blank option at the end clears the field. The values are User Ids, so Save writes
  the `Project_Coordinator__c` lookup exactly as the record page does.
- **Form files, no automatic attach** (Aqil: no Remote Site / Apex download). The new `c-ldr-form-files` component
  shows each file with **Download** on its left and previews under the list (image thumbnail; PDF / other tile; click
  opens). It's used in:
  - the Convert window's Files step (replacing the v5.5d markup);
  - the **Attach to Opportunity** window, above the flow, with the Contact's form files.
- **KBMax quotes:** Attach to Opportunity passes the Contact's quotes to the flow's `Selected_KBMax_Rows` input (since
  v3). Convert_Lead has no such input, so the inbox can't pass them there. In production, none of the 1,688 quotes on
  converted Leads is linked to an Opportunity (`KBMax_Web_Quote_Junction__c`).

### v5.5e (Aqil, 2026-10-30)
- **Project Coordinator in LDR Fields is a dropdown, not a User search.** The search also listed people who aren't
  coordinators. The dropdown shows the person editing first, then the rest A–Z:
  - the people in `LdrInboxController.COORDINATOR_NAMES`: Aqil Bassa, Jahmanz Williams, Marco Estebez, Samantha
    Sanchez, WeiWei Huang, Jabir Nana, Yasmin Hernandez and Aziz Nana (active users only);
  - whoever is on the record now, if they aren't on that list.

  `getQueue` returns these as `coordinators` (User Id → name). v5.5f added a blank option.

### v5.5d: canvas 1793402177-b610 (Aqil's notes #160–#163, 2026-10-30)
- **Record page order (#161):**
  - header lines 1–2;
  - then every alert banner, in a group that renders only when one is showing;
  - then the status-button line on its own, with In Outreach on the left and the status buttons + Junk ▾ on the right;
  - then the boxes.

  Post Quote does the same: lines 1–2, then the no-coordinator / ✓ Marked banners, then the Action taken line.
- **LDR Fields (#160, #161):**
  - The title reads "LDR Fields" at 14px. **Convert/Hand-off** sits on the right of the title line, sized to its text
    (14px, 36px tall). It reads "Hand-off" when there's no Lead. It shows only for the claimer and is disabled while
    there are unsaved changes.
  - The bottom Hand-off row and the "Didn't open?" link are gone.
  - **Populate Project** is Release green, the same size. The Project Details title is 14px #292929, with tighter
    spacing.
- **Project Name** is a one-line box (`lightning-input`). The field is a Text Area, which `lightning-input-field`
  drew as a multi-line box. It's kept in the draft and saved with Save, as before.
- **Draft Email subject (#160):** `NanaWall | ` + the submission's own project name. That's a form's `Project_Name__c`
  or a 3D configurator quote's Project Name (new `ConfigPerson.latestProjectName`). Instant estimates have none.
  Otherwise it uses the inquiry type. It no longer uses the LDR's Project Name.
- **Create Lead is a popup (#160):**
  - First | Last Name, then Email | Phone, then Lead Status | Customer Type | Company.
  - Then the address with Address Search, the same `lightning-input-address` lookup Quick Edit uses.
  - × at the top right; Cancel / Create Lead at the bottom right.
- **Link to Existing (#160):** the two record pickers are replaced by the inbox's own search,
  `LdrInboxController.searchLinkRecords`. It's SOSL in user mode, then only records whose name, email, company /
  account or zip contains the text, or whose phone contains its digits (4+). Leads are unconverted only.
  - The dropdown shows up to 5 results; each has ▸ for its details, and clicking the name picks it.
  - **Show More Results for "…"** opens **Advanced Search**: up to 50 rows, each with Select.
  - Only the middle of the popup scrolls, and each list caps at 300px.
  - The Contact search starts with the submission's email.
- **FETR (#160):** Contact, Email and Phone come from the Contact record (`Contact__r.Phone` was added to the query),
  falling back to the submission. Type stays the Contact's Lead Type: production Contacts have no record types (all
  "Master").
- **Convert window Files step (#161):** each form file has a **Download** button on its left, and previews sit under
  the list (image thumbnails; PDF / other tiles). Clicking a preview opens the file.
- **Zoom (#162):** `.ldr-shell { zoom: 0.9 }`, so the inbox at 100% browser zoom looks like Salesforce at 90%. Every
  `vh` height inside it is divided by 0.9 (the shell height and the popups' max-heights). Removed in v6.
- **Sequence Status (#163):** the Mine / All button bar is now a dropdown on its own row above Record / Type / Form,
  with counts. The filtering is the same.

### v5.5: canvas 1793316028-ca79 (Aqil's notes #156–#159, 2026-10-29)
- **Claim time = `ClaimedDate__c` (#156, Date/Time on Form_Submission__c, Website_Instant_Estimate__c and
  KBMax_Web_Quote__c).** Written on claim (incl. the sibling submissions), claim from a teammate, assign to the
  coordinator, reassign and junk; cleared on release and junk Restore. `Claimed_Date__c` (Date) is no longer written or
  read, except by the one-time move.
  - Mine, Finished and All: card date and Date sort by claim time (rows without one: submitted time); a person's
    grouped cards put the most recently claimed on top. Replaces #132's Last Modified.
  - Header line 1 of a claimed record: "Claimed Oct 25, 2026, 2:56 PM" (Pacific); unclaimed: "Submitted …".
  - Claim Audit, the uncontacted alert and the take-over reminder use it directly; the Project Coordinator history
    lookup and the 8:00 AM fallback are gone. Backfilled claims (midnight Pacific) show as "date only" in Claim Audit.
    The dashboards' claim-speed days use it too. A backfilled claim (exactly midnight Pacific) shows its date only
    ("Claimed Oct 20, 2026"), in the header, the junk banner and the uncontacted list.
  - Until the one-time move has run, a claim with no `ClaimedDate__c` uses its old Claimed Date (midnight Pacific) to
    find what the claim replaced, so Release and Reassign still restore the previous coordinator.
- **Automation tags in the new Comments fields (#156):** `Form_Submission__c.Comments1__c`, `Comments__c` on instant
  estimates and 3D configurator quotes (Text Area 255). #LinkFixed…, #FixReviewed, #Junk:<reason> and #NoContactNeeded
  (was the end of Questions or Comments) go there, added after a space, never twice; a tag that wouldn't fit in 255
  characters is refused with a message (the link fix just skips its tag), and the text already there is never cut.
  Reads check the new field and the old place, so records not moved yet still work (junk Restore too).
- **One-time move, built in (#156, per Aqil):** Apex `moveLegacyFields()` (admins only, user mode). Admins see a notice
  "One-time move: …" with **Move Now** only while something is left: loaded rows with tags in the old field, or any
  claimed record with `Claimed_Date__c` but no `ClaimedDate__c`. Move Now (1) copies the old tags to the new Comments
  field and removes them from the old one (form `Comments__c` held only tags; `#NoContactNeeded` at the end of a form's
  Questions or Comments; the end of an estimate's Questions or Comments, the customer's text stays), and (2) sets
  `ClaimedDate__c` to the old date at 00:00 Pacific on claimed records, like the 2026-10-29 backfill (released ones
  keep their old date and are left alone). It reads forms / estimates touched since Sep 2026 (~1,900 today) 200 at a
  time and saves each record on its own; running it again does nothing. The notice stays only if a record couldn't be
  moved (no room in its 255-character Comments field, or a failed save: the toast says how many).
- **Headers (#157 / #158 / #159; record pages, Post Quote, 6Sense):** buttons top right; icon + name in one 44px row;
  the info lines start under the icon. Right side: line 1 Current Tab, line 2 "Go to <Tab>", line 3 the buttons
  (record pages: status buttons + Junk ▾, with "In Outreach" on the left; Post Quote: Action taken; 6Sense: status
  buttons). Lines 2–3 use line 1's style (12.5px #707070). Post Quote: tag moves (Post Quote → line 1, customer type →
  line 2, Residential / Commercial → line 3), General Application bold + Specific Application as text, General
  Application removed from Project Details, "Label: value" rows for Project / Opportunity Name and Last Modified By.
- **Permission set:** edit on `Form_Submission__c.ClaimedDate__c` and `Comments1__c`.
- **6Sense (from the v5 review):** the replies are read without their email bodies first; bodies are read only for
  the replies that pass the Lead Funnel Time Stamp rule, 200 at a time, and only the reply part is kept (heap: 2,000
  long emails could pass Apex's 6 MB).
- **Claim Audit text** updated: claim time = the Claimed Date (date and time); "exact = No" = claimed before Oct 29.
- **Text boxes fixed (v5.5b, found in the LWC preview):** a native `<textarea value={…}>` isn't filled by LWC (compiler
  warning LWC1057). The Draft Email message box stayed empty when a template was picked, and Post Quote's FJTR
  "Questions/Comments/Concerns" box opened empty instead of with the reply (since v3). Both now carry their text in
  `data-text` and a `renderedCallback` fills the box when it differs (typing doesn't move the caret).
- **Version label:** v5.5.
- **Tests:** `tagsFitTheCommentsField`, `restoreJunkFromTheOldField`, `moveLegacyFieldsOnce`,
  `moveLegacyFieldsOtherPaths`, `moveLegacyFieldsIsAdminOnly`, `claimTimesUseClaimedDate`; claim / release check
  `ClaimedDate__c`; the junk, link-fix, claim-audit and uncontacted tests
  updated for the new fields. Not run in an org.

### v5: canvas 1793232781-c0e5 (Aqil's notes #151–#155 + Zaid's flow update, 2026-10-28)
- **6Sense tab (#151, #152 A / K):** right of Mine, for Aqil and Aziz only (as themselves or in Boss View; hidden while
  viewing as another LDR, and switching View as from it goes to Unclaimed). New component `lwc/ldrSixSense` (list +
  page); `ldrInbox` loads the data and passes it in.
  - Apex `getSixSenseReplies()` (admins only, read-only, user mode): Tasks and Events with "[6sense] [Email] [In]" in
    the Subject, created on or after Sep 1, 2026 (Pacific, `SIX_SENSE_SINCE`), on Leads whose CE Campaign Name contains
    "rina" or "Emily". Kept only when Lead Funnel Time Stamp is blank or earlier than the reply's date, and Comments
    don't have the CASL footer (the space after the comma is optional). Built as the canvas does, per Aqil. 2000 rows
    per object (`SIX_SENSE_LIMIT`); the list says when that cap is hit.
  - Mine = Project Coordinator is the viewer; Unassigned = blank, or anyone outside the six LDRs (`SIX_SENSE_LDR_IDS`:
    Aqil, Jabir, Jahmanz, Samantha Sanchez, WeiWei, Yasmin; Aziz's Leads count as Unassigned). Tab count = Mine.
  - Groups by CE Lead Status (Qualified, Human Review, Not Interested, Not Interested Now, Other), one card per person
    with "▸ N more emails"; filters Record · Type · CE Lead Status, then Status · Date; no list search.
  - Page: Open Lead ↗ · Call · Draft Email (a `mailto:` link) and the status buttons Working / Nurture / Unreachable /
    Disqualified on header line 1. `saveSixSenseStatus(leadId, status, outcome, timeStamp)` (admins only) sets Lead
    Status + Lead Funnel Time Stamp = today; clicking the filled button undoes it. Disqualified shows Lead Funnel
    Outcome * as a prompt only.
  - Search: "In other tabs" and the Salesforce search's "In the inbox" list 6Sense people in your Mine / Unassigned
    box ("In 6Sense" / "In 6Sense (Unassigned)").
- **Convert flow (Zaid's update):** the Convert window passes `recordId` (Lead Id) and `skipNavigation = true`; the
  "open in a new tab" links use `/lightning/flow/Convert_Lead?flow__recordId=…&flow__skipNavigation=true`. When the
  flow finishes, its `OpportunityId` output picks the Opportunity for the Files step (`getLeadConversion(leadId,
  flowOpportunityId)`); otherwise the Lead's converted Opportunity, as before. The outputs AccountId / ContactId /
  OpportunityId are record variables (ProjectId is text), so the inbox reads the record's Id (v5b). **Needs Zaid's flow
  version in the org** (lightning-flow errors on an input the flow doesn't have): in production it was activated on
  2026-10-29 00:50 UTC (version 301PY000020g4rEYAQ).
- **Attach to Opportunity (Zaid's update, v5c):** the `Contact_New_Opportunity` window also passes `skipNavigation =
  'true'` (a text variable in that flow), with recordId / ContactId / Selected_KBMax_Rows as before. Needs the version
  active in production since 2026-10-29 00:49 UTC (301PY000020g4rDYAQ); the flow has no outputs, so finishing still
  re-reads the Contact's open opportunities.
- **Claim clears the Outcome (#152 B / #153 A):** a Lead or Contact whose status is New after the claim (reset or
  already New) gets Lead Funnel Outcome cleared in the same update. Claim from a teammate is unchanged.
- **Junk (#153 D):** sets Project Coordinator = you, Lead Funnel Timestamp = today, Status = Wrong profile, and Lead
  Funnel Outcome by reason (Solicitation → Spam/Solicitation; Fake or invalid contact info → Invalid Contact
  Information; Test / Not a customer → Other). The tag keeps the previous coordinator too (`{prev:…|…|…|…|<Id>}`), and
  Restore puts it back; older 4-slot tags still restore the other four.
- **Record header (#152 F, #154, #155 A):** Inquiry Type tag at the start of line 1 and the status buttons (now with
  **Qualified**, between Disqualified and Junk ▾) on its right; Customer Type tag at the start of line 2 and "Current
  Tab: <Tab> - Go to <Tab>" on its right; line 3 only for "In Outreach". "Existing Contact" tag removed. The buttons
  block is at least 44px tall and centred. The status buttons left LDR fields.
- **Rep note (#152 C / #153 B):** the grey rule line under the rep is gone; a note follows "Rep: <name>": "(Owner: X)",
  "(PA Residential)", "(*Undetermined* PA Res/Com Split)" with the name "Joe Bennett Residential or Gunner Roberts
  Commercial", or "(Owner Jeff Calabrese - Confirm if split)". The full rule is the note's hover text.
- **Notices:** "…Project Coordinator is already …" (Unclaimed) only when Lead Funnel Timestamp is within the last 7 days
  (#152 D). "You took this over from …" has an × on every tab, stays dismissed per user in this browser
  (`localStorage`), and shows only for 24 hours after the claim (claim time as in Claim Audit; new `ClaimContext.claimedAt`)
  (#152 E).
- **Popups (#152 G):** Quick Edit, Log a Call (Cancel then Save, bottom right) and Draft Email open as centred dialogs.
- **Draft Email (#152 H, #155 B / C):** the message is an editable box (starts as the template; *bold* and "- " bullets
  are kept in the copy; Undo Edits; a template click replaces it; reopening starts fresh). The details are read-only.
  Copy buttons on the title line, templates on the line below, no bottom button row.
- **LDR fields (#152 I, #153 C):** Project Coordinator | Lead Funnel Timestamp and Lead Status | Lead Funnel Outcome
  side by side; Project Application Industry | Project Application side by side; Populate Project on the Project
  Details title line while it's open (hint text removed); no API names. **Not done:** Project Site as Street, then City
  | State | Zip on one line. It's the base `lightning-input-address` (which carries the Address Search), and its
  internal layout can't be restyled; doing it means separate inputs and losing the search. Margins: a CSS fix for the
  record-edit-form fields' side padding, to check in Salesforce.
- **Post Quote (#152 J, #154, #155 A):** "Action taken:" + its buttons on header line 1, right; "Current Tab - Go to"
  on line 2; the bar above Project / Opportunity is gone (grid: Project | Opportunity, then FJTR).
- **Instant Estimate facts (#152 L):** Submitted · Instant Estimate Name · Estimate / Frame type · Opening Width ·
  Opening Height / Customer type · Project Construction Classification · Application (no Inquiry type).
- **Version label:** v5. The junk banner now says the Finished window from `FINISHED_DAYS` (it still said 7 days).
- **Tests:** `sixSenseKeepRule`, `sixSenseIsAdminOnly`, `sixSenseListsRepliesAndStatusTakesThemOff`,
  `junkOutcomePerReason`; `markJunkOnLinkedLeadAndRestore`, `junkTagParsing`, `claimResetsStaleStatus` and
  `leadConversionReportsContactAndOpportunity` updated. Not run in an org.

### v4c: canvas 1793144121-3994 (Aqil's notes #148–#150, 2026-10-27)
- **Convert sets Qualified (#150):** in the Convert window, once the flow has converted the Lead and before the Files
  step, Apex `qualifyConvertedContact(leadId)` sets the new Contact's Lead Funnel Status = Qualified, only when it is
  blank (a Contact the Lead was merged into keeps its status). User mode; runs once per conversion. The Files step and
  the "Converted" toast say "Lead Funnel Status set to Qualified."; if it fails, the error shows and the Files step /
  Open Contact still work. Conversions outside the inbox stay blank (a record-triggered flow on Lead could cover them).
  #148 B / #149 C (Qualified from the link fix) were superseded by #150 and are not built.
- **Claim → Mine (#148 A):** a successful claim switches to Mine with the record open (the tab switch's resets; the
  claim message stays). A claim conflict stays put.
- **Filter rows, no list search on Unclaimed / Mine / Finished / All (#148 D / E):** line 1 Record · Type · Form;
  line 2 Coordinator · Status · Date (Unclaimed / All) or Status · Date (Mine / Finished). "Coordinator: All" /
  "No Coordinator". The "Search name or email…" box is only on Prospects and Post Quote; elsewhere a leftover search
  is ignored (list and "In other tabs"). Boss View → All Submissions keeps its own search.
- **Uncontacted list (#148 C):** "Uncontacted Claimed Leads & Contacts (N)"; a row that isn't loaded shows a toast
  instead of opening the Lead.
- **Finished = 14 days** (`FINISHED_DAYS` in `ldrInbox.js` and the controller; was 7, #149 A asked for 30, Aqil chose
  14 on 2026-10-27). A converted Contact set back
  to New / Working is in Mine again. Not changed: Post Quote "done" replies stay 7 days (`PQ_DONE_DAYS`), and the
  dashboards' "Finished this week" stays 7 days (`WEEK_DAYS`).
- **Prospects = last 45 days (#149 B)** (`PROSPECT_DAYS`): estimates created in the last 45 days, 3D configurator
  people whose latest quote is in the last 45 days. The blurb starts "Last 45 days." `LDR_Prospect_Since` still sets
  Post Quote and the configurator stats ("Quotes since …"), and keeps people with an older claimed quote out.
- **Claimed instant estimates load like form submissions (#149 D):** any claimed estimate (Custom or price range)
  that is New / Working, or whose Lead / Contact changed in the last 14 days, with no start date. Fixes the
  uncontacted list opening the Lead for a claimed Custom estimate outside the date windows (#148).
- **Queue cap 1000** (`MAX_ROWS`, was 500; Aqil, 2026-10-27): form submissions and instant estimates each, newest
  first.
- **Tests:** `qualifyConvertedContactOnlyWhenBlank`. Not run in an org.

### v4: canvas 1792808924-54b8 (Aqil's notes #143–#146, 2026-10-23)
- **Search in every tab (#143):** the list still filters by name or email; below it, "In other tabs · N" lists the
  other matches (Unclaimed, Mine, Post Quote, Prospects, Finished, All; "This Tab · Filtered Out" when a list filter
  hides it here), 8 at first with "Show all N". Clicking one switches to its tab (filters reset, search kept; Post
  Quote / Prospects pick the filter or list that shows it). A search also loads Prospects if they aren't loaded yet.
- **"Go to <Tab> Tab" (#143):** on the record page and the Post Quote page, under Current Tab, when the list is on
  another tab.
- **Salesforce search (#144 / #145A):** "Search Salesforce by email…" in the middle of the tab bar (button or Enter,
  at least 2 characters). A full email = exact match on Leads (not converted) and Contacts; other text = Salesforce
  search on name, email and company. The panel shows "In the inbox" matches (click to open) and "In Salesforce, not in
  the inbox" cards (type, status, account, location, Rep via the owner aliases, Project Coordinator, created, last
  activity, open opportunities, a best-guess "Not in the inbox" reason, Open in Salesforce). Apex `searchPeople`
  (user mode, read-only, up to 20 Leads + 20 Contacts).
- **Claim Audit (#145B, Boss View):** new tab between Dashboard and 6Sense Dashboard (`c-ldr-claim-audit`, Apex
  `getClaimAudit`, admins only). By Claimer table (Within 24h / Still inside 24h / Late / No email / No Lead / Contact,
  late-or-none rate and bar, Whole team row) and Flagged Records with search, Claimer, Status, Leads / Contacts, Lead
  status and Converted filters. Live from Salesforce from Oct 6, 2026 (at most 120 days back).
  - Claim time = the claimer becoming Project Coordinator on the Lead / Contact (field history), else Claimed Date
    8:00 AM Pacific ("Claim time exact = No").
  - Emails = Tasks owned by the claimer, subject "[Outreach] [Email] [Out]…" or "Email: …", on the Lead, the
    Contact or the Lead it converted from, after the form came in.
  - Aziz's claims and test emails are left out; junk rows are counted.
- **Uncontacted Claimed Leads (#146, everyone):** a red notice under the fixed-links notice, "You have N claimed Leads
  or Contacts with no email after 24 hours. View All", and a list (oldest claim first; name opens it in its tab). ×
  writes `#NoContactNeeded` at the end of Questions or Comments on that person's claimed submissions
  (`markNoContactNeeded`, user mode) and the tag is hidden everywhere Questions or Comments is shown. Apex
  `getUncontactedClaims`; refreshed on load, ↻, View as and after every inbox write (not on the silent refresh).
- **Permission set:** `Form_Submission__c.Questions_or_Comments__c` is now editable (needed for ×).
- **Version label:** "v4" in the top bar between "Signed in as" and "Updated", for the admins only (Aqil, Aziz;
  Boss View included). Change `APP_VERSION` in `ldrInbox.js` with each version.
- **↻ also reloads the open record's side panels** (open opportunities, activity, history, account, related
  submissions); before, they only loaded when a record was selected. The 60 s auto-refresh still doesn't.
- **Tests:** `searchPeople*` (4), `claimAuditRequiresAdmin`, `claimAuditClassifiesClaims`, `claimTimesUseCoordinatorHistory`,
  `uncontactedClaimsListAndNoContactNeeded`, `uncontactedClaimsAreYourOwn`. Not run in an org.

### v3: canvas 1792637411-1b3f (Aqil's notes #133–#142, 2026-10-21)
- **Top tabs (#135):** the brand row holds the page tabs (LDR Inbox · My Dashboard · … / Boss View's pages) as underlined
  text tabs; the separate boss-tab and user-tab bars are gone.
- **Lead Views (#136):** one list view / report per row, full width.
- **Quick Edit (#137 / #138):** a record edit form for First / Last Name, Email, Phone (and Company on Leads), plus a
  Mailing Address with address search (`lightning-input-address`, codes kept for State & Country Picklists). Save /
  Cancel in the #137 colours; the LDR fields' Save / Cancel and the Hand-off button restyled the same way.
- **Project Site address search (#134):** the five Project Site fields are one address input with search. The search's
  country / state codes are mapped to the full-name picklist values (state codes are matched within the country, since
  NL and ME repeat). Street / City are cut to 100 characters and Zip to 12, with a note; nothing is saved until Save.
- **Post Quote for every LDR (#139):**
  - The tab shows for everyone; its count (open replies where you're the Project Coordinator) loads with the inbox.
    My Dashboard has "Post Quote replies for you".
  - The cards are in the inbox's own list column (search and Date sort shared; Mine / No Project Coordinator /
    All LDRs filter in the tab bar), and the reply page sits where the record page goes and scrolls on its own.
  - Apex: `getPostQuote` / `savePostQuote` no longer check for the admins.
- **Cards (#140):** customer-type edge and icon, [Post Quote] + type, project, then done flag · General Application ·
  opportunity stage · Residential / Commercial; coordinator bottom right on every card; "▸ N more emails" opens the
  earlier replies as child rows.
- **Page (#140–#142):**
  - Header in three lines: Replied · email · phone `(xxx) xxx-xxxx`, with Current Tab on the right; Account · City,
    State Zip · Rep; General / Specific Application tags and a red "Split Territory: Project in X's area" flag when
    the Project owner differs from the Opportunity owner.
  - Rep = the matched Opportunity's owner through the owner aliases only (`aliasOwner` in `repRouting.js`).
  - Thirds: Comments and other emails on the left; "Action taken:" over separate Project Details and Opportunity
    Details boxes, each with its own Save / Cancel; Reason Project Lost only for Stage = Project Lost and Lost To only
    for Reason = Competitor; labels without API names.
- **Action taken (#140):** Updated · Escalated · FJTR Sent · No Action Needed add `#Updated` / `#Escalated` /
  `#FJTRSent` / `#NoActionNeeded` on a new line at the end of the latest email Task's Comments (`markPostQuoteReply`,
  user mode; one tag at a time; the lit button undoes it). A tagged reply leaves Post Quote and shows for 7 days, from
  the Task's Last Modified Date, at the end of Finished (yours) and All under "Post Quote replies"; counts include them.
  The tag isn't shown in the reply text.
- **FJTR card (#141 / #142):** the team's FJTR table (Contact, Email, Phone, Project, Additional Attachments,
  Questions/Comments/Concerns, editable and starting as the latest reply), Copy Subject and Copy FJTR (Outlook HTML in
  the template's colours, no blank lines around the table).
- **Not changed:** Post Quote isn't reloaded by the silent auto-refresh (↻ and every Post Quote save reload it); the
  FETR copy still has its spacer lines.
- **Tests:** `postQuoteLoadsForEveryLdr` replaces `postQuoteIsAdminOnlyAndLoads`; new `postQuoteTagHelpers` and
  `markPostQuoteReplyAddsReplacesAndUndoesTheTag`; the Post Quote list test also checks a tagged reply. Not run in an org.

### v2: production review + Aqil's decisions (2026-10-21)
- **Status Reason dropped; Lead Funnel Outcome is flagged (not enforced) for Wrong profile / Disqualified.**
  Production: Lead `Status_Reason__c` depends on Status and has no values mapped to Wrong profile or Disqualified, and
  the Outcome is what's reported.
  - **Inbox LDR fields:** no Status Reason field. When Status is Wrong profile or Disqualified, Lead Funnel Outcome's
    label gets a * and "Required when Status is Wrong profile." (or "… Disqualified.") shows under it in red.
    - It's a prompt only: the field isn't required, there's no error border, and saving without it works.
    - Outcome is editable wherever Status is, incl. a converted Contact's status saved without claiming.
  - **Apex:**
    - `saveLeadFields` drops its `statusReason` parameter.
    - `saveStatusWithoutClaim(submissionId, status, outcome)` now saves the Outcome.
    - Status Reason is never written, and the queue no longer sends its options or values.
    - No Outcome check.
  - **Mark as junk:** still sets Wrong profile + Outcome Spam/Solicitation + timestamp, but leaves Status Reason as it
    is. The restore tag keeps its four slots, so Restore also undoes the Status Reason of junk marked before this change.
  - **Lead Views → Change Status:** a Lead Funnel Outcome select ("Lead Funnel Outcome *") replaces Status Reason for
    Wrong profile / Disqualified, with the same message. Save doesn't need it.
- **Retired statuses reset on claim.** Claiming a Lead / Contact whose status isn't an active value of its picklist any
  more resets it to New, like the stale ones. Examples: Contact Lead Funnel Status "Inactive" (40k+), "Remarket",
  "Awaiting Info"; Lead "Close - No Further Action", "Attempting Contact".
  - Apex: `isRetiredStatus`, which reads the active values from the describe, so it follows future picklist changes.
  - LWC: `isStaleStatus`, which shows the same pre-claim "↻ Was …" flag and banner and the "reset to New" message.
  - Before, these records kept the old status after the claim and dropped out of Mine at once (14 submissions in
    90 days).
- **From the production review** (`REFACTOR_LOG.md`, "Production review"):
  - Speed numbers read only the claimers' Tasks (same results, about a third of the rows).
  - The 6sense "last synced" time is sent as ISO GMT.
  - 6Sense Integration User Tasks are shown as automation.
- **Tests:** `wrongProfileSavesWithOrWithoutOutcome` replaces `wrongProfileNeedsStatusReason`; new `retiredStatusesAreDetected`;
  the junk test now expects Status Reason unchanged. Not run in an org.

### Canvas 7d7a (Aqil's note #132, 2026-10-20)
- **Mine and Finished dated and sorted by the submission's Last Modified time** (replaces #131C's submitted time for
  those two tabs). The card date ("10m", "3h", "Oct 18") and the Date sort use `LastModifiedDate`, newest first by
  default (the Date button flips it). Mine keeps its New / Working sections, sorted inside each. A grouped person's
  head card is their most recently modified submission. Unclaimed, All and Prospects keep the submitted time.
- Apex: `LastModifiedDate` added to the Form_Submission__c queue query and to `ESTIMATE_FIELDS`
  (Website_Instant_Estimate__c). Configurator rows send their quote's `LastModifiedDate` (`ConfigPerson.lastModifiedAt`).
  A row without one falls back to the submitted time.
- Expected (accepted in the notes): Last Modified is the claim about 72% of the time. A later write (claim / release,
  junk, the #LinkFixed safety net, which runs as whoever opens the inbox) moves a card to the top of Mine / Finished.
  Lead / Contact status changes don't touch the submission, so they don't move it.

### Canvas e7b5 (Aqil's notes #119–131, incl. Aziz's design-system change 25, 2026-10-20)
- Ported by Claude from Aqil's canvas `project/LDRInbox-NanaWall.dc.html` version **1792543523-e7b5** and the notes
  file `LDR-canvas-change-notes-current_131.md`. #81–118 were already in this build (sections below).
- **Attach to Opportunity (#119):** Contact rows in Mine get a button directly above Hand-off (white, green outline).
  It opens the **`Contact_New_Opportunity`** screen flow ("Contact: New Opportunity", the Contact page's New Opportunity
  button) in a window over the inbox, like Convert. Inputs: `recordId` = `{ Id: contactId }` (SObject), `ContactId`
  (String), and `Selected_KBMax_Rows` = the Contact's 3D configurator quotes from Related items (`{ Id }` only). The flow
  has no outputs, so on finish the inbox re-reads Open opportunities and picks the newest one's project for this
  submission's FETR (#120). The canvas's own window was a stand-in for the flow's screens and is not ported.
- **FETR project picklist (#120):** next to "FETR · rep email" when the Contact has 2+ open projects (one entry per
  project). Default, first that applies: the LDR's pick; the submission's Project name found in a project / opportunity
  name; the project zip's city found in exactly one name; the newest opportunity. A note under the title says which
  (amber #8A4B00 when it fell back to the newest). The pick sets Project Name (+ link) and Split Territory in the card and
  Copy FETR, and is kept per submission for the session. *City:* the canvas looks the zip up in a simulated table; the LWC
  has no zip→city source, so it uses the form's City (or the Contact's Mailing City) when that zip matches, else the
  form / Contact city.
- **Windfall "Invalid Date" (#121, production bug):** root cause found in Apex. `windfallValues` built the map with
  `String.valueOf(Object)`, which gives `"2026-10-13 00:00:00"` for a Date, and the LWC then parsed
  `"2026-10-13 00:00:00T00:00:00"`. This hit **every** Contact row's Windfall date (the Contact's own and the converted
  Lead's), not just the fallback. Apex now sends `yyyy-MM-dd`; the LWC formats only a real `YYYY-MM-DD` (blank / invalid →
  blank, so the FETR leaves the line out). The "(Windfall from the converted Lead)" FETR line is removed. Re-check in
  production: Alan Joelson, Tyler Koval or Ghazala Rana should show Oct 13, 2026.
- **FETR line breaks (#122):** "Questions/Comments/Concerns" and "Home/Zip Code Value" values start on the line below
  the label in the card, the copied HTML (`:<br>`) and the plain text.
- **Design system (#123, Aziz's change 25):**
  - Every font size is on the 11 / 12.5 / 14 / 16 / 19 / 24 / 30 scale (157 values snapped across all components;
    dashboard titles 16px / 600 as in the canvas).
  - No shadows: dialogs get a 1px #D8D8D8 border.
  - Native inputs / selects use #707070 borders; secondary buttons keep #C2C2C2.
  - Links are teal #00798F (green stays on text toggles and buttons).
  - Palette snaps: sand #D6CFBC → #E1DED8 (warn banner, configurator button, competitor card, Post Quote warning) and
    → #C6C1B0 in charts; #81826F → #908A81; #77123E → #47647D. Dashboard "Responded" KPI and the Contact campaign bar
    are #3D3D3D, as in the canvas.
  - About 20 button / toggle labels are now in Title Case (Draft Email, Log a Call, Quick Edit, Claim Lead, Show Less, …).
  - Missing required fields (Create Lead on submit; Status Reason as soon as it's missing) get the field's own SLDS red
    error border through `reportValidity()`. That is SLDS's error red, not exactly #C8102E: base components can't take
    an inline border.
  - Fonts unchanged: the inbox loads Source Sans 3 / Source Serif 4 from `NanaWallFonts`; the canvas's first choice,
    Source Sans Pro / Serif Pro, isn't in the package.
- **Populate Project (#124):** homeowners get Industry **Single Family - New** for "New Construction" and **Single Family
  - Remodel** for "Remodel" or a blank classification (forms: `Project_Construction_Classification__c`; instant
  estimates: `Project_Classification__c`). The message says which. The help text under the button says so too.
- **Queue cards (#125):** under the name / date: "● Claimed, still New"; [Inquiry Type][Customer Type]; the other flags
  (left out when none); the claimer and the amber ⚠ coordinator flag on the right; the purple "▸ N submissions" pill
  last. No Zip/Postal line and no "Also: …" text. Post Quote, Prospects and All Submissions cards are unchanged.
- **Mine in sections (#126 / #131C):** New, then Working, each with a header and count (a person's grouped
  submissions count once), sorted by submitted time inside each. "Other" appears only for claimed rows that are neither
  (in practice: a claimed submission with no Lead / Contact yet).
- **Current Tab (#127 / #131A):** "Current Tab: Unclaimed / Mine / Prospect / Finished / N/A" at the right end of the
  Submitted line, from the same `inTab()` the lists use. Claimed by another LDR: "Mine (Yasmin Hernandez)" /
  "Finished (…)".
- **Tab switch (#128):** Record, Type, Status, Form and every Project Coordinator filter go back to All, the sequence
  buttons to All and the Date sort to newest first. The search is kept and, while it has text, is outlined in teal on a
  light-teal fill with a × to clear it (native input instead of `lightning-input`, so the canvas styles apply).
- **Convert (#129):** after the "Convert Lead - LDR" flow converts the Lead, the inbox replaces the flow's own summary
  screen with a **Files** step (path "Account › Contact › Project › Files"):
  - The form's attachments are listed as links. They are on the upload host, not Salesforce Files, so they can't be
    attached automatically until the www.nanawall.com Remote Site Setting exists (notes #55).
  - **Upload Files** (`lightning-file-upload` on `ConvertedOpportunityId`).
  - **Attach Files & Open Contact** / **Open Contact**.
  - Closing leaves you on the Contact in the inbox, with Open opportunities re-read. This fixes "the new opportunity
    only shows after a full browser refresh". The cause was not caching: no Apex method is cacheable. After the reload,
    the selected row was kept but its related data was never re-read.
  - Detection: each flow `statuschange` calls the new non-cacheable Apex **`getLeadConversion`** (`IsConverted`,
    `ConvertedContactId`, `ConvertedOpportunityId`; if that is blank, it falls back to the Contact's newest open
    Opportunity from the last 10 minutes). No Opportunity → the Files step is skipped.
  - The window keeps its own Lead Id. Before, it closed itself on the next reload because the row had become the Contact.
  - New test: `leadConversionReportsContactAndOpportunity`.
- **Handoff email (#130):** "Hi <First Name>," (was "Hi,").
- **Address line (#131B):** the Lead / Contact City, State Zip; if none, the submission's zip; then "No address on …".
  The "(zip from the form; no Lead or Contact yet)" note is removed.
- **Not verified (none of this ran in an org):**
  - `Contact_New_Opportunity` and its input names / types, and whether it needs more than `Id` on the passed records.
  - Whether LDRs can run that flow: the permission set lists only `Convert_Lead` under flow access; add
    `Contact_New_Opportunity` if they can't.
  - Whether the flow's summary screen flashes before the Files step replaces it (one Apex round trip).
  - The look of every #123 change, and the Mine sections / card layout, in the browser.

### Canvas 41be (Aqil's notes #115–118, 2026-10-19)
- LDR-facing: **Rep shown correctly for homeowners in split territories; dashboards scroll; Change Status on Lead Views.**
- **Residential vs commercial (#117 / #118, production bug):** `repRouting.js` `projectType()` now decides in this order:
  instant estimate → residential; Customer Type Homeowner (form, Lead Type__c or Contact LeadType__c) → residential;
  3D configurator → the latest quote's Project Type (`KBMax_Web_Quote__c.Type_of_record__c`, added to the configurator
  read); Lead Project Type (`classifySingleType`); Project Application Industry; form Application (`classifyApplication`).
  RES = Residential, Patio, Dining Room, Living Room, Pool House, Bed / Bath; COM = Commercial, Restaurants, Educational,
  Retail, Office, Other. Still undecided → "<res rep> (res) or <com rep> (com)", "unable to determine project type",
  flagged; Southern California now names both reps by ZIP (it showed no name before). Alan Joelson (Homeowner, Dining
  Room, CASouth-SanDiego) now shows Joe Rapolla (checked in Node with his production values).
- **Scrolling (#115A):** Boss Dashboard, 6Sense Dashboard, My Dashboard, Estimate and Lead Views panes are `flex: 1 1
  auto; min-height: 0; overflow-y: auto` inside the fixed-height shell, so they scroll in a short window.
- **Lead Views (#115B / #116):** Change Status next to Open full view (disabled until rows are selected): Lead Status
  (record-type picklist) + Status Reason (Wrong profile / Disqualified only, required, dependent values), Save →
  `updateRecord` per selected Lead with only Id, Status (+ reason), per-row errors, refresh, selection cleared. No Apex.
  No Import to Outreach button: Open full view opens the standard list view, where the Outreach extension adds its own.
  Open: should Change Status also set Lead Funnel Time Stamp = today? (not built; Aqil to answer).

### Canvas a62f / ae9a (Aqil's notes #108–113, 2026-10-16)
- **All tab (#108):** All = every LDR's Mine + Finished: claimed and still New / Working, or finished in the last 7 days
  by whoever claimed it (converted Contacts, Qualified, Nurture, …). The Finished test is now `isFinishedFor(row,
  claimer)`; Finished calls it with the viewer. Junk stays out of All. `getQueue` also loads claimed submissions whose
  Lead / Contact changed in the last 7 days (so other LDRs' converted Contacts reach All); the LWC applies the exact rule.
- **Estimate tab (#111, every LDR, not Boss View):** new child LWC `ldrEstimate`: frame type (images from the new static
  resource `LDR_EstimateFrames`), Width / Height buttons, estimated cost, "Copy for email", included items, disclaimer,
  and an All sizes table (click a price to pick it). Prices in `ldrEstimate/estimatePrices.js` (the 60 ranges from the
  website estimator, current since 2026-06-26; sizes outside 6–18' × 7–9' = Custom). No Apex; nothing saved.
- **Lead Views tab (#109–113, Aqil / Aziz as themselves, not Boss View):** new LWCs `ldrLeadViews` + `ldrListViewPanel`.
  Seven panels, two per row: four Lead list views (live through `lightning/uiListsApi`: columns, filters line, default
  sort; server-side column sort; search on the loaded rows; Load more; row checkboxes; inline edit of fields the user can
  update, incl. "Update N selected items"; Save → `updateRecord` per row with per-row errors; View / Edit row actions) and
  three reports (new Apex `getReportRows` → Reports API, read-only table, admins only). "Open full view ↗" opens the real
  list view / report as a console tab. Picklist columns aren't editable inline (no datatable editor); use the full view.
  The views and reports must be shared with whoever opens the tab. New Apex test `reportRowsGuards`.
- Not ported: Rep Finder (#99–107, its own artboard since #114) and the other Phase 3 entries.

### Canvas aabc (Aqil's notes #96–98, 2026-10-15)
- **Draft email templates (#96B, #97, #98):** buttons next to the "Draft email" title: Request Information ·
  Estimate Small · Estimate Large (instant estimate rows only) · Handoff. Click toggles; another switches; opening Draft
  email starts with none. The message (wording copied verbatim from the canvas) replaces the blank lines at the top of
  the copied HTML, the plain-text copy and the mailto body; *word* is bold, "-<tab>" lines are hanging-indent dashes.
  Greeting "Hi <first name>," (Handoff: "Hi,"; **InsertRepInfo** placeholder). Copied / hint texts change with a template.
- **Details table (#96A, #98):** 90% wide, first column 1.67in, Aptos 10pt inside (rest of the email 11pt), no spacer
  row, 1/4 pt black line above the first row; the plain-text copy and mailto body drop the "____" separator. On-page
  preview: 90% wide, 1px #292929 top line, 160px first column.
- **Open opportunities (#96C):** Record Type · Opportunity Owner · Project Owner / Created · Close · Amount. Project
  Owner = `Opportunity.Project_Name__r.Owner.Name` (added to `getContactOpportunities`, checked in production). A red
  "Split Territory" tag shows before the stage when both owners are set and differ.
- **FETR (#96D):** Contact Information Type = Contact.LeadType__c (old rule only when blank); Split Territory = "Yes -
  Copying <Project Owner>" when the first open opportunity's owner and its Project's owner differ, else "No" (replaces
  the routing rule); Inquiry Details Type = the form's Inquiry Type as-is.
- **Log a call (#96E):** outcome buttons select (teal when picked); Comments box; Save (green outline, disabled until an
  outcome is picked) logs it. `logCall` now takes `comments`, written first in Task.Description (then the existing
  "Logged from LDR Inbox (…)" line). Opening / cancelling / changing rows clears both.
- **#96F (Convert window "Opportunity files"):** no LWC change; it belongs in the "Convert Lead - LDR" screen flow.

### Canvas d84b (Aqil's notes #93–95, 2026-10-15)
- **Record header (#94A):** the action buttons float right at the top of the name column; the name row sits beside
  them and the Submitted / account + rep / owner / Outreach lines are single nowrap lines that drop below the buttons
  when they don't fit beside them. "Mark as junk" is no longer in the header.
- **Status buttons in LDR fields (#94B, #95):** a row above Project Coordinator: Working · Nurture · Unreachable ·
  Disqualified · Junk ▾ (hidden on prospects). The four statuses need a linked Lead / Contact you have claimed; one click
  sets Status (Contact: Lead Funnel Status) and Lead Funnel Timestamp = today (Pacific) through `saveLeadFields`
  (no new Apex method; Outcome and Status Reason are passed through unchanged). Disqualified is disabled on Contacts
  (Contact.Lead_Funnel_Status__c has no such value, checked in production). Unsaved LDR field edits must be saved or
  cancelled first. The current status button is filled teal; disabled buttons say why in the tooltip.
- **Junk on a linked row (#94B, new behaviour):** besides claim + tag + Finished 7 days + same-email sweep, the clicked
  row's Lead / Contact gets Status (Contact: Lead Funnel Status) = Wrong profile, Status Reason = Solicitation (Contacts
  only where Contact.Status_Reason__c exists), Lead Funnel Outcome = Spam/Solicitation and Lead Funnel Timestamp =
  today. All four reasons map the same way. The previous values are kept in the tag
  (`#Junk:<reason>{prev:status|reason|outcome|yyyy-mm-dd}`) and Restore puts them back. The tag helpers in JS and Apex
  strip the `{prev:…}` block. Picklist values confirmed in production (read-only): Lead Status and Contact Lead Funnel
  Status have Working / Nurture / Unreachable / Wrong profile (Disqualified on Lead only); Status_Reason__c has
  Solicitation on both (Lead's depends on Status; 4 production Leads already have Wrong profile + Solicitation);
  Lead_Funnel_Outcome__c has Spam/Solicitation on both. New Apex tests `markJunkOnLinkedLeadAndRestore`,
  `junkTagParsing`.
- **#95 text changes:** "LDR fields" title; the owner-alias rule line reads "Owner: <Salesforce owner>"; the queue card
  coordinator tag shortens a leading "Samantha" to "Sam" (card tag only).
- **#95 LWC-only (Aqil's screenshot):** removed "You are the Lead's / Contact's Project Coordinator"; "Set from a
  different submission, not this one" now sits under the Project Coordinator field.
- No LWC change for #93 (canvas size 1717 × 770, the LDR team's screen).

### Canvas f123 (Aqil's notes #86–92, 2026-10-15)
- **Record header (#86, #89A, #90):** top-aligned; the name row is 44px tall with the name and tags centred; the
  Submitted / account / rep / Outreach lines now sit directly under the name, in the same column. The Outreach line
  starts with 📨. The **Sequence in Outreach button is removed** (its JS handler is left in place, unused). The customer
  type pill uses the queue-card type colours (Homeowner teal, Contractor orange, Architect blue, Business Owner purple,
  white text and icon; Unknown grey). Buttons keep their width on one row.
- **Fixed-links safety net on instant estimates (#89B):** `fixLinks` now also handles Website_Instant_Estimate__c
  (both-linked, converted Lead, same email). Its "#LinkFixed…" / "#FixReviewed" tags go at the end of
  Questions_or_Comments__c (no internal Comments field); 3D configurator rows are left out (no field to tag).
  `markFixesReviewed` / `markFixReviewed` handle both objects. The 🔗 notice says "submission(s)"; each row in
  "View all" says "tagged in Comments__c" or "tagged in Questions_or_Comments__c (end)"; × / Clear All messages name the
  right field. The window is capped at the viewport height with a fixed header and a scrolling list (max 660px).
  One helper (`stripFixTags` in JS, `stripInternalTags` in Apex) removes #LinkFixed…, #FixReviewed, #Junk:… and
  #JunkUndone wherever the inbox shows or copies the comment. New Apex test `safetyNetOnInstantEstimate`.
- **Boss View → All Submissions (#89C, #90):** the tab row holds the date filters (Past 7 / 30 / 90 days / Past year,
  From / To) and a stats line: "[period] · N total · N claimed · N unclaimed · New · Working · Qualified · Nurture ·
  other statuses A–Z · Without Status" (only statuses with rows; counts follow the filters). The left column has
  Record / Type / Status, then Project Coordinator (its own setting) + Form, then search and the Date sort. Options are
  built from all loaded submissions. Status and Type reset when switching Boss tabs. `getAllSubmissions` now also
  returns Email_Address__c, Lead Type__c and Contact LeadType__c (when present). A blank status reads "Without Status"
  in the inbox Status filter too.
- **Prospects (#89D):** points still decide the section; inside each section cards are newest first, and the Date
  button flips newest / oldest. Sorting by points is no longer offered.
- **Queue cards (#89E):** the bottom line no longer wraps: Zip/Postal on the left, claim label and coordinator pill in a
  right-aligned column. "Zip/Postal:" is printed once in this build (production's double label was an older build).
- No LWC change for #88 (canvas-only markup bug) or #91–92 (canvas size).

### Mark as junk on instant estimates (Aziz, 2026-10-14)
- Custom instant estimates can be marked as junk too. Website_Instant_Estimate__c has no internal comments field, so
  the "#Junk:<reason>" tag is appended to its Questions_or_Comments__c (Long Text, confirmed in production) and the
  claim fields are set as for forms. The inbox strips the tag wherever it shows the comment; in Salesforce the tag is
  visible at the end of the customer's comment. Restore removes it. Same-email unlinked estimates are included in the
  sibling marking. LDRs need edit access to Questions_or_Comments__c (from the profile; not added to the permset).
  New Apex test `markJunkOnInstantEstimate` (skips when the claim fields are missing).

### Full canvas review (brand artboard dd24, 2026-10-14)
The brand artboard was compared element by element with the LWC; the full list is in the project doc
`claude/ldr-inbox-canvas-vs-lwc-review.md`. Main changes in this build:
- Detail header re-laid out (name/tags left, actions right; Sequence in Outreach on its own row; info lines below).
  Banners in canvas order and colours; conflict / not-linked / coordinator wording and buttons as in the canvas.
- Log a call shows on every linked record (disabled with "Claim it first" when not yours; Apex still requires the claim).
  Outcome "Answered — Interested". Outreach line shows the active sequence name. Submitted time is relative.
- "Other submissions" and "Related submissions" are solid green panels. Attachments expiry tag (last 7 of ~30 days).
  Windfall / rep flag / matched-account / FETR / campaign / tracking texts and colours per canvas; FETR Home/Zip uses
  all Windfall lines and the copied email uses the canvas greens. Follow Up shows for instant estimates too.
- Apex: related-submission comments strip internal tags (`stripInternalTags`, + test assertion).
- Dashboards: canvas status / 6sense / per-LDR colours, "No-outreach flags" column, rows for every LDR, speed labels,
  no serif. Post Quote: canvas row/stage/button styles.
- Not done: "Post Quote replies for you" on My Dashboard, Post Quote tab-bar filter / shared search, project address
  search, some Quick edit / Create Lead / Link window details.

### Pass removed (Aziz, 2026-10-14)
- Prospect cards have no Pass any more (matches the brand canvas). Removed: the Pass link and reasons on the card,
  the "Passed" count and admin note, Apex `passProspect` / `passedIds`, the ProspectResult passed counts and the
  filter that left out people with a "Prospect passed:" Task, plus its Apex test. People passed earlier show on the
  list again. The existing Task in production (1, by Aqil Bassa on 2026-10-13, "Prospect passed: Low value") is
  left as is; delete it in Salesforce if it isn't wanted.

### Canvas dd24 (2026-10-14)
- **Mark as junk** (new): on an unclaimed (or your own) Form Submission, "Mark as junk ▾" with 4 reasons (Solicitation
  or sales pitch, Fake or invalid contact info, Test submission, Not a customer (other)). Apex `markJunk` claims it for
  you and appends "#Junk:<reason>" to Comments__c; no Lead or Contact is created or changed. The same sender's other
  unclaimed, unlinked submissions (same email) are marked in the same click. Junk rows show only in your Finished tab
  for 7 days with a grey "Junk · <reason>" flag and a banner with Restore (`restoreJunk`: removes the tag and the
  claim). Release on a junk row = Restore. Not offered on instant estimates, configurator rows or prospects.
- Row flags in the canvas order (type, form, Outbound, +KBMax/Estimate, campaign, open opp, junk, no outreach,
  "Was <status>", "● Claimed, still New" (white/red), assigned); group pill under the name line; "Zip/Postal:" prefix.
- Detail header: customer type tag with its icon; action buttons as in the canvas (teal outline; Release / Reassign
  green outline; the submission link sand).
- All Submissions tags neutral grey, claimed green / unclaimed red. Prospect tier headers sentence case.
- SF Bay Area showroom moved to Emeryville (1150 55th St E) for the 50-mile check.

### Canvas 5041 + production error hardening (2026-10-14)
- Brand artboard moved back to fuller colours: customer type as a coloured tag + side bar (plus the icon), Inquiry
  Type tags in toned Outlook hues, coloured age pill (amber near SLA, red past it), coloured flags (Outbound, +KBMax,
  open opp, no outreach, "Was <status>"), amber coordinator flag, emoji icons back (⚠ ⏱ 📍 🔗 🎉), no initials avatars.
- Prospect cards: up to 5 flags coloured by kind; "near a studio" still scores but is no longer a flag; 6sense status
  as a coloured tag with "M/D/YYYY · 6Sense Status Updated"; estimate summary no longer repeats the project type.
- 6Sense Activity note moved under "What they submitted", with a coloured left edge per outcome.
- Production "Could not load the queue: An internal server error has occurred" (seen twice by Aziz, 2026-10-14): cause
  not confirmed (no access to the Apex exception log from here). Changes: getQueue is retried once after 1.5 s on that
  specific error; Form Submission and estimate queries now return newest first, so the 500-row cap (MAX_ROWS) drops the
  oldest rows instead of the newest (production had 456 submissions in the last 30 days on 2026-10-14).

### NanaWall brand refinements (canvas 2de1, 2026-10-13, partly reversed in 5041)
- Customer type shows as an icon next to the name (plain grey text for Unknown and other types); rows no longer
  color-code by type. The left edge turns red only when an unclaimed row is past the SLA (age shows "■ 2h" in red).
- Emoji icons replaced: warnings use a small red ■; the coordinator flag and the "unclaimed but already has a
  coordinator" warning show the coordinator's initials avatar.
- Inquiry Type tags keep the Outlook flag colors (deliberate exception to the brand colors, as in the artboard).
- Section titles are sentence case. Boss View banner, its tabs and the View-as banner are dark green (#143E30).
- Prospect cards: the 2 strongest signals only (the rest stay in "Why this prospect"), button says Claim Lead / Claim
  Contact, 6sense outcome as one colored line (teal = in a campaign, green = replied, grey, red).
  **Differs from the artboard:** the artboard card has no Pass button; it is kept here as a small "Pass" link because
  Pass (Task-based) is a decided feature.
- Configurator files show type tiles (RFA, IFC, PDF, ZIP, LINK, MP4).

### NanaWall brand look (2026-10-13)
Replaces the old look everywhere (inbox, Post Quote, dashboards), from the LDRInbox-NanaWall artboard:
- Square corners, NanaWall colors (greens #4A6D22 / #194D19 / #74A63A, teal links #00798F, red #C8102E, warm page
  #F4F2ED, greys #292929 / #3D3D3D / #707070), bold weights softened to 600.
- Fonts: Source Sans 3 (body) and Source Serif 4 (names and titles), bundled in the `NanaWallFonts` static resource and
  loaded with `loadStyle`. If the resource fails to load, the inbox falls back to Trebuchet MS / Helvetica / Georgia.
- Top bar: NanaWall logo + "LDR Inbox" only.
- Not checked in an org: how Salesforce's own base components (lightning-input, lightning-button-icon, spinners) look
  next to the new fonts; they keep SLDS styling.

### Canvas 1791916019-9fed (2026-10-13)
- **6sense on cards and in the detail:** prospect cards show the CE outcome (e.g. "6sense: Human review", set date,
  campaign; faded when over 90 days). The detail has a "6Sense Activity" note explaining the outcome.
- **Sequence in Outreach** button in the detail: opens the Lead / Contact as a console subtab (record page elsewhere).
- **Windfall on Contacts:** shown for Contacts too; when the Contact has no Windfall numbers, the converted Lead's are
  shown with a note. FETR "Home/Zip Code Value" uses the same source.
- "Submitted" (Pacific date/time) is the first fact in the detail. Configurator button: "Open 3D configurator ↗".
- **Prospects:** Project Coordinator / Type / Status filters and a Date sort (first click switches from points to date).
- Follow Up adds "CE Last Synced Time".
- **Boss View → Dashboard → Speed:** per LDR, Form Submissions claimed since Oct 6, same day / next business day /
  weekend → Monday, average hours to the claimer's first Task, average to Qualified (status history) or conversion.
- **My Dashboard → Your speed:** your same-day %, with the team's %, first outreach and time to Qualified.
- **Boss View → 6Sense Dashboard (new tab):** CE enrolments in the last 30 days by status (Leads / Contacts / both),
  8-week stacked bars, top 10 campaigns (60 days), Human Review / Qualified per Project Coordinator (14 days).
- Rep routing: SoCal commercial now splits Jonathan Guerra / Drew Scott by ZIP lists, else Shawn Mahoney.

### Canvas 1791849381-55a9 (2026-10-12): Outreach sequence buttons + My Dashboard

- **Mine / All: Outreach sequence buttons** All · Sequenced · Unsequenced · Finished Sequence (with counts). Sequenced
  = `Outreach_Current_Active_Sequence_Name__c` set (if `Outreach_Finished_Sequences__c` is also set, only when
  `Outreach_Actively_being_Sequenced__c` is checked); Finished Sequence = finished set and not active by that rule;
  Unsequenced = neither. `Outreach_Actively_being_Sequenced__c` (checkbox, Lead and Contact, confirmed in production)
  was added to the Follow Up fields read dynamically; it isn't shown in the Follow Up card.
- **Inbox / Dashboard toggle for everyone (not Boss View): My Dashboard.** KPIs (worked leads, Qualified and % of worked,
  opportunities created, claimed and working now), leads-by-status bar with "x% of the team's worked leads", 12-month
  trends, and **Suggested actions** from the inbox: no outreach in 5+ days, claimed but still New, unclaimed where you
  are the Project Coordinator, the 3 oldest unclaimed, the 3 strongest prospects, finished this week. Clicking one opens
  it in the inbox. New Apex `getMyDashboard(userId)` (your own, or the "View as" user for admins). Team totals use the
  same `DASHBOARD_LDRS` list as Boss View. Not ported: the canvas "Post Quote replies for you" group (Post Quote data
  only loads on that tab).
- Filters: Lead/Contact · Type · Status row now sits above the Form filter (canvas order).

### Canvas 1791844392-12d4 (2026-10-12)

- **Link safety net, by email:** a form submission with no Lead and no Contact is linked on load when exactly one
  Contact has the same email (Contact__c), or else exactly one unconverted Lead (Lead__c). Several matches, or a
  Contact and an open Lead, are left alone. Tagged `#LinkFixed-email` in Comments__c (the review list shows "linked by
  email to ..."). Production had 7 unlinked submissions with an email in the last 30 days.
- **Unlinked box:** says "A Lead / A Contact / A Lead and a Contact exist with this email address." when one exists
  (via `getLinkSuggestions`, email matches only, unconverted Leads).
- **Clear All** on the fixed-links list: `#FixReviewed` on every submission still listed (new Apex `markFixesReviewed`).

### Production candidate changes (2026-10-12, after sandbox testing)

- **Start date:** `LDR_Prospect_Since` = `2026-09-01T00:00:00-07:00` (Prospects and Post Quote). Production volumes
  since Sep 1: 651 untouched price-range estimates, 1,141 configurator quotes, 427 post-quote reply Tasks (all under
  the caps).
- **3D configurator claims** (Aziz: assume `KBMax_Web_Quote__c.Claimed_By__c` (Lookup User) and `Claimed_Date__c`
  (Date or Date/Time) exist by go-live). A configurator row's record is now the person's latest quote, so Claim,
  Release, Reassign, Claim from, Save, Log a call and Hand-off work on it like an instant estimate. Claimed people
  load into Mine / All tagged Outbound; people with any claimed quote since the start date leave Prospects. The fields
  are read dynamically: **until they exist, the Claim button stays disabled with a note and nothing fails.**
- **Pass is saved as a Task** (Aziz: a first approach): a completed Task on the Lead/Contact, Subject
  `Prospect passed: <reason>`, owner = the LDR, description says which list. `getProspects` leaves out anyone with
  such a Task since the start date; the footer shows how many. Delete the Task to bring someone back. (Task/Event
  can't be used in a SOQL semi-join, so passed Ids are read with a separate Task query, up to 10,000.)
- Configurator quotes are read newest first in a SOQL for loop (batches of 200, up to 20,000) instead of aggregates.

### Sandbox build (prototype 1791823053-a111, 2026-10-12)

**Prospects tab (everyone).** Outbound list of people who did NOT ask for a call, two lists:
- *Instant estimates*: price-range estimates (`Estimate_Amount__c` not Custom) on unconverted Leads with Status New, no
  Project Coordinator and no claim, created on/after `LDR_Prospect_Since`. One row per Lead (newest estimate); repeat
  count and first-estimate date per Lead. Capped at the newest 1,500 (production has 1,944 since Jun 1).
- *3D configurator*: `KBMax_Web_Quote__c` grouped per Lead / Contact (Contact wins when both), quotes since
  `LDR_Prospect_Since`, highest `KBMax_Price__c`, first/latest quote; converted Leads are skipped. Cap 2,000 people
  (production has 1,853 since Jun 1).
- Rules and scoring are the canvas `prospectEval` (in `prospects.js`): hidden = staff/test, junk numbers, opted out
  (`DoNotCall` or `HasOptedOutOfEmail`), worked / coordinated, closed, set-aside reps (by the rep shown), no usable
  phone. Points: Windfall grade, repeat estimates, near a studio, estimate high end; quote size, quotes in 30 days,
  bursts, returned after being worked. Tiers Strong (3+), Worth a look (1-2, top 10 shown), Everything else (collapsed).
- **Claim to call** on estimates uses the existing claim (the estimate's own claim fields); it then shows in Mine/All
  tagged **Outbound** (the queue now also loads claimed price-range estimates since `LDR_Prospect_Since`).
- **3D configurator rows can't be claimed** in this build: `KBMax_Web_Quote__c` has no `Claimed_By__c` /
  `Claimed_Date__c`. The button shows, disabled, with that explanation (Aziz: "assume the fields don't get added").
  Call / Draft email / Open Lead work.
- **Pass is not saved** (Aziz). It hides the person until the page reloads; admins see a note in the list footer.
  Decision for Aqil and Aziz: log a Task on the Lead/Contact ("Prospect passed: reason") or add Passed By / Reason /
  Date fields.
- Configurator detail: renders (main render link; position renders are IDs only, shown as placeholders), latest quote
  configuration, quotes list, file links (`*_File_URL__c`, zip and saved-project links parsed from the link formulas).
- Not ported from the canvas: the list chips for "Drawing package / IFC / Revit file" (would need the latest quote
  per person in the list query), the model name on the list card (shown in the detail).

**Post Quote tab (Aqil and Aziz, as themselves).** Replies to the 6sense post-quote emails since
`LDR_Prospect_Since`: Task Subject contains `[6sense] [Email] [In]`, Who = Contact whose
`sixsense_ce__campaign_name__c` contains "150k", Description without "CASL" (**assumption**: the canvas says internal
agent emails carry a CASL footer; the exact text wasn't available, so any Description containing "CASL" is skipped).
Project = `Contact.Conversica_Informational_Statement_2__c`, Opportunity = the Contact Role opportunity whose
`Project_Name__c` has that name. Filters Mine / No Project Coordinator / All LDRs. **Save writes** Project__c
`Stage__c`, `Reason_Project_Lost__c`, `Lost_to__c`, `Stage_Detail__c` and Opportunity `StageName`, `StageDetail__c` in
user mode (Aziz: editable in sandbox). Reason/Lost to only enable for Project Lost / Competitor; picklist values come
from describe (all active values, not per record type). Production: 1,299 matching Tasks since Jun 1.

**Boss View: Inbox / All Submissions / Dashboard.** All Submissions lists form submissions and Custom estimates in a
date range (presets 7/30/90/365 days or custom; up to 2,000 + 1,000 rows); clicking opens it in the inbox when loaded,
otherwise in Salesforce. Dashboard: Leads by Project Coordinator and Status by `Lead_Funnel_Time_Stamp__c` (this week /
this month / last month), Opportunities created by each LDR, 12-month trends, and inbox numbers from what the inbox
loaded. The LDR list is hard-coded (`DASHBOARD_LDRS`, same 7 names as the canvas).

**Form filter** ("Form: All / Quote / Consultation / ...") on the inbox tabs.

**Link safety net (canvas a111).** When the inbox loads, form submissions with both Lead__c and Contact__c get Lead__c
cleared; ones on a converted Lead with no Contact get Contact__c = ConvertedContactId and Lead__c cleared. Each is
tagged `#LinkFixed` in `Form_Submission__c.Comments__c` (internal comments; the tags are hidden in the inbox). Admins
see "Fixed links on N form submissions" with a review list; × appends `#FixReviewed`. Runs in user mode for whoever
loads the inbox; failures are shown to admins only. Claims that link the Contact now also clear Lead__c.
**This writes data on page load**: check it in the sandbox before production.

**Tab order:** Unclaimed · Mine · Post Quote (admins) · Prospects | Finished · All.

New Apex: `getProspects`, `getConfiguratorDetail`, `getPostQuote`, `savePostQuote`, `fixLinks`, `markFixReviewed`,
`getDashboard`, `getAllSubmissions` (+ tests). No permission set changes. New Custom Label `LDR_Prospect_Since`.

### Fix (2026-10-09): "+1 Estimate" on instant-estimate rows
The row badge counted every instant estimate on the Lead/Contact, including the estimate row itself, so a person whose
only estimate was the one being viewed showed "+1 Estimate". An estimate row now subtracts itself when it is one of the
counted records; form-submission rows are unchanged (they still show the person's estimates). The detail panel's
Related list already excluded the viewed estimate.

### Production candidate (prototype 1791569913-7c73, 2026-10-09)

**Instant estimate filter for production.** `LDR_Estimate_Date_Windows` is now `2026-10-01T00:00:00-07:00`: Custom
estimates created from Oct 1, 2026 (Pacific) onward. The June 15–30 test window is removed. If the label already
exists in the target org, the deploy overwrites its value; check it in Setup → Custom Labels after deploying.

**Eloqua Profiler no longer cut off.** Cause: the existing `Profiler_Lead` / `Profiler_Contact` pages use
`<apex:iframe>` with no height, which Salesforce renders at 600px, inside the inbox's 900px frame. New pages
`LDR_Profiler_Lead` / `LDR_Profiler_Contact` (same Eloqua URL, iframe 896px, no header, email URL-encoded) are now what
the inbox loads. The old pages are untouched (other places may use them). `pageAccesses` for the two new pages were
added to `LDR_Inbox_User` (Visualforce page access only, no field or object entries). If LDRs get "insufficient
privileges" in the Profiler box, assign the pages on the LDR profile instead.

**Rep display routing uses Territory__c (canvas 7c73).** `repRouting.js` rewritten: the Lead/Contact `Territory__c`
decides the split (CT, KS/MO, Upstate NY, PA, SoCal, TX); project type comes from `Type_of_record__c`, then
`Project_Application_Industry__c`, then the submission's application, then Homeowner. SoCal residential uses the
Roozbeh ZIP list; SoCal commercial uses the county ZIP lists. Territory blank → the owner's split from location, shown
amber. Bryan Bush displays as Cameron Wiese. The queue query now reads `Lead__r.Territory__c`, `Contact__r.Territory__c`,
`Lead__r.Type_of_record__c`, `Lead__r.Project_Application_Industry__c` (all confirmed in production). Many records have
a blank Territory__c, so expect amber "from owner + location" results on those.

**Link to existing Lead/Contact in the inbox.** The button on unlinked submissions now opens a window instead of the
record edit page: up to 4 suggested matches (Contacts, then unconverted Leads, same email or same name) plus Lead and
Contact record pickers (Lead picker hides converted Leads). Link saves `Lead__c` / `Contact__c` on the submission or
estimate in user mode (`linkSubmission`), same access path as Create Lead, then reloads. New Apex:
`getLinkSuggestions(submissionId, name)`, `linkSubmission(submissionId, leadId, contactId)`; test
`linkToExistingSuggestsAndLinks`.

### Fix (2026-10-08): no instant estimates showing

The queue's instant-estimate query selected `Lead__r.IsConverted` and `Lead__r.ConvertedDate` twice (once from the
shared field list, once added for converted Leads). Salesforce rejects a query that selects a field twice, the error was
caught silently, and the inbox showed **no estimates at all**, old or new. This has been the case since estimates were
added (c90e). The select list is now de-duplicated (`estimateSelectList`), a test checks for duplicates, and if the
estimate query ever fails again, admins see the Salesforce error in a red banner at the top of the inbox instead of an
empty list.

### Instant estimate claim fields (2026-10-08)

`Website_Instant_Estimate__c.Claimed_By__c` (Lookup User) and `Claimed_Date__c` (**Date**) exist in production. The
inbox detects them; no code change was needed to turn estimates on.

**Permission set reverted.** The previous zip added Instant Estimate object/field permissions (and made
Form_Submission__c.Lead__c / Contact__c editable) to `LDR_Inbox_User`; that broke the sandbox deploy. LDRs already have
this access through their profile, so the permission set is back to exactly what deployed before (no
Website_Instant_Estimate__c entries; Form Submission Lead/Contact read-only in the set). The likely cause: the set named
estimate fields that don't exist in the sandbox (e.g. the newer UTM_Term__c / UTM_Content__c, or the claim fields).
Access to those fields now comes only from the LDRs' profile; if a profile lacks edit on Form_Submission__c.Lead__c /
Contact__c or the estimate claim fields, Create Lead / converted-Lead claims / estimate claims will error for that user.

The estimate queries now name only fields that exist in the org (`presentFields`), so a sandbox missing a newer
estimate field still shows estimates instead of silently showing none.

### Showrooms: 17 locations (2026-10-08)

Added Montréal (QC), Toronto (ON) and San Pedro Garza García (N.L., Mexico) to `SHOWROOMS` in `ldrInbox.js`, so the
list matches the 17 locations on nanawall.com/locations. City-centre coordinates, 50-mile radius, each with its
nanawall.com/locations link. The flag still needs the Lead's Latitude/Longitude or the Contact's Mailing
Latitude/Longitude; it never appears when those are blank. Showrooms that were in Salesforce's Showroom__c object but
aren't on the website (e.g. Orlando, Charlotte, Bristol PA, Vista CA) are not included.

### New in this release (prototype 1791477589-9853 + estimate date windows, 2026-10-08)

**Instant estimate date filter (Aziz, for sandbox testing).** Custom estimates created **June 15–30, 2026 OR from
Oct 5, 2026 onward** (Pacific time). Stored in the new Custom Label **`LDR_Estimate_Date_Windows`** (replaces
`LDR_Estimate_Cutoff`; delete that old label if it was deployed):
`2026-06-15T00:00:00-07:00..2026-07-01T00:00:00-07:00;2026-10-05T00:00:00-07:00`
Format: windows separated by `;`, each `start..end` (end exclusive) or just `start` (open-ended). Edit it in Setup →
Custom Labels, no deploy. (Superseded 2026-10-09: now `2026-10-01T00:00:00-07:00`.)
The 30-day lookback no longer applies to estimates; only the windows do. Production has 181 Custom estimates in these
windows (the sandbox count depends on its refresh date). The estimate claim fields are still required (see c90e).

**Converted Leads are worked as their Contact.** A submission whose Lead was converted (Contact__c blank) now appears
as the Contact the Lead became (`Lead__r.ConvertedContactId`); one linked to both a Lead and a Contact is shown as the
Contact. Production had 71 such unclaimed submissions in the last 30 days that the inbox used to leave out. Claiming
(or assign / claim from / reassign) **writes `Contact__c`** on the submission (and on sibling submissions still pointing
at the converted Lead). Claim siblings match the Contact or the converted Lead.
- **Finished:** claimed by you and either the Contact was converted in the last 7 days (its Lead Funnel Status starts
  blank), or not New/Working with the later of status change and claim in the last 7 days. Mine leaves out Contacts
  converted in the last 7 days. (Canvas rule; a fresh claim on a Contact converted within 7 days goes straight to Finished.)

**Convert Lead in a window over the inbox.** Hand-off on a Lead row writes Status/Outcome, then runs the
**Convert Lead - LDR flow inside the inbox** (`lightning-flow`, input `recordId`), instead of a new tab. When the flow
finishes the queue reloads and the row shows as the Contact. A "Doesn't load?" link opens the flow in a tab.

**Draft email:** shows the details as a table plus a link to the nearest design studio (nanawall.com/locations page).
"Copy details & open mail app" copies formatted HTML + plain text (4 blank lines on top for your message) and opens
the mail app with To / Bcc / Subject; "Copy details only"; "Open mail app with plain text instead" (old behaviour).
Copy uses the Clipboard API, else a hidden in-component copy with `execCommand('copy')`; **not tested in Lightning**.

**FETR card (Contact rows):** the team's FETR layout (Contact, Email, Phone, Type, Account, Project, Split Territory,
Inquiry, Plans, KBMax / Instant Estimator) with absolute links, and "Copy FETR" (formatted for Outlook). Project comes
from the first open opportunity's `Project_Name__c`.

**Follow Up Information card** (right column, above Activity): 6Sense Option moved here with its own Cancel / Save
(Apex `saveSixSense`), plus CE Campaign Name, CE Lead/Contact Status, Outreach Current Active Sequence Name, Outreach
Finished Sequences (all read dynamically).

**Other:** instant-estimate tag is just "Instant Estimate"; estimate facts = Inquiry type, Customer type, Instant
Estimate Name (link), Frame type, Opening Width, Opening Height, Construction Classification, Application, Estimate;
Lunch & Learn facts reordered (Courses spans two columns; Reporting Matched Account on Leads only); showrooms carry
their nanawall.com/locations link (shown on the showroom line and in the draft email).

### New in this release (prototype 1791413716-c90e, 2026-10-07)

**Instant estimates in the queue (the big change)**
- `Website_Instant_Estimate__c` records are queue items alongside form submissions, **only when
  `Estimate_Amount__c = 'Custom'`** (the estimator couldn't give a range) **and created on/after the cutoff** in Custom
  Label **`LDR_Estimate_Cutoff`** (default `2026-10-01T00:00:00-07:00`, Oct 1 Pacific). Change the label in Setup →
  Custom Labels to move it, no deployment. Plan: an earlier date in the sandbox if it has few estimates; Oct 1 in
  production. Production had 68 Custom estimates from Oct 1–7 (about 10 a day), against ~176 non-Representative forms.
- Each estimate is claimed with **its own `Claimed_By__c` / `Claimed_Date__c` on `Website_Instant_Estimate__c`**.
  **Those fields don't exist in production and aren't in this package** (Aziz: hold until confirmed in the sandbox).
  Everything about estimates is dynamic: without the fields the code still deploys, estimates simply don't appear,
  and admins see a notice saying so. Create them (Claimed_By__c = Lookup(User), Claimed_Date__c = Date/Time) and the
  estimates show up on the next refresh. LDRs need read on the object and edit on both fields.
- Status, coordinator, timestamp, address, history and activity come from the estimate's Lead / Contact, exactly as
  for forms. Claim / release / reassign / claim from / save / hand-off / log call / Create Lead all accept an estimate
  Id (Apex `Item` wrapper); Create Lead sets `Lead__c` on the estimate.
- Claiming a form also claims that person's unclaimed Custom estimates, and the other way round.
- Detail: tag "Instant Estimate · Custom" (orange); facts = Inquiry type, Customer type, Estimate (Custom, no
  automatic range), Application, Frame type, Opening (W × H), Project Construction Classification, Gate variant,
  Estimate #; "Open Instant Estimate"; draft email fills Project Type / Product Type / Frame from the estimate.
  "Other submissions from this person" lists estimates too; Related submissions excludes the estimate being viewed.

**Other changes**
- **Grouping by person:** a person's submissions (same Lead, same Contact, or same email when unlinked) are one queue
  entry: newest on top with "▸ N submissions · Also: …"; selecting opens the group with the others indented; click
  the header again to collapse.
- **Inquiry Type tag colours** (Outlook flags): Quote green, Consultation yellow, Instant/Website Estimate orange,
  Contact Us blue, Lunch & Learn lavender, Design Assistance teal, Representative grey. Homeowner colour now teal.
- **"Team" tab is now "All"** and includes your own claims; row claim labels show the full name (no "You").
- **Boss View** (admins, in "View as"): you as yourself plus edit unclaimed records without claiming, with the
  canvas banner text. Aziz can always edit unclaimed records; Aqil only in Boss View. Apex still allows both admins
  (the restriction is in the UI).
- **6Sense Option** (`X6Sense_Option__c`, Lead or Contact) in the LDR fields; read/written dynamically.
- **Lunch & Learn Request** facts: Inquiry type, Customer type, Company (Account link on Contacts), Courses
  (`Form_Submission__c.Courses__c`, dynamic), Zip, Reporting Matched Account (link).
- **Related submissions:** newest first, 5 shown, "Load more (n)".
- Not ported: Windfall card on Contacts (no Contact Windfall fields confirmed).

### New in this release (prototype 1791332457-946d + "LWC notes for the code thread", 2026-10-07)

**Sandbox bugs from Aqil's report**
- **`allFields` error (lightning:lookup):** the Project Coordinator is no longer a lookup inside
  `lightning-record-edit-form`. It is a `lightning-record-picker` (active Users) plus a date input for Lead Funnel
  Timestamp, both fed from the queue data and saved through Apex as before. No code calls `reset()` on inputs any more.
  Cause not confirmed; this removes the component that threw.
- **"Unsaved changes" stuck after Cancel:** there is no stored dirty flag now. It is computed by comparing the draft
  with the last-saved values (Project Details values captured in the form's `onload`).
- **Header order:** "Submitted · email · phone" is above the Account line; the rep rule line stays under Account/Rep.
- **Buttons:** Cancel | Save (Cancel left), "Unsaved changes" to their left, Hand-off on its own full-width row.
- **Hand-off blank page:** the Convert Lead flow opens **synchronously in the click**, before any server call, with
  the **relative** URL `/lightning/flow/Convert_Lead?flow__recordId=<Lead Id>` (console: workspace tab; standard
  app: `standard__webPage` navigation). Status/Outcome are written after. Disabled while there are unsaved changes.
  A "Didn't open? Open the Convert Lead flow." link sits under the button (Lead rows only).
- **Missing spaces** before bold names: `&nbsp;` used in every "text <strong>name</strong>" banner.
- **Open Lead / Contact / Form Submission / Activity:** console → workspace tab; standard app → same browser tab
  (`NavigationMixin.Navigate`), no more new browser tabs.
- **Eloqua Profiler iframe:** fixed 900px height.
- No literal `\uXXXX` escapes in the template (checked).
- **Not changed:** Project Details' Project Site Country order comes from Setup (US/Canada/Mexico first needs an
  admin to reorder the picklist values). The new Create Lead form does list US, Canada, Mexico first.

**Showrooms:** the inbox no longer reads `Showroom__c` (dated). It uses the 14 locations confirmed from
nanawall.com/locations (Corte Madera, Gardena, Portland, Kirkland, Salt Lake City, Englewood, Long Island City,
Chicago, Strongsville, Carmel, Wixom, Omaha, Dallas, Tempe), hard-coded in `ldrInbox.js` (`SHOWROOMS`). Distance is
straight-line from the Lead/Contact's geocoded address to the showroom **city centre** (50 mi); only Corte Madera
(94925) and Gardena (90248) have a confirmed zip. No Vista or Toronto. Apex `activeShowrooms()` was removed.

**Queue**
- Tabs: **Unclaimed · Mine · Finished** left, **Team** right. Customer-type chips removed (row border colour stays).
- **Finished:** claimed by you, status no longer New/Working (or Lead converted) and changed in the last 7 days.
  Time of change = latest LeadHistory `Status` / ContactHistory `Lead_Funnel_Status__c` row; converted Leads use
  ConvertedDate (date only). Apex now also loads converted Leads you claimed that converted in the last 7 days.
- Mine/Team: New/Working **and** not converted.
- Filters: Project Coordinator (Unclaimed; "No Project Coordinator", "(you)"), Team LDR (Team), Record
  (Lead / Contact / No record yet), Type (Lead.Type__c / Contact.LeadType__c), Status (incl. "(blank)"). Tab switch
  resets Status/Type/Coordinator filters; Record filter and search stay.
- Sort: "Date ↑/↓" button, **newest first by default**. "Response target" caption removed.
- Row tags: "⚠ Lead: <full name>" / "⚠ Contact: <full name>" bottom-right on unclaimed rows (your own name too);
  red "⏱ No outreach Nd" in Mine; blue "Open opp · <rep>" / "N open opps" on Contacts; KBMax/estimate counts now
  include Contact-linked quotes.

**Claim / release / reassign**
- **Claim also claims the person's other unclaimed submissions** (same Lead, same Contact, or same email when nothing
  is linked; Representative requests skipped). Toast says how many.
- **Reassign** (Mine, next to "Claimed by you"): only when someone else was Project Coordinator before your claim.
  Confirm dialog; Yes → coordinator back to them, Claimed_By__c / Claimed_Date__c = them, Lead Funnel Timestamp back
  to its pre-claim value. **Uses field history** (Aziz, 2026-10-07: no new fields). Limits: Contact Lead Funnel
  Timestamp isn't history-tracked, so on Contacts it is left as is; if history is missing, Reassign doesn't show.
- **Claim from a teammate** (Team): "Claim lead/contact" next to "Claimed by <name>", confirm dialog; coordinator =
  you, timestamp = today, Claimed_By__c = you. Fails safely (CONFLICT) if it changed hands meanwhile.
- Release unchanged: restores coordinator + timestamp from history; Status **Working → New only** (the notes say
  "Status → New"; not changed, see open questions).

**No-outreach flag (Mine):** red row tag + amber dismissable banner when more than **5 days** (`NO_OUTREACH_DAYS`)
since the later of: claim (Claimed_Date__c), set to Working (status history), and the claimer's own last Task/Event
on the Lead/Contact (owner **or** creator, so Outreach-synced activity counts). New/Working only.

**Contacts:** open-opportunity caption on the Open opportunities card ("Stays in your queue…"); rows are **not**
filtered or re-routed (decision 2026-10-06). Related quotes/estimates query `Contact__c` on Contact rows (dynamic
SOQL, so it compiles if that lookup is missing in a sandbox).

**Create Lead is built into the inbox** (left column, above "What they submitted"), replacing Salesforce's New Lead
page. Fields: First/Last Name*, Company* (blank → full name), Email, Phone, Lead Status* (New), Customer Type*
(Lead.Type__c values), Country* (CountryCode, US/CA/MX first), Street, City, State (StateCode, follows Country),
Zip*. Picklists come from `getPicklistValuesByRecordType`. Apex `createLeadForSubmission` inserts in USER_MODE
(validation + duplicate rules apply; a duplicate-rule block says to use "Link to existing"), **sets
Form_Submission__c.Lead__c**, and if claimed sets Project Coordinator = claimer + timestamp = today. City/State are
not looked up from the zip (needs a postal-code service).

**Activity History** moved to the right column (LDR fields → Open opportunities → Activity → History). Each item
has a `lightning-icon` by Task.TaskSubtype (Call / Email / Task) or Event; Events are now included. Click opens an
in-page preview with Task/Event Description and "Open the full record in Salesforce". **Related submissions** moved
directly under "Other submissions from this person".

**Campaigns:** "Cold Meta campaign" callout/tag (utm_campaign contains `pro-conversions` and utm_source = `meta`).

**Admins (Aqil, Aziz; user Ids hard-coded in Apex `adminUserIds`):** "View as" switcher in the header (changes whose
Mine/Finished/Team/no-outreach you see; every read/write still runs as you) and can edit an **unclaimed** row's LDR
fields without claiming (own Cancel/Save; Hand-off still needs a claim). A Custom Permission would be cleaner later.

**Not built (decisions pending):** Contact Hand-off → new Project/Opportunity flow (and whether it sends an email);
zip → city/state lookup; persisting alert dismissals; "Assigned by" still needs field history on Claimed_By__c.

### Fix (2026-10-06): "Cannot read properties of undefined (reading 'allFields')" in lightning:lookup

Sandbox error from the Project Coordinator lookup (the only lookup field in the component). Not reproduced here;
two likely triggers in the code were changed:
- **Cancel** called `reset()` on every LDR input field, including the lookup. It now rebuilds the edit forms
  (new key) instead of calling `reset()`.
- The coordinator, Quick edit and Project Details forms stayed mounted while `record-id` / `object-api-name`
  switched between rows (Lead ↔ Contact). Each form is now keyed per submission + record, so switching rows
  creates a fresh form.
If the error still appears, note the exact click that triggers it (row switch, Claim, Cancel, Populate, Save).

### New in this release (prototype 1791241808-c0f3, 2026-10-05)

- **Dismissable alerts (Mine tab only).** Each of the 9 banners on the selected submission (conflict, converted
  after submission, coordinator warning, took over, assigned, not yet linked, stale status, decided status, needs
  status) has an × button. A dismissal is **in-memory only**: it lasts until you pick another row or switch tab,
  is not saved to Salesforce, and other users still see the alert.
- **Open opportunities** moved to the right column, above History.
- **"What they submitted"** now shows **Project name** (the form's `Project_Name__c`; for Homeowner, "<Last name>
  Residence") and **Project zip** (Homeowner: their own zip; everyone else: `Project_Postal_Code__c`).
- **Save / Cancel.** "Clear changes" is gone. Next to Save there is now **Cancel** (resets every LDR field to the
  last saved value) and an "Unsaved changes" label while edits are pending. Hand-off sits on its own row.
- **Populate Project now works for every customer type**, not just Homeowner (Lead rows claimed by you only):
  - Homeowner: unchanged defaults, plus Project Site address copied from the Lead (Country, Street, City, State
    mapped to the picklist's full name, Zip from Project zip → Lead PostalCode → form zip).
  - Everyone else: Project name from the form; Type = Residential only if the form's Application values are just
    Residential/Other and include Residential, otherwise **Commercial**; for Commercial, Industry is a loose text
    match of the Application values against the Industry picklist (e.g. "Restaurants" → Restaurant,
    "Educational" → Education); Country from Lead.Country; Zip from Project zip.
  - **Rule to confirm:** room-type answers like Patio, Living Room or Pool House count as Commercial under this
    rule (it is the prototype's rule as written). Nothing is saved until you press Save.
- Apex now also selects Lead Street, City, State, PostalCode and Country for the above.

### "Check before hand-off" trimmed (2026-10-02)

- Removed the **UTM check** ("UTM campaign was on the form but did not reach the Lead") and the **Project
  Application check** ("Form said X, but Project Application is blank on the Lead"). Both values are
  submission-specific and were never expected to reach the Lead, so the mismatch wasn't a real problem.
  There was only one UTM comparison (campaign); no other UTM fields were checked.
- The list is built in `lwc/ldrInbox/ldrInbox.js` (the `active` getter), not in Apex. Apex no longer selects
  `Lead__r.UTM_Campign__c` / `Lead__r.Project_Application__c`, which only existed for these checks.
  (`Lead.Project_Application__c` is still edited in Project Details through the record form.)
- Still in the list: submission linked to a different person than the form, and form customer type ≠ Lead type.

### New in this release (prototype 1790985648-e091, 2026-10-02)

- **Claim now also resets Qualified / Disqualified to New** (Apex `CLAIM_RESETS_STATUS` and the LWC). Reason
  from the prototype: Mine/Team only show New/Working, so claiming a Qualified lead made it vanish from every tab.
  Unclaimed submissions in those statuses show a red warning before you claim ("By claiming it, you will reset the
  status to New…"), and the claim message says how to move it back. **This replaces the earlier rule that
  Qualified/Disqualified were never touched.** New Apex test `claimResetsQualifiedStatus`.
- Image attachments show as larger tiles (200×148); PDFs and other files stay 100×74.
- **Project Details → "Clear changes"** appears once a Project Details field is edited (or Populate Project is
  used). It drops the unsaved edits and resets the inputs to what Salesforce has. Nothing is saved.
- **Quick edit**: First Name, Last Name, Phone, and Company (Company on Lead rows only; Contacts don't have a
  Company field). Email was removed from Quick edit, as in the prototype.
- Hand-off button reads "Convert/Hand-Off to X" (Lead) or "Hand-Off to X (no Lead to convert)" (Contact).

### New in this release (prototype 1790982372-7622, 2026-10-02)

- **Rep display routing** (`lwc/ldrInbox/repRouting.js`): the header's "Rep:" can now show a different name from
  the Salesforce owner. Order: owner alias (Stuart Ferrell → Julie Barnes, Nick Wnenk → Gro Gabor) → Southern
  California residential (zip list → Roozbeh Ahdoot, else Joe Rapolla) / commercial (Shawn Mahoney + partner by zip
  prefix) → split-territory states (CT, MO, KS, NY, PA, TX) → owner (canonical spelling). A line under it says which
  rule applied. Hand off button and email use the displayed name. **Display only**: it never changes ownership.
  - The rules were copied into the prototype from display-rules.md / salesforce-routing-SKILL.md. Their
    Residential/Commercial reading of the split territories is **unconfirmed**, so those results are shown in amber
    as "verify". (The prototype showed them as confirmed; I flagged them because the source itself flags them.)
  - Only Homeowner counts as residential; nothing reliably says "commercial". So **Contractor / Architect /
    Business Owner submissions in Southern California or a split-territory state show "Not determinable"** (red),
    as in the prototype. Expect this often for Texas and SoCal.
  - State comes from the Lead's State / Contact's Mailing State (name or 2-letter code); zip from the record or the
    form. "Upstate" New York and SoCal sub-territories are not truly checked (zip-prefix approximations).
- **Image preview paging**: ‹ › buttons and arrow keys move through all of the submission's images ("2 of 5");
  Esc closes.
- **Team tab filter** by LDR ("Filter: All LDRs" or one claimer).
- **Quick edit** adds First Name and Last Name (Lead/Contact standard fields, saved through Lightning Data Service).
- (Superseded 2026-10-07: the inbox now uses the 14-location list, not Showroom__c.) Not changed at the time: the prototype's new showroom list (14 locations from nanawall.com, without Vista or Toronto). The
  inbox kept reading the org's **Showroom__c** records, which still mark Vista (San Diego Area Design Center) and the
  Toronto-area studio (Mississauga) as Active. If those are closed, untick Active on those records and the
  inbox follows.

### New in this release (prototype 1790973652-0d1e, 2026-10-02)

- **Image lightbox:** click an image attachment to see it larger (click outside or ✕ to close).
- **Download icon** on each attachment. Browsers ignore the `download` attribute for files on another site, so for
  www.nanawall.com uploads it usually just opens the file in a new tab. That depends on how the upload server
  serves the file; not something the inbox controls.
- **Quick edit** (header): Phone and Email on the linked Lead/Contact, saved through Salesforce's own record form
  (`lightning-record-edit-form`), so validation and permissions apply. Real save, not simulated.
- **Nearby showroom** line under the comments: nearest **active `Showroom__c`** record within 50 miles
  (straight-line), using the Lead's `Latitude/Longitude` or the Contact's `MailingLatitude/MailingLongitude`
  (Salesforce geocodes these; all 25 recent submissions checked had them). The prototype used 4 hand-entered
  showrooms and a zip table; production has 26 active showrooms with coordinates, so the inbox reads those.
  Showrooms with "Show Address" unticked show city/state only. Showroom query is dynamic SOQL, so the class
  compiles even if the sandbox lacks the object.
- **Unlinked submissions:** placeholder clock icon in the header, plus **Link to existing Lead/Contact**, which opens the
  Form Submission in edit mode so the LDR can set its Lead/Contact field, then Refresh.
- **Create Lead** now pre-fills Project Coordinator (the claimer) and Lead Funnel Timestamp (today) when the
  submission was already claimed, so the new Lead isn't left without an owner. (Still doesn't set Lead__c.)
- Comments text is larger. Card order: What they submitted → Attachments → Other submissions → Open
  opportunities → Windfall → Rep flag → Activity → Matched account → Related → Source & tracking → Profiler.

### New in this release (prototype 1790971936-e17c, 2026-10-02)

- **Submissions with no Lead or Contact yet** now appear in the queue (tag "Not linked yet") with a blue banner:
  - **Refresh** reloads the queue to pick up a newly linked record.
  - **Create Lead** opens Salesforce's own New Lead form prefilled from the submission (name, company, email,
    phone, zip, country), so the org's layout, validation and duplicate rules apply. It does **not** set `Lead__c`
    on the submission. Either Eloqua/Salesforce links it, or someone sets the Lead field on the Form Submission;
    then Refresh.
  - On these rows you can Claim / Release (the submission only). Fields, Save, Hand off and Log a call are hidden
    (there's no record to write to); Apex refuses them too. They count as "still being worked" for Mine/Team.
  - Production check 2026-10-02: 1 unlinked submission in the last 30 days, so this is rare.
- **"Assigned by" flag and banner** when someone else assigned the submission to you (Assign to coordinator).
  This reads `Form_Submission__c` field history (dynamic SOQL). **Form Submission has no field history in
  production today**, so the flag won't appear until an admin turns on Track Field History for Form Submission and
  ticks `Claimed_By__c`. No code change needed after that.
- Other submissions from this person: shows the project name (or the start of the comments) and how far apart the
  two submissions were ("15 min apart").
- Activity History items are clickable and open the Task.
- Open opportunities (Contact rows): stage colour pill and coloured left edge; record names in green.
- Attachments card moved up, right under "What they submitted". Eloqua Profiler is taller (630px).
- Not ported: the prototype's "Signed in as" person switcher. It's a demo for viewing as another LDR; the real
  inbox always uses the logged-in user.

### New in this release (prototype 1790959404-cce2, 2026-10-02)

- Sort is a dropdown ("Sort: Oldest first" / "Sort: Newest first") instead of a toggle button.
- Source & tracking shows a note when the UTM Source/Medium means Eloqua should have added the person as a
  Campaign Member (Paid Social, 3rd Party Banner or Search). The inbox doesn't look the Campaign up. The note only
  says one should exist, as a check that the tracking reached Salesforce.
- Rep requests: only Inquiry_Type__c = "Representative" is excluded / flagged (Apex and LWC). "Rep Contact" was
  dropped: it's a Type__c picklist value, and Type__c is blank on real records.
- Project Details collapses again whenever you select a different submission.

### Deploy fix (2026-10-02): Contact.Status_Reason__c missing in the sandbox

The sandbox deploy failed with 6 errors, all from one cause: `Contact.Status_Reason__c` exists in production but
not in the sandbox. (The test-class error and the two LWC "Unable to find Apex action method" errors were knock-on
failures because the controller didn't compile.)

- Apex no longer references `Contact.Status_Reason__c` directly. It checks at runtime whether the field exists and
  reads/writes it dynamically (`contactHasStatusReason()`, `contactStatusReasonsFor()`), so the class compiles in
  both orgs.
- When the field is missing, Contact rows hide Status Reason and don't require it for Wrong profile. Lead rows are
  unchanged.
- The permission set no longer grants `Contact.Status_Reason__c` (the deploy rejects unknown fields). **Before
  production**, either add that `<fieldPermissions>` block back (production has the field) or make sure LDRs'
  profile already has edit access to it; otherwise the inbox can't set it on Contacts there.
- Alternative: create `Status_Reason__c` on Contact in the sandbox to match production, then re-add the permset entry.

### New in this release (prototype 1790956220-aed4, 2026-10-02)

- Prototype changes: queue tag reads "On contact: X" for Contact rows; coordinator warning says "you'll see a
  reminder to connect with them; they aren't notified"; "Claim this contact/lead to edit its fields"; left column
  reordered to What they submitted → Open opportunities → Windfall → Attachments → Other submissions from this
  person → Representative flag → Activity History → Matched account → Related submissions → Source & tracking →
  Eloqua Profiler.
- Fixes from a lint/compile pass (no org compile available here):
  - ESLint (`@salesforce/eslint-config-lwc/recommended`, what VS Code uses) reported 3 errors in `ldrInbox.js`: two
    unused helpers (`netWorth`, `USD_SHORT`) and an ambiguous arrow function. All fixed; ESLint is now clean.
  - Apex: `HistoryRow` inner-class members made public (they're read by the outer class).
  - Added the standard project files the Salesforce VS Code extensions expect: `.forceignore`, `.gitignore`,
    `force-app/main/default/lwc/jsconfig.json` and `lwc/.eslintrc.json` (`.forceignore` keeps the last two out of deploys).

### If VS Code still shows red marks

- **Apex files:** red underlines on `Form_Submission__c.Claimed_By__c`, `Contact.Lead_Funnel_Status__c` and similar
  usually mean VS Code's local copy of the org's objects is stale, not that the code is wrong. Run
  **SFDX: Refresh SObject Definitions** (Command Palette) against the sandbox, then reopen the files.
- **LWC JS:** red underlines on `@salesforce/apex/...` imports go away once `.sfdx/typings` exists. Run any
  `SFDX:` command against the org once, or **SFDX: Refresh SObject Definitions**.
- **Real deploy errors** show in the deploy output (`sf project deploy start ...`) or in the Output > Salesforce CLI
  panel. Send that text and they can be fixed one by one.

### Previous release (prototype 1790900199-c34a)

- **Contact-linked submissions now work like Lead ones**, using the Contact's own fields:
  Project Coordinator, Lead Funnel Timestamp, **Lead Funnel Status** (instead of Lead.Status), Status Reason and
  Lead Funnel Outcome (Contact picklist values). Claim/Release/Save/Hand off all write to the Contact.
  Claim sets a blank Contact Lead Funnel Status to New. Hand off sets Qualified / Hand-off to Rep and does **not**
  open the convert flow (there is no Lead). Project Details, Windfall and Matched account are hidden for Contacts.
- **Contact History** card (ContactHistory) replaces Lead History on Contact rows; Eloqua profiler uses the org's
  `Profiler_Contact` page. Header shows the Contact's Account as a link. "Claim contact" button label.
- **Open opportunities** card on Contact rows: open Opportunities the Contact has a Contact Role on
  (OpportunityContactRole, IsClosed = false) with stage, record type, owner, amount, created and close date.
- **Converted after submission** banner (red) when the Lead was converted into this Contact after the form came in.
  Conversion time = Contact CreatedDate when it matches Lead.ConvertedDate (±1 day), else midnight of ConvertedDate.
  On those rows **Lead Funnel Status can be saved without claiming** ("Save status", new Apex
  `saveStatusWithoutClaim`, which re-checks the conversion server-side and refuses if another LDR holds the claim).
- **Tab rules changed:** Mine and Team now show a claimed submission only while its status (Lead.Status or Contact
  Lead Funnel Status) is New or Working. Anything else (Qualified, Nurture, Unreachable, Wrong profile, a blank
  Contact status…) takes it off. Unclaimed hides converted-after rows once their status is something other than
  blank/New/Working.
- "Questions or comments" always shows (blank when empty).
- Permission set: edit access to the five Contact fields above, page access to `Profiler_Contact`.
- **Release on a Contact** restores Project Coordinator from Contact field history, but leaves Lead Funnel Timestamp as
  is: `Contact.Lead_Funnel_Time_Stamp__c` has no field history in production (checked 2026-10-01). Turning on history
  for that field makes release restore it with no code change.
- Contact edit access comes from the LDRs' profile (the permission set grants field access only, like Lead). If an LDR
  can read but not edit Contacts, Claim on a Contact row fails with a clear error.

### Previous release (prototype 1790893810-92be)

- **Saving indicator** on the LDR fields card ("Saving Project Coordinator and Lead Funnel Timestamp…") while Claim or
  Release runs. Claim/Release now also tell Lightning Data Service the Lead changed and reload Lead History, so the
  Coordinator and Funnel Timestamp fields show the new values right away (previously they could show the old values
  until you reselected the row).
- "Rep Contact" is matched case-insensitively alongside "Representative" in the person / rep-flag cards (same rule as the queue).
- Campaign card shows the campaign label above the title; PDF tiles say "Click to open"; hint line under attachments;
  Project Details header uses the prototype's larger arrow and title; took-over banner wording matches the prototype.
- Not taken from the prototype: links opening in a shared named browser tab (`nanawall_sf`) — in the console app,
  records open as workspace tabs instead. The "you'll both get a reminder" wording — no reminder is sent, so the banner
  says so. Release setting Status to New in every case — the inbox only resets Working → New, so a Qualified or
  Nurture status the LDR set isn't wiped by a release.

### Previous release (prototype 1790891907-83a2)

- **Contact-linked submissions are now in the queue** (Lead__c blank, Contact__c set: the person already exists as a
  Contact). Header shows a Contact icon and an "Existing Contact" tag; the record button opens the Contact. Claim,
  Release, Log a call (Task on the Contact) and Draft email work. The Lead field form, Save and Hand off are hidden,
  and Apex refuses Lead writes for these rows.
- **Claim now takes over the Project Coordinator**: sets `Lead.Project_Coordinator__c` to me and
  `Lead_Funnel_Time_Stamp__c` to today, even if another coordinator was set (replaces "only if blank" below).
  Status New → Working is no longer done on claim; stale statuses still reset to New.
  A banner on claimed rows says "You took this over from X"; **no notification is sent to X** (would need a flow).
- **Release restores** the previous coordinator and funnel timestamp from Lead field history when the claim changed them.
  If history has nothing (history off, or Apex tests), it clears the coordinator if it's me and the timestamp if it's today.
- **Campaign callouts**: competitor search, branded search and Windfall cold campaign (from UTM campaign) show as a
  tag on the queue row and a coloured card in Source & tracking; UTM content shows as "Ad / content".
- **Attachment thumbnails**: images show as 100×74 previews, PDFs as a PDF tile, everything else as before. Requires the
  CSP Trusted Site in this package; without it, images show as broken icons (the link still works). HEIC isn't previewed.
- **Layout**: Lead History moved to the right column under the fields card. "Pre-Conversion Details" is now a collapsible
  **Project Details** section (collapsed by default) in the order Populate, Project Name, Type, Industry, Application,
  Country, Street, City / State / Zip.
- **Removed from the UI**: LDR Notes and LDR Project Name inputs (the Apex no longer writes them from the inbox).
- **Hand off** opens the Convert Lead - LDR flow in a new browser tab (not a sized pop-up).
- Permission set description shortened to 166 characters (was 283; deploy failed over 255).

### Earlier behaviour (still applies unless overridden above)

- **Queue**: Form Submissions with a Lead that is not converted, created in the last 30 days
  (configurable), plus anything claimed by the current user regardless of age. Max 500 rows.
- **Tabs**: Unclaimed (no `Claimed_By__c`) · Mine (claimed by me, Status is not Nurture or Wrong profile) ·
  Team (claimed by someone else). Nurture and Wrong profile are exit statuses: once saved, the lead leaves Mine.
- **Claim** takes ownership. If the Lead is in a stale status (Nurture, Wrong profile, Unreachable, Bounced) it resets
  Status to New (the new submission is a re-engagement signal). Qualified / Disqualified are never touched.
- **Draft email** shows a preview (To, Bcc ldr@nanawall.com, subject "NanaWall | <project or inquiry>", plain-text
  summary of what the customer submitted), then "Open in mail app" opens a mailto: draft. Nothing is logged in Salesforce.
- **Lead History** (LeadHistory, geocode/Data.com Clean noise and ID rows hidden, only fields the user can read) and
  **Activity History** (Tasks on the Lead; Website Visit / Subscribed / Email Opened hidden) cards.
- **Pre-Conversion Details** (Lead Project Name, Project Type, Application Industry, Application, Site Street/City/Zip/Country)
  use Salesforce's own field inputs, so dependent picklists behave as on the Lead page; they save with Save / Hand off.
  Lead Project Name pre-fills from the form's Project Name when blank; LDR Project Name defaults to Project Name.
- **Hand off** saves, sets Qualified / Hand-off to Rep, then opens the **Convert Lead - LDR** screen flow
  (`/lightning/flow/Convert_Lead?flow__recordId=<Lead>`) in a sized pop-up window (760×840). The window is opened on
  click and pointed at the flow after the save, so pop-up blockers usually allow it; if blocked, console tab fallback.
- **Eloqua Profiler** card embeds the org's existing `Profiler_Lead` Visualforce page (which iframes Eloqua's profiler
  for the Lead's email). Needs an active Eloqua session in the browser; permission set grants page access.
- **Search & sort**: search by name or email; toggle oldest/newest first (customer-type priority sort removed).
- **Matched account card**: past opportunities/orders (Lead fields), Account billing city/state and website, and the
  3 most recent Opportunities (stage, amount, created, close date) with "+N more → view in Salesforce".
- **Related submissions**: KBMax web quotes (price, status, $0-price warning) and instant estimates (range) on the Lead.
- **Other submissions from this person**: every other Form Submission with the same email, with claim status;
  click jumps to it in the queue (or opens the record if it isn't loaded).
- **Representative flag**: if the same email also sent a Representative request (excluded from the queue), a banner
  shows the gap; more than 1 day apart is flagged as "likely couldn't reach the rep".
- **Lead/Activity history** show 5 entries with "+N more"; Eloqua Partner tasks are marked automated.
- **Pre-Conversion**: Project Site State added (Salesforce's own Country → State dependency).
- **Header** shows company (or the homeowner's name) · Lead City, State Zip · Rep, then submitted time, email, phone.
- **Windfall Information** card (Homeowners): grade, estimated property value, net worth (plus high/low), last
  calculated date, additional property values 1-3; notes when there is no Windfall data or the grade is "5 U".
- **Project Coordinator** (user lookup) and **Lead Funnel Timestamp** are editable and save with Save / Hand off.
- **Populate Project** (Homeowners): Project Name = "<Last name> Residence - City, ST" from Project Site City/State
  (else the Lead's address) + Residential / Single Family - Remodel / Living Room. The prototype's zip-code lookup is
  not built (needs a postal-code service).
- **Draft email** body lists the submission fields in the LDR team's order (Frame is blank: no such field exists).
- **CSS classes are all prefixed `ldr-`** so Salesforce or package global styles can't hit generic names like
  `.banner`, `.tag`, `.stage`, `.card`.
- **Excluded**: submissions with Inquiry Type "Representative" never appear in the inbox.
- **Wrong profile** requires a Status Reason (`Lead.Status_Reason__c`), enforced in the UI and in Apex.
- **Stale Nurture**: an unclaimed submission on a Lead still marked Nurture gets a "Lead was Nurture" tag and banner;
  claiming it reactivates the Lead to Working.
- **Assign to coordinator**: when an unclaimed submission's Lead already has a Project Coordinator, the warning banner
  offers "Assign this submission to <coordinator>" (sets `Claimed_By__c` to them, Status New → Working, no notification).
- **Possible resubmission**: other submissions on the same Lead within 15 minutes are labelled as such under related activity.
- **Sort**: Contractor & Architect → Business Owner → Homeowner → other; oldest first within each.
- **Claim**: locks the submission row, fails with a conflict banner if someone else already has it;
  otherwise sets `Claimed_By__c`/`Claimed_Date__c` and Status New → Working.
  `Lead.Project_Coordinator__c` is set to me **only if it was blank**; an existing coordinator is left unchanged.
- **Release**: clears the claim and Status Working → New. Clears Project Coordinator **only if this claim set it**,
  detected from Lead field history (a Project_Coordinator__c change by me at/after the claim time).
  Apex tests can't see field history, so tests use a simpler rule.
- **Homeowner leads** show Windfall grade, Additional Windfall Property Value 1 and Net Worth
  (low–high confidence range, else `wf_net_worth__c`). Other customer types don't show Windfall data.
- **Matched account** card when LeanData has set `Reporting Matched Account`: past opportunity and order counts,
  funnel stage, competitor flag (all from the Lead's `Matched_Account_*` fields), and up to 3 recent projects
  from that Account's Opportunities (`Opportunity.Project_Name__c`).
- **Queue card tags**: "+N KBMax · +N Estimate" (quotes/estimates on the Lead), "Claimed, still New" (Mine tab).
- **Save / Hand off**: only the claimer. Hand off = Status Qualified + Outcome "Hand-off to Rep".
- **Log a call**: inserts a completed Call Task on the Lead. (Not appended to LDR Notes – that field is only 255 chars.)
- Auto-refreshes every 60 s (configurable). This is polling, not real-time push.
- **Opening records** (Open Lead, Review Lead, Open Form Submission, related items):
  in the LDR Console they open as workspace tabs beside the inbox, which stays as it was.
  In a standard (non-console) app they open in a new browser tab instead.
- The inbox remembers the selected tab, type filter and lead for the browser tab (sessionStorage),
  so a page reload doesn't reset the LDR's place.

## Left out on purpose (from the design)

- "Sample" / "illustrative" tags (prototype-only).
- info@ email items and "Create lead from email" (phase 2, needs Microsoft 365 integration).
- Owner-rep notification on hand-off – relies on whatever automation already fires on Status/Outcome change.
- The "you'll both get a reminder" notification on take-over (no flow/email built; the inbox shows its own "You took
  this over from …" banner).

## Known risks / to verify in sandbox

### v5.6p (2026-11-02)
- After deploying, open Setup → Permission Sets → LDR Inbox User and check it lists only the Apex class and the two
  LDR_Profiler pages. If the old object and field entries are still there, remove them by hand. A deploy may leave
  entries the file no longer lists.
- Test as a regular LDR, not an admin:
  - claim and release
  - save LDR Fields and Project Details
  - Quick Edit
  - Convert / Hand-off
  - a KBMax checkbox
  An "insufficient access" or "field hidden" message means the profile is missing that permission (see v5.6p under
  Behaviour).

### v5.6 (2026-11-02)
- The four new Lead fields must exist in the target org: the permission set names them. Check that an LDR, not an
  admin, can save Quote Requested and Project Timeline.
- The Project Details popup sits inside the LDR Fields card (`position: fixed`). Check in Salesforce that it covers the
  page like Quick Edit and isn't clipped.
- The ZIP+4 validation error still fires when Project Details are saved on a Lead with a ZIP+4 PostalCode, now from the
  popup's Save. It's parked; the suggested fix is the rule comparing `LEFT(PostalCode, 5)`.
- A wider Project Site Zip needs separate address fields instead of `lightning-input-address`, which loses Address
  Search.

### v5.5g (2026-10-30)
- `KBMax_Web_Quote_Junction__c` must exist in the target org: the permission set names it. LDRs also need Read on
  KBMax_Web_Quote__c and Edit on the new Opportunity (master-detail). Check that an LDR, not an admin, can check a
  quote.
- Attach to Opportunity's Files step picks the Contact's newest open Opportunity from the last 30 minutes. If the flow
  doesn't add the Contact as a Contact Role, the new Opportunity isn't found and there's no Files step.
- Does `Contact_New_Opportunity` need `Selected_KBMax_Rows` for anything besides creating junctions (e.g. a screen)?
  The flow owner should confirm. It's no longer sent.

### v5.5d (2026-10-30)
- **Zoom 0.9:** check in Salesforce that these land in the right place and size:
  - the dropdowns (Junk ▾, the Project Coordinator picker, address lookups, `lightning-combobox` lists);
  - the lightbox;
  - the flow windows.

  `zoom` is applied to the inbox only. Salesforce's own toasts and modals aren't scaled. LDRs who keep the browser at
  90% should go back to 100%.
- **Link to Existing search** uses SOSL, so new records appear once Salesforce has indexed them (usually seconds).
  It's unverified in the org whether a 4-digit phone fragment is found by SOSL; the Apex test uses fixed search
  results.
- **Not built:**
  - Project Details' Zip on its own line and the Project Site Country indent (#161), and the multi-line Project Site
    Street (#160). All three are inside `lightning-input-address`, whose layout can't be styled from outside. Fixing
    them means replacing it with separate fields, which loses the Address Search.
  - Attaching the form's files to the Opportunity automatically. Dropped (Aqil, 2026-10-30): the Convert and Attach to
    Opportunity windows have Download + previews instead (v5.5f).
- **ZIP+4 error (#160 / #161):** no cause found in the code, which only cuts zips to 5 digits for lookups and never on
  save. Production has Leads with ZIP+4 in PostalCode and Project Site Zip that users and Eloqua saved this week. The
  exact error text is needed.

### v5.5 (2026-10-29)
- **The five new fields must exist in the target org** (`ClaimedDate__c` on all three objects, `Comments1__c` on Form
  Submission, `Comments__c` on Instant Estimate and KBMax): the Apex reads some of them in static SOQL, so the deploy
  fails without them. They're in production (2026-10-29); create them in the sandbox (or refresh it) before testing.
- Run **Move Now** once right after the deploy (admin). Until then nothing breaks (reads check both places), but
  Claim Audit / the uncontacted alert skip claims that have no `ClaimedDate__c`.
- Anything else that reads `Claimed_Date__c` (reports, list views, flows) stops getting new values.
- **v5.5c (2026-10-30), after a failed test run (7 of 76):** the test fixes don't depend on who runs the tests or on
  newer org automation:
  - the Claim Audit tests no longer leave out Aziz's own claims when he runs them (the audit always excludes Aziz);
  - the link-by-email test creates its Contact after the submissions, because Zaid's "Form Submission - Link Contact
    by Email" before-save flow (2026-10-27) now links them on insert;
  - the exact-email search test uses two emails, because a validation rule refuses a Contact whose email a Lead
    already has;
  - two assert messages couldn't be null; the claim time is compared in whole seconds.

  Fixed in the code: the Salesforce search failed on any SOSL reserved character such as `( ) - + *`, because
  `\(` isn't valid inside `FIND '...'`. Those characters are now searched as spaces, and the results are still
  filtered on the full text.

### v5 (2026-10-28)
- **Deploy order:** Zaid's `Convert_Lead` and `Contact_New_Opportunity` updates (both with a `skipNavigation` input)
  must be active in the org before or with v5; otherwise the Convert / Attach to Opportunity windows error. Both are
  active in production (2026-10-29); check the sandbox has them before testing there.
- Check that the popups (Quick Edit's Address Search dropdown inside the dialog), header lines 1–2 with long text,
  the 44px centring and the LDR-field edges look right in Salesforce.
- 6Sense: check counts against the canvas snapshot (Oct 27: 201 replies from 191 Leads) and that LDRs other than
  Aqil / Aziz see no 6Sense tab or search matches. The owner-alias map is copied into `ldrSixSense.js`; keep it in
  step with `repRouting.js`.
- Take-over reminder dismissals live in each browser's `localStorage`, so they don't follow a user to another computer.

### v4c (2026-10-27)
- **Queue row cap:** `getQueue` reads at most `MAX_ROWS` form submissions, newest first. It was 500 and production on
  2026-10-27 had 727 non-Representative submissions from the last 30 days, so the oldest ~227 (217 of them claimed)
  weren't loaded. Raised to 1000, which covers today's volume with ~270 to spare. If 30-day volume passes 1000, old
  claimed rows drop out of Mine / Finished / All again; the lasting fix is to read claimed rows in their own query.
  Check the inbox's load time and that the Apex response stays within limits with ~1000 rows in the sandbox.
- Convert → Qualified: check in the sandbox that a validation rule or flow doesn't block the Contact update right after
  conversion (the error is shown, nothing else is blocked).

### Production checklist (2026-10-09, updated 2026-10-13)
- Deploy the `NanaWallFonts` static resource with the LWC (it is in the package). Fonts are OFL; keep `OFL-LICENSE.txt` in the zip.
- The CSP Trusted Site `NanaWall_Uploads` was removed from the package (Zaid's v33): confirm it exists in the target
  org, or nanawall.com attachment thumbnails won't load. (The LDR Console app and tab are in use in production.)
- `LDR_Prospect_Since` is Sep 1, 2026 in this package; a deploy overwrites the label value.
- Confirm the link safety net's on-load writes are wanted in production (it edits Form Submission links and Comments).
- Run all Apex tests in UATFullSB first; Claude has not compiled or run them.
- The two new Visualforce pages deploy with the package; confirm the Profiler fills the box for an LDR user. The
  permission set grants `Profiler_Contact` / `Profiler_Lead` page access: confirm those pages exist in the target org
  (not queryable through the read-only connection).
- Rep display is display-only; blank `Territory__c` falls back to owner + location (amber).
- Claim overwriting the coordinator is a behaviour change: an LDR claiming a resubmission now replaces a colleague's
  coordinator on the Lead. Confirm the team wants that before production.
- Release's restore depends on Lead field history for `Project_Coordinator__c` and `Lead_Funnel_Time_Stamp__c`
  (both tracked in production, re-checked 2026-10-21; check the sandbox).
- `Form_Submission__c.Contact__c` must exist in the sandbox (it exists in production).
- **v4:**
  - Salesforce search and the uncontacted alert run with the LDR's sharing: check as a non-admin LDR that they see
    the Leads / Contacts they should. Claim Audit needs Aqil / Aziz to read every LDR's Leads, Contacts and Tasks.
  - Partial Salesforce search matches word starts ("atel" won't find "Patel"); new records can take minutes to show.
  - Claim times without coordinator history fall back to 8:00 AM Pacific on the Claimed Date, which can mark a claim
    Late (or not) wrongly; a Datetime claim field would fix it.
  - 24 hours is clock time (weekends count), and a hand-off email to a rep doesn't count as contact.
  - The uncontacted alert has no time limit (claims since Oct 6); `#NoContactNeeded` goes into the customer's
    Questions or Comments text, so reports and exports of that field will show it.
  - Instant estimates: the permission set has no `Website_Instant_Estimate__c` entries; × on an estimate needs edit on
    its Questions or Comments from the profile (junk marking already relies on that).
- **Post Quote (v3):**
  - Check it as a non-admin LDR: replies on Contacts / Opportunities the LDR can't see drop out, so counts can differ
    per LDR.
  - "Action taken" edits the reply Task in user mode; check LDRs can edit those Tasks (owned by 6Sense Integration
    User) and that no Task trigger or flow objects.
  - Done time is the Task's Last Modified Date, so any later edit to that Task restarts its 7 days in Finished / All.
  - Every inbox load reads up to 2,000 reply Tasks since `LDR_Prospect_Since` (541 on 2026-10-21) and the window only
    grows; move the label forward from time to time.
  - Address search (Quick Edit, Project Site): check the lookup returns results in the console app and that its
    country / state values map as expected.

- The permission set grants access to the Convert_Lead flow. Whether LDRs can complete a conversion there also
  depends on the flow's own logic and their Lead convert permission (not checked).

- **Field-level security.** The permission set now grants read (and edit on the claim + LDR fields) for every
  Form Submission and Lead custom field the inbox uses. Assign it to **every** user of the inbox, admins included.
  If a field is still unreadable, the inbox shows a yellow banner listing it instead of failing.
- If the permission set deploy fails with "not permissionable" or "required field" for a field, remove that
  one `<fieldPermissions>` block (formula, required and some managed fields can't be granted this way).

- Matched-account data comes from LeanData-maintained Lead fields; order count and funnel stage are blank on many Leads.

- In a standard app, the browser may block the new tab as a pop-up the first time; allow pop-ups for the Salesforce domain.

- Apex not compiled yet; expect a first-deploy fix or two.
- Tests insert Leads and Form Submissions; validation rules, DupeBlocker, LeanData or other triggers
  may block those inserts. Adjust `makeLead()` if so.
- `Type__c` is blank on almost all recent submissions, so the form label falls back to `Inquiry_Type__c`.
- The "form vs Lead" mismatch checks are limited to Application and UTM campaign.
- No end-user QA, accessibility audit, or load test has been done.
