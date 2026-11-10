# LDR Inbox – refactor log (2026-10-20)

Scope agreed with Aqil: **fix confirmed bugs and security issues, remove verified dead code, make small
consolidations. Behavior and UI stay the same; no file splits, no new features.** Anything that changes business
behavior or needs a design or admin decision is listed under [Not changed](#not-changed--needs-a-decision) instead
of being done.

- **Baseline:** `_baseline/original-2026-10-20.zip` (force-app, README, config, taken before any edit).
- **Full line diff:** `_baseline/refactor-2026-10-20.diff`.
- **Rollback:** unzip the baseline over the project.

## How this was checked, and what was not

| Check | Result |
|---|---|
| LWC compile: every js/html/css with `@lwc/compiler` 9.5 | Pass. It passed before the refactor too. |
| ESLint: `@salesforce/eslint-config-lwc/recommended` (the repo's config) | Pass, 0 errors. Before: 17 errors, all unused `catch (e)` bindings. |
| Template bindings: every root `{x}` in each template is a member of its class | Pass. Checked by script, which was confirmed to catch a planted bad binding. |
| Apex syntax: `prettier-plugin-apex` parse of both classes | Pass |
| **Apex compile against the org schema** | **Not done.** No `sf` CLI and no org access here. |
| **Apex tests** | **Not run** (they never have been). |
| **UI in a browser / org** | **Not done.** No visual or functional test of any change. |

Before production, deploy to a sandbox and run `LdrInboxControllerTest`, as the README already says. Then click
through the items marked 🔍 below.

---

## Changes

Legend: 🐞 bug fix (behavior changes, but only the broken part) · ♻️ refactor (same behavior) · 🧹 dead code removed
· ♿ accessibility · 🔍 worth a manual check in the sandbox.

### Apex: `classes/LdrInboxController.cls`

| # | Type | Change | Why |
|---|---|---|---|
| A1 | 🐞 ♻️ 🔍 | **`restoreJunk`: no SOQL inside the loop.** The rows whose junk tag carries `{prev:…}` are now read in one query per object (new `readItems`) instead of one `readItem` query per row. | Restoring many rows at once could hit the 100-SOQL limit. If a row isn't visible, the error message is the same as before. |
| A2 | ♻️ | **`queryItem` refactored.** The per-object SELECT moved to the new `itemSelect(SObjectType)`, which `queryItem` and `readItems` share. Fields, `WITH USER_MODE`, `FOR UPDATE` and error messages are unchanged. | Avoids keeping two copies of the three SELECT strings. |
| A3 | ♻️ | **Describe cache.** `hasField` now uses `fieldMap(objectName)`, which caches each object's field map for the transaction. `claimDateValue`, `describePicklist` and `typedValue` use it too. | `hasField` ran `Schema.getGlobalDescribe()` plus a field describe 100+ times per `getQueue`, and once per row in `fixLinks`, which costs CPU time. |
| A4 | 🐞 | **`typedValue`: null guard.** A field missing from the org (for example `X6Sense_Option__c` in some sandboxes) now gives "<field> doesn't exist on <object> in this org." | Before, the save failed with "Attempt to de-reference a null object". |
| A5 | 🐞 | **`junkTargets`: skips null Ids** (matches `linkFixTargets`). | A null in the list threw a raw NullPointerException. |
| A6 | 🐞 | **`claimFrom`: the stale-claim check is now required.** A null `expectedClaimerId` is treated as a conflict. | Before, sending null skipped the check and took over anyone's claim. The LWC and the tests always send the Id, so they behave the same. |
| A7 | 🧹 | Removed `RESUBMIT_WINDOW_MINUTES`, `PROSPECT_PEOPLE_LIMIT`, `Item.inquiry` (assigned, never read) and an unused `binds.put('people', …)`. | Zero references in the Apex, the tests or any LWC. |
| A8 | ♻️ | `getQueue` uses the existing `ACTIVE_STATUSES` constant instead of a second identical set. | Removes duplication. |
| A9 | ♻️ | New `PACIFIC_TZ` constant replaces 5 copies of `'America/Los_Angeles'`. | Removes duplication. |
| A10 | ♻️ | Doc fixes: the `estimates` comment named a label that doesn't exist (`LDR_Estimate_Cutoff` → `LDR_Estimate_Date_Windows`). The `statusChangedAt` comment claimed ConvertedDate was used (it isn't). The stale 2026-09-30 STATUS header now points to README / this log. | Comments didn't match the code. |

### LWC: `ldrInbox` (main inbox)

| # | Type | Change | Why |
|---|---|---|---|
| I1 | 🐞 | **`load()`: request sequencing.** The refresh timer and action handlers can overlap. Now only the newest `getQueue` reply updates the queue, `loading` and `loadError`. | An older, slower reply could overwrite a newer queue, for example right after a claim. |
| I2 | 🐞 🔍 | **Restored selection loads all its data.** After a page reload (selection restored from sessionStorage), the row now loads configurator quotes and the email match too, through the new `loadSelectionData()`, which `selectRow` also uses. | A restored 3D-configurator row showed "Loading…" forever. |
| I3 | 🐞 | **Row-switch races.** In `loadRelated` (contact opportunities, account, person submissions, related items), `loadEmailMatch`, `loadClaimContext` and `loadTimeline`, a late failure for the previous row no longer clears the current row's data. `timelineLoaded` is only set by the current row's request. | Switching rows quickly could blank the new row's cards, or briefly show "No history". |
| I4 | 🐞 | **All Submissions: request sequencing** (`loadAllSubs`). | "Past year" then "Past 7 days": the slower year reply arrived last and showed under the 7-day label. |
| I5 | 🐞 | **`isoDay` uses Pacific dates** (same as `todayPacific()`), not UTC. | After about 5pm Pacific, the All Submissions range moved a day ahead and the label showed tomorrow. |
| I6 | 🧹 | Removed unused members: `showInboxBody`, `notesMax` / `NOTES_MAX`, `projectMax` / `PROJECT_MAX`, `handleProject`, `handleNotes`, `sequenceInOutreach` (and its `openSubtab` / `getFocusedTabInfo` imports, plus `detailExtras.canSequence`), `openConvertFlow`, `estimateWindows` (write-only) and `projectDetailsEdited` (write-only). Also removed `mapRow.initials`, which was unused and could throw on a blank name. | Each was checked with a whole-word grep across every LWC js/html, and again with the template-binding check. Sequence in Outreach and the tab-based Convert flow had no button left; Hand-off uses the in-page flow modal. |
| I7 | ♻️ | `chipCls()` replaced by the `CHIP_CLASS` map already exported from `prospects.js` (same classes). | The export was unused, and the function duplicated it. |
| I8 | ♻️ | 13 unused `catch (e)` bindings → `catch {` (2 more in ldrEstimate, 2 in ldrListViewPanel via L5). | ESLint errors. |
| I9 | ♿ | The prospect card (`role="button"`) now opens on Enter / Space (`handleProspectCardKey`). Keys pressed on the phone link or Claim button inside the card are left alone. | Before, the card could be focused with the keyboard but not opened. |
| I10 | ♿ 🔍 | The inbox message (`.ldr-toast`) now sits inside a `role="status" aria-live="polite"` wrapper that is always rendered. The wrapper is `display: contents` (`.ldr-live`), so the card's flex gap is unchanged. | Screen readers didn't announce messages. |
| I11 | ♿ | "↻" reload-prospects button: added `aria-label`. | It had no accessible name. |
| I12 | ♻️ | "Check before hand-off" list: items are keyed by position (`{key, text}`), not by message text. | Two identical messages would have collided as for:each keys. |
| I13 | 🧹 🔍 | **`ldrInbox.css`: removed 59 dead rules and 12 selectors from grouped rules (about 180 lines)** for 39 classes that appear in no html or js and aren't built by JS: `ldr-title`, `ldr-hint`, `ldr-avatar*`, `ldr-attachment`, `ldr-att-kind/-name`, `ldr-btn-green/-warn/-unlinked*/-fetr/-outreach`, `ldr-tag-neutral/-warn/-unlinked/-status`, `ldr-ce-blue/-green/-amber/-grey/-red/-teal` (6sense colors are inline styles now), `ldr-chip-on/-windfall/-studio`, `ldr-row-late`, `ldr-seq-line`, `ldr-mark` and others. The only grouped-selector edit: `.ldr-title, .ldr-d-name, .ldr-dialog-title` → `.ldr-d-name, .ldr-dialog-title`. | Dead styles. Classes that are built dynamically (`ldr-copp-*`, `ldr-opp-*`, `ldr-stage-*`, `ldr-inq-*`, `ldr-campaign-*`, `ldr-allsub-*`) were kept. |

### LWC: `ldrDashboard`

| # | Type | Change | Why |
|---|---|---|---|
| D1 | 🐞 🔍 | **My Dashboard reloads when an admin changes "View as".** `userId` is now a getter/setter that reloads on change, with a request counter so a slow earlier reply can't overwrite a newer one. | The component stays mounted when View-as changes, so it kept showing the previous person's KPIs, speed and trends under their name, mixed with the new person's suggested actions. |
| D2 | ♻️ | `sum()` only recurses into objects. | A string value would have recursed forever. Today's data is always numbers, so nothing visible changes. |
| D3 | ♻️ | New `asOfText()` replaces 3 copies of the "as of" formatting. `pct()` is reused in two places that inlined the same math. `colorOf` is built once per getter instead of once per lookup (about 200 rebuilds per render before). | Removes duplication and wasted work. |
| D4 | 🧹 | CSS: `.db-title` / `.db-kpi-v` were each declared 2–3 times with later rules overriding earlier ones. They are merged to their final computed values. Removed a duplicate `.db-pill-on` and the unused `.db-dot`. | Final styles are identical (`font-family: inherit` = unset for an inherited property). |

### LWC: `ldrListViewPanel` (Lead Views)

| # | Type | Change | Why |
|---|---|---|---|
| L1 | 🐞 🔍 | **Percent columns use the `number` type.** | Salesforce percent values are whole numbers (50 = 50%), but the datatable `percent` type multiplies by 100, so 50 showed as "5,000%" and edits used that scale. |
| L2 | 🐞 | **Change Status selects stay in sync.** Options now carry `selected` from `newStatus` / `newReason`. | Switching Status between Wrong profile and Disqualified clears the reason, but the browser kept showing the old option while Save stayed disabled. |
| L3 | 🐞 | "↻ Run again" is disabled while the report runs, and `loadReport` ignores re-entry. | Double clicks started parallel Apex calls. |
| L4 | ♻️ | `columns` is cached on (list info, object info). | It was rebuilt on every render, including every search keystroke, which can also reset the user's column widths. |
| L5 | ♻️ | New `refreshSaved()` replaces the notify + refresh block that was duplicated in `saveStatus` and `handleSave`. | Removes duplication. |

### LWC: `ldrPostQuote` (admins)

| # | Type | Change | Why |
|---|---|---|---|
| P1 | 🐞 | Changing the filter or search re-selects the first visible row when the selected one is filtered out (new `keepActiveVisible`, also used by `load`). | The detail pane could show a row that wasn't in the list. |
| P2 | 🐞 | "Full email in Salesforce ↗" only renders when there is an email Task. | When there wasn't one, the link did nothing. |
| P3 | ♻️ | The detail view model `d` is cached on (active row, its draft, picklists). Its body moved to `buildDetail`. | The template reads `{d.x}` about 55 times per render, so the regex reply-trimming and option lists were rebuilt about 55× per keystroke. |
| P4 | 🧹 | Removed the unused `hasOthers`. CSS: removed unused `.pq-purple`, `.pq-btn-green`, `.pq-btn-primary`, `.pq-textarea` and `.pq-mark`. Merged the three `.pq-title` rules into their final values. | Dead code. |

### Other files

| # | File | Change |
|---|---|---|
| O1 | `lwc/ldrTypeIcon/ldrTypeIcon.html` | Business Owner icon: removed a duplicated `<path>` (drawn twice). |
| O2 | `lwc/ldrEstimate/ldrEstimate.js` | 2 unused catch bindings (ESLint). |
| O3 | `README.md` | Corrected "All queries/DML run in USER_MODE". Writes and claim/lock reads are USER_MODE; other reads are system mode plus `stripInaccessible`, with sharing enforced. Added a pointer to this log. |
| O4 | `.gitignore` | Ignore `_baseline/`. |
| O5 | `REFACTOR_LOG.md` | This file. |

---

## Production review (2026-10-21)

The first pass was done without access to production. This pass checked the refactor, and every hard-coded value the
code depends on, against production: schema describes and about 50 read-only SOQL queries. Nothing was written to
Salesforce. Changes are on branch `refactor/prod-review-2026-10-21` (PR into `refactor/2026-10-20`).

### Refactor changes re-checked: none needs undoing
- **I5 All Submissions dates in Pacific:** right. `getAllSubmissions` turns the dates into Datetimes in the running
  user's time zone, and both admins (and all 7 LDRs) are on America/Los_Angeles.
- **L1 Percent columns as `number`:** right, rarely visible. The only percent-type Lead field is `wf_loan_to_value__c`.
  The type is only used for columns the user can edit; other columns show Salesforce's own formatted value.
- **A6 `claimFrom`:** the LWC always sends the expected claimer. **A3 describe cache, A4 / A5 null guards, A1 bulk
  read:** no data dependency. **I6 / I13 dead code and CSS:** nothing removed is referenced by production data.
- **Kept on purpose:** the `hasField` / `presentFields` guards for fields that do exist in production. The same code
  runs in sandboxes that may not have them yet (README).

### Hard-coded values confirmed in production
- **Statuses and picklists:** Lead Status values, Contact Lead Funnel Status values, Outcome "Hand-off to Rep", and the
  junk values (Wrong profile / Solicitation / Spam/Solicitation) are all active.
- **Populate Project:** Residential → Single Family - Remodel → Living Room is a valid dependent chain.
- **Form and estimate values:** customer types (the 4 values), inquiry types, Estimate Amount "Custom", and the
  instant-estimate price table (all 49 frame × width × height combinations seen in the last 20 days match).
- **6sense:** the status codes exist.
- **Post Quote:** Project Lost → Competitor chain is valid.
- **Users:** the admin User Ids (both active), the dashboard LDR names, and the rep-routing names.
- **Field types:** `Claimed_Date__c` is a Date on all three objects.
- **Metadata:** the 3 report Ids, the 4 list views, and the `Convert_Lead` flow (active) all exist.

### Changes on this branch
| # | Type | Change | Why |
|---|---|---|---|
| P1 | ♻️ | `speedFor` reads only Tasks owned by the claimers (`OwnerId IN :claimers`). | The calculation only ever looks up `<person>:<claimer>`, so results are identical. In production about 70% of the Tasks on these people are Eloqua Partner tracking Tasks (724 of 1,061 since Oct 6), so the query reads about a third of the rows and the 20,000-row cap is reached much later. |
| P2 | 🐞 | Windfall "Net Worth Last Calculated" shows the date, not "Invalid Date". Apex `windfallValues` now sends a Date as `yyyy-MM-dd`. The LWC formats only a real `YYYY-MM-DD` (`wfDateLabel`); blank or invalid → blank, so the FETR leaves the line out. | `wf_net_worth_calculation_date__c` is a Date. `String.valueOf(Object)` gave `"2026-10-13 00:00:00"`, which hit every Contact's Windfall date. Same code as on `ldr-inbox-updates` (canvas #121), so the branches merge cleanly. The canvas's design-only part of #121 (dropping the "(Windfall from the converted Lead)" FETR line) is not on this branch. |
| P3 | 🐞 | The 6sense "last synced" Datetime goes to the LWC as ISO 8601 GMT (`…T14:05:00Z`). | `sixsense_ce__last_synced_at__c` is a Datetime; `String.valueOf` gave `"2026-10-21 14:05:00"` (GMT, no zone). Chrome read it as local time, so dates near midnight were off by a day; Safari shows Invalid Date. |
| P4 | 🐞 | `6Sense Integration User` added to `AUTOMATION_USERS`. | It creates about 2,100 Tasks a week; the activity timeline showed them as a person's activity (only Eloqua Partner was greyed as automation). |

### Found in production; needs a decision or admin work (not changed)
1. **Lead Status Reason dependency (admin):** Lead `Status_Reason__c` depends on Status, but only Bad Data / Wrong
   number / Unresponsive are mapped (to Unreachable). Nothing is mapped to **Wrong profile** or **Disqualified**, yet the
   inbox (and Lead Views Change Status) requires a reason for them, and junk writes Wrong profile + Solicitation.
   - Apex saves these anyway: 5 Leads already have Wrong profile + Solicitation.
   - On the standard Lead page, though, Status Reason offers nothing for those statuses.
   - Fix: an admin maps the reasons (at least Solicitation, Bad Data, Wrong Contact, Product Fit, Budget, Out of
     Territory) to Wrong profile and Disqualified under Lead > Status Reason > Field Dependencies.
   - No code change. Contact `Status_Reason__c` isn't dependent, so it's fine.
2. **Legacy statuses aren't reset on claim (business decision):** `CLAIM_RESETS_STATUS` lists only active values.
   - Production still holds inactive ones: Lead Attempting Contact 205, Close - No Further Action 136, Not Engaged 42, …;
     Contact Inactive 40,276, Awaiting Info 1,585, Re-Engaged 784, Remarket 703.
   - 14 submissions in 90 days were linked to such records.
   - Claimed, they keep the old status, aren't New / Working, and drop out of Mine and All immediately.
   - Option: reset whenever the status isn't New / Working (`!ACTIVE_STATUSES.contains(st)` in Apex, and the same in the
     JS warning lists). That would set e.g. Inactive Contacts to New on claim, so it's the team's call.
3. **`Convert_Lead` input is a Lead record variable,** but the inbox passes `recordId` as a String (and the "Doesn't
   load?" link uses `?flow__recordId=`). Aqil's #129 report shows the embedded flow running, so leave it; just confirm
   in the sandbox.
4. **Smaller ones:**
   - **Dashboard 6sense colours:** `CE_COLORS` has no colour for `not_started`, `stop_responding` or `import_error`
     (Contacts: 24 / 3 / 66), so they're left out of the bars and legend. Needs colours (design).
   - **Post Quote segment regex** misses `6S.4.EV.O.COM<150k…` campaigns (233 Contacts: no `_`, segment "O" unmapped).
     Needs the meaning of "O".
   - **Populate Project:** falls back to the form's Country, which can be "Other" (not a Project Site Country value);
     long street / zip values can exceed the Lead field lengths (Project_Site_Zip_Code__c is 12).
   - **Timeline noise:** `Do_Not_Synch_with_Eloqua__c` history (about 1,000 rows in 3 days, Eloqua Partner) isn't
     filtered and can crowd the timeline.
   - **Not checked:** whether the `Profiler_Contact` / `Profiler_Lead` VF pages the permission set grants exist in
     production (deploy fails if not), and Aziz's access to the "Lead Journey" report folder and the "AB - …" list views.

## Not changed – needs a decision

These came up in the review but would change business behavior, need an admin or design call, or can't be done safely
without an org or browser. They are ordered roughly by risk.

### Decided 2026-10-20 (Aqil)
- **Field access (item 1):** everyone with access to the app has read/write on the fields they need. No permission set
  change.
- **Admins (item 3):** keep the two hard-coded admin User Ids as they are.
- **Production field check** (read-only schema describe, 2026-10-20, as Aqil): every custom field the Apex and LWC
  reference exists in production on the expected objects, except `KBMax_Web_Quote__c.Position_file_image_1_Id__c`
  to `_4_Id__c`. Those are read only when present (`presentPaths`), so nothing breaks; the inbox falls back to
  `Position_File_Ids__c`. Also confirmed:
  - `Claimed_By__c` is Lookup(User) and `Claimed_Date__c` is a **Date** on all three queue objects.
  - `Website_Instant_Estimate__c.Frame_Width__c` / `Frame_Height__c` are picklists, so the static `String.isBlank`
    references compile.
  - `Lead.UTM_Campign__c` (misspelled) does exist, so its permission set entry (item 19) is valid.
  - `Contact.Status_Reason__c` and `X6Sense_Option__c` (Lead + Contact) exist.

### Security / access
1. **The permission set doesn't grant edit on fields the code writes in USER_MODE.** These fail unless the LDR
   profile grants them:
   - `Form_Submission__c`: `Lead__c`, `Contact__c` and `Comments__c` are read-only here.
   - `Website_Instant_Estimate__c` and `KBMax_Web_Quote__c`: no object or field entries at all.
   - Not granted: `Lead/Contact.X6Sense_Option__c` and `Contact.Status_Reason__c`.

   The README says the profile covers some of these, so this may be intended. **Confirm with a `System.runAs` test as
   a non-admin LDR who has only this permission set and profile.** The tests run as an admin, so they can't catch it.
2. **`fixLinks` (the link safety net) runs for any user on every inbox load.** It reads by email in system mode and
   rewrites `Lead__c` / `Contact__c` / `Comments__c`. The writes are USER_MODE. Options:
   - make the email lookups `WITH USER_MODE`, or
   - move the safety net to a scheduled job or flow.

   The README already asks whether the on-load writes are wanted in production.
3. **The admin list is two hard-coded User Ids** (`adminUserIds`). A Custom Permission (`LDR_Inbox_Admin`) checked
   with `FeatureManagement.checkPermission` would be cleaner. It needs an admin to create and assign it, and about
   15 test edits.
4. **Hard-coded report Ids** in `ldrLeadViews.js` only work in the org that owns them. Resolve them by DeveloperName
   in Apex instead. *(2026-10-21: all 3 Ids exist in production with the expected names, in the shared folder "Lead
   Journey"; the 4 list view API names exist too. Fine for production; only a sandbox or other org needs this.)*

### Behavior / data
5. **`isStaff` (prospects.js) matches substrings.** For example, prospect "Ann Lee" with owner "Joanne Kleeman"
   counts as staff and is hidden. Comparing whole name tokens fixes it, but it changes which prospects show, so the
   team should agree first.
6. **Mixed time zones.** Claim, claimFrom and createLead stamp `Date.today()` (the user's time zone); junk and status
   use Pacific. In the LWC, `when()`, `ageLabel()` and opportunity dates use the browser's time zone, while other
   labels say "PT". It only matters for non-Pacific users. Pick one convention. *(2026-10-21: both admins and all 7 LDRs
   are on America/Los_Angeles in production, so there's no visible effect today.)*
7. **Speed numbers row budget** (`speedFor`, used by the Boss View LDR Dashboard Speed section and by My Dashboard,
   which also computes the team's same-day rate). Since `SPEED_SINCE` (Oct 6) it reads:
   - claimed Form Submissions (cap 5,000),
   - every Task on those Leads / Contacts, by anyone, including automation (cap 20,000),
   - Lead and Contact status history (cap 20,000 each),
   - converted Leads (no cap).

   Salesforce allows 50,000 rows per request, and going over can't be caught: the whole dashboard fails. Production
   2026-10-20: 385 claimed submissions and about 960 Tasks in two weeks. Two problems as it grows:
   - The Task cap fills first (around 10 months at this rate). After that the speed numbers are silently wrong.
   - Later, the total can pass 50,000.

   Fix: only read Tasks owned by the claimers (`OwnerId IN` the claimer set), the only ones the calculation uses.
   Better still, cap each query from the remaining budget. *(2026-10-21: the claimer filter is done, see P1 under
   "Production review". The per-query budget cap is still open.)*
8. **Weekend math uses `format('E')`**, which depends on locale. It breaks for an admin whose locale isn't English.
9. **Post Quote stage tags all render grey.** `.pq-tag` comes after `.pq-stage-*` at the same specificity, so the
   teal / green stage colors never show. This may be intended (it came in with the dd24 review). Decide, then
   reorder or delete. A note is in the CSS.
10. **`--green` and `--green-dark` are both `#4A6D22`** in `ldrInbox.css`, so the hover and dark states that use
    `--green-dark` show no change. Setting it to `#194D19` is a visible change.
11. Small text mismatches:
    - "No outreach in 5+ days" only flags at 6 or more days.
    - "Showing the top 10 by points" actually shows the 10 newest.
    - The dashboard "finished" count uses a narrower rule than the Finished tab.
12. **Post Quote:** Opportunity Stage offers a blank "--None--" that Apex rejects. Drafts are lost when you switch
    tabs.

### Code health (bigger refactors, deliberately not done now)
13. **`get active` in ldrInbox.js is a 486-line getter, read about 200 times per render.** This is the biggest
    performance cost in the UI. Caching it safely needs its full input list or a split into smaller getters. Do it
    with browser testing available.
14. **Remaining `ldrInbox.css` cascade layers.** 159 selectors are defined more than once, and later "canvas" blocks
    override earlier ones. Merge them with a before/after computed-style diff, not by eye. Hex values could also use
    the existing custom properties (815 hex literals, 85 `var()` uses).
15. **Splitting the 4k-line controller** into dashboard, junk/link-fix and prospects/post-quote services, keeping
    thin `@AuraEnabled` wrappers so LWC imports don't change.
16. **A shared `c/ldrUtils` module** for `errorText` (4 copies), date / age formatting and the clipboard fallback.
17. **Test class quality:**
    - Several tests `return` early or accept `fixed + failed == 1`, so they pass without checking anything.
    - Field-history branches are unreachable because of `Test.isRunningTest()`.
    - There are no `System.runAs` LDR tests.
18. **Accessibility not done:**
    - Dialogs: `aria-modal`, Escape key, focus handling.
    - Lightbox: move focus in when it opens.
    - Selected state on tabs and toggles: `aria-pressed` / `aria-selected`.
    - Dashboard tables and charts have no table / img semantics.
19. **Unused permission set entry:** `Lead.UTM_Campign__c` (misspelled) is granted but never used by the code. The
    field exists in production, so the entry is valid; removing it is optional.
